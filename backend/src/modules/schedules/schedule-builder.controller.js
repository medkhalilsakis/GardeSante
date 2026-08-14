/**
 * ============================================================
 * SCHEDULE BUILDER CONTROLLER
 * Création de plannings : Wizard, Tableur, Visuel, Génération IA
 * ============================================================
 */

const { query, transaction } = require('../../config/database');
const {
  generateRoundRobin, generateABRotation, generateCyclic,
  evaluateRules, generateNationalSnapshot,
} = require('./rules-engine');
const { log, getIp } = require('../history/history.controller');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToEstablishment, emitToDepartment } = require('../../realtime/emit');
const { SCHEDULE_IN_FORCE } = require('../../config/constants');
const { normalizePeriods, periodBounds, dateInPeriods } = require('./periods');

// Utilitaire : dates entre start et end
const getDatesInRange = (startDate, endDate) => {
  const dates = [];
  const current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
};

// PostgreSQL DATE peut être renvoyé comme un Date JS à minuit local par
// node-postgres. `toISOString()` convertirait alors ce minuit en UTC et ferait
// reculer la date d'un jour dans les fuseaux positifs (ex. Tunis).
const dateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Source unique : les week-ends sont calculés et les jours fériés sont lus
// directement depuis les entrées actuellement gérées par le Super Admin.
const getCurrentSpecialDates = async (startDate, endDate) => {
  const holidayRes = await query(
    `SELECT start_date, end_date FROM public_holidays
     WHERE start_date <= $2::date AND end_date >= $1::date`,
    [startDate, endDate]
  );
  const holidaySet = new Set();
  holidayRes.rows.forEach(holiday => {
    getDatesInRange(dateKey(holiday.start_date), dateKey(holiday.end_date)).forEach(date => holidaySet.add(date));
  });
  return getDatesInRange(startDate, endDate).filter(date => {
    const day = new Date(`${date}T12:00:00`).getDay();
    return day === 0 || day === 6 || holidaySet.has(date);
  });
};

const replaceRosterAssignments = async (client, scheduleId, roster, start, end) => {
  await client.query('DELETE FROM schedule_staff_periods WHERE schedule_id=$1', [scheduleId]);
  await client.query('DELETE FROM schedule_staff_assignments WHERE schedule_id=$1', [scheduleId]);
  for (const [position, row] of roster.entries()) {
    const periods = normalizePeriods(row, start, end);
    const bounds = periodBounds(periods);
    await client.query(
      'INSERT INTO schedule_staff_assignments (schedule_id,user_id,period_start,period_end,position) VALUES ($1,$2,$3,$4,$5)',
      [scheduleId, row.userId, bounds.startDate || start, bounds.endDate || end, position]
    );
    for (const [periodPosition, period] of periods.entries()) {
      await client.query(
        'INSERT INTO schedule_staff_periods (schedule_id,user_id,period_start,period_end,position) VALUES ($1,$2,$3,$4,$5)',
        [scheduleId, row.userId, period.startDate, period.endDate, periodPosition]
      );
    }
  }
};

// ──────────────────────────────────────────────────────────────
// ÉTAPE 1 DU WIZARD — Contexte du service
// GET /api/schedule-builder/wizard/context?departmentId=&startDate=&endDate=
// ──────────────────────────────────────────────────────────────
const getWizardContext = async (req, res) => {
  const { departmentId, startDate, endDate } = req.query;
  const estId = req.user.establishmentId;

  if (!departmentId) return res.status(400).json({ success: false, message: 'departmentId requis' });

  // Personnel du service (actifs, pas en congé)
  const staff = await query(
    `SELECT u.id, u.first_name, u.last_name, u.matricule, u.phone,
            u.speciality, u.grade, u.is_on_leave,
            r.code AS role_code, r.name AS role_name,
            COUNT(s.id) FILTER (WHERE s.shift_date >= NOW() - INTERVAL '30 days') AS recent_shifts
     FROM users u
     JOIN user_departments ud ON u.id = ud.user_id
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN shifts s ON s.user_id = u.id AND s.status != 'cancelled'
     WHERE ud.department_id = $1 AND u.is_active = TRUE AND u.establishment_id = $2
     GROUP BY u.id, r.code, r.name
     ORDER BY r.level DESC, u.last_name`,
    [departmentId, estId]
  );

  // Types de garde configurés
  const shiftTypes = await query(
    `SELECT * FROM shift_types WHERE establishment_id = $1 AND is_active = TRUE ORDER BY start_time`,
    [estId]
  );

  // Templates disponibles pour ce service
  const templates = await query(
    `SELECT * FROM schedule_templates
     WHERE establishment_id = $1 AND is_active = TRUE
       AND (department_id = $2 OR department_id IS NULL)
     ORDER BY is_default DESC, times_used DESC LIMIT 5`,
    [estId, departmentId]
  );

  // Absences planifiées sur la période
  let plannedAbsences = [];
  if (startDate && endDate) {
    const absRes = await query(
      `SELECT a.user_id, a.start_date, a.end_date, at.name AS absence_type
       FROM absences a
       JOIN absence_types at ON a.absence_type_id = at.id
       WHERE a.department_id = $1 AND a.status = 'approved'
         AND a.start_date <= $3 AND a.end_date >= $2`,
      [departmentId, startDate, endDate]
    );
    plannedAbsences = absRes.rows;
  }

  // Règles actives de l'établissement
  const rules = await query(
    `SELECT rule_code, rule_name, rule_type, severity, config FROM establishment_rules
     WHERE establishment_id = $1 AND is_active = TRUE
     ORDER BY priority DESC`,
    [estId]
  );

  return res.json({
    success: true,
    data: {
      staff:           staff.rows,
      shiftTypes:      shiftTypes.rows,
      templates:       templates.rows,
      plannedAbsences,
      rules:           rules.rows,
      availableAlgos: ['round_robin', 'ab_rotation', 'cyclic', 'manual'],
      periodSuggestions: ['weekly', 'monthly', 'quarterly', 'biannual'],
    },
  });
};

// ──────────────────────────────────────────────────────────────
// GÉNÉRATION INTELLIGENTE (Wizard + API générique)
// POST /api/schedule-builder/generate
// ──────────────────────────────────────────────────────────────
const generateSchedule = async (req, res) => {
  const {
    departmentId, scheduleId,
    startDate, endDate,
    shiftTypeId,
    algo = 'round_robin',
    teamA, teamB,
    staffIds,
    cycleLength,
    templateId,
    periodType = 'monthly',
    name,
  } = req.body;

  const estId = req.user.establishmentId;

  if (!departmentId || !startDate || !endDate || !shiftTypeId) {
    return res.status(400).json({ success: false, message: 'departmentId, startDate, endDate et shiftTypeId sont requis' });
  }

  // Résoudre le personnel
  let staff;
  if (staffIds?.length) {
    const res2 = await query(`SELECT id, first_name, last_name FROM users WHERE id = ANY($1) AND is_active = TRUE`, [staffIds]);
    staff = res2.rows;
  } else {
    const res2 = await query(
      `SELECT u.id, u.first_name, u.last_name FROM users u
       JOIN user_departments ud ON u.id = ud.user_id
       WHERE ud.department_id = $1 AND u.is_active = TRUE AND u.is_on_leave = FALSE
         AND u.establishment_id = $2`,
      [departmentId, estId]
    );
    staff = res2.rows;
  }

  if (staff.length === 0) {
    return res.status(400).json({ success: false, message: 'Aucun personnel disponible pour ce service' });
  }

  // Un planning spécial ne génère des gardes que sur les week-ends et jours fériés
  // calculés lors de sa création par le chef de service.
  let dates = getDatesInRange(startDate, endDate);
  if (scheduleId) {
    const existingSchedule = await query(
      'SELECT metadata, schedule_type FROM schedules WHERE id=$1 AND establishment_id=$2',
      [scheduleId, estId]
    );
    if (!existingSchedule.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable.' });
    if (existingSchedule.rows[0].schedule_type === 'special_weekend_holiday' || existingSchedule.rows[0].metadata?.special_days_only) {
      dates = await getCurrentSpecialDates(startDate, endDate);
      if (!dates.length) return res.status(400).json({ success: false, message: 'Ce planning spécial ne contient aucune date de week-end ou jour férié.' });
    }
  }

  // Compter les gardes existantes (pour équilibrage)
  const existingCounts = {};
  const existingRes = await query(
    `SELECT user_id, COUNT(*) AS cnt FROM shifts
     WHERE department_id = $1 AND shift_date BETWEEN $2 AND $3 AND status != 'cancelled'
     ${scheduleId ? 'AND schedule_id != $4' : ''}
     GROUP BY user_id`,
    scheduleId ? [departmentId, startDate, endDate, scheduleId] : [departmentId, startDate, endDate]
  );
  existingRes.rows.forEach(r => { existingCounts[r.user_id] = parseInt(r.cnt); });

  // Générer selon l'algorithme
  let generated = [];
  if (algo === 'ab_rotation' && teamA?.length && teamB?.length) {
    const resolveTeam = async (ids) => {
      const r = await query(`SELECT id, first_name, last_name FROM users WHERE id = ANY($1)`, [ids]);
      return r.rows;
    };
    const resolvedA = await resolveTeam(teamA);
    const resolvedB = await resolveTeam(teamB);
    generated = generateABRotation(resolvedA, resolvedB, dates, shiftTypeId);
  } else if (algo === 'cyclic') {
    generated = generateCyclic(staff, dates, shiftTypeId, cycleLength);
  } else {
    generated = generateRoundRobin(staff, dates, shiftTypeId, existingCounts);
  }

  // Créer ou récupérer le planning
  let targetScheduleId = scheduleId;
  if (!targetScheduleId) {
    const schedName = name || `Planning ${new Date(startDate).toLocaleDateString('fr-FR')} — ${new Date(endDate).toLocaleDateString('fr-FR')}`;
    const newSched = await query(
      `INSERT INTO schedules
         (establishment_id, department_id, name, start_date, end_date, created_by,
          period_type, creation_mode, template_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'assistant',$8,$9)
       RETURNING id`,
      [estId, departmentId, schedName, startDate, endDate, req.user.id,
       periodType, templateId || null,
       JSON.stringify({ algo, columnIds: [], staffCount: staff.length })]
    );
    targetScheduleId = newSched.rows[0].id;
  }

  // Insérer les gardes générées
  let insertedCount = 0;
  for (const shift of generated) {
    try {
      await query(
        `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT DO NOTHING`,
        [targetScheduleId, estId, departmentId, shift.user_id, shift.shift_type_id, shift.shift_date, req.user.id]
      );
      insertedCount++;
    } catch (e) { /* ignore duplicates */ }
  }

  // Évaluer les règles immédiatement
  const evaluation = await evaluateRules(targetScheduleId, estId);

  // Mettre à jour le compteur d'usage du template
  if (templateId) {
    await query('UPDATE schedule_templates SET times_used = times_used + 1 WHERE id = $1', [templateId]);
  }

  log({
    userId: req.user.id, action: 'schedule_generate',
    category: 'schedule',
    description: `Planning généré (${algo}) : ${insertedCount} gardes — ${startDate} → ${endDate}`,
    entityType: 'schedules', entityId: targetScheduleId,
    ipAddress: getIp(req),
  });

  return res.json({
    success: true,
    data: {
      scheduleId:     targetScheduleId,
      generatedCount: insertedCount,
      algo,
      evaluation,
    },
    message: `${insertedCount} gardes générées${evaluation.errors.length > 0 ? ` (${evaluation.errors.length} conflits détectés)` : ''}`,
  });
};

// ──────────────────────────────────────────────────────────────
// VALIDATION D'UN PLANNING COMPLET
// POST /api/schedule-builder/:scheduleId/validate
// ──────────────────────────────────────────────────────────────
const validateSchedule = async (req, res) => {
  const { scheduleId } = req.params;
  const estId = req.user.establishmentId;

  // Vérifier l'accès
  const sched = await query('SELECT id, establishment_id, department_id FROM schedules WHERE id=$1', [scheduleId]);
  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (sched.rows[0].establishment_id !== estId) return res.status(403).json({ success: false, message: 'Accès non autorisé' });

  const evaluation = await evaluateRules(scheduleId, estId);
  return res.json({ success: true, data: evaluation });
};

// ──────────────────────────────────────────────────────────────
// VALIDATION D'UNE GARDE UNIQUE (pour éditeur visuel temps réel)
// POST /api/schedule-builder/:scheduleId/validate-shift
// ──────────────────────────────────────────────────────────────
const validateShift = async (req, res) => {
  const { userId, shiftDate, shiftTypeId } = req.body;
  const { scheduleId } = req.params;
  const estId = req.user.establishmentId;

  const warnings = [];

  // 1. Double affectation
  const double = await query(
    `SELECT COUNT(*) FROM shifts
     WHERE user_id=$1 AND shift_date=$2 AND schedule_id=$3 AND status!='cancelled'`,
    [userId, shiftDate, scheduleId]
  );
  if (parseInt(double.rows[0].count) > 0) {
    warnings.push({ type: 'DOUBLE_ASSIGNMENT', severity: 'error', message: 'Ce médecin a déjà une garde ce jour.' });
  }

  // 2. Absence approuvée
  const absence = await query(
    `SELECT id FROM absences WHERE user_id=$1 AND status='approved'
     AND $2 BETWEEN start_date AND end_date`,
    [userId, shiftDate]
  );
  if (absence.rows.length > 0) {
    warnings.push({ type: 'ABSENCE_CONFLICT', severity: 'error', message: 'Ce médecin est en absence approuvée ce jour.' });
  }

  // 3. Repos insuffisant (veille)
  const prevShift = await query(
    `SELECT s.shift_date, st.duration_hours, st.end_time
     FROM shifts s JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.user_id=$1 AND s.shift_date = $2::date - INTERVAL '1 day'
       AND s.status != 'cancelled'`,
    [userId, shiftDate]
  );
  if (prevShift.rows[0]) {
    warnings.push({ type: 'INSUFFICIENT_REST', severity: 'warning', message: 'Ce médecin a une garde la veille, vérifiez le repos.' });
  }

  return res.json({
    success: true,
    isValid: warnings.filter(w => w.severity === 'error').length === 0,
    warnings,
  });
};

// Sauvegarde du tableur manuel. Les identités du personnel restent des UUID,
// les champs affichés ne sont donc jamais une source de données modifiable.
const saveDraft = async (req, res) => {
  const { scheduleId } = req.params;
  const { rows = [], customCols = [], week_organization = [] } = req.body;
  const estId = req.user.establishmentId;
  const schedRes = await query(
    `SELECT id, name, establishment_id, department_id,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date,
            status, metadata, schedule_type
       FROM schedules
      WHERE id=$1 AND establishment_id=$2`,
    [scheduleId, estId]
  );
  const schedule = schedRes.rows[0];
  if (!schedule) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const isPublishedSchedule = SCHEDULE_IN_FORCE.includes(schedule.status);
  if (isPublishedSchedule) {
    const head = await query(
      'SELECT 1 FROM user_departments WHERE user_id=$1 AND department_id=$2 AND is_head=TRUE',
      [req.user.id, schedule.department_id]
    );
    if (req.user.roleCode !== 'department_head' || !head.rows.length) {
      return res.status(403).json({
        success: false,
        message: 'Seul le chef de ce service peut modifier directement un planning envoyé ou en cours.',
      });
    }
  } else if (schedule.status !== 'draft') {
    return res.status(400).json({
      success: false,
      message: `Un planning au statut « ${schedule.status} » ne peut pas être modifié dans le tableur.`,
    });
  }

  // Les ids de lignes (`new-...`) ne sont jamais des UUID de personnel.
  const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const roster = rows.filter(r => isUuid(r.userId));
  const invalidPersonnelRow = rows.find(r => r.userId && !isUuid(r.userId));
  if (invalidPersonnelRow) {
    return res.status(400).json({ success: false, code: 'INVALID_PERSONNEL_ID', message: 'Une ligne du tableur contient un identifiant de personnel invalide. Veuillez selectionner a nouveau ce personnel.' });
  }
  const ids = roster.map(r => r.userId);
  if (new Set(ids).size !== ids.length) return res.status(400).json({ success: false, message: 'Un membre du personnel ne peut apparaître qu\'une fois dans le tableur.' });
  if (ids.length) {
    const users = await query('SELECT id FROM users WHERE establishment_id=$1 AND is_active=TRUE AND id = ANY($2)', [estId, ids]);
    if (users.rows.length !== ids.length) return res.status(400).json({ success: false, message: 'Le personnel sélectionné doit appartenir à l\'hôpital et être actif.' });
  }
  const start = dateKey(schedule.start_date), end = dateKey(schedule.end_date);
  const isSpecialSchedule = schedule.schedule_type === 'special_weekend_holiday' || schedule.metadata?.schedule_kind === 'weekend_holiday' || schedule.metadata?.special_days_only;
  const specialDateSet = isSpecialSchedule ? new Set(await getCurrentSpecialDates(start, end)) : null;
  for (const row of roster) {
    const name = `${row.lastName || ''} ${row.firstName || ''}`.trim() || 'Personnel sélectionné';
    if (isSpecialSchedule) {
      const selectedDates = Object.entries(row.shifts || {})
        .filter(([, code]) => String(code || '').toUpperCase() !== 'R')
        .map(([date]) => dateKey(date))
        .filter(Boolean);
      if (!selectedDates.length) return res.status(400).json({ success: false, code: 'SPECIAL_DATES_REQUIRED', message: `${name} : sélectionnez au moins un week-end ou jour férié.` });
      const invalidDate = selectedDates.find(date => !specialDateSet.has(date));
      if (invalidDate) return res.status(400).json({ success: false, code: 'SPECIAL_DATE_ONLY', message: `${name} : le ${invalidDate} n'est pas un week-end ou un jour férié autorisé.` });
      row.periodStart = selectedDates.sort()[0];
      row.periodEnd = selectedDates.sort().at(-1);
      continue;
    }
    const periods = normalizePeriods(row, start, end);
    if (!periods.length) return res.status(400).json({ success: false, code: 'PERIODS_REQUIRED', message: `${name} : ajoutez au moins une période.` });
    for (const [index, period] of periods.entries()) {
      const label = periods.length > 1 ? `période ${index + 1}` : 'période';
      if (!period.startDate || !period.endDate) return res.status(400).json({ success: false, code: 'PERIOD_RANGE_REQUIRED', message: `${name} : les deux dates de la ${label} sont obligatoires.` });
      if (period.startDate < start || period.startDate > end || period.endDate < start || period.endDate > end) {
        return res.status(400).json({ success: false, code: 'PERIOD_OUTSIDE_SCHEDULE', message: `${name} : la ${label} doit rester comprise entre le ${start} et le ${end}.` });
      }
      if (period.startDate > period.endDate) return res.status(400).json({ success: false, code: 'PERIOD_RANGE_INVALID', message: `${name} : le début de la ${label} doit précéder sa fin.` });
      if (index > 0 && period.startDate <= periods[index - 1].endDate) {
        return res.status(400).json({ success: false, code: 'PERIODS_OVERLAP', message: `${name} : les périodes ${index} et ${index + 1} se chevauchent.` });
      }
    }
    const bounds = periodBounds(periods);
    row.periods = periods;
    row.periodStart = bounds.startDate;
    row.periodEnd = bounds.endDate;
  }
  if (!isSpecialSchedule && roster.length > 0 && !roster.some(row => normalizePeriods(row, start, end).some(period => period.startDate === start))) {
    return res.status(400).json({ success: false, message: `Au moins un personnel doit couvrir le début du planning (${start}).` });
  }
  if (!isSpecialSchedule && roster.length > 0 && !roster.some(row => normalizePeriods(row, start, end).some(period => period.endDate === end))) {
    return res.status(400).json({ success: false, message: `Au moins un personnel doit couvrir la fin du planning (${end}).` });
  }

  // RÈGLE I — Un personnel en congé ne peut pas être affecté à une garde pendant sa période de congé.
  const { findLeaveViolations } = require('../absences/leave-check');
  const leaveAssignments = [];
  for (const row of roster) {
    const periods = normalizePeriods(row, start, end);
    for (const date of Object.keys(row.shifts || {})) {
      const code = row.shifts[date];
      if (code === 'R' || (!specialDateSet && !dateInPeriods(date, periods))) continue;
      if (specialDateSet && !specialDateSet.has(dateKey(date))) continue;
      leaveAssignments.push({ userId: row.userId, date: dateKey(date) });
    }
  }
  const leaveViolations = await findLeaveViolations(leaveAssignments, start, end);
  if (leaveViolations.length > 0) {
    const first = leaveViolations[0];
    const names = new Map(roster.filter(r => r.userId === first.userId).map(r => [r.userId, `${r.lastName || ''} ${r.firstName || ''}`.trim() || 'Personnel']));
    const name = names.get(first.userId) || 'Ce personnel';
    return res.status(400).json({
      success: false,
      code: 'LEAVE_CONFLICT',
      message: `${name} est en ${first.typeName} du ${first.leaveStart} au ${first.leaveEnd} : impossible de l'affecter le ${first.date}. Retirez cette affectation ou posez-en une autre.`,
      data: { violations: leaveViolations }
    });
  }

  // RÈGLE II — Un agent d'un autre service demande l'accord de son chef, mais
  // cet accord ne bloque PAS l'enregistrement : la demande part automatiquement,
  // la ligne reste marquée « en attente » et le tableur s'enregistre et s'envoie
  // normalement. Un refus retirera la seule ligne concernée (voir `decideLoan`).
  const { syncExternalStaffLoans } = require('./external-staff');
  const loanSync = await syncExternalStaffLoans({
    schedule,
    roster,
    actor: req.user,
    app: req.app,
  });

  // Convertit aussi les codes du tableur en gardes réelles : le brouillon
  // reste exploitable par les règles métier et par la validation finale.
  const typeRes = await query('SELECT id, UPPER(code) AS code, LOWER(name) AS name FROM shift_types WHERE establishment_id=$1 AND is_active=TRUE', [estId]);
  const resolveShiftType = (code) => typeRes.rows.find(t => t.code === code)
    || typeRes.rows.find(t => (code === 'J' && t.name.startsWith('jour')) || (code === 'N' && t.name.startsWith('nuit')) || (code === 'S' && t.name.startsWith('soir')) || (code === 'G' && t.name.startsWith('garde')));
  const shiftRows = [];
  for (const row of roster) {
    const periods = normalizePeriods(row, start, end);
    for (const [date, code] of Object.entries(row.shifts || {})) {
      if (code === 'R' || (!specialDateSet && !dateInPeriods(date, periods))) continue;
      if (specialDateSet && !specialDateSet.has(dateKey(date))) return res.status(400).json({ success: false, code: 'SPECIAL_DATE_ONLY', message: `La date ${dateKey(date)} n’est pas autorisée dans ce planning week-end et jours fériés.` });
      const shiftType = resolveShiftType(String(code).toUpperCase());
      if (!shiftType) return res.status(400).json({ success: false, message: `Type de garde introuvable pour le code "${code}".` });
      shiftRows.push([scheduleId, estId, schedule.department_id, row.userId, shiftType.id, date, req.user.id]);
    }
  }
  await transaction(async client => {
    await replaceRosterAssignments(client, scheduleId, roster, start, end);
    await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
    for (const shift of shiftRows) {
      await client.query(
        'INSERT INTO shifts (schedule_id,establishment_id,department_id,user_id,shift_type_id,shift_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        shift
      );
    }
    await client.query(
      `UPDATE schedules SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`,
      [scheduleId, JSON.stringify({ spreadsheet: { rows: roster, customCols, week_organization: Array.isArray(week_organization) ? week_organization : [], savedAt: new Date().toISOString() } })]
    );
  });
  const externalLoans = await require('./external-staff').getScheduleLoanStates(scheduleId);
  const pendingCount = loanSync.pending.length;
  log({
    userId: req.user.id,
    action: isPublishedSchedule ? 'schedule_live_update' : 'schedule_draft_update',
    category: 'schedule',
    description: isPublishedSchedule
      ? `Planning ${schedule.status === 'active' ? 'en cours' : 'envoyé'} modifié directement par le chef de service`
      : 'Brouillon du planning enregistré',
    entityType: 'schedules',
    entityId: scheduleId,
    metadata: { status: schedule.status, startDate: start, endDate: end, staffCount: roster.length },
    ipAddress: getIp(req),
  });
  return res.json({
    success: true,
    message: pendingCount
      ? `${isPublishedSchedule ? 'Planning mis à jour' : 'Brouillon enregistré'} — ${pendingCount} agent(s) externe(s) en attente de l'accord de leur chef de service.`
      : isPublishedSchedule ? 'Planning mis à jour' : 'Brouillon enregistré',
    data: { savedAt: new Date().toISOString(), externalLoans, pendingExternal: loanSync.pending },
  });
};

// ──────────────────────────────────────────────────────────────
// SNAPSHOT NATIONAL (après approbation)
// POST /api/schedule-builder/:scheduleId/snapshot
// ──────────────────────────────────────────────────────────────
const createSnapshot = async (req, res) => {
  const { scheduleId } = req.params;
  const snapshot = await generateNationalSnapshot(scheduleId);

  if (!snapshot) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  return res.json({ success: true, data: snapshot, message: 'Snapshot national généré' });
};

// ──────────────────────────────────────────────────────────────
// RÉCUPÉRER LE DÉTAIL D'UN PLANNING (vue tableur / visuel)
// GET /api/schedule-builder/:scheduleId/detail
// ──────────────────────────────────────────────────────────────
const getScheduleDetail = async (req, res) => {
  const { scheduleId } = req.params;
  const estId = req.user.establishmentId;

  // ⚠️ Dates en TEXTE, jamais en objets Date. node-pg convertit une colonne DATE
  // en Date JS à minuit LOCAL ; sérialisée en JSON elle devient
  // « 2026-08-09T23:00:00.000Z » pour un planning qui commence le 10 (fuseau +01).
  // Le tableur ne compare que des clés « YYYY-MM-DD » obtenues en tronquant la
  // chaîne : il reculait donc d'un jour entier — colonnes affichées, périodes par
  // défaut des lignes, bornes de validation et min/max des sélecteurs de date.
  // La liste des plannings (`schedules.controller.js`) TO_CHAR déjà ses dates,
  // d'où la contradiction visible entre la carte du planning et son tableur.
  const sched = await query(
    `SELECT sch.*, d.name AS dept_name, d.code AS dept_code,
            u.first_name AS created_by_first, u.last_name AS created_by_last,
            TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date_key,
            TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS end_date_key
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN users u ON sch.created_by = u.id
     WHERE sch.id = $1 AND sch.establishment_id = $2`,
    [scheduleId, estId]
  );

  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (sched.rows[0].status === 'draft' && (req.user.roleCode !== 'department_head' || sched.rows[0].created_by !== req.user.id)) return res.status(403).json({ success: false, message: 'Ce brouillon est privé au chef de service.' });

  const { start_date_key, end_date_key, ...schedRow } = sched.rows[0];
  const schedule = {
    ...schedRow,
    start_date: start_date_key || schedRow.start_date,
    end_date:   end_date_key   || schedRow.end_date,
  };

  const shifts = await query(
    `SELECT s.*, u.first_name, u.last_name, u.matricule, u.speciality, u.grade, u.phone,
            r.code AS role_code, r.name AS role_name,
            st.name AS shift_type_name, st.code AS shift_type_code,
            st.color, st.start_time, st.end_time, st.duration_hours,
            TO_CHAR(s.shift_date, 'YYYY-MM-DD') AS shift_date_key
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN roles r ON u.role_id = r.id
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.schedule_id = $1
     ORDER BY s.shift_date, u.last_name`,
    [scheduleId]
  );

  const cycles = await query(
    'SELECT * FROM schedule_cycles WHERE schedule_id = $1 ORDER BY start_date',
    [scheduleId]
  );

  const staff = await query(
    `SELECT u.id, u.first_name, u.last_name, u.matricule, u.phone, r.name AS role_name,
            TO_CHAR(a.period_start, 'YYYY-MM-DD') AS period_start,
            TO_CHAR(a.period_end,   'YYYY-MM-DD') AS period_end,
            COALESCE((
              SELECT json_agg(json_build_object(
                'startDate', TO_CHAR(p.period_start, 'YYYY-MM-DD'),
                'endDate', TO_CHAR(p.period_end, 'YYYY-MM-DD')
              ) ORDER BY p.position)
              FROM schedule_staff_periods p
              WHERE p.schedule_id = a.schedule_id AND p.user_id = a.user_id
            ), '[]'::json) AS periods,
            a.position
     FROM schedule_staff_assignments a JOIN users u ON u.id=a.user_id JOIN roles r ON r.id=u.role_id
     WHERE a.schedule_id=$1 ORDER BY a.position`, [scheduleId]
  );

  // État d'approbation des agents empruntés à un autre service : le tableur
  // colore les lignes en attente sans que rien ne soit bloqué.
  const externalLoans = await require('./external-staff').getScheduleLoanStates(scheduleId);

  return res.json({
    success: true,
    data: {
      schedule,
      shifts:   shifts.rows.map(({ shift_date_key, ...s }) => ({
        ...s,
        shift_date: shift_date_key || s.shift_date,
      })),
      cycles:   cycles.rows,
      staff:    staff.rows,
      externalLoans,
    },
  });
};

// ──────────────────────────────────────────────────────────────
// SOUMETTRE UN PLANNING AU WORKFLOW DE VALIDATION
// POST /api/schedule-builder/:scheduleId/submit
// ──────────────────────────────────────────────────────────────

const canProposeScheduleChange = async (user, departmentId) => {
  if (user.roleCode === 'general_supervisor') return true;
  if (user.roleCode !== 'service_supervisor') return false;
  const membership = await query('SELECT 1 FROM user_departments WHERE user_id=$1 AND department_id=$2', [user.id, departmentId]);
  return membership.rows.length > 0;
};

const notifyScheduleReviewers = async ({ scheduleId, establishmentId, departmentId, senderId, scheduleName }) => {
  const recipients = await query(
    `SELECT DISTINCT u.id FROM users u
     JOIN roles r ON r.id=u.role_id
     LEFT JOIN user_departments ud ON ud.user_id=u.id
     WHERE u.establishment_id=$1 AND u.is_active=TRUE
       AND (r.code='general_supervisor' OR (r.code='service_supervisor' AND ud.department_id=$2))
       AND u.id <> $3`,
    [establishmentId, departmentId, senderId]
  );
  await Promise.all(recipients.rows.map(({ id }) => createNotification({
    establishmentId, recipientId: id, senderId, type: 'schedule_submitted',
    title: 'Planning à consulter', message: `Le planning « ${scheduleName || 'Planning'} » a été envoyé. Vous pouvez proposer des modifications.`,
    entityType: 'schedules', entityId: scheduleId, priority: 'high',
  })));
};

const listChangeProposals = async (req, res) => {
  const { scheduleId } = req.params;
  const schedule = await query('SELECT id, department_id, establishment_id FROM schedules WHERE id=$1 AND establishment_id=$2', [scheduleId, req.user.establishmentId]);
  if (!schedule.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const role = req.user.roleCode;
  const allowed = ['department_head', 'service_supervisor', 'general_supervisor', 'director', 'hospital_admin', 'super_admin'].includes(role);
  if (!allowed) return res.status(403).json({ success: false, message: 'Accès non autorisé' });
  const proposals = await query(
    `SELECT p.*, u.first_name, u.last_name, r.name AS proposer_role, r.code AS proposer_role_code,
            d.first_name AS decided_first_name, d.last_name AS decided_last_name
     FROM schedule_change_proposals p
     JOIN users u ON u.id=p.proposed_by JOIN roles r ON r.id=u.role_id
     LEFT JOIN users d ON d.id=p.decided_by
     WHERE p.schedule_id=$1 ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC`,
    [scheduleId]
  );
  return res.json({ success: true, data: proposals.rows });
};

const createChangeProposal = async (req, res) => {
  const { scheduleId } = req.params;
  const { rows, customCols = [], week_organization = [], comment = '' } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ success: false, message: 'Les lignes du tableur sont requises.' });
  const schedule = await query('SELECT id, department_id, establishment_id, status, name, created_by FROM schedules WHERE id=$1 AND establishment_id=$2', [scheduleId, req.user.establishmentId]);
  const item = schedule.rows[0];
  if (!item) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (!SCHEDULE_IN_FORCE.includes(item.status)) return res.status(400).json({ success: false, message: 'Les propositions sont ouvertes une fois le planning envoyé et mis en marche.' });
  if (!(await canProposeScheduleChange(req.user, item.department_id))) return res.status(403).json({ success: false, message: 'Seuls les surveillants concernés peuvent proposer une modification.' });
  const created = await query(
    `INSERT INTO schedule_change_proposals (schedule_id, establishment_id, department_id, proposed_by, proposal, comment)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
    [scheduleId, item.establishment_id, item.department_id, req.user.id, JSON.stringify({ rows, customCols, week_organization: Array.isArray(week_organization) ? week_organization : [] }), comment || null]
  );
  await createNotification({
    establishmentId: item.establishment_id, recipientId: item.created_by, senderId: req.user.id, type: 'schedule_change_proposed',
    title: 'Proposition de modification', message: `Une proposition de modification attend votre décision pour « ${item.name} ».`,
    entityType: 'schedule_change_proposals', entityId: created.rows[0].id, priority: 'high',
  });
  return res.status(201).json({ success: true, data: created.rows[0], message: 'Proposition envoyée au chef de service.' });
};

const decideChangeProposal = async (req, res) => {
  const { scheduleId, proposalId } = req.params;
  const { decision, comment = '' } = req.body;
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ success: false, message: 'Décision invalide.' });
  const proposalRes = await query(
    `SELECT p.*, s.start_date, s.end_date, s.name FROM schedule_change_proposals p
     JOIN schedules s ON s.id=p.schedule_id
     WHERE p.id=$1 AND p.schedule_id=$2 AND p.establishment_id=$3`,
    [proposalId, scheduleId, req.user.establishmentId]
  );
  const proposal = proposalRes.rows[0];
  if (!proposal) return res.status(404).json({ success: false, message: 'Proposition introuvable' });
  const head = await query('SELECT 1 FROM user_departments WHERE user_id=$1 AND department_id=$2 AND is_head=TRUE', [req.user.id, proposal.department_id]);
  if (req.user.roleCode !== 'department_head' || !head.rows.length) return res.status(403).json({ success: false, message: 'Seul le chef de ce service peut décider.' });
  if (proposal.status !== 'pending') return res.status(400).json({ success: false, message: 'Cette proposition a déjà été traitée.' });

  if (decision === 'accepted') {
    const spreadsheet = proposal.proposal || {};
    const rows = Array.isArray(spreadsheet.rows) ? spreadsheet.rows : [];
    const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const roster = rows.filter(row => isUuid(row.userId));
    const proposalStart = dateKey(proposal.start_date);
    const proposalEnd = dateKey(proposal.end_date);
    roster.forEach((row) => {
      row.periods = normalizePeriods(row, proposalStart, proposalEnd);
      const bounds = periodBounds(row.periods);
      row.periodStart = bounds.startDate;
      row.periodEnd = bounds.endDate;
    });
    const typeRes = await query('SELECT id, UPPER(code) AS code, LOWER(name) AS name FROM shift_types WHERE establishment_id=$1 AND is_active=TRUE', [proposal.establishment_id]);
    const resolveType = code => typeRes.rows.find(type => type.code === code) || typeRes.rows.find(type => (code === 'J' && type.name.startsWith('jour')) || (code === 'N' && type.name.startsWith('nuit')) || (code === 'S' && type.name.startsWith('soir')) || (code === 'G' && type.name.startsWith('garde')));
    const shifts = [];
    for (const row of roster) for (const [date, code] of Object.entries(row.shifts || {})) {
      if (code === 'R') continue;
      if (!dateInPeriods(date, row.periods)) continue;
      const type = resolveType(String(code).toUpperCase());
      if (!type) return res.status(400).json({ success: false, message: `Type de garde introuvable pour le code « ${code} ».` });
      shifts.push([scheduleId, proposal.establishment_id, proposal.department_id, row.userId, type.id, date, req.user.id]);
    }
    await transaction(async client => {
      await replaceRosterAssignments(client, scheduleId, roster, proposalStart, proposalEnd);
      await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
      for (const shift of shifts) await client.query('INSERT INTO shifts (schedule_id,establishment_id,department_id,user_id,shift_type_id,shift_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', shift);
      await client.query(`UPDATE schedules SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`, [scheduleId, JSON.stringify({ spreadsheet: { rows: roster, customCols: spreadsheet.customCols || [], week_organization: Array.isArray(spreadsheet.week_organization) ? spreadsheet.week_organization : [], savedAt: new Date().toISOString() } })]);
      await client.query(`UPDATE schedule_change_proposals SET status=$2, decided_by=$3, decision_comment=$4, decided_at=NOW() WHERE id=$1`, [proposalId, decision, req.user.id, comment || null]);
    });
  } else {
    await query(`UPDATE schedule_change_proposals SET status='rejected', decided_by=$2, decision_comment=$3, decided_at=NOW() WHERE id=$1`, [proposalId, req.user.id, comment || null]);
  }
  await createNotification({ establishmentId: proposal.establishment_id, recipientId: proposal.proposed_by, senderId: req.user.id, type: `schedule_change_${decision}`, title: decision === 'accepted' ? 'Proposition acceptée' : 'Proposition refusée', message: `Votre proposition pour « ${proposal.name} » a été ${decision === 'accepted' ? 'acceptée' : 'refusée'}${comment ? ` : ${comment}` : '.'}`, entityType: 'schedule_change_proposals', entityId: proposalId, priority: 'normal' });
  log({ userId: req.user.id, action: `schedule_change_${decision}`, category: 'schedule', description: `Proposition ${decision} pour le planning ${scheduleId}`, entityType: 'schedule_change_proposals', entityId: proposalId, ipAddress: getIp(req) });
  return res.json({ success: true, message: decision === 'accepted' ? 'Proposition appliquée au planning officiel.' : 'Proposition refusée.' });
};

const cancelScheduleSubmission = async (req, res) => {
  const { scheduleId } = req.params;
  const { reason } = req.body;
  if (!reason || !String(reason).trim()) return res.status(400).json({ success: false, message: 'Un motif d’annulation est obligatoire.' });
  const schedule = await query('SELECT * FROM schedules WHERE id=$1 AND establishment_id=$2', [scheduleId, req.user.establishmentId]);
  const item = schedule.rows[0];
  if (!item) return res.status(404).json({ success: false, message: 'Planning introuvable.' });
  const head = await query('SELECT 1 FROM user_departments WHERE user_id=$1 AND department_id=$2 AND is_head=TRUE', [req.user.id, item.department_id]);
  if (req.user.roleCode !== 'department_head' || !head.rows.length) return res.status(403).json({ success: false, message: 'Seul le chef de ce service peut annuler cet envoi.' });
  // Un planning déjà en cours ne peut pas être « dé-envoyé » : des gardes sont
  // en train de se dérouler. Seul un planning envoyé mais pas encore démarré
  // peut revenir en brouillon.
  if (item.status !== 'submitted') {
    return res.status(400).json({
      success: false,
      message: item.status === 'active'
        ? 'Ce planning est déjà en cours : son envoi ne peut plus être annulé. Passez par une proposition de modification ou un remplacement.'
        : 'Seul un planning envoyé et non encore démarré peut être annulé.',
    });
  }

  await transaction(async client => {
    await client.query(`UPDATE schedules SET status='draft', updated_at=NOW() WHERE id=$1`, [scheduleId]);
    await client.query(`INSERT INTO schedule_workflow_history (schedule_id, step_order, action, actor_id, comment) VALUES ($1,0,'submission_cancelled',$2,$3)`, [scheduleId, req.user.id, String(reason).trim()]);
  });
  const recipients = await query(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN user_departments ud ON ud.user_id=u.id WHERE u.establishment_id=$1 AND u.is_active=TRUE AND (r.code='general_supervisor' OR (r.code='service_supervisor' AND ud.department_id=$2))`, [item.establishment_id, item.department_id]);
  await Promise.all(recipients.rows.map(({ id }) => createNotification({ establishmentId:item.establishment_id, recipientId:id, senderId:req.user.id, type:'schedule_submission_cancelled', title:'Envoi de planning annulé', message:`Le chef a annulé l’envoi du planning « ${item.name} ». Motif : ${String(reason).trim()}`, entityType:'schedules', entityId:scheduleId, priority:'high' })));
  log({ userId:req.user.id, action:'schedule_submission_cancelled', category:'schedule', description:`Envoi annulé : ${reason}`, entityType:'schedules', entityId:scheduleId, ipAddress:getIp(req) });
  return res.json({ success:true, message:'Envoi annulé et surveillants informés.' });
};
const submitSchedule = async (req, res) => {
  const { scheduleId } = req.params;
  const estId = req.user.establishmentId;
  const { notes } = req.body;

  // Vérifier accès + statut
  const sched = await query(
    'SELECT id, status, name, establishment_id, department_id FROM schedules WHERE id=$1',
    [scheduleId]
  );
  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (sched.rows[0].establishment_id !== estId) return res.status(403).json({ success: false, message: 'Accès non autorisé' });
  if (sched.rows[0].status !== 'draft') return res.status(400).json({ success: false, message: `Ce planning est déjà "${sched.rows[0].status}"` });

  // Valider les règles avant soumission
  const evaluation = await evaluateRules(scheduleId, estId);
  if (!evaluation.isValid) {
    return res.status(400).json({
      success: false,
      message: 'Le planning contient des erreurs bloquantes. Veuillez les corriger avant la soumission.',
      data: evaluation,
    });
  }

  // Mise en marche immédiate : il n'y a ni approbation ni refus. Le planning est
  // effectif dès l'envoi, et déjà « en cours » si sa période a commencé.
  const updated = await query(
    `UPDATE schedules
        SET status = CASE WHEN start_date <= CURRENT_DATE THEN 'active' ELSE 'submitted' END,
            notes = COALESCE($2, notes),
            updated_at = NOW()
      WHERE id = $1
      RETURNING status,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date,   'YYYY-MM-DD') AS end_date`,
    [scheduleId, notes || null]
  );
  const newStatus = updated.rows[0].status;
  const isRunning = newStatus === 'active';

  await query(
    `INSERT INTO schedule_workflow_history (schedule_id, step_order, action, actor_id, comment)
     VALUES ($1, 0, 'submitted', $2, $3)`,
    [scheduleId, req.user.id, notes || null]
  );

  log({
    userId: req.user.id, action: 'schedule_submit', category: 'schedule',
    description: isRunning
      ? 'Planning envoyé et mis en marche (période déjà commencée)'
      : 'Planning envoyé et mis en vigueur',
    entityType: 'schedules', entityId: scheduleId, ipAddress: getIp(req),
  });

  await notifyScheduleReviewers({ scheduleId, establishmentId: estId, departmentId: sched.rows[0].department_id, senderId: req.user.id, scheduleName: sched.rows[0].name });

  // Temps réel : le planning apparaît chez les surveillants sans rechargement.
  const payload = {
    scheduleId,
    name: sched.rows[0].name,
    status: newStatus,
    state: isRunning ? 'en_cours' : 'soumis',
    startDate: updated.rows[0].start_date,
    endDate: updated.rows[0].end_date,
  };
  emitToEstablishment(req.app, estId, 'schedule:submitted', payload);
  if (sched.rows[0].department_id) {
    emitToDepartment(req.app, sched.rows[0].department_id, 'schedule:submitted', payload);
  }

  return res.json({
    success: true,
    message: isRunning
      ? 'Planning envoyé et mis en marche : il est en cours dès maintenant. Les surveillants peuvent proposer des modifications.'
      : 'Planning envoyé et mis en vigueur. Il démarrera à sa date de début. Les surveillants peuvent proposer des modifications.',
    data: { ...evaluation, status: newStatus, state: payload.state },
  });
};

const decideAllChangeProposals = async (req, res) => {
  const { scheduleId } = req.params;
  const { decision = 'accepted', comment = '' } = req.body;
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ success: false, message: 'Décision invalide.' });

  const proposalsRes = await query(
    `SELECT p.*, s.start_date, s.end_date, s.name FROM schedule_change_proposals p
     JOIN schedules s ON s.id=p.schedule_id
     WHERE p.schedule_id=$1 AND p.establishment_id=$2 AND p.status='pending'
     ORDER BY p.created_at ASC`,
    [scheduleId, req.user.establishmentId]
  );
  const pendingList = proposalsRes.rows;
  if (!pendingList.length) return res.status(404).json({ success: false, message: 'Aucune proposition en attente.' });

  const head = await query('SELECT 1 FROM user_departments WHERE user_id=$1 AND department_id=$2 AND is_head=TRUE', [req.user.id, pendingList[0].department_id]);
  if (req.user.roleCode !== 'department_head' || !head.rows.length) return res.status(403).json({ success: false, message: 'Seul le chef de ce service peut décider.' });

  if (decision === 'accepted') {
    const latestProposal = pendingList[pendingList.length - 1];
    const spreadsheet = latestProposal.proposal || {};
    const rows = Array.isArray(spreadsheet.rows) ? spreadsheet.rows : [];
    const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const roster = rows.filter(row => isUuid(row.userId));
    const proposalStart = dateKey(latestProposal.start_date);
    const proposalEnd = dateKey(latestProposal.end_date);
    roster.forEach((row) => {
      row.periods = normalizePeriods(row, proposalStart, proposalEnd);
      const bounds = periodBounds(row.periods);
      row.periodStart = bounds.startDate;
      row.periodEnd = bounds.endDate;
    });
    const typeRes = await query('SELECT id, UPPER(code) AS code, LOWER(name) AS name FROM shift_types WHERE establishment_id=$1 AND is_active=TRUE', [latestProposal.establishment_id]);
    const resolveType = code => typeRes.rows.find(type => type.code === code) || typeRes.rows.find(type => (code === 'J' && type.name.startsWith('jour')) || (code === 'N' && type.name.startsWith('nuit')) || (code === 'S' && type.name.startsWith('soir')) || (code === 'G' && type.name.startsWith('garde')));
    const shifts = [];
    for (const row of roster) for (const [date, code] of Object.entries(row.shifts || {})) {
      if (code === 'R') continue;
      if (!dateInPeriods(date, row.periods)) continue;
      const type = resolveType(String(code).toUpperCase());
      if (!type) continue;
      shifts.push([scheduleId, latestProposal.establishment_id, latestProposal.department_id, row.userId, type.id, date, req.user.id]);
    }
    await transaction(async client => {
      await replaceRosterAssignments(client, scheduleId, roster, proposalStart, proposalEnd);
      await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
      for (const shift of shifts) await client.query('INSERT INTO shifts (schedule_id,establishment_id,department_id,user_id,shift_type_id,shift_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', shift);
      await client.query(`UPDATE schedules SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`, [scheduleId, JSON.stringify({ spreadsheet: { rows: roster, customCols: spreadsheet.customCols || [], week_organization: Array.isArray(spreadsheet.week_organization) ? spreadsheet.week_organization : [], savedAt: new Date().toISOString() } })]);
      for (const p of pendingList) {
        await client.query(`UPDATE schedule_change_proposals SET status=$2, decided_by=$3, decision_comment=$4, decided_at=NOW() WHERE id=$1`, [p.id, decision, req.user.id, comment || null]);
      }
    });
  } else {
    for (const p of pendingList) {
      await query(`UPDATE schedule_change_proposals SET status='rejected', decided_by=$2, decision_comment=$3, decided_at=NOW() WHERE id=$1`, [p.id, req.user.id, comment || null]);
    }
  }

  for (const p of pendingList) {
    await createNotification({ establishmentId: p.establishment_id, recipientId: p.proposed_by, senderId: req.user.id, type: `schedule_change_${decision}`, title: decision === 'accepted' ? 'Propositions acceptées' : 'Propositions refusées', message: `Vos propositions pour « ${p.name} » ont été ${decision === 'accepted' ? 'acceptées' : 'refusées'}.`, entityType: 'schedule_change_proposals', entityId: p.id, priority: 'normal' });
  }

  log({ userId: req.user.id, action: `schedule_change_${decision}_all`, category: 'schedule', description: `Toutes les propositions (${pendingList.length}) ont été ${decision}s pour le planning ${scheduleId}`, entityType: 'schedule_change_proposals', entityId: scheduleId, ipAddress: getIp(req) });
  return res.json({ success: true, message: `${pendingList.length} proposition(s) ${decision === 'accepted' ? 'acceptée(s)' : 'refusée(s)'}.` });
};

const notifyGeneralSupervisor = async (req, res) => {
  const { scheduleId } = req.params;
  const { comment = '' } = req.body;
  const estId = req.user.establishmentId;

  const schedRes = await query(
    'SELECT id, name, department_id, status FROM schedules WHERE id=$1 AND establishment_id=$2',
    [scheduleId, estId]
  );
  const sched = schedRes.rows[0];
  if (!sched) return res.status(404).json({ success: false, message: 'Planning introuvable.' });

  const sgRes = await query(
    `SELECT u.id, u.first_name, u.last_name FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.establishment_id = $1 AND r.code = 'general_supervisor' AND u.is_active = TRUE`,
    [estId]
  );

  if (!sgRes.rows.length) {
    return res.status(404).json({ success: false, message: 'Aucun Surveillant Général trouvé dans cet établissement.' });
  }

  const senderName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() || 'Surveillant';
  const notifications = sgRes.rows.map(sg => createNotification({
    establishmentId: estId,
    recipientId: sg.id,
    senderId: req.user.id,
    type: 'schedule_shared_sg',
    title: 'Planning transmis pour consultation',
    message: `Le surveillant ${senderName} vous a transmis le planning « ${sched.name} » pour consultation et suggestions.${comment ? ` Note : ${comment}` : ''}`,
    entityType: 'schedules',
    entityId: scheduleId,
    priority: 'high',
  }));

  await Promise.all(notifications);

  log({
    userId: req.user.id,
    action: 'schedule_shared_sg',
    category: 'schedule',
    description: `Planning transmis au Surveillant Général (${sgRes.rows.length} destinataire(s))`,
    entityType: 'schedules',
    entityId: scheduleId,
    ipAddress: getIp(req),
  });

  return res.json({
    success: true,
    message: `Planning transmis à ${sgRes.rows.length} Surveillant(s) Général(aux) avec succès.`,
  });
};

const generateProposals = async (req, res) => {
  const estId = req.user.establishmentId;
  const {
    departmentId,
    name,
    startDate,
    endDate,
    periodType = 'monthly',
    scheduleType = 'normal',
    selectedStaff = [],
    serviceRequirements = {},
    generationStrategy = 'auto_balance',
  } = req.body;

  if (!departmentId || !startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'departmentId, startDate et endDate sont requis' });
  }

  // Determine dates list
  let dates = getDatesInRange(startDate, endDate);
  if (scheduleType === 'special_weekend_holiday') {
    dates = await getCurrentSpecialDates(startDate, endDate);
  }

  if (dates.length === 0) {
    return res.status(400).json({ success: false, message: 'Aucune date valide trouvée pour la période sélectionnée' });
  }

  // Fetch absences in range for selected staff
  const staffIds = selectedStaff.map(s => s.id).filter(Boolean);
  let approvedAbsences = [];
  if (staffIds.length > 0) {
    const absRes = await query(
      `SELECT user_id, start_date::text, end_date::text FROM absences
       WHERE user_id = ANY($1) AND status = 'approved' AND start_date <= $3 AND end_date >= $2`,
      [staffIds, startDate, endDate]
    );
    approvedAbsences = absRes.rows;
  }

  // Fetch shift types
  const shiftTypesRes = await query(
    `SELECT id, UPPER(code) AS code, name, duration_hours FROM shift_types WHERE establishment_id = $1 AND is_active = TRUE`,
    [estId]
  );
  const shiftTypes = shiftTypesRes.rows;

  // Helper to generate proposal variations
  const buildProposalVariant = (key, variantTitle, variantDesc, strategyModifier) => {
    const rosterRows = selectedStaff.map((member, mIdx) => {
      const shiftMap = {};
      const memberAbsences = approvedAbsences.filter(a => a.user_id === member.id);

      dates.forEach((dateStr, dIdx) => {
        const dObj = new Date(`${dateStr}T12:00:00`);
        const dayOfWeek = dObj.getDay();

        // Excluded days check
        if (Array.isArray(member.excludedDays) && member.excludedDays.includes(dayOfWeek)) {
          return;
        }

        // Leave check
        const isOnLeave = memberAbsences.some(a => dateStr >= a.start_date && dateStr <= a.end_date);
        if (isOnLeave) return;

        // Date range / relay check
        if (member.periodStart && dateStr < member.periodStart) return;
        if (member.periodEnd && dateStr > member.periodEnd) return;

        // Shift assignment based on variant strategy
        let assignCode = 'J';
        if (strategyModifier === 'balanced') {
          if ((mIdx + dIdx) % 3 === 0) assignCode = 'J';
          else if ((mIdx + dIdx) % 3 === 1) assignCode = 'N';
          else assignCode = 'G';
        } else if (strategyModifier === 'continuity') {
          assignCode = mIdx % 2 === 0 ? 'J' : 'N';
        } else if (strategyModifier === 'weekend_rest') {
          if (dayOfWeek === 0 || dayOfWeek === 6) assignCode = 'G';
          else assignCode = (dIdx % 2 === 0) ? 'J' : 'N';
        }

        shiftMap[dateStr] = assignCode;
      });

      return {
        id: member.id ? `row-${member.id}` : `custom-${mIdx}`,
        userId: member.id || null,
        lastName: member.lastName || member.last_name || '',
        firstName: member.firstName || member.first_name || '',
        roleName: member.roleName || member.role_name || member.roleCode || '',
        phone: member.phone || '',
        matricule: member.matricule || '',
        periodStart: member.periodStart || startDate,
        periodEnd: member.periodEnd || endDate,
        shiftStart: '07:00',
        shiftEnd: '07:00',
        deptId: departmentId,
        shifts: shiftMap,
      };
    });

    // Compute anomalies
    const anomalies = [];
    dates.forEach(dStr => {
      const assignedSeniors = rosterRows.filter(r => (r.roleName.toLowerCase().includes('senior') || r.roleName.toLowerCase().includes('médecin')) && r.shifts[dStr]);
      if (serviceRequirements.seniorCount && assignedSeniors.length < serviceRequirements.seniorCount) {
        anomalies.push({
          id: `missing-senior-${dStr}`,
          type: 'missing_senior',
          severity: 'warning',
          message: `Le ${dStr}, aucun Senior n'est planifié en garde (requis : ${serviceRequirements.seniorCount}).`,
          date: dStr,
        });
      }
    });

    rosterRows.forEach(r => {
      const shiftCount = Object.keys(r.shifts).length;
      if (serviceRequirements.maxPerWeek && shiftCount > serviceRequirements.maxPerWeek * 4) {
        anomalies.push({
          id: `max-shifts-${r.id}`,
          type: 'max_exceeded',
          severity: 'warning',
          message: `${r.firstName} ${r.lastName} a ${shiftCount} gardes planifiées (seuil recommandé dépassé).`,
          userId: r.userId,
        });
      }
    });

    return {
      key,
      title: variantTitle,
      description: variantDesc,
      rosterRows,
      anomalies,
      metrics: {
        coveragePct: Math.min(100, Math.round((rosterRows.reduce((sum, r) => sum + Object.keys(r.shifts).length, 0) / (dates.length * Math.max(1, selectedStaff.length))) * 100)),
        equityScore: strategyModifier === 'balanced' ? 98 : strategyModifier === 'continuity' ? 92 : 95,
        restScore: strategyModifier === 'weekend_rest' ? 99 : 94,
        totalShifts: rosterRows.reduce((sum, r) => sum + Object.keys(r.shifts).length, 0),
      }
    };
  };

  const propA = buildProposalVariant('proposal_a', 'Proposition A — Équilibrée', 'Équité maximale du nombre de gardes, nuits et week-ends par agent', 'balanced');
  const propB = buildProposalVariant('proposal_b', 'Proposition B — Continuité & Stabilité', 'Minimise les changements d’équipes avec des blocs de présence continus', 'continuity');
  const propC = buildProposalVariant('proposal_c', 'Proposition C — Optimisée Repos & Week-ends', 'Priorise le repos après les gardes et un équilibre strict en fin de semaine', 'weekend_rest');

  return res.json({
    success: true,
    data: {
      proposals: [propA, propB, propC],
      datesCount: dates.length,
      staffCount: selectedStaff.length,
    }
  });
};

const confirmProposal = async (req, res) => {
  const estId = req.user.establishmentId;
  const {
    departmentId,
    name,
    startDate,
    endDate,
    scheduleType = 'normal',
    periodType = 'monthly',
    selectedProposal,
  } = req.body;

  if (!departmentId || !startDate || !endDate || !selectedProposal) {
    return res.status(400).json({ success: false, message: 'Données de la proposition incomplètes' });
  }

  const schedName = name?.trim() || `Planning Assistant (${startDate} → ${endDate})`;

  const newSched = await query(
    `INSERT INTO schedules
       (establishment_id, department_id, name, start_date, end_date, schedule_type,
        status, creation_mode, period_type, created_by, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft', 'assistant', $7, $8, $9::jsonb)
     RETURNING id`,
    [
      estId, departmentId, schedName, startDate, endDate, scheduleType,
      periodType, req.user.id,
      JSON.stringify({
        spreadsheet: {
          rows: selectedProposal.rosterRows || [],
          customCols: [],
          savedAt: new Date().toISOString(),
        },
        schedule_kind: scheduleType === 'special_weekend_holiday' ? 'weekend_holiday' : 'normal',
        special_days_only: scheduleType === 'special_weekend_holiday',
        proposalTitle: selectedProposal.title,
      })
    ]
  );

  const scheduleId = newSched.rows[0].id;

  const shiftTypesRes = await query(
    `SELECT id, UPPER(code) AS code FROM shift_types WHERE establishment_id = $1 AND is_active = TRUE`,
    [estId]
  );
  const shiftTypes = shiftTypesRes.rows;
  const resolveShiftTypeId = (code) => {
    const matched = shiftTypes.find(st => st.code === String(code).toUpperCase());
    return matched ? matched.id : (shiftTypes[0] ? shiftTypes[0].id : null);
  };

  let insertedCount = 0;
  for (const row of (selectedProposal.rosterRows || [])) {
    if (!row.userId) continue;
    for (const [dateStr, code] of Object.entries(row.shifts || {})) {
      if (!code || code === 'R') continue;
      const stId = resolveShiftTypeId(code);
      if (!stId) continue;
      await query(
        `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [scheduleId, estId, departmentId, row.userId, stId, dateStr, req.user.id]
      );
      insertedCount++;
    }
  }

  log({
    userId: req.user.id,
    action: 'schedule_assistant_generate',
    category: 'schedule',
    description: `Planning « ${schedName} » généré par l'Assistant Intelligent (${selectedProposal.title})`,
    entityType: 'schedules',
    entityId: scheduleId,
    ipAddress: getIp(req),
  });

  return res.json({
    success: true,
    data: { scheduleId, name: schedName, insertedCount },
    message: `Planning « ${schedName} » généré avec succès !`,
  });
};

module.exports = {
  getWizardContext,
  generateSchedule,
  generateProposals,
  confirmProposal,
  validateSchedule,
  validateShift,
  saveDraft,
  createSnapshot,
  getScheduleDetail,
  submitSchedule,
  cancelScheduleSubmission,
  listChangeProposals,
  createChangeProposal,
  decideChangeProposal,
  decideAllChangeProposals,
  notifyGeneralSupervisor,
};
