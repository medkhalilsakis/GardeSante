const { query, transaction } = require('../../config/database');
const { SHIFT_STATUS, NOTIFICATION_TYPES } = require('../../config/constants');
const { countDuty, dutyEntries, dateKey } = require('./spreadsheet-reader');
const {
  isValidDateKey,
  datesInRange,
  generatedRows,
  loadApprovedLeaves,
  isAvailableOn,
  persistGeneratedRows,
} = require('./generation-helpers');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// ============================================================
// DÉTECTION DES CONFLITS
// ============================================================

/** Minutes depuis le début du jour, avec une valeur prudente pour les anciennes
 * lignes qui ne portaient pas d'heures. Le calcul reste local aux clés DATE :
 * aucune colonne PostgreSQL DATE ne passe par `new Date('YYYY-MM-DD')`. */
const timeMinutes = (value, fallback) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return Number.isInteger(hours) && hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? hours * 60 + minutes
    : fallback;
};

const dateOrdinal = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return NaN;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
};

const entryWindow = (entry) => {
  const day = dateOrdinal(entry.date);
  if (!Number.isFinite(day)) return null;
  const start = timeMinutes(entry.shiftStart || entry.start_time, 7 * 60);
  let end = timeMinutes(entry.shiftEnd || entry.end_time, 19 * 60);
  // 07:00 → 07:00 is the Tableur's full-day/overnight convention.
  if (end <= start) end += 24 * 60;
  return { start: day * 1440 + start, end: day * 1440 + end };
};

/**
 * Lit les affectations des plannings qui se chevauchent. Le registre moderne
 * est prioritaire ; `shifts` n'est utilisé qu'en repli pour les plannings
 * historiques créés avant le Tableur (ou par l'ancien assistant).
 */
const loadConflictEntries = async (departmentId, startDate, endDate) => {
  const schedulesResult = await query(
    `SELECT sch.id, sch.name, sch.department_id, sch.status,
            sch.schedule_type, sch.metadata,
            TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(sch.end_date, 'YYYY-MM-DD') AS end_date
       FROM schedules sch
      WHERE sch.department_id = $1
        AND sch.end_date >= $2::date
        AND sch.start_date <= $3::date
        AND sch.status <> 'archived'`,
    [departmentId, startDate, endDate]
  );
  const schedules = schedulesResult.rows;
  const bySchedule = new Map();
  const legacyIds = [];

  for (const schedule of schedules) {
    // An explicit rows array (including []) is authoritative: an empty Tableur
    // must not resurrect rows left over in the legacy table.
    const hasSpreadsheet = Array.isArray(schedule.metadata?.spreadsheet?.rows);
    if (hasSpreadsheet) {
      bySchedule.set(schedule.id, dutyEntries(schedule, startDate, endDate).map((entry, index) => ({
        id: `spreadsheet-${schedule.id}-${entry.userId}-${entry.date}-${index}`,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        userId: entry.userId,
        firstName: entry.firstName || '',
        lastName: entry.lastName || '',
        date: dateKey(entry.date),
        shiftStart: entry.shiftStart || null,
        shiftEnd: entry.shiftEnd || null,
      })).filter(entry => entry.userId && entry.date));
    } else {
      legacyIds.push(schedule.id);
    }
  }

  if (legacyIds.length) {
    const legacyResult = await query(
      `SELECT s.id, s.schedule_id, s.user_id,
              TO_CHAR(s.shift_date, 'YYYY-MM-DD') AS date,
              s.status, st.start_time, st.end_time,
              u.first_name, u.last_name, sch.name AS schedule_name
         FROM shifts s
         JOIN schedules sch ON sch.id = s.schedule_id
         JOIN users u ON u.id = s.user_id
         LEFT JOIN shift_types st ON st.id = s.shift_type_id
        WHERE s.schedule_id = ANY($1)
          AND s.shift_date BETWEEN $2::date AND $3::date
          AND s.status <> 'cancelled'`,
      [legacyIds, startDate, endDate]
    );
    for (const row of legacyResult.rows) {
      const list = bySchedule.get(row.schedule_id) || [];
      list.push({
        id: row.id,
        scheduleId: row.schedule_id,
        scheduleName: row.schedule_name,
        userId: row.user_id,
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        date: row.date,
        shiftStart: row.start_time,
        shiftEnd: row.end_time,
      });
      bySchedule.set(row.schedule_id, list);
    }
  }

  return { schedules, bySchedule };
};

const detectConflicts = async (departmentId, startDate, endDate, targetScheduleId = null) => {
  const conflicts = [];
  const { schedules, bySchedule } = await loadConflictEntries(departmentId, startDate, endDate);
  const target = targetScheduleId ? schedules.find(schedule => schedule.id === targetScheduleId) : null;
  const selectedSchedules = target ? schedules : schedules;
  const entries = selectedSchedules.flatMap(schedule => bySchedule.get(schedule.id) || []);
  const targetEntries = target ? (bySchedule.get(target.id) || []) : entries;
  const otherEntries = target
    ? entries.filter(entry => entry.scheduleId !== target.id)
    : entries;

  // 1. Double affectation : quand un planning cible est fourni, comparer ses
  // lignes aux autres plannings et conserver les doublons internes éventuels.
  const doubleGroups = new Map();
  for (const entry of targetEntries) {
    const key = `${entry.userId}|${entry.date}`;
    const group = doubleGroups.get(key) || [];
    group.push(entry);
    doubleGroups.set(key, group);
  }
  if (target) {
    for (const entry of otherEntries) {
      const key = `${entry.userId}|${entry.date}`;
      const group = doubleGroups.get(key) || [];
      if (group.length && !group.some(item => item.scheduleId === entry.scheduleId)) group.push(entry);
      doubleGroups.set(key, group);
    }
  }
  for (const [key, group] of doubleGroups) {
    if (group.length < 2) continue;
    const [userId, date] = key.split('|');
    const names = group.find(item => item.userId === userId) || group[0];
    const scheduleNames = [...new Set(group.map(item => item.scheduleName).filter(Boolean))];
    conflicts.push({
      type: 'DOUBLE_ASSIGNMENT',
      severity: 'high',
      message: `${names.firstName} ${names.lastName} est affecté(e) à ${group.length} gardes le ${date}${scheduleNames.length > 1 ? ` (${scheduleNames.join(', ')})` : ''}`,
      userId,
      date,
      shiftIds: group.map(item => item.id),
      scheduleIds: [...new Set(group.map(item => item.scheduleId))],
    });
  }

  // 2. Repos insuffisant. On compare les fenêtres temporelles, y compris entre
  // deux plannings, plutôt qu'une différence brute de DATE qui signalait à tort
  // toute succession de deux jours.
  const restEntries = target ? [...targetEntries, ...otherEntries] : entries;
  const byUser = new Map();
  for (const entry of restEntries) {
    const list = byUser.get(entry.userId) || [];
    list.push(entry);
    byUser.set(entry.userId, list);
  }
  for (const [userId, userEntries] of byUser) {
    const ordered = userEntries
      .map(entry => ({ entry, window: entryWindow(entry) }))
      .filter(item => item.window)
      .sort((a, b) => a.window.start - b.window.start);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous.entry.date === current.entry.date) continue;
      const restHours = (current.window.start - previous.window.end) / 60;
      if (restHours >= 0 && restHours < 11) {
        const person = current.entry;
        conflicts.push({
          type: 'INSUFFICIENT_REST',
          severity: 'medium',
          message: `${person.firstName} ${person.lastName}: repos de ${restHours.toFixed(1)}h entre ${previous.entry.date} et ${person.date} (minimum 11h)`,
          userId,
          date: person.date,
          shiftIds: [previous.entry.id, person.id],
        });
      }
    }
  }

  return conflicts;
};

// ============================================================
// GÉNÉRATION AUTOMATIQUE (Round-Robin équitable)
// ============================================================
const generateScheduleLegacy = async (req, res) => {
  if (req.user.roleCode === 'director') {
    return res.status(403).json({
      success: false,
      message: 'Le directeur consulte les plannings mais ne crée pas de gardes.',
    });
  }
  const { departmentId, startDate, endDate, shiftTypeId, scheduleId } = req.body;

  // Récupérer les médecins du service
  const doctorsResult = await query(
    `SELECT u.id, u.first_name, u.last_name,
            COUNT(s.id) AS shift_count_current_month
     FROM users u
     JOIN user_departments ud ON u.id = ud.user_id
     LEFT JOIN shifts s ON u.id = s.user_id
       AND s.shift_date BETWEEN $2 AND $3
       AND s.status != 'cancelled'
     WHERE ud.department_id = $1 AND u.is_active = TRUE AND u.is_on_leave = FALSE
     GROUP BY u.id, u.first_name, u.last_name
     ORDER BY shift_count_current_month ASC, RANDOM()`,
    [departmentId, startDate, endDate]
  );

  if (!doctorsResult.rows.length) {
    return res.status(400).json({ success: false, message: 'Aucun médecin disponible dans ce service' });
  }

  const doctors = doctorsResult.rows;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const shifts = [];
  let doctorIndex = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const doctor = doctors[doctorIndex % doctors.length];

    shifts.push({
      scheduleId,
      establishmentId: req.user.establishmentId,
      departmentId,
      userId: doctor.id,
      shiftTypeId,
      shiftDate: dateStr,
      status: SHIFT_STATUS.PLANNED,
      createdBy: req.user.id,
    });

    doctorIndex++;
  }

  // Insérer en batch
  await transaction(async (client) => {
    for (const shift of shifts) {
      await client.query(
        `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [shift.scheduleId, shift.establishmentId, shift.departmentId, shift.userId, shift.shiftTypeId, shift.shiftDate, shift.status, shift.createdBy]
      );
    }
  });

  return res.json({
    success: true,
    message: `${shifts.length} gardes générées avec succès (algorithme round-robin)`,
    data: { shiftsGenerated: shifts.length },
  });
};

/**
 * Générateur sécurisé utilisé par la route moderne. Les plannings créés par le
 * Tableur sont écrits dans le registre `metadata.spreadsheet.rows`; les bases
 * incomplètes retombent explicitement sur l'ancien générateur `shifts`.
 */
const generateSchedule = async (req, res) => {
  const role = req.user.roleCode;
  if (!req.user.isSuperAdmin && !['department_head', 'service_supervisor'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Seuls le chef de service ou le surveillant de service peuvent générer un planning.' });
  }
  const { departmentId, startDate, endDate, shiftTypeId, scheduleId } = req.body;
  const establishmentId = req.user.isSuperAdmin
    ? (req.body.establishmentId || req.user.establishmentId)
    : req.user.establishmentId;
  if (!scheduleId || !UUID_RE.test(String(scheduleId))) {
    return res.status(400).json({ success: false, message: 'scheduleId est requis pour générer un planning.' });
  }
  if (!departmentId || !isValidDateKey(startDate) || !isValidDateKey(endDate) || endDate < startDate) {
    return res.status(400).json({ success: false, message: 'Le service et une période de dates valide sont requis.' });
  }
  if (!req.user.isSuperAdmin) {
    const membership = await query(
      `SELECT 1 FROM user_departments
        WHERE user_id=$1 AND department_id=$2
          AND ($3 = 'service_supervisor' OR is_head=TRUE) LIMIT 1`,
      [req.user.id, departmentId, role]
    );
    if (!membership.rows.length) return res.status(403).json({ success: false, message: 'Vous ne pouvez générer un planning que pour votre service.' });
  }
  const scheduleRes = await query(
    'SELECT id, establishment_id, department_id, status, metadata FROM schedules WHERE id=$1',
    [scheduleId]
  );
  const schedule = scheduleRes.rows[0];
  if (!schedule) return res.status(404).json({ success: false, message: 'Planning introuvable.' });
  if (schedule.establishment_id !== establishmentId || schedule.department_id !== departmentId) {
    return res.status(403).json({ success: false, message: 'Ce planning n’appartient pas à votre établissement ou à ce service.' });
  }
  if (!['draft', 'rejected'].includes(schedule.status)) {
    return res.status(409).json({ success: false, message: 'Seul un planning en brouillon ou rejeté peut être généré.' });
  }

  const staffResult = await query(
    `SELECT u.id, u.first_name, u.last_name,
            COUNT(s.id) AS shift_count_current_month
       FROM users u
       JOIN user_departments ud ON u.id = ud.user_id
       LEFT JOIN shifts s ON u.id = s.user_id
         AND s.shift_date BETWEEN $2 AND $3 AND s.status != 'cancelled'
      WHERE ud.department_id = $1 AND u.establishment_id = $4
        AND u.is_active = TRUE AND u.is_on_leave = FALSE
      GROUP BY u.id, u.first_name, u.last_name
      ORDER BY shift_count_current_month ASC, RANDOM()`,
    [departmentId, startDate, endDate, establishmentId]
  );
  const staff = staffResult.rows;
  if (!staff.length) return res.status(400).json({ success: false, message: 'Aucun personnel disponible dans ce service.' });
  const dates = datesInRange(startDate, endDate);
  const leavesByUser = await loadApprovedLeaves(query, staff.map((member) => member.id), startDate, endDate);
  const uncoveredDate = dates.find((date) => staff.every((member) => !isAvailableOn(leavesByUser, member.id, date)));
  if (uncoveredDate) return res.status(400).json({ success: false, code: 'NO_AVAILABLE_STAFF', message: `Aucun personnel disponible le ${uncoveredDate} : tous sont en congé approuvé.` });

  const shifts = [];
  let memberIndex = 0;
  for (const date of dates) {
    const available = staff.filter((member) => isAvailableOn(leavesByUser, member.id, date));
    const member = available[memberIndex % available.length];
    shifts.push({ scheduleId, establishmentId, departmentId, userId: member.id, shiftTypeId, shiftDate: date, status: SHIFT_STATUS.PLANNED, createdBy: req.user.id });
    memberIndex += 1;
  }
  const rows = generatedRows(shifts.map((shift) => ({ user_id: shift.userId, shift_date: shift.shiftDate, shift_type_id: shift.shiftTypeId })), staff, startDate, endDate);
  try {
    await transaction(async (client) => {
      await persistGeneratedRows(client, scheduleId, rows, startDate, endDate);
      await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
    });
  } catch (modernError) {
    console.warn('Modern schedule register unavailable; falling back to shifts:', modernError.code || modernError.message);
    await transaction(async (client) => {
      for (const shift of shifts) {
        await client.query(
          `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [shift.scheduleId, shift.establishmentId, shift.departmentId, shift.userId, shift.shiftTypeId, shift.shiftDate, shift.status, shift.createdBy]
        );
      }
    });
  }
  return res.json({ success: true, message: `${shifts.length} gardes générées avec succès (algorithme round-robin)`, data: { shiftsGenerated: shifts.length } });
};

// ============================================================
// CRUD PLANNINGS
// ============================================================

const getSchedules = async (req, res) => {
  const { status, departmentId, from, to, page = 1, limit = 20 } = req.query;
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const offset = (page - 1) * limit;

  let conditions = ['sch.establishment_id = $1'];
  let params = [eid]; let idx = 2;

  if (status) { conditions.push(`sch.status = $${idx}`); params.push(status); idx++; }
  // Un chef de service ne doit jamais « perdre » un planning qu'il a créé : le
  // filtre par service ne s'applique pas à ses propres créations. Sans cela, un
  // planning créé dans un service qui n'est plus le sien disparaissait de la
  // liste alors qu'il existait toujours en base.
  const isHead = req.user.roleCode === 'department_head';
  if (departmentId) {
    if (isHead) {
      conditions.push(`(sch.department_id = $${idx} OR sch.created_by = $${idx + 1})`);
      params.push(departmentId, req.user.id); idx += 2;
    } else {
      conditions.push(`sch.department_id = $${idx}`); params.push(departmentId); idx++;
    }
  }
  // Recherche par chevauchement : un planning qui couvre une partie de la
  // période demandée doit rester visible, même s'il commence avant `from` ou
  // se termine après `to`.
  if (from) { conditions.push(`sch.end_date >= $${idx}`); params.push(from); idx++; }
  if (to) { conditions.push(`sch.start_date <= $${idx}`); params.push(to); idx++; }

  // Les brouillons sont strictement privés : seul leur chef créateur peut les voir.
  if (isHead) {
    conditions.push(`(sch.status <> 'draft' OR sch.created_by = $${idx})`); params.push(req.user.id); idx++;
  } else {
    conditions.push(`sch.status <> 'draft'`);
  }
  // Filtrer par service pour les chefs et surveillants
  if (!req.user.isSuperAdmin && ['department_head', 'service_supervisor'].includes(req.user.roleCode)) {
    const deptResult = await query(
      `SELECT department_id FROM user_departments WHERE user_id = $1`,
      [req.user.id]
    );
    if (deptResult.rows.length) {
      if (isHead) {
        conditions.push(`(sch.department_id = ANY($${idx}) OR sch.created_by = $${idx + 1})`);
        params.push(deptResult.rows.map(r => r.department_id), req.user.id); idx += 2;
      } else {
        conditions.push(`sch.department_id = ANY($${idx})`);
        params.push(deptResult.rows.map(r => r.department_id)); idx++;
      }
    }
  }

  const where = conditions.join(' AND ');

  const countResult = await query(`SELECT COUNT(*) FROM schedules sch WHERE ${where}`, params);
  const result = await query(
    `SELECT sch.*, d.name AS department_name, d.name_ar AS department_name_ar,
            u.first_name AS created_by_first, u.last_name AS created_by_last,
            TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS end_date,
            planning_state(sch.status, sch.start_date, sch.end_date) AS state
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN users u ON sch.created_by = u.id
     WHERE ${where}
     ORDER BY sch.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  );

  // Le tableur est la source de vérité depuis la migration du registre. La
  // table `shifts` ne reçoit plus les lignes saisies dans le tableur : compter
  // par LEFT JOIN affichait donc systématiquement zéro sur les cartes de la
  // liste. Le lecteur partagé applique exactement la même règle cases/périodes
  // que le calendrier, l'appel du jour et la supervision.
  const schedules = result.rows.map((schedule) => ({
    ...schedule,
    total_shifts: countDuty(schedule),
  }));

  return res.json({
    success: true, data: schedules,
    pagination: {
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / parseInt(limit)),
    },
  });
};

const getSchedule = async (req, res) => {
  const result = await query(
    `SELECT sch.*, d.name AS department_name, d.name_ar AS department_name_ar,
            u.first_name AS created_by_first, u.last_name AS created_by_last
            ,TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date_key
            ,TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS end_date_key
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN users u ON sch.created_by = u.id
     WHERE sch.id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const schedule = {
    ...result.rows[0],
    start_date: result.rows[0].start_date_key || dateKey(result.rows[0].start_date),
    end_date: result.rows[0].end_date_key || dateKey(result.rows[0].end_date),
  };
  if (schedule.establishment_id !== req.user.establishmentId || (schedule.status === 'draft' && (req.user.roleCode !== 'department_head' || schedule.created_by !== req.user.id))) return res.status(403).json({ success: false, message: 'Accès non autorisé à ce planning.' });

  // Les lignes du tableur vivent dans metadata.spreadsheet.rows. Construire ici
  // le même contrat de lecture que l'ancien endpoint `/shifts`, sans consulter
  // la table morte, permet aux écrans historiques de continuer à fonctionner.
  const entries = dutyEntries(schedule, schedule.start_date, schedule.end_date);
  const userIds = [...new Set(entries.map((entry) => entry.userId).filter(Boolean))];
  const staffResult = userIds.length
    ? await query(
      `SELECT u.id, u.first_name, u.last_name, u.speciality, u.grade, u.phone,
              r.name AS role_name
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = ANY($1)`, [userIds]
    )
    : { rows: [] };
  const staffById = new Map(staffResult.rows.map((member) => [member.id, member]));
  const shifts = entries.map((entry, index) => {
    const member = staffById.get(entry.userId) || {};
    const startTime = entry.shiftStart || null;
    const endTime = entry.shiftEnd || null;
    return {
      id: `spreadsheet-${schedule.id}-${entry.userId}-${entry.date}-${index}`,
      schedule_id: schedule.id,
      user_id: entry.userId,
      department_id: entry.departmentId || schedule.department_id,
      shift_date: entry.date,
      shift_type_id: null,
      shift_type_name: entry.label || 'De service',
      shift_type_code: null,
      shift_color: null,
      color: null,
      start_time: startTime,
      end_time: endTime,
      duration_hours: null,
      status: 'planned',
      first_name: entry.firstName || member.first_name || '',
      last_name: entry.lastName || member.last_name || '',
      speciality: member.speciality || '',
      grade: member.grade || entry.roleName || member.role_name || '',
      phone: member.phone || '',
      role_name: entry.roleName || member.role_name || '',
    };
  });

  const history = await query(
    `SELECT swh.*, u.first_name, u.last_name FROM schedule_workflow_history swh
     JOIN users u ON swh.actor_id = u.id
     WHERE swh.schedule_id = $1 ORDER BY swh.created_at`,
    [req.params.id]
  );

  const conflicts = await detectConflicts(schedule.department_id, schedule.start_date, schedule.end_date);

  return res.json({
    success: true,
    data: { ...schedule, shifts, history: history.rows, conflicts },
  });
};

const createSchedule = async (req, res) => {
  if (req.user.roleCode === 'director') {
    return res.status(403).json({
      success: false,
      message: 'Le directeur consulte les plannings mais ne peut pas en créer.',
    });
  }
  // Accept both camelCase (old wizard) and snake_case (new PlanningStep1 form)
  const deptId       = req.body.department_id || req.body.departmentId;
  const startDate    = req.body.start_date    || req.body.startDate;
  const endDate      = req.body.end_date      || req.body.endDate;
  const scheduleType = req.body.schedule_type || req.body.scheduleType || (req.body.creation_mode === 'special_days' ? 'special_weekend_holiday' : 'normal');
  const { name, notes, workflowId, status, creation_mode, metadata } = req.body;
  const eid = req.user.isSuperAdmin
    ? (req.body.establishmentId || req.body.establishment_id || req.user.establishmentId)
    : req.user.establishmentId;

  if (!deptId) {
    return res.status(400).json({ success: false, message: 'department_id est requis pour créer un planning' });
  }
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return res.status(400).json({ success: false, message: 'Les dates de début et de fin sont obligatoires et doivent être valides.' });
  }
  if (endDate < startDate) {
    return res.status(400).json({ success: false, message: 'La date de fin doit être postérieure ou égale à la date de début.' });
  }
  const currentDateResult = await query("SELECT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS today");
  const today = currentDateResult.rows[0].today;
  if (endDate < today) {
    return res.status(400).json({ success: false, message: `La date de fin doit être égale ou postérieure au ${today}.` });
  }

  // Un chef ne peut créer un planning que dans un service dont il est chef.
  // Sans ce garde-fou, un planning pouvait naître dans un service étranger puis
  // devenir invisible dans sa liste — le planning « disparaissait » après création.
  if (req.user.roleCode === 'department_head' && !req.user.isSuperAdmin) {
    const owns = await query(
      'SELECT 1 FROM user_departments WHERE user_id = $1 AND department_id = $2 AND is_head = TRUE',
      [req.user.id, deptId]
    );
    if (!owns.rows.length) {
      const fallback = await query(
        `SELECT ud.department_id, d.name FROM user_departments ud
           JOIN departments d ON d.id = ud.department_id
          WHERE ud.user_id = $1 AND ud.is_head = TRUE ORDER BY d.name LIMIT 1`,
        [req.user.id]
      );
      return res.status(403).json({
        success: false,
        code: 'NOT_DEPARTMENT_HEAD',
        message: fallback.rows.length
          ? `Vous ne dirigez pas ce service. Créez ce planning dans « ${fallback.rows[0].name} ».`
          : 'Vous n\'êtes chef d\'aucun service : impossible de créer un planning.',
        data: { suggestedDepartmentId: fallback.rows[0]?.department_id || null },
      });
    }
  }

  const result = await query(
    `INSERT INTO schedules (establishment_id, department_id, name, start_date, end_date, notes, workflow_id, status, creation_mode, metadata, created_by, schedule_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING *`,
    [eid, deptId, name, startDate, endDate, notes || null, workflowId || null, status || 'draft', creation_mode || null, JSON.stringify(metadata || {}), req.user.id, scheduleType]
  );
  return res.status(201).json({ success: true, data: result.rows[0] });
};

const updateSchedule = async (req, res) => {
  const { name, notes, startDate, endDate } = req.body;
  const schedule = await query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
  if (!schedule.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (!['draft', 'rejected'].includes(schedule.rows[0].status)) {
    return res.status(400).json({ success: false, message: 'Seuls les plannings en brouillon peuvent être modifiés' });
  }

  const result = await query(
    `UPDATE schedules SET name = COALESCE($1,name), notes = COALESCE($2,notes),
     start_date = COALESCE($3,start_date), end_date = COALESCE($4,end_date), updated_at = NOW()
     WHERE id = $5 RETURNING *`,
    [name, notes, startDate, endDate, req.params.id]
  );
  return res.json({ success: true, data: result.rows[0] });
};

// Envoi générique d'un planning. Comme dans le tableur (schedule-builder), il
// n'y a ni approbation ni refus : le planning est en vigueur dès l'envoi, et
// déjà « en cours » si sa période a commencé.
const submitSchedule = async (req, res) => {
  const { comment } = req.body;
  const updated = await query(
    `UPDATE schedules
        SET status = CASE WHEN start_date <= CURRENT_DATE THEN 'active' ELSE 'submitted' END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING status`,
    [req.params.id]
  );
  if (!updated.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  await query(
    `INSERT INTO schedule_workflow_history (schedule_id, step_order, action, actor_id, comment)
     VALUES ($1, 0, 'submitted', $2, $3)`,
    [req.params.id, req.user.id, comment]
  );
  return res.json({
    success: true,
    message: updated.rows[0].status === 'active'
      ? 'Planning envoyé et mis en marche : il est en cours dès maintenant.'
      : 'Planning envoyé et mis en vigueur. Il démarrera à sa date de début.',
    data: { status: updated.rows[0].status },
  });
};

const getConflicts = async (req, res) => {
  const schedule = await query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
  if (!schedule.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const conflicts = await detectConflicts(schedule.rows[0].department_id, schedule.rows[0].start_date, schedule.rows[0].end_date, req.params.id);
  return res.json({ success: true, data: conflicts, count: conflicts.length });
};

/**
 * PATCH /api/schedules/:id/action
 * Actions: duplicate | archive | restore | delete
 */
const scheduleAction = async (req, res) => {
  const { id } = req.params;
  const { action, name } = req.body;
  const estId = req.user.establishmentId;

  const { rows } = await query('SELECT * FROM schedules WHERE id = $1 AND establishment_id = $2', [id, estId]);
  const schedule = rows[0];
  if (!schedule) return res.status(404).json({ success: false, message: 'Planning introuvable' });

  switch (action) {
    case 'archive': {
      await query(`UPDATE schedules SET status = 'archived', updated_at = NOW() WHERE id = $1`, [id]);
      return res.json({ success: true, message: 'Planning archivé' });
    }
    case 'restore': {
      await query(`UPDATE schedules SET status = 'draft', updated_at = NOW() WHERE id = $1`, [id]);
      return res.json({ success: true, message: 'Planning restauré en brouillon' });
    }
    case 'delete': {
      if (!['draft', 'archived'].includes(schedule.status)) {
        return res.status(400).json({ success: false, message: 'Seuls les brouillons et archives peuvent être supprimés' });
      }
      await query(`DELETE FROM shifts WHERE schedule_id = $1`, [id]);
      await query(`DELETE FROM schedules WHERE id = $1`, [id]);
      return res.json({ success: true, message: 'Planning supprimé' });
    }
    case 'duplicate': {
      const newName = name || `${schedule.name} (copie)`;
      // Le Tableur est la source de vérité. Une duplication doit emporter ses
      // lignes et sa configuration, ainsi que les périodes matérialisées qui
      // servent aux remplacements. Les anciennes lignes `shifts` ne sont
      // recopiées que pour un planning historique sans Tableur.
      const hasSpreadsheet = Array.isArray(schedule.metadata?.spreadsheet?.rows);
      const metadata = schedule.metadata && typeof schedule.metadata === 'object'
        ? JSON.parse(JSON.stringify(schedule.metadata))
        : {};

      const duplicated = await transaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO schedules
             (establishment_id, department_id, name, start_date, end_date,
              status, creation_mode, period_type, template_id, is_shared,
              shared_with, notes, metadata, created_by, schedule_type)
           VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
           RETURNING id`,
          [
            estId,
            schedule.department_id,
            newName,
            schedule.start_date,
            schedule.end_date,
            schedule.creation_mode || 'manual',
            schedule.period_type || 'monthly',
            schedule.template_id || null,
            Boolean(schedule.is_shared),
            Array.isArray(schedule.shared_with) ? schedule.shared_with : [],
            schedule.notes || null,
            JSON.stringify(metadata),
            req.user.id,
            schedule.schedule_type || 'normal',
          ]
        );
        const newId = inserted.rows[0].id;

        await client.query(
          `INSERT INTO schedule_staff_assignments
             (schedule_id, user_id, period_start, period_end, position)
           SELECT $1, user_id, period_start, period_end, position
             FROM schedule_staff_assignments
            WHERE schedule_id = $2`,
          [newId, id]
        );
        await client.query(
          `INSERT INTO schedule_staff_periods
             (schedule_id, user_id, period_start, period_end, position)
           SELECT $1, user_id, period_start, period_end, position
             FROM schedule_staff_periods
            WHERE schedule_id = $2`,
          [newId, id]
        );

        if (!hasSpreadsheet) {
          await client.query(
            `INSERT INTO shifts
               (schedule_id, establishment_id, department_id, user_id,
                shift_type_id, shift_date, status, notes, is_extra, created_by)
             SELECT $1, establishment_id, department_id, user_id,
                    shift_type_id, shift_date, 'planned', notes, is_extra, $3
               FROM shifts
              WHERE schedule_id = $2`,
            [newId, id, req.user.id]
          );
        }

        return newId;
      });

      return res.json({ success: true, data: { scheduleId: duplicated }, message: `Planning dupliqué : "${newName}"` });
    }
    default:
      return res.status(400).json({ success: false, message: 'Action inconnue' });
  }
};

/**
 * GET /api/users/hospital-staff
 * Returns all active hospital staff (all departments) for cross-service selection
 * Query params: search, role, deptId, personnelType, priorityDeptId, limit, offset
 */
const getHospitalStaff = async (req, res) => {
  const {
    search, role, deptId, personnelType, priorityDeptId,
    limit = 250, offset = 0,
  } = req.query;
  const estId = req.user.establishmentId;

  for (const [label, value] of [['rôle', role], ['service', deptId], ['service prioritaire', priorityDeptId]]) {
    if (value && !UUID_RE.test(value)) {
      return res.status(400).json({ success: false, message: `Identifiant de ${label} invalide.` });
    }
  }
  if (personnelType && !['medical', 'administrative', 'auxiliary'].includes(personnelType)) {
    return res.status(400).json({ success: false, message: 'Type de personnel invalide.' });
  }

  const categoryExpr = `COALESCE(jt.category, CASE
    WHEN r2.code IN ('senior_doctor','resident') OR r.code IN ('senior_doctor','resident') THEN 'medical'
    WHEN r.code IN ('director','hospital_admin','general_supervisor','department_head','service_supervisor','observer') THEN 'administrative'
    ELSE NULL END)`;
  const categoryLabelExpr = `COALESCE(jt.category_label, CASE
    WHEN r2.code IN ('senior_doctor','resident') OR r.code IN ('senior_doctor','resident') THEN 'Personnel médical'
    WHEN r.code IN ('director','hospital_admin','general_supervisor','department_head','service_supervisor','observer') THEN 'Personnel administratif'
    ELSE 'Type à renseigner' END)`;
  const functionExpr = `COALESCE(
    NULLIF(BTRIM(jt.name), ''),
    NULLIF(BTRIM(CASE WHEN r2.code <> 'autre' THEN r2.name END), ''),
    NULLIF(BTRIM(CASE WHEN r.code <> 'autre' THEN r.name END), ''),
    'Fonction à renseigner'
  )`;
  const functionSourceExpr = `CASE
    WHEN NULLIF(BTRIM(jt.name), '') IS NOT NULL THEN 'job_title'
    WHEN r2.code <> 'autre' AND NULLIF(BTRIM(r2.name), '') IS NOT NULL THEN 'secondary_role'
    WHEN r.code <> 'autre' AND NULLIF(BTRIM(r.name), '') IS NOT NULL THEN 'access_role'
    ELSE 'missing'
  END`;

  const joins = `
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN roles r2 ON u.secondary_role_id = r2.id
    LEFT JOIN job_titles jt ON u.job_title_id = jt.id
    LEFT JOIN LATERAL (
      SELECT membership.department_id
        FROM user_departments membership
       WHERE membership.user_id = u.id
       ORDER BY membership.is_primary DESC, membership.department_id
       LIMIT 1
    ) ud ON TRUE
    LEFT JOIN departments d ON ud.department_id = d.id
  `;

  const conditions = ['u.establishment_id = $1', 'u.is_active = TRUE'];
  const params = [estId];
  let p = 2;

  if (search) {
    conditions.push(`(
      u.first_name ILIKE $${p} OR u.last_name ILIKE $${p}
      OR CONCAT_WS(' ', u.first_name, u.last_name) ILIKE $${p}
      OR CONCAT_WS(' ', u.last_name, u.first_name) ILIKE $${p}
      OR COALESCE(u.matricule, '') ILIKE $${p}
      OR COALESCE(u.phone, '') ILIKE $${p}
      OR COALESCE(r.name, '') ILIKE $${p}
      OR COALESCE(r2.name, '') ILIKE $${p}
      OR COALESCE(jt.name, '') ILIKE $${p}
      OR COALESCE(d.name, '') ILIKE $${p}
      OR EXISTS (
        SELECT 1 FROM user_departments search_membership
        JOIN departments search_department ON search_department.id = search_membership.department_id
        WHERE search_membership.user_id = u.id AND search_department.name ILIKE $${p}
      )
    )`);
    params.push(`%${search}%`);
    p++;
  }
  if (role) {
    conditions.push(`r.id = $${p}`);
    params.push(role);
    p++;
  }
  if (deptId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM user_departments filtered_membership
       WHERE filtered_membership.user_id = u.id
         AND filtered_membership.department_id = $${p}
    )`);
    params.push(deptId);
    p++;
  }
  if (personnelType) {
    conditions.push(`${categoryExpr} = $${p}`);
    params.push(personnelType);
    p++;
  }

  const where = conditions.join(' AND ');
  const countRes = await query(
    `SELECT COUNT(DISTINCT u.id) ${joins} WHERE ${where}`,
    params
  );

  const dataParams = [...params];
  let priorityMembershipExpr = 'FALSE';
  let priorityParam = null;
  const hasDepartmentMembershipExpr = `EXISTS (
    SELECT 1 FROM user_departments any_membership
     WHERE any_membership.user_id = u.id
  )`;
  let priorityOrder = `CASE
    WHEN ${categoryExpr} = 'medical' AND d.id IS NOT NULL THEN 1
    WHEN ${categoryExpr} = 'medical' THEN 2
    WHEN ${categoryExpr} = 'auxiliary' THEN 3
    WHEN ${categoryExpr} = 'administrative' THEN 4
    ELSE 5 END`;
  if (priorityDeptId) {
    dataParams.push(priorityDeptId);
    priorityParam = dataParams.length;
    priorityMembershipExpr = `EXISTS (
      SELECT 1 FROM user_departments priority_membership
       WHERE priority_membership.user_id = u.id
         AND priority_membership.department_id = $${priorityParam}
    )`;
    priorityOrder = `CASE
      WHEN ${priorityMembershipExpr} THEN 0
      WHEN ${categoryExpr} = 'medical' AND d.id IS NOT NULL THEN 1
      WHEN ${categoryExpr} = 'medical' THEN 2
      WHEN ${categoryExpr} = 'auxiliary' THEN 3
      WHEN ${categoryExpr} = 'administrative' THEN 4
      ELSE 5 END`;
  }

  const effectiveDepartmentIdExpr = priorityDeptId
    ? `CASE WHEN ${priorityMembershipExpr} THEN $${priorityParam}::uuid ELSE d.id END`
    : 'd.id';
  const effectiveDepartmentNameExpr = priorityDeptId
    ? `CASE WHEN ${priorityMembershipExpr}
        THEN (SELECT priority_department.name FROM departments priority_department WHERE priority_department.id = $${priorityParam})
        ELSE d.name END`
    : 'd.name';

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 250, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);
  dataParams.push(safeLimit, safeOffset);
  const limitParam = dataParams.length - 1;
  const offsetParam = dataParams.length;

  const { rows } = await query(
    `SELECT u.id, u.first_name, u.last_name, u.phone, u.matricule,
            u.avatar_url, u.is_on_leave, u.last_activity_at,
            r.name AS role_name, r.name AS access_role_name,
            r.code AS role_code, r.id AS role_id,
            r2.name AS secondary_role_name, r2.code AS secondary_role_code,
            jt.id AS job_title_id, jt.name AS job_title,
            ${functionExpr} AS function_name,
            ${functionExpr} AS display_role_name,
            ${functionSourceExpr} AS function_source,
            ${categoryExpr} AS personnel_category,
            ${categoryLabelExpr} AS personnel_category_label,
            ${effectiveDepartmentNameExpr} AS dept_name,
            ${effectiveDepartmentIdExpr} AS dept_id,
            ${priorityMembershipExpr} AS belongs_to_priority_department,
            ${priorityDeptId ? `(${hasDepartmentMembershipExpr} AND NOT (${priorityMembershipExpr}))` : 'FALSE'} AS requires_loan,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', member_department.id,
                'name', member_department.name,
                'isPrimary', all_memberships.is_primary
              ) ORDER BY all_memberships.is_primary DESC, member_department.name)
              FROM user_departments all_memberships
              JOIN departments member_department ON member_department.id = all_memberships.department_id
              WHERE all_memberships.user_id = u.id
            ), '[]'::jsonb) AS departments
       ${joins}
      WHERE ${where}
      ORDER BY ${priorityOrder}, d.name NULLS LAST,
               COALESCE(jt.sort_order, 999), u.last_name, u.first_name
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
    dataParams
  );

  return res.json({ success: true, data: rows, total: parseInt(countRes.rows[0].count) });
};

/**
 * GET /api/roles (all platform roles for wizard dropdown)
 */
const getAllRoles = async (req, res) => {
  const estId = req.user.establishmentId;
  const { rows } = await query(
    `SELECT r.id, r.name, r.code, COUNT(u.id) AS user_count
     FROM roles r
     LEFT JOIN users u ON u.role_id = r.id AND u.establishment_id = $1 AND u.is_active = TRUE
     WHERE r.establishment_id = $1 OR r.establishment_id IS NULL
     GROUP BY r.id, r.name, r.code
     ORDER BY r.name`,
    [estId]
  );
  return res.json({ success: true, data: rows });
};

module.exports = {
  getSchedules, getSchedule, createSchedule, updateSchedule,
  submitSchedule, generateSchedule,
  getConflicts, detectConflicts,
  scheduleAction, getHospitalStaff, getAllRoles,
};
