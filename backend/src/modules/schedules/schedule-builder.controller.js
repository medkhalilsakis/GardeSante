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

// PostgreSQL DATE est renvoyé comme Date par node-postgres : conserver le jour
// UTC, sans le transformer dans le fuseau horaire du serveur.
const dateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : new Date(value).toISOString().slice(0, 10);
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

  const dates = getDatesInRange(startDate, endDate);

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
  const { rows = [], customCols = [] } = req.body;
  const estId = req.user.establishmentId;
  const schedRes = await query(
    'SELECT id, department_id, start_date, end_date, status FROM schedules WHERE id=$1 AND establishment_id=$2',
    [scheduleId, estId]
  );
  const schedule = schedRes.rows[0];
  if (!schedule) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (schedule.status !== 'draft') return res.status(400).json({ success: false, message: 'Seul un planning brouillon peut être modifié.' });

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
  for (const row of roster) {
    const name = `${row.lastName || ''} ${row.firstName || ''}`.trim() || 'Personnel sélectionné';
    const pStart = row.periodStart || null, pEnd = row.periodEnd || null;
    if (!pStart) return res.status(400).json({ success: false, code: 'PERIOD_START_REQUIRED', message: `${name} : date de début requise.` });
    if (!pEnd) return res.status(400).json({ success: false, code: 'PERIOD_END_REQUIRED', message: `${name} : date de fin requise.` });
    if (pStart < start) return res.status(400).json({ success: false, code: 'PERIOD_START_BEFORE_SCHEDULE', message: `${name} : la date de début ne peut pas être avant le ${start}.` });
    if (pStart > end) return res.status(400).json({ success: false, code: 'PERIOD_START_AFTER_SCHEDULE', message: `${name} : la date de début ne peut pas être après le ${end}.` });
    if (pEnd < start) return res.status(400).json({ success: false, code: 'PERIOD_END_BEFORE_SCHEDULE', message: `${name} : la date de fin ne peut pas être avant le ${start}.` });
    if (pEnd > end) return res.status(400).json({ success: false, code: 'PERIOD_END_AFTER_SCHEDULE', message: `${name} : la date de fin ne peut pas dépasser le ${end}.` });
    if (pStart > pEnd) return res.status(400).json({ success: false, code: 'PERIOD_RANGE_INVALID', message: `${name} : la date de début doit être antérieure ou égale à la date de fin.` });
  }
  if (roster.length > 0 && !roster.some(row => (row.periodStart || start) === start)) {
    return res.status(400).json({ success: false, message: `Au moins un personnel doit couvrir le début du planning (${start}).` });
  }
  if (roster.length > 0 && !roster.some(row => (row.periodEnd || end) === end)) {
    return res.status(400).json({ success: false, message: `Au moins un personnel doit couvrir la fin du planning (${end}).` });
  }
  // Convertit aussi les codes du tableur en gardes réelles : le brouillon
  // reste exploitable par les règles métier et par la validation finale.
  const typeRes = await query('SELECT id, UPPER(code) AS code, LOWER(name) AS name FROM shift_types WHERE establishment_id=$1 AND is_active=TRUE', [estId]);
  const resolveShiftType = (code) => typeRes.rows.find(t => t.code === code)
    || typeRes.rows.find(t => (code === 'J' && t.name.startsWith('jour')) || (code === 'N' && t.name.startsWith('nuit')) || (code === 'S' && t.name.startsWith('soir')) || (code === 'G' && t.name.startsWith('garde')));
  const shiftRows = [];
  for (const row of roster) {
    for (const [date, code] of Object.entries(row.shifts || {})) {
      if (code === 'R' || date < (row.periodStart || start) || date > (row.periodEnd || end)) continue;
      const shiftType = resolveShiftType(String(code).toUpperCase());
      if (!shiftType) return res.status(400).json({ success: false, message: `Type de garde introuvable pour le code "${code}".` });
      shiftRows.push([scheduleId, estId, schedule.department_id, row.userId, shiftType.id, date, req.user.id]);
    }
  }
  await transaction(async client => {
    await client.query('DELETE FROM schedule_staff_assignments WHERE schedule_id=$1', [scheduleId]);
    for (const [position, row] of roster.entries()) {
      await client.query(
        'INSERT INTO schedule_staff_assignments (schedule_id,user_id,period_start,period_end,position) VALUES ($1,$2,$3,$4,$5)',
        [scheduleId, row.userId, row.periodStart || start, row.periodEnd || end, position]
      );
    }
    await client.query('DELETE FROM shifts WHERE schedule_id=$1', [scheduleId]);
    for (const shift of shiftRows) {
      await client.query(
        'INSERT INTO shifts (schedule_id,establishment_id,department_id,user_id,shift_type_id,shift_date,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        shift
      );
    }
    await client.query(
      `UPDATE schedules SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$1`,
      [scheduleId, JSON.stringify({ spreadsheet: { rows: roster, customCols, savedAt: new Date().toISOString() } })]
    );
  });
  return res.json({ success: true, message: 'Brouillon enregistré', data: { savedAt: new Date().toISOString() } });
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

  const sched = await query(
    `SELECT sch.*, d.name AS dept_name, d.code AS dept_code,
            u.first_name AS created_by_first, u.last_name AS created_by_last
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN users u ON sch.created_by = u.id
     WHERE sch.id = $1 AND sch.establishment_id = $2`,
    [scheduleId, estId]
  );

  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });

  const shifts = await query(
    `SELECT s.*, u.first_name, u.last_name, u.matricule, u.speciality, u.grade, u.phone,
            r.code AS role_code, r.name AS role_name,
            st.name AS shift_type_name, st.code AS shift_type_code,
            st.color, st.start_time, st.end_time, st.duration_hours
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
            a.period_start, a.period_end, a.position
     FROM schedule_staff_assignments a JOIN users u ON u.id=a.user_id JOIN roles r ON r.id=u.role_id
     WHERE a.schedule_id=$1 ORDER BY a.position`, [scheduleId]
  );

  return res.json({
    success: true,
    data: {
      schedule: sched.rows[0],
      shifts:   shifts.rows,
      cycles:   cycles.rows,
      staff:    staff.rows,
    },
  });
};

// ──────────────────────────────────────────────────────────────
// SOUMETTRE UN PLANNING AU WORKFLOW DE VALIDATION
// POST /api/schedule-builder/:scheduleId/submit
// ──────────────────────────────────────────────────────────────
const submitSchedule = async (req, res) => {
  const { scheduleId } = req.params;
  const estId = req.user.establishmentId;
  const { notes } = req.body;

  // Vérifier accès + statut
  const sched = await query(
    'SELECT id, status, establishment_id, department_id FROM schedules WHERE id=$1',
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

  // Passer en "submitted"
  await query(
    `UPDATE schedules SET status = 'submitted', notes = COALESCE($2, notes), updated_at = NOW()
     WHERE id = $1`,
    [scheduleId, notes || null]
  );

  await query(
    `INSERT INTO schedule_workflow_history (schedule_id, step_order, action, actor_id, comment)
     VALUES ($1, 0, 'submitted', $2, $3)`,
    [scheduleId, req.user.id, notes || null]
  );

  log({
    userId: req.user.id, action: 'schedule_submit', category: 'schedule',
    description: `Planning soumis pour validation`,
    entityType: 'schedules', entityId: scheduleId, ipAddress: getIp(req),
  });

  return res.json({ success: true, message: 'Planning soumis pour validation', data: evaluation });
};

module.exports = {
  getWizardContext,
  generateSchedule,
  validateSchedule,
  validateShift,
  saveDraft,
  createSnapshot,
  getScheduleDetail,
  submitSchedule,
};
