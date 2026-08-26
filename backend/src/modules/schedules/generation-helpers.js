/**
 * Utilitaires communs aux anciens endpoints de génération.
 *
 * Les dates d'un planning sont des clés de calendrier (`YYYY-MM-DD`), pas des
 * instants. Elles sont donc manipulées avec l'horloge UTC explicite uniquement
 * pour l'arithmétique, sans jamais passer par `new Date('YYYY-MM-DD')` ou
 * `toISOString()` sur une date métier.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const dateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

const isValidDateKey = (value) => {
  const key = dateKey(value);
  if (!DATE_RE.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() + 1 === month
    && probe.getUTCDate() === day;
};

const nextDateKey = (value) => {
  const key = dateKey(value);
  if (!isValidDateKey(key)) return '';
  const [year, month, day] = key.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

const datesInRange = (startDate, endDate) => {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!isValidDateKey(start) || !isValidDateKey(end) || start > end) return [];
  const dates = [];
  let cursor = start;
  while (cursor && cursor <= end) {
    dates.push(cursor);
    cursor = nextDateKey(cursor);
  }
  return dates;
};

/**
 * Convertit le résultat des moteurs historiques en lignes du registre Tableur.
 * Les cases explicites font foi dans `spreadsheet-reader`; la période complète
 * reste conservée pour les écrans qui affichent les bornes de participation.
 */
const generatedRows = (generated, staff, startDate, endDate) => {
  const members = new Map((staff || []).map((member) => [String(member.id), member]));
  const byUser = new Map();
  for (const shift of generated || []) {
    const userId = shift.user_id || shift.userId;
    const date = dateKey(shift.shift_date || shift.date);
    if (!userId || !date) continue;
    const key = String(userId);
    const member = members.get(key) || {};
    const row = byUser.get(key) || {
      userId,
      firstName: member.first_name || member.firstName || '',
      lastName: member.last_name || member.lastName || '',
      roleName: member.role_name || member.roleName || '',
      shifts: {},
      periods: [{ startDate, endDate }],
      periodStart: startDate,
      periodEnd: endDate,
    };
    if (shift.shift_type_id) row.shiftTypeId = shift.shift_type_id;
    row.shifts[date] = true;
    byUser.set(key, row);
  }
  return [...byUser.values()];
};

/** Congés approuvés couvrant tout ou partie de la fenêtre demandée. */
const loadApprovedLeaves = async (queryFn, userIds, startDate, endDate) => {
  const byUser = new Map();
  if (!userIds?.length) return byUser;
  const result = await queryFn(
    `SELECT a.user_id,
            TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
            at.name AS type_name
       FROM absences a
       LEFT JOIN absence_types at ON at.id = a.absence_type_id
      WHERE a.user_id = ANY($1::uuid[])
        AND a.kind = 'leave'
        AND a.status = 'approved'
        AND a.start_date <= $3::date
        AND a.end_date >= $2::date`,
    [userIds, startDate, endDate]
  );
  for (const leave of result.rows) {
    const list = byUser.get(String(leave.user_id)) || [];
    list.push(leave);
    byUser.set(String(leave.user_id), list);
  }
  return byUser;
};

const isAvailableOn = (leavesByUser, userId, date) => {
  const key = dateKey(date);
  return !(leavesByUser.get(String(userId)) || [])
    .some((leave) => leave.start_date <= key && leave.end_date >= key);
};

const filterGeneratedOnLeave = (generated, leavesByUser) => (
  (generated || []).filter((shift) => isAvailableOn(
    leavesByUser,
    shift.user_id || shift.userId,
    shift.shift_date || shift.date
  ))
);

/**
 * Écrit le registre moderne et les périodes de participation. Le caller doit
 * utiliser une transaction et prévoir le repli vers `shifts` si une ancienne
 * base ne possède pas encore les tables du registre.
 */
const persistGeneratedRows = async (client, scheduleId, rows, startDate, endDate) => {
  await client.query('DELETE FROM schedule_staff_periods WHERE schedule_id=$1', [scheduleId]);
  await client.query('DELETE FROM schedule_staff_assignments WHERE schedule_id=$1', [scheduleId]);
  for (const [position, row] of (rows || []).entries()) {
    if (!row.userId) continue;
    await client.query(
      `INSERT INTO schedule_staff_assignments
         (schedule_id,user_id,period_start,period_end,position)
       VALUES ($1,$2,$3,$4,$5)`,
      [scheduleId, row.userId, row.periodStart || startDate, row.periodEnd || endDate, position]
    );
    const periods = Array.isArray(row.periods) && row.periods.length
      ? row.periods
      : [{ startDate: row.periodStart || startDate, endDate: row.periodEnd || endDate }];
    for (const [periodPosition, period] of periods.entries()) {
      await client.query(
        `INSERT INTO schedule_staff_periods
           (schedule_id,user_id,period_start,period_end,position)
         VALUES ($1,$2,$3,$4,$5)`,
        [scheduleId, row.userId, period.startDate, period.endDate, periodPosition]
      );
    }
  }
  const spreadsheet = {
    rows: rows || [],
    customCols: [],
    week_organization: [],
    mode: 'standard',
    savedAt: new Date().toISOString(),
  };
  await client.query(
    `UPDATE schedules
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
            creation_mode = COALESCE(NULLIF(creation_mode, 'manual'), 'assistant'),
            updated_at = NOW()
      WHERE id = $1`,
    [scheduleId, JSON.stringify({ spreadsheet })]
  );
};

const dateLabel = (value) => {
  const key = dateKey(value);
  if (!isValidDateKey(key)) return '';
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, day)));
};

module.exports = {
  dateKey,
  isValidDateKey,
  nextDateKey,
  datesInRange,
  generatedRows,
  loadApprovedLeaves,
  isAvailableOn,
  filterGeneratedOnLeave,
  persistGeneratedRows,
  dateLabel,
};
