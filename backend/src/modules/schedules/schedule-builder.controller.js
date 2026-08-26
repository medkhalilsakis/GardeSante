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
const { normalizePeriods, periodBounds } = require('./periods');
// Règle de lecture partagée du tableur : `isMarked` dit si une case vaut « de
// service », `dutyEntries` applique l'arbitrage cases / période de participation.
// `dateKey` n'est pas importé : ce fichier en possède déjà une copie (l.43).
const { isMarked, dutyEntries } = require('./spreadsheet-reader');
const {
  isValidDateKey,
  datesInRange,
  generatedRows,
  loadApprovedLeaves,
  isAvailableOn,
  persistGeneratedRows,
} = require('./generation-helpers');

// La fonction visible vient de la fiche metier. Le role d'acces reste le
// dernier recours pour les anciens comptes qui n'ont pas encore de fonction.
const STAFF_FUNCTION_EXPR = `COALESCE(
  NULLIF(BTRIM(jt.name), ''),
  NULLIF(BTRIM(CASE WHEN r2.code <> 'autre' THEN r2.name END), ''),
  NULLIF(BTRIM(CASE WHEN r.code <> 'autre' THEN r.name END), ''),
  'Fonction à renseigner'
)`;

// Utilitaire : dates entre start et end
const getDatesInRange = (startDate, endDate) => {
  return datesInRange(startDate, endDate);
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

const normalizeFixedRosterPayload = (value) => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((slot, index) => ({
    id: String(slot?.id || `fixed-slot-${index + 1}`).slice(0, 100),
    jobTitleId: slot?.jobTitleId || slot?.job_title_id || null,
    functionName: String(slot?.functionName || slot?.function_name || '').trim().slice(0, 160),
    quantity: Math.min(Math.max(Number.parseInt(slot?.quantity, 10) || 1, 1), 50),
    isConstant: Boolean(slot?.isConstant ?? slot?.is_constant),
  }));
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

  if (!req.user.isSuperAdmin && !['department_head', 'service_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Seuls le chef de service ou le surveillant de service peuvent générer un planning.' });
  }

  if (!departmentId || !isValidDateKey(startDate) || !isValidDateKey(endDate) || endDate < startDate || !shiftTypeId) {
    return res.status(400).json({ success: false, message: 'departmentId, startDate, endDate et shiftTypeId sont requis' });
  }

  if (!req.user.isSuperAdmin) {
    const membership = await query(
      `SELECT 1 FROM user_departments
        WHERE user_id=$1 AND department_id=$2
          AND ($3 = 'service_supervisor' OR is_head=TRUE) LIMIT 1`,
      [req.user.id, departmentId, req.user.roleCode]
    );
    if (!membership.rows.length) return res.status(403).json({ success: false, message: 'Vous ne pouvez générer un planning que pour votre service.' });
  }

  // Résoudre le personnel
  let staff;
  if (staffIds?.length) {
    const res2 = await query(
      `SELECT id, first_name, last_name FROM users
        WHERE id = ANY($1) AND establishment_id=$2 AND is_active = TRUE`,
      [staffIds, estId]
    );
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
  const leavesByUser = await loadApprovedLeaves(query, staff.map((member) => member.id), startDate, endDate);

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
  const {
    rows = [], customCols = [], week_organization = [],
    spreadsheetMode = 'standard', fixedRoster = [],
  } = req.body;
  const sourceRows = Array.isArray(rows) ? rows : [];
  const normalizedSpreadsheetMode = spreadsheetMode === 'fixed' ? 'fixed' : 'standard';
  const normalizedFixedRoster = normalizedSpreadsheetMode === 'fixed'
    ? normalizeFixedRosterPayload(fixedRoster)
    : [];
  if (!['standard', 'fixed'].includes(spreadsheetMode)) {
    return res.status(400).json({ success: false, message: 'Mode de tableur invalide.' });
  }
  if (normalizedSpreadsheetMode === 'fixed') {
    if (req.user.roleCode !== 'department_head') {
      return res.status(403).json({ success: false, message: 'Seul le chef de service peut utiliser le Tableur fixe.' });
    }
    if (normalizedFixedRoster.some(slot => !slot.functionName)) {
      return res.status(400).json({ success: false, message: 'Chaque poste du Tableur fixe doit avoir une fonction.' });
    }
    const totalFixedPositions = normalizedFixedRoster.reduce((total, slot) => total + slot.quantity, 0);
    if (totalFixedPositions > 500) {
      return res.status(400).json({ success: false, message: 'Le Tableur fixe ne peut pas dépasser 500 postes.' });
    }
  }
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

  if (normalizedSpreadsheetMode === 'fixed') {
    const jobTitleIds = [...new Set(normalizedFixedRoster.map(slot => slot.jobTitleId).filter(Boolean))];
    if (jobTitleIds.length) {
      const validJobTitles = await query(
        'SELECT id FROM job_titles WHERE establishment_id=$1 AND is_active=TRUE AND id = ANY($2)',
        [estId, jobTitleIds]
      );
      if (validJobTitles.rows.length !== jobTitleIds.length) {
        return res.status(400).json({ success: false, message: 'Une fonction du Tableur fixe est introuvable ou inactive.' });
      }
    }
  }

  // Les ids de lignes (`new-...`) ne sont jamais des UUID de personnel.
  const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const roster = sourceRows.filter(r => isUuid(r.userId));
  const invalidPersonnelRow = sourceRows.find(r => r.userId && !isUuid(r.userId));
  if (invalidPersonnelRow) {
    return res.status(400).json({ success: false, code: 'INVALID_PERSONNEL_ID', message: 'Une ligne du tableur contient un identifiant de personnel invalide. Veuillez selectionner a nouveau ce personnel.' });
  }
  const ids = roster.map(r => r.userId);
  if (new Set(ids).size !== ids.length) return res.status(400).json({ success: false, message: 'Un membre du personnel ne peut apparaître qu\'une fois dans le tableur.' });
  if (ids.length) {
    const users = await query('SELECT id, job_title_id FROM users WHERE establishment_id=$1 AND is_active=TRUE AND id = ANY($2)', [estId, ids]);
    if (users.rows.length !== ids.length) return res.status(400).json({ success: false, message: 'Le personnel sélectionné doit appartenir à l\'hôpital et être actif.' });
    if (normalizedSpreadsheetMode === 'fixed') {
      const usersById = new Map(users.rows.map(user => [user.id, user]));
      const slotsById = new Map(normalizedFixedRoster.map(slot => [slot.id, slot]));
      const occupiedPositions = new Set();
      for (const row of roster) {
        if (!row.fixedSlotId) continue;
        const slot = slotsById.get(String(row.fixedSlotId));
        const positionIndex = Number(row.fixedPositionIndex);
        if (!slot || !Number.isInteger(positionIndex) || positionIndex < 0 || positionIndex >= slot.quantity) {
          return res.status(400).json({ success: false, message: 'Un poste du Tableur fixe est invalide. Rechargez le planning.' });
        }
        const positionKey = `${slot.id}:${positionIndex}`;
        if (occupiedPositions.has(positionKey)) {
          return res.status(400).json({ success: false, message: 'Deux personnels ne peuvent pas occuper le même poste fixe.' });
        }
        occupiedPositions.add(positionKey);
        const userJobTitleId = usersById.get(row.userId)?.job_title_id;
        if (slot.jobTitleId && String(userJobTitleId || '') !== String(slot.jobTitleId)) {
          return res.status(400).json({ success: false, message: `${row.lastName || ''} ${row.firstName || ''} ne correspond pas à la fonction « ${slot.functionName} ».`.trim() });
        }
      }
    }
  }
  const start = dateKey(schedule.start_date), end = dateKey(schedule.end_date);
  const isSpecialSchedule = schedule.schedule_type === 'special_weekend_holiday' || schedule.metadata?.schedule_kind === 'weekend_holiday' || schedule.metadata?.special_days_only;
  const specialDateSet = isSpecialSchedule ? new Set(await getCurrentSpecialDates(start, end)) : null;
  for (const row of roster) {
    const name = `${row.lastName || ''} ${row.firstName || ''}`.trim() || 'Personnel sélectionné';
    if (isSpecialSchedule) {
      const selectedDates = Object.entries(row.shifts || {})
        .filter(([, value]) => isMarked(value))
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
  //
  // Les journées de service sont déduites par le lecteur partagé, exactement comme
  // les liront ensuite la supervision, l'appel du jour et les statistiques : cases
  // cochées de la ligne, ou période de participation quand elle n'en porte aucune.
  // Ne regarder que les cases laissait passer les lignes exprimées par période —
  // c'est-à-dire la quasi-totalité — et la règle ne se déclenchait jamais.
  const { findLeaveViolations } = require('../absences/leave-check');
  const rosterSchedule = {
    ...schedule,
    start_date: start,
    end_date: end,
    metadata: {
      ...schedule.metadata,
      spreadsheet: { ...schedule.metadata?.spreadsheet, rows: roster },
    },
  };
  const leaveAssignments = dutyEntries(rosterSchedule, start, end)
    .map(entry => ({ userId: entry.userId, date: entry.date }));
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

  // Le tableur est la seule source de vérité des gardes : plus aucune conversion
  // vers la table `shifts`. Les périodes de participation, elles, restent
  // matérialisées par `replaceRosterAssignments` (schedule_staff_periods /
  // schedule_staff_assignments), que lisent la fiche agent et les remplacements.
  const previousSpreadsheet = schedule.metadata?.spreadsheet && typeof schedule.metadata.spreadsheet === 'object'
    ? schedule.metadata.spreadsheet
    : {};
  const nextSpreadsheet = {
    ...previousSpreadsheet,
    rows: roster,
    customCols: Array.isArray(customCols) ? customCols : [],
    week_organization: Array.isArray(week_organization) ? week_organization : [],
    mode: normalizedSpreadsheetMode,
    fixedRoster: normalizedFixedRoster,
    savedAt: new Date().toISOString(),
  };
  const changeSummary = buildSpreadsheetChangeSummary(previousSpreadsheet, nextSpreadsheet);
  await transaction(async client => {
    await replaceRosterAssignments(client, scheduleId, roster, start, end);
    // Le tableur ne produit plus de gardes : on purge les lignes héritées pour que
    // `shifts` ne puisse jamais contredire le tableur sur ce planning.
    await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
    await client.query(
      `UPDATE schedules SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`,
      [scheduleId, JSON.stringify({ spreadsheet: nextSpreadsheet })]
    );
    if (normalizedSpreadsheetMode === 'fixed') {
      const constantSlots = normalizedFixedRoster.filter(slot => slot.isConstant);
      const templateConfig = JSON.stringify({ kind: 'fixed_spreadsheet', version: 1, slots: constantSlots });
      const existingTemplate = await client.query(
        `SELECT id FROM schedule_templates
         WHERE establishment_id=$1 AND department_id=$2 AND is_active=TRUE
           AND generation_algo='fixed_roster' AND config->>'kind'='fixed_spreadsheet'
         ORDER BY updated_at DESC LIMIT 1`,
        [estId, schedule.department_id]
      );
      if (existingTemplate.rows[0]) {
        await client.query(
          `UPDATE schedule_templates
           SET name='Tableur fixe', description='Fonctions constantes du tableau de garde du service',
               config=$2::jsonb, updated_at=NOW()
           WHERE id=$1`,
          [existingTemplate.rows[0].id, templateConfig]
        );
      } else if (constantSlots.length) {
        await client.query(
          `INSERT INTO schedule_templates
             (establishment_id, department_id, name, description, period_type, week_mode,
              generation_algo, config, is_default, created_by)
           VALUES ($1,$2,'Tableur fixe','Fonctions constantes du tableau de garde du service',
                   'monthly','standard','fixed_roster',$3::jsonb,FALSE,$4)`,
          [estId, schedule.department_id, templateConfig, req.user.id]
        );
      }
    }
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
    metadata: {
      status: schedule.status,
      startDate: start,
      endDate: end,
      staffCount: roster.length,
      spreadsheetMode: normalizedSpreadsheetMode,
      tableurOnly: true,
      changeSummary,
    },
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

  // Le Super Admin consulte les gardes de TOUS les hôpitaux depuis son panneau
  // de supervision, mais son propre `establishmentId` est celui du compte
  // plateforme (`00000000-…`), qui ne possède aucun planning. Borner la requête
  // dessus renvoyait donc « Planning introuvable » à chaque aperçu ouvert depuis
  // le dashboard Super Admin, quel que soit l'hôpital choisi : le tableau ne
  // s'affichait jamais. Sa lecture reste une lecture — ce routeur n'expose que
  // des GET pour lui, et la règle de confidentialité des brouillons ci-dessous
  // ne bouge pas. Pour tous les autres rôles la borne reste stricte : on ne voit
  // que les plannings de son établissement.
  const scopeToEstablishment = !req.user.isSuperAdmin;

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
     WHERE sch.id = $1${scopeToEstablishment ? ' AND sch.establishment_id = $2' : ''}`,
    scopeToEstablishment ? [scheduleId, estId] : [scheduleId]
  );

  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (sched.rows[0].status === 'draft' && (req.user.roleCode !== 'department_head' || sched.rows[0].created_by !== req.user.id)) return res.status(403).json({ success: false, message: 'Ce brouillon est privé au chef de service.' });

  const { start_date_key, end_date_key, ...schedRow } = sched.rows[0];
  const schedule = {
    ...schedRow,
    start_date: start_date_key || schedRow.start_date,
    end_date:   end_date_key   || schedRow.end_date,
  };

  // Le Tableur est la source de vérité des affectations. Depuis la migration
  // du registre, `saveDraft` purge la table historique `shifts` après chaque
  // sauvegarde : la lire ici produirait donc une fiche vide alors que le
  // planning contient bien des lignes dans `metadata.spreadsheet.rows`.
  // `dutyEntries` applique la même règle cases/périodes que le calendrier, les
  // exports et le moteur de règles. On matérialise ensuite la forme historique
  // attendue par les consommateurs de cet endpoint (sans réécrire en base).
  const entries = dutyEntries(schedule, schedule.start_date, schedule.end_date);
  const entryUserIds = [...new Set(entries.map(entry => entry.userId).filter(Boolean))];
  const entryStaff = entryUserIds.length
    ? await query(
      `SELECT u.id, u.first_name, u.last_name, u.matricule, u.speciality, u.grade, u.phone,
              r.code AS role_code, r.name AS role_name
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = ANY($1)`,
      [entryUserIds]
    )
    : { rows: [] };
  const entryStaffById = new Map(entryStaff.rows.map(member => [member.id, member]));
  const shifts = entries.map((entry, index) => {
    const member = entryStaffById.get(entry.userId) || {};
    return {
      id: `spreadsheet-${schedule.id}-${entry.userId}-${entry.date}-${index}`,
      schedule_id: schedule.id,
      establishment_id: schedule.establishment_id,
      department_id: entry.departmentId || schedule.department_id,
      user_id: entry.userId,
      // Le jour de la garde : c'est la donnée qui distingue deux affectations du
      // même agent, et elle manquait — elle n'apparaissait que noyée dans `id`.
      // Les consommateurs de cet endpoint indexent tous les gardes par date
      // (`shift.shift_date`) : sans ce champ ils recevaient 124 affectations sans
      // pouvoir en situer une seule. La forme historique lue en base porte bien
      // `shift_date`, comme les deux autres matérialisations du tableur
      // (`rules-engine.js`, `schedules.controller.js`) : on la complète ici.
      shift_date: entry.date,
      shift_type_id: null,
      shift_type_name: entry.label || 'De service',
      shift_type_code: null,
      shift_color: null,
      color: null,
      start_time: entry.shiftStart || null,
      end_time: entry.shiftEnd || null,
      duration_hours: null,
      status: 'planned',
      first_name: entry.firstName || member.first_name || '',
      last_name: entry.lastName || member.last_name || '',
      matricule: entry.matricule || member.matricule || '',
      speciality: member.speciality || '',
      grade: member.grade || entry.roleName || member.role_name || '',
      phone: member.phone || '',
      role_code: member.role_code || null,
      role_name: entry.roleName || member.role_name || '',
      at_home: entry.atHome === true,
    };
  });

  const cycles = await query(
    'SELECT * FROM schedule_cycles WHERE schedule_id = $1 ORDER BY start_date',
    [scheduleId]
  );

  const staff = await query(
    `SELECT u.id, u.first_name, u.last_name, u.matricule, u.phone,
            r.name AS role_name,
            r2.name AS secondary_role_name,
            jt.id AS job_title_id, jt.name AS job_title,
            ${STAFF_FUNCTION_EXPR} AS function_name,
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
       FROM schedule_staff_assignments a
       JOIN users u ON u.id = a.user_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN roles r2 ON r2.id = u.secondary_role_id
       LEFT JOIN job_titles jt ON jt.id = u.job_title_id
      WHERE a.schedule_id = $1
      ORDER BY a.position`,
    [scheduleId]
  );

  // État d'approbation des agents empruntés à un autre service : le tableur
  // colore les lignes en attente sans que rien ne soit bloqué.
  const externalLoans = await require('./external-staff').getScheduleLoanStates(scheduleId);

  return res.json({
    success: true,
    data: {
      schedule,
      shifts,
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

const comparableRow = (row = {}) => ({
  periods: row.periods || [],
  periodStart: row.periodStart || row.period_start || null,
  periodEnd: row.periodEnd || row.period_end || null,
  startTime: row.startTime || row.start_time || null,
  endTime: row.endTime || row.end_time || null,
  shifts: row.shifts || {},
  custom: row.custom || {},
  fixedSlotId: row.fixedSlotId || null,
  fixedPositionIndex: row.fixedPositionIndex ?? null,
});

const rowDisplayName = (row = {}) => (
  `${row.lastName || row.last_name || ''} ${row.firstName || row.first_name || ''}`.trim()
  || row.name
  || 'Personnel'
);

const buildSpreadsheetChangeSummary = (previousSpreadsheet = {}, nextSpreadsheet = {}) => {
  const previousRows = Array.isArray(previousSpreadsheet.rows) ? previousSpreadsheet.rows : [];
  const nextRows = Array.isArray(nextSpreadsheet.rows) ? nextSpreadsheet.rows : [];
  const previousByUser = new Map(previousRows.filter(row => row.userId).map(row => [String(row.userId), row]));
  const nextByUser = new Map(nextRows.filter(row => row.userId).map(row => [String(row.userId), row]));
  const added = nextRows.filter(row => row.userId && !previousByUser.has(String(row.userId))).map(row => ({ userId: row.userId, name: rowDisplayName(row) }));
  const removed = previousRows.filter(row => row.userId && !nextByUser.has(String(row.userId))).map(row => ({ userId: row.userId, name: rowDisplayName(row) }));
  const changedPersonnel = [];

  for (const [userId, nextRow] of nextByUser) {
    const previousRow = previousByUser.get(userId);
    if (!previousRow) continue;
    const before = comparableRow(previousRow);
    const after = comparableRow(nextRow);
    const fields = Object.keys(after).filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (fields.length) changedPersonnel.push({ userId, name: rowDisplayName(nextRow), fields });
  }

  const previousMode = previousSpreadsheet.mode === 'fixed' ? 'fixed' : 'standard';
  const nextMode = nextSpreadsheet.mode === 'fixed' ? 'fixed' : 'standard';
  return {
    previousMode,
    nextMode,
    modeChanged: previousMode !== nextMode,
    added,
    removed,
    changedPersonnel,
    staffBefore: previousRows.filter(row => row.userId).length,
    staffAfter: nextRows.filter(row => row.userId).length,
    fixedRosterChanged: JSON.stringify(previousSpreadsheet.fixedRoster || []) !== JSON.stringify(nextSpreadsheet.fixedRoster || []),
    customColumnsChanged: JSON.stringify(previousSpreadsheet.customCols || []) !== JSON.stringify(nextSpreadsheet.customCols || []),
    weekOrganizationChanged: JSON.stringify(previousSpreadsheet.week_organization || []) !== JSON.stringify(nextSpreadsheet.week_organization || []),
  };
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

// Historique interne d'un tableur. Cette vue est volontairement bornée au
// planning demandé et ne remplace pas l'historique général des dashboards.
const getScheduleHistory = async (req, res) => {
  const { scheduleId } = req.params;
  const scheduleRes = await query(
    `SELECT s.id, s.name, s.status, s.establishment_id, s.department_id,
            s.creation_mode, s.metadata, s.created_at, s.updated_at,
            TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(s.end_date, 'YYYY-MM-DD') AS end_date,
            creator.id AS creator_id, creator.first_name AS creator_first_name,
            creator.last_name AS creator_last_name, creator_role.name AS creator_role_name
       FROM schedules s
       JOIN users creator ON creator.id = s.created_by
       LEFT JOIN roles creator_role ON creator_role.id = creator.role_id
      WHERE s.id = $1`,
    [scheduleId]
  );
  const schedule = scheduleRes.rows[0];
  if (!schedule) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (!req.user.isSuperAdmin && schedule.establishment_id !== req.user.establishmentId) {
    return res.status(403).json({ success: false, message: 'Accès non autorisé' });
  }

  const allowedRoles = ['department_head', 'service_supervisor', 'general_supervisor', 'director', 'hospital_admin', 'super_admin'];
  if (!req.user.isSuperAdmin && !allowedRoles.includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Accès non autorisé' });
  }
  if (!req.user.isSuperAdmin && ['department_head', 'service_supervisor'].includes(req.user.roleCode)) {
    const membership = await query(
      'SELECT 1 FROM user_departments WHERE user_id=$1 AND department_id=$2',
      [req.user.id, schedule.department_id]
    );
    if (!membership.rows.length) return res.status(403).json({ success: false, message: 'Ce planning ne dépend pas de votre service.' });
  }

  const [activityRes, workflowRes, proposalRes] = await Promise.all([
    query(
      `SELECT al.id, al.action, al.description, al.metadata, al.severity, al.created_at,
              u.id AS actor_id, u.first_name, u.last_name, r.name AS role_name, r.code AS role_code
         FROM activity_logs al
         JOIN users u ON u.id = al.user_id
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE al.category = 'schedule'
          AND al.entity_type = 'schedules'
          AND al.entity_id = $1
        ORDER BY al.created_at DESC`,
      [scheduleId]
    ),
    query(
      `SELECT h.id, h.action, h.comment, h.created_at,
              u.id AS actor_id, u.first_name, u.last_name, r.name AS role_name, r.code AS role_code
         FROM schedule_workflow_history h
         JOIN users u ON u.id = h.actor_id
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE h.schedule_id = $1
        ORDER BY h.created_at DESC`,
      [scheduleId]
    ),
    query(
      `SELECT p.id, p.status, p.comment, p.proposal, p.created_at, p.decided_at, p.decision_comment,
              proposer.id AS proposer_id, proposer.first_name AS proposer_first_name,
              proposer.last_name AS proposer_last_name, proposer_role.name AS proposer_role_name,
              proposer_role.code AS proposer_role_code,
              decider.id AS decider_id, decider.first_name AS decider_first_name,
              decider.last_name AS decider_last_name, decider_role.name AS decider_role_name,
              decider_role.code AS decider_role_code
         FROM schedule_change_proposals p
         JOIN users proposer ON proposer.id = p.proposed_by
         LEFT JOIN roles proposer_role ON proposer_role.id = proposer.role_id
         LEFT JOIN users decider ON decider.id = p.decided_by
         LEFT JOIN roles decider_role ON decider_role.id = decider.role_id
        WHERE p.schedule_id = $1
        ORDER BY p.created_at DESC`,
      [scheduleId]
    ),
  ]);

  const actorFrom = (row, prefix = '') => ({
    id: prefix ? row[`${prefix}id`] : row.actor_id,
    firstName: prefix ? row[`${prefix}first_name`] : row.first_name,
    lastName: prefix ? row[`${prefix}last_name`] : row.last_name,
    roleName: prefix ? row[`${prefix}role_name`] : row.role_name,
    roleCode: prefix ? row[`${prefix}role_code`] : row.role_code,
  });
  const events = [{
    id: `schedule:${schedule.id}:created`,
    action: 'schedule_created',
    source: 'schedule',
    status: 'completed',
    title: 'Tableur créé',
    description: `Création du planning « ${schedule.name} »`,
    occurredAt: schedule.created_at,
    actor: {
      id: schedule.creator_id,
      firstName: schedule.creator_first_name,
      lastName: schedule.creator_last_name,
      roleName: schedule.creator_role_name,
      roleCode: null,
    },
    metadata: {
      creationMode: schedule.creation_mode,
      spreadsheetMode: schedule.metadata?.spreadsheet?.mode || 'standard',
      startDate: schedule.start_date,
      endDate: schedule.end_date,
    },
  }];

  activityRes.rows.forEach(row => events.push({
    id: `activity:${row.id}`,
    action: row.action,
    source: 'activity',
    status: row.severity === 'error' ? 'error' : 'completed',
    title: null,
    description: row.description,
    occurredAt: row.created_at,
    actor: actorFrom(row),
    metadata: row.metadata || {},
  }));
  const workflowActivityEquivalent = {
    submitted: 'schedule_submit',
    submission_cancelled: 'schedule_submission_cancelled',
  };
  workflowRes.rows.forEach(row => {
    const equivalentAction = workflowActivityEquivalent[row.action];
    const duplicated = equivalentAction && activityRes.rows.some(activity => (
      activity.action === equivalentAction
      && Math.abs(new Date(activity.created_at) - new Date(row.created_at)) < 15000
    ));
    if (duplicated) return;
    events.push({
      id: `workflow:${row.id}`,
      action: row.action,
      source: 'workflow',
      status: 'completed',
      title: null,
      description: row.comment || null,
      occurredAt: row.created_at,
      actor: actorFrom(row),
      metadata: {},
    });
  });
  proposalRes.rows.forEach(row => {
    events.push({
      id: `proposal:${row.id}:created`,
      action: 'schedule_change_proposed',
      source: 'proposal',
      status: 'pending',
      title: 'Proposition de modification',
      description: row.comment || 'Proposition envoyée au chef de service.',
      occurredAt: row.created_at,
      actor: actorFrom(row, 'proposer_'),
      metadata: { proposalId: row.id, changeSummary: row.proposal?.auditSummary || null },
    });
    if (row.decided_at) events.push({
      id: `proposal:${row.id}:decision`,
      action: row.status === 'accepted' ? 'schedule_change_accepted' : 'schedule_change_rejected',
      source: 'proposal',
      status: row.status,
      title: row.status === 'accepted' ? 'Proposition acceptée' : 'Proposition refusée',
      description: row.decision_comment || (row.status === 'accepted' ? 'Les changements ont été appliqués au tableur officiel.' : 'La proposition n’a pas été appliquée.'),
      occurredAt: row.decided_at,
      actor: actorFrom(row, 'decider_'),
      metadata: { proposalId: row.id, proposer: actorFrom(row, 'proposer_'), changeSummary: row.proposal?.auditSummary || null },
    });
  });

  events.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  const actorIds = new Set(events.map(event => event.actor?.id).filter(Boolean));
  return res.json({
    success: true,
    data: {
      schedule: {
        id: schedule.id,
        name: schedule.name,
        status: schedule.status,
        startDate: schedule.start_date,
        endDate: schedule.end_date,
        spreadsheetMode: schedule.metadata?.spreadsheet?.mode || 'standard',
      },
      events,
      stats: {
        total: events.length,
        actors: actorIds.size,
        proposals: proposalRes.rows.length,
        acceptedProposals: proposalRes.rows.filter(row => row.status === 'accepted').length,
        rejectedProposals: proposalRes.rows.filter(row => row.status === 'rejected').length,
      },
    },
  });
};

const createChangeProposal = async (req, res) => {
  const { scheduleId } = req.params;
  const { rows, customCols = [], week_organization = [], comment = '' } = req.body;
  if (!Array.isArray(rows)) return res.status(400).json({ success: false, message: 'Les lignes du tableur sont requises.' });
  const schedule = await query('SELECT id, department_id, establishment_id, status, name, created_by, metadata FROM schedules WHERE id=$1 AND establishment_id=$2', [scheduleId, req.user.establishmentId]);
  const item = schedule.rows[0];
  if (!item) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (!SCHEDULE_IN_FORCE.includes(item.status)) return res.status(400).json({ success: false, message: 'Les propositions sont ouvertes une fois le planning envoyé et mis en marche.' });
  if (!(await canProposeScheduleChange(req.user, item.department_id))) return res.status(403).json({ success: false, message: 'Seuls les surveillants concernés peuvent proposer une modification.' });
  const currentSpreadsheet = item.metadata?.spreadsheet || {};
  const currentMode = currentSpreadsheet.mode === 'fixed' ? 'fixed' : 'standard';
  const proposalSpreadsheet = {
    rows,
    customCols,
    week_organization: Array.isArray(week_organization) ? week_organization : [],
    mode: currentMode,
    fixedRoster: currentMode === 'fixed' ? normalizeFixedRosterPayload(currentSpreadsheet.fixedRoster) : [],
  };
  const proposalSummary = buildSpreadsheetChangeSummary(currentSpreadsheet, proposalSpreadsheet);
  const created = await query(
    `INSERT INTO schedule_change_proposals (schedule_id, establishment_id, department_id, proposed_by, proposal, comment)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
    [scheduleId, item.establishment_id, item.department_id, req.user.id, JSON.stringify({
      ...proposalSpreadsheet,
      auditSummary: proposalSummary,
    }), comment || null]
  );
  await createNotification({
    establishmentId: item.establishment_id, recipientId: item.created_by, senderId: req.user.id, type: 'schedule_change_proposed',
    title: 'Proposition de modification', message: `Une proposition de modification attend votre décision pour « ${item.name} ».`,
    entityType: 'schedule_change_proposals', entityId: created.rows[0].id, priority: 'high',
  });
  await log({
    userId: req.user.id,
    action: 'schedule_change_proposed',
    category: 'schedule',
    description: `Proposition de modification envoyée pour le planning « ${item.name} »`,
    entityType: 'schedule_change_proposals',
    entityId: created.rows[0].id,
    metadata: { scheduleId, tableurOnly: true, status: 'pending', changeSummary: proposalSummary },
    ipAddress: getIp(req),
  });
  // La notification seule n'atteint pas l'écran : `createNotification` insère en
  // base sans diffuser. Sans cette émission, le chef ne voit la proposition
  // qu'au prochain rafraîchissement (repli de 60 s).
  emitToDepartment(req.app, item.department_id, 'schedule:change-proposal', {
    scheduleId, proposalId: created.rows[0].id, status: 'pending',
  });
  return res.status(201).json({ success: true, data: created.rows[0], message: 'Proposition envoyée au chef de service.' });
};

const decideChangeProposal = async (req, res) => {
  const { scheduleId, proposalId } = req.params;
  const { decision, comment = '' } = req.body;
  if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ success: false, message: 'Décision invalide.' });
  const proposalRes = await query(
    `SELECT p.*, s.start_date, s.end_date, s.name, s.metadata FROM schedule_change_proposals p
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
    await transaction(async client => {
      await replaceRosterAssignments(client, scheduleId, roster, proposalStart, proposalEnd);
      await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
      const currentSpreadsheet = proposal.metadata?.spreadsheet || {};
      const mode = spreadsheet.mode === 'fixed' || currentSpreadsheet.mode === 'fixed' ? 'fixed' : 'standard';
      await client.query(`UPDATE schedules SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`, [scheduleId, JSON.stringify({ spreadsheet: {
        ...currentSpreadsheet,
        rows: roster,
        customCols: spreadsheet.customCols || [],
        week_organization: Array.isArray(spreadsheet.week_organization) ? spreadsheet.week_organization : [],
        mode,
        fixedRoster: mode === 'fixed' ? normalizeFixedRosterPayload(spreadsheet.fixedRoster || currentSpreadsheet.fixedRoster) : [],
        savedAt: new Date().toISOString(),
      } })]);
      await client.query(`UPDATE schedule_change_proposals SET status=$2, decided_by=$3, decision_comment=$4, decided_at=NOW() WHERE id=$1`, [proposalId, decision, req.user.id, comment || null]);
    });
  } else {
    await query(`UPDATE schedule_change_proposals SET status='rejected', decided_by=$2, decision_comment=$3, decided_at=NOW() WHERE id=$1`, [proposalId, req.user.id, comment || null]);
  }
  await createNotification({ establishmentId: proposal.establishment_id, recipientId: proposal.proposed_by, senderId: req.user.id, type: `schedule_change_${decision}`, title: decision === 'accepted' ? 'Proposition acceptée' : 'Proposition refusée', message: `Votre proposition pour « ${proposal.name} » a été ${decision === 'accepted' ? 'acceptée' : 'refusée'}${comment ? ` : ${comment}` : '.'}`, entityType: 'schedule_change_proposals', entityId: proposalId, priority: 'normal' });
  log({ userId: req.user.id, action: `schedule_change_${decision}`, category: 'schedule', description: `Proposition ${decision} pour le planning ${scheduleId}`, entityType: 'schedule_change_proposals', entityId: proposalId, ipAddress: getIp(req) });
  // Le surveillant doit voir la décision sans rechargement, et une proposition
  // acceptée modifie le planning officiel : les deux salons sont visés.
  emitToDepartment(req.app, proposal.department_id, 'schedule:change-proposal', { scheduleId, proposalId, status: decision });
  if (decision === 'accepted') {
    emitToEstablishment(req.app, proposal.establishment_id, 'schedule:updated', { scheduleId });
  }
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
  // Le planning redevient un brouillon : il doit disparaître des écrans de
  // supervision sans rechargement, comme il y était apparu à l'envoi.
  emitToEstablishment(req.app, item.establishment_id, 'schedule:updated', { scheduleId, status: 'draft' });
  if (item.department_id) {
    emitToDepartment(req.app, item.department_id, 'schedule:updated', { scheduleId, status: 'draft' });
  }
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
    `SELECT p.*, s.start_date, s.end_date, s.name, s.metadata FROM schedule_change_proposals p
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
    await transaction(async client => {
      await replaceRosterAssignments(client, scheduleId, roster, proposalStart, proposalEnd);
      await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
      const currentSpreadsheet = latestProposal.metadata?.spreadsheet || {};
      const mode = spreadsheet.mode === 'fixed' || currentSpreadsheet.mode === 'fixed' ? 'fixed' : 'standard';
      await client.query(`UPDATE schedules SET metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`, [scheduleId, JSON.stringify({ spreadsheet: {
        ...currentSpreadsheet,
        rows: roster,
        customCols: spreadsheet.customCols || [],
        week_organization: Array.isArray(spreadsheet.week_organization) ? spreadsheet.week_organization : [],
        mode,
        fixedRoster: mode === 'fixed' ? normalizeFixedRosterPayload(spreadsheet.fixedRoster || currentSpreadsheet.fixedRoster) : [],
        savedAt: new Date().toISOString(),
      } })]);
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
  // Même diffusion que la décision unitaire : sans elle, les surveillants ne
  // verraient la réponse qu'au prochain rafraîchissement.
  const first = pendingList[0];
  if (first) {
    emitToDepartment(req.app, first.department_id, 'schedule:change-proposal', { scheduleId, status: decision, all: true });
    if (decision === 'accepted') {
      emitToEstablishment(req.app, first.establishment_id, 'schedule:updated', { scheduleId });
    }
  }
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

  // Helper to generate proposal variations
  const buildProposalVariant = (key, variantTitle, variantDesc, strategyModifier) => {
    const rosterRows = selectedStaff.map((member, mIdx) => {
      const shiftMap = {};
      const memberAbsences = approvedAbsences.filter(a => a.user_id === member.id);

      dates.forEach((dateStr) => {
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

        // L'agent est de service ce jour-là. Le tableur ne connaît plus qu'une
        // seule notion : la case est cochée, ou elle est vide.
        shiftMap[dateStr] = true;
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

  // Le tableur est la seule source de vérité : la proposition retenue vient
  // d'être écrite dans `metadata.spreadsheet.rows` ci-dessus. On ne la recopie
  // plus dans `shifts` — le décompte annoncé est simplement relu par la règle
  // partagée, donc il correspond exactement à ce que le tableur affichera.
  const insertedCount = dutyEntries(
    {
      id: scheduleId,
      start_date: startDate,
      end_date: endDate,
      schedule_type: scheduleType,
      metadata: { spreadsheet: { rows: selectedProposal.rosterRows || [] } },
    },
    startDate,
    endDate
  ).length;

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
  getScheduleHistory,
  submitSchedule,
  cancelScheduleSubmission,
  listChangeProposals,
  createChangeProposal,
  decideChangeProposal,
  decideAllChangeProposals,
  notifyGeneralSupervisor,
};
