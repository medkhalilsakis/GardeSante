/**
 * Remplacements « overlay » — couche de superposition sur une garde courante.
 *
 * PRINCIPE : ce module n'écrit JAMAIS dans `shifts`.
 * Le tableur validé reste intact ; les remplacements sont stockés à côté
 * et appliqués à la lecture. Aucune fonction de l'ancien flux (absences)
 * n'est modifiée — les deux cohabitent dans la même table via `schedule_id`
 * (NULL = ancien flux, renseigné = overlay).
 */
const { query, transaction } = require('../../config/database');
const { createNotification } = require('../notifications/notifications.controller');

const SCOPES = ['full_period', 'date_range', 'single_day', 'time_slot'];
const CHEF_ROLES = ['department_head'];
const SUPERVISOR_ROLES = ['service_supervisor', 'general_supervisor'];
const READ_ROLES = [...CHEF_ROLES, ...SUPERVISOR_ROLES, 'director', 'hospital_admin', 'super_admin'];

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────

/** Services auxquels l'utilisateur est rattaché. */
const getUserDepartments = async (userId) => {
  const { rows } = await query('SELECT department_id, is_head FROM user_departments WHERE user_id = $1', [userId]);
  return rows;
};

/** Le chef de CE service (ou un super-admin) est seul habilité à confirmer/refuser. */
const isChefOfDepartment = async (user, departmentId) => {
  if (user.isSuperAdmin) return true;
  if (user.roleCode !== 'department_head') return false;
  const { rows } = await query(
    'SELECT 1 FROM user_departments WHERE user_id = $1 AND department_id = $2',
    [user.id, departmentId]
  );
  return rows.length > 0;
};

/** Émission temps réel best-effort — n'interrompt jamais la requête. */
const emitToUser = (req, userId, event, payload) => {
  try {
    const io = req.app.get('io');
    if (io) io.to(`user:${userId}`).emit(event, payload);
  } catch (err) {
    console.error('Socket emit failed:', err.message);
  }
};

/**
 * Destinataires « information » : surveillants du service + surveillants
 * généraux de l'hôpital. Même requête que notifyScheduleReviewers.
 */
const notifySupervisors = async (req, { establishmentId, departmentId, senderId, replacementId, scheduleName, authorName }) => {
  const recipients = await query(
    `SELECT DISTINCT u.id FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     WHERE u.establishment_id = $1 AND u.is_active = TRUE
       AND (r.code = 'general_supervisor' OR (r.code = 'service_supervisor' AND ud.department_id = $2))
       AND u.id <> $3`,
    [establishmentId, departmentId, senderId]
  );

  const title = 'Nouveau remplacement';
  const message = `${authorName} a enregistré un remplacement sur « ${scheduleName} ». Consultation uniquement.`;

  await Promise.all(recipients.rows.map(async ({ id }) => {
    await createNotification({
      establishmentId, recipientId: id, senderId,
      type: 'replacement_created',
      title, titleAr: 'استبدال جديد',
      message, entityType: 'replacements', entityId: replacementId, priority: 'normal',
    });
    emitToUser(req, id, 'notification', { type: 'replacement_created', title, message, entityId: replacementId });
  }));
};

/** Le chef du service doit confirmer un remplacement proposé par un surveillant. */
const notifyChef = async (req, { establishmentId, departmentId, senderId, replacementId, scheduleName, authorName }) => {
  const recipients = await query(
    `SELECT DISTINCT u.id FROM users u
     JOIN roles r ON r.id = u.role_id
     JOIN user_departments ud ON ud.user_id = u.id
     WHERE u.establishment_id = $1 AND u.is_active = TRUE
       AND r.code = 'department_head' AND ud.department_id = $2
       AND u.id <> $3`,
    [establishmentId, departmentId, senderId]
  );

  const title = 'Remplacement à confirmer';
  const message = `${authorName} propose un remplacement sur « ${scheduleName} ». Votre confirmation est requise.`;

  await Promise.all(recipients.rows.map(async ({ id }) => {
    await createNotification({
      establishmentId, recipientId: id, senderId,
      type: 'replacement_pending_confirmation',
      title, titleAr: 'استبدال في انتظار التأكيد',
      message, entityType: 'replacements', entityId: replacementId, priority: 'high',
    });
    emitToUser(req, id, 'notification', { type: 'replacement_pending_confirmation', title, message, entityId: replacementId });
  }));
};

/**
 * Normalise une date en 'YYYY-MM-DD'.
 * PostgreSQL renvoie les colonnes DATE en objet Date à minuit LOCAL : comparer
 * ces objets à une chaîne ISO du client décale d'un jour selon le fuseau.
 * On ramène donc tout à une chaîne, comparable lexicographiquement.
 */
const toDateOnly = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Deux remplacements se chevauchent-ils ?
 * Comparaison en deux temps : d'abord les dates, puis les heures
 * (uniquement si les DEUX sont des créneaux horaires).
 */
const periodsOverlap = (a, b) => {
  const aStart = toDateOnly(a.start_date);
  const aEnd = toDateOnly(a.end_date) || aStart;
  const bStart = toDateOnly(b.start_date);
  const bEnd = toDateOnly(b.end_date) || bStart;

  // Une borne absente signifie « toute la période » : le chevauchement est acquis.
  if (aStart && bStart) {
    if (aEnd < bStart || bEnd < aStart) return false;
  }

  // Les dates se croisent. Si les deux sont horaires, on affine.
  if (a.scope === 'time_slot' && b.scope === 'time_slot' && a.start_time && b.start_time) {
    const toMin = (t) => {
      const [h, m] = String(t).split(':').map(Number);
      return h * 60 + (m || 0);
    };
    let aS = toMin(a.start_time), aE = toMin(a.end_time || a.start_time);
    let bS = toMin(b.start_time), bE = toMin(b.end_time || b.start_time);
    if (aE <= aS) aE += 1440; // créneau à cheval sur minuit
    if (bE <= bS) bE += 1440;
    return aS < bE && bS < aE;
  }

  return true;
};

/** Normalise et valide la portée demandée. */
const normalizeScope = (body, schedule) => {
  const scope = SCOPES.includes(body.scope) ? body.scope : 'full_period';
  const out = { scope, startDate: null, endDate: null, startTime: null, endTime: null };

  if (scope === 'full_period') {
    out.startDate = toDateOnly(schedule.start_date);
    out.endDate = toDateOnly(schedule.end_date);
    return out;
  }

  const start = toDateOnly(body.startDate);
  if (!start) return { error: 'La date de début est requise.' };

  if (scope === 'single_day') {
    out.startDate = start;
    out.endDate = start;
    return out;
  }

  if (scope === 'date_range') {
    const end = toDateOnly(body.endDate);
    if (!end) return { error: 'La date de fin est requise.' };
    if (end < start) {
      return { error: 'La date de fin doit être postérieure à la date de début.' };
    }
    out.startDate = start;
    out.endDate = end;
    return out;
  }

  // time_slot
  if (!body.startTime || !body.endTime) return { error: 'Les heures de début et de fin sont requises.' };
  out.startDate = start;
  out.endDate = toDateOnly(body.endDate) || start;
  out.startTime = body.startTime;
  out.endTime = body.endTime;
  return out;
};

// ──────────────────────────────────────────────────────────────
// GET /api/replacements/eligible-schedules
// Gardes courantes : finalisées, non brouillon, période non révolue.
// ──────────────────────────────────────────────────────────────
const getEligibleSchedules = async (req, res) => {
  if (!READ_ROLES.includes(req.user.roleCode) && !req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Accès non autorisé.' });
  }

  const eid = req.user.establishmentId;
  const conditions = [
    'sch.establishment_id = $1',
    `sch.status <> 'draft'`,
    // Tableur finalement soumis : version finale enregistrée OU workflow abouti
    `(sch.final_version_id IS NOT NULL
      OR EXISTS (SELECT 1 FROM schedule_versions sv WHERE sv.schedule_id = sch.id AND sv.is_final = TRUE)
      OR sch.status IN ('submitted','under_review','approved','active'))`,
    // Garde courante : la période n'est pas terminée
    'sch.end_date >= CURRENT_DATE',
  ];
  const params = [eid];
  let idx = 2;

  // Chef de service et surveillant de service : limités à leurs services.
  if (!req.user.isSuperAdmin && ['department_head', 'service_supervisor'].includes(req.user.roleCode)) {
    const depts = await getUserDepartments(req.user.id);
    if (!depts.length) return res.json({ success: true, data: [] });
    conditions.push(`sch.department_id = ANY($${idx})`);
    params.push(depts.map(d => d.department_id));
    idx++;
  }

  const { rows } = await query(
    `SELECT sch.id, sch.name,
            TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS end_date,
            sch.status, sch.schedule_type,
            sch.department_id, d.name AS department_name, d.name_ar AS department_name_ar,
            (SELECT COUNT(*) FROM replacements r
              WHERE r.schedule_id = sch.id) AS replacement_count,
            (SELECT COUNT(*) FROM replacements r
              WHERE r.schedule_id = sch.id AND r.confirmation_status = 'pending_chef') AS pending_count
     FROM schedules sch
     JOIN departments d ON d.id = sch.department_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sch.start_date DESC`,
    params
  );

  return res.json({ success: true, data: rows });
};

// ──────────────────────────────────────────────────────────────
// GET /api/replacements/schedule/:scheduleId/staff
// Personnel affecté au tableur — les remplaçables.
// ──────────────────────────────────────────────────────────────
const getScheduleStaff = async (req, res) => {
  const { scheduleId } = req.params;
  const sched = await query(
    'SELECT id, department_id, establishment_id, status FROM schedules WHERE id = $1 AND establishment_id = $2',
    [scheduleId, req.user.establishmentId]
  );
  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (sched.rows[0].status === 'draft') {
    return res.status(400).json({ success: false, message: 'Les brouillons ne sont pas concernés par les remplacements.' });
  }

  const { rows } = await query(
    `SELECT DISTINCT u.id, u.first_name, u.last_name, u.matricule, u.speciality, u.grade,
            r.name AS role_name, r.code AS role_code,
            d.id AS department_id, d.name AS department_name,
            (SELECT COUNT(*) FROM shifts s2
              WHERE s2.schedule_id = $1 AND s2.user_id = u.id AND s2.status <> 'cancelled') AS shift_count
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN user_departments ud ON ud.user_id = u.id AND ud.is_primary = TRUE
     LEFT JOIN departments d ON d.id = ud.department_id
     WHERE u.id IN (
       SELECT user_id FROM shifts WHERE schedule_id = $1 AND status <> 'cancelled'
       UNION
       SELECT user_id FROM schedule_staff_assignments WHERE schedule_id = $1
     )
     ORDER BY u.last_name, u.first_name`,
    [scheduleId]
  );

  return res.json({ success: true, data: rows });
};

// ──────────────────────────────────────────────────────────────
// GET /api/replacements/overlay
// Liste filtrée par rôle. Le SG voit l'hôpital, les autres leur service.
// ──────────────────────────────────────────────────────────────
const getOverlayReplacements = async (req, res) => {
  if (!READ_ROLES.includes(req.user.roleCode) && !req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Accès non autorisé.' });
  }

  const { scheduleId, confirmationStatus } = req.query;
  const conditions = ['r.establishment_id = $1', 'r.schedule_id IS NOT NULL'];
  const params = [req.user.establishmentId];
  let idx = 2;

  if (scheduleId) { conditions.push(`r.schedule_id = $${idx}`); params.push(scheduleId); idx++; }
  if (confirmationStatus) { conditions.push(`r.confirmation_status = $${idx}`); params.push(confirmationStatus); idx++; }

  // Cloisonnement par service (le SG et la direction voient tout l'hôpital).
  if (!req.user.isSuperAdmin && ['department_head', 'service_supervisor'].includes(req.user.roleCode)) {
    const depts = await getUserDepartments(req.user.id);
    if (!depts.length) return res.json({ success: true, data: [] });
    conditions.push(`r.department_id = ANY($${idx})`);
    params.push(depts.map(d => d.department_id));
    idx++;
  }

  const { rows } = await query(
    `SELECT r.id, r.schedule_id, r.department_id, r.scope,
            TO_CHAR(r.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(r.end_date,   'YYYY-MM-DD') AS end_date,
            r.start_time, r.end_time, r.confirmation_status, r.created_by_role,
            r.reason, r.rejection_reason, r.status, r.created_at, r.confirmed_at,
            sch.name AS schedule_name,
            TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS schedule_start,
            TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS schedule_end,
            d.name AS department_name,
            r.requested_by,
            req.first_name AS requested_by_first, req.last_name AS requested_by_last,
            reqrole.name AS requested_by_role_name,
            conf.first_name AS confirmed_by_first, conf.last_name AS confirmed_by_last,
            COALESCE(items.items, '[]'::json) AS items
     FROM replacements r
     JOIN schedules sch ON sch.id = r.schedule_id
     LEFT JOIN departments d ON d.id = r.department_id
     JOIN users req ON req.id = r.requested_by
     LEFT JOIN roles reqrole ON reqrole.id = req.role_id
     LEFT JOIN users conf ON conf.id = r.confirmed_by
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
         'id', ri.id,
         'absentUserId', ri.absent_user_id,
         'absentFirstName', au.first_name,
         'absentLastName', au.last_name,
         'absentSpeciality', au.speciality,
         'replacementUserId', ri.replacement_user_id,
         'replacementFirstName', ru.first_name,
         'replacementLastName', ru.last_name,
         'replacementSpeciality', ru.speciality,
         'fromDepartmentId', ri.from_department_id,
         'fromDepartmentName', fd.name,
         'isCrossDepartment', ri.is_cross_department,
         'notes', ri.notes
       ) ORDER BY au.last_name) AS items
       FROM replacement_items ri
       JOIN users au ON au.id = ri.absent_user_id
       JOIN users ru ON ru.id = ri.replacement_user_id
       LEFT JOIN departments fd ON fd.id = ri.from_department_id
       WHERE ri.replacement_id = r.id
     ) items ON TRUE
     WHERE ${conditions.join(' AND ')}
     ORDER BY CASE r.confirmation_status WHEN 'pending_chef' THEN 0 ELSE 1 END,
              r.created_at DESC`,
    params
  );

  return res.json({ success: true, data: rows });
};

// ──────────────────────────────────────────────────────────────
// POST /api/replacements/overlay
// ──────────────────────────────────────────────────────────────
const createOverlayReplacement = async (req, res) => {
  const { scheduleId, items = [], reason } = req.body;
  const user = req.user;

  const canCreate = user.isSuperAdmin || CHEF_ROLES.includes(user.roleCode) || SUPERVISOR_ROLES.includes(user.roleCode);
  if (!canCreate) {
    return res.status(403).json({ success: false, message: 'Seuls le chef de service et les surveillants peuvent créer un remplacement.' });
  }

  if (!scheduleId) return res.status(400).json({ success: false, message: 'La garde courante est requise.' });
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ success: false, message: 'Sélectionnez au moins un personnel à remplacer.' });
  }

  // ── Le planning doit être une garde courante finalisée ──
  const schedRes = await query(
    `SELECT sch.*, d.name AS department_name,
            (sch.final_version_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM schedule_versions sv WHERE sv.schedule_id = sch.id AND sv.is_final = TRUE)
              OR sch.status IN ('submitted','under_review','approved','active')) AS is_finalized
     FROM schedules sch
     JOIN departments d ON d.id = sch.department_id
     WHERE sch.id = $1 AND sch.establishment_id = $2`,
    [scheduleId, user.establishmentId]
  );
  const schedule = schedRes.rows[0];
  if (!schedule) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (schedule.status === 'draft') {
    return res.status(400).json({ success: false, message: 'Les brouillons ne sont pas concernés : modifiez directement le tableur.' });
  }
  if (!schedule.is_finalized) {
    return res.status(400).json({ success: false, message: 'Ce tableur n\'a pas encore été soumis définitivement.' });
  }

  // ── Portée ──
  const period = normalizeScope(req.body, schedule);
  if (period.error) return res.status(400).json({ success: false, message: period.error });

  // La portée doit rester dans les bornes du planning (comparaison sur 'YYYY-MM-DD')
  const schedStart = toDateOnly(schedule.start_date);
  const schedEnd = toDateOnly(schedule.end_date);
  if (period.startDate && schedStart && period.startDate < schedStart) {
    return res.status(400).json({ success: false, message: `La période commence avant le planning (début : ${schedStart}).` });
  }
  if (period.endDate && schedEnd && period.endDate > schedEnd) {
    return res.status(400).json({ success: false, message: `La période dépasse la fin du planning (fin : ${schedEnd}).` });
  }

  // ── Validation des binômes ──
  const absentIds = items.map(i => i.absentUserId);
  const replacerIds = items.map(i => i.replacementUserId);
  if (absentIds.some(id => !id) || replacerIds.some(id => !id)) {
    return res.status(400).json({ success: false, message: 'Chaque personnel remplacé doit avoir un remplaçant.' });
  }
  if (new Set(absentIds).size !== absentIds.length) {
    return res.status(400).json({ success: false, message: 'Un même personnel ne peut être remplacé deux fois dans le même ordre.' });
  }
  for (const it of items) {
    if (it.absentUserId === it.replacementUserId) {
      return res.status(400).json({ success: false, message: 'Un personnel ne peut pas se remplacer lui-même.' });
    }
  }

  // Tous les intervenants doivent appartenir au même hôpital
  const allIds = [...new Set([...absentIds, ...replacerIds])];
  const usersRes = await query(
    `SELECT u.id, u.first_name, u.last_name, u.is_active, u.establishment_id,
            ud.department_id
     FROM users u
     LEFT JOIN user_departments ud ON ud.user_id = u.id AND ud.is_primary = TRUE
     WHERE u.id = ANY($1)`,
    [allIds]
  );
  const usersById = new Map(usersRes.rows.map(u => [u.id, u]));
  for (const id of allIds) {
    const u = usersById.get(id);
    if (!u) return res.status(400).json({ success: false, message: 'Personnel introuvable.' });
    if (u.establishment_id !== user.establishmentId) {
      return res.status(400).json({ success: false, message: 'Le remplaçant doit appartenir au même hôpital.' });
    }
    if (!u.is_active) {
      return res.status(400).json({ success: false, message: `${u.first_name} ${u.last_name} n'est plus actif.` });
    }
  }

  // ── Blocage des chevauchements sur un même remplacé ──
  const existing = await query(
    `SELECT r.id, r.scope, r.start_date, r.end_date, r.start_time, r.end_time,
            ri.absent_user_id, au.first_name, au.last_name
     FROM replacements r
     JOIN replacement_items ri ON ri.replacement_id = r.id
     JOIN users au ON au.id = ri.absent_user_id
     WHERE r.schedule_id = $1 AND ri.absent_user_id = ANY($2)`,
    [scheduleId, absentIds]
  );
  const candidate = {
    scope: period.scope,
    start_date: period.startDate,
    end_date: period.endDate,
    start_time: period.startTime,
    end_time: period.endTime,
  };
  for (const row of existing.rows) {
    if (periodsOverlap(candidate, row)) {
      return res.status(409).json({
        success: false,
        message: `${row.first_name} ${row.last_name} fait déjà l'objet d'un remplacement sur cette période.`,
      });
    }
  }

  // ── Statut selon l'auteur ──
  const isChef = user.isSuperAdmin || (user.roleCode === 'department_head');
  const confirmationStatus = isChef ? 'confirmed' : 'pending_chef';
  const status = isChef ? 'accepted' : 'pending';

  // Avertissements non bloquants : remplaçant déjà de garde sur la période
  const conflictRes = await query(
    `SELECT DISTINCT s.user_id, u.first_name, u.last_name
     FROM shifts s JOIN users u ON u.id = s.user_id
     WHERE s.user_id = ANY($1) AND s.status <> 'cancelled'
       AND s.shift_date BETWEEN $2 AND $3`,
    [replacerIds, period.startDate || schedStart, period.endDate || schedEnd]
  );
  const warnings = conflictRes.rows.map(r => ({
    userId: r.user_id,
    message: `${r.first_name} ${r.last_name} est déjà de garde sur cette période.`,
  }));

  const created = await transaction(async (client) => {
    const { rows: [repl] } = await client.query(
      `INSERT INTO replacements
        (establishment_id, schedule_id, department_id, scope, start_date, end_date, start_time, end_time,
         confirmation_status, created_by_role, status, urgency, reason, notes, requested_by,
         confirmed_by, confirmed_at, absent_user_id, replacement_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'normal',$12,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        user.establishmentId, scheduleId, schedule.department_id, period.scope,
        period.startDate, period.endDate, period.startTime, period.endTime,
        confirmationStatus, user.roleCode, status, reason || null, user.id,
        isChef ? user.id : null, isChef ? new Date() : null,
        // Rétro-compatibilité : on renseigne le 1er binôme sur les colonnes historiques
        items[0].absentUserId, items[0].replacementUserId,
      ]
    );

    for (const it of items) {
      const replacer = usersById.get(it.replacementUserId);
      const isCross = replacer.department_id && replacer.department_id !== schedule.department_id;
      await client.query(
        `INSERT INTO replacement_items
          (replacement_id, absent_user_id, replacement_user_id, from_department_id, is_cross_department, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [repl.id, it.absentUserId, it.replacementUserId, replacer.department_id || null, !!isCross, it.notes || null]
      );
    }

    return repl;
  });

  // ── Notifications ──
  const authorName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Un responsable';
  const notifPayload = {
    establishmentId: user.establishmentId,
    departmentId: schedule.department_id,
    senderId: user.id,
    replacementId: created.id,
    scheduleName: schedule.name || 'Planning',
    authorName,
  };

  if (isChef) {
    await notifySupervisors(req, notifPayload);
  } else {
    await notifyChef(req, notifPayload);
    // Les autres surveillants sont informés de la proposition
    await notifySupervisors(req, notifPayload);
  }

  return res.status(201).json({
    success: true,
    data: created,
    warnings,
    message: isChef
      ? 'Remplacement enregistré. Les surveillants ont été informés.'
      : 'Remplacement enregistré. En attente de confirmation du chef de service.',
  });
};

// ──────────────────────────────────────────────────────────────
// POST /api/replacements/overlay/:id/confirm  — chef de service
// ──────────────────────────────────────────────────────────────
const confirmOverlayReplacement = async (req, res) => {
  const repl = await query(
    `SELECT r.*, sch.name AS schedule_name FROM replacements r
     LEFT JOIN schedules sch ON sch.id = r.schedule_id
     WHERE r.id = $1 AND r.establishment_id = $2 AND r.schedule_id IS NOT NULL`,
    [req.params.id, req.user.establishmentId]
  );
  const item = repl.rows[0];
  if (!item) return res.status(404).json({ success: false, message: 'Remplacement introuvable' });

  if (!(await isChefOfDepartment(req.user, item.department_id))) {
    return res.status(403).json({ success: false, message: 'Seul le chef de ce service peut confirmer un remplacement.' });
  }
  if (item.confirmation_status !== 'pending_chef') {
    return res.status(400).json({ success: false, message: 'Ce remplacement est déjà confirmé.' });
  }

  const { rows: [updated] } = await query(
    `UPDATE replacements
     SET confirmation_status = 'confirmed', status = 'accepted',
         confirmed_by = $1, confirmed_at = NOW(), updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [req.user.id, req.params.id]
  );

  const title = 'Remplacement confirmé';
  const message = `Votre remplacement sur « ${item.schedule_name || 'Planning'} » a été confirmé par le chef de service.`;
  await createNotification({
    establishmentId: item.establishment_id, recipientId: item.requested_by, senderId: req.user.id,
    type: 'replacement_confirmed', title, titleAr: 'تم تأكيد الاستبدال',
    message, entityType: 'replacements', entityId: item.id, priority: 'normal',
  });
  emitToUser(req, item.requested_by, 'notification', { type: 'replacement_confirmed', title, message, entityId: item.id });

  return res.json({ success: true, data: updated, message: 'Remplacement confirmé.' });
};

// ──────────────────────────────────────────────────────────────
// POST /api/replacements/overlay/:id/reject — refus ⇒ suppression
// ──────────────────────────────────────────────────────────────
const rejectOverlayReplacement = async (req, res) => {
  const { reason } = req.body;
  const repl = await query(
    `SELECT r.*, sch.name AS schedule_name FROM replacements r
     LEFT JOIN schedules sch ON sch.id = r.schedule_id
     WHERE r.id = $1 AND r.establishment_id = $2 AND r.schedule_id IS NOT NULL`,
    [req.params.id, req.user.establishmentId]
  );
  const item = repl.rows[0];
  if (!item) return res.status(404).json({ success: false, message: 'Remplacement introuvable' });

  if (!(await isChefOfDepartment(req.user, item.department_id))) {
    return res.status(403).json({ success: false, message: 'Seul le chef de ce service peut refuser un remplacement.' });
  }
  if (item.confirmation_status !== 'pending_chef') {
    return res.status(400).json({ success: false, message: 'Seuls les remplacements non confirmés peuvent être refusés.' });
  }

  // Notifier AVANT la suppression (l'entité disparaît ensuite).
  const title = 'Remplacement refusé';
  const message = reason
    ? `Votre remplacement sur « ${item.schedule_name || 'Planning'} » a été refusé : ${reason}`
    : `Votre remplacement sur « ${item.schedule_name || 'Planning'} » a été refusé par le chef de service.`;
  await createNotification({
    establishmentId: item.establishment_id, recipientId: item.requested_by, senderId: req.user.id,
    type: 'replacement_rejected', title, titleAr: 'تم رفض الاستبدال',
    message, entityType: 'replacements', entityId: null, priority: 'high',
  });
  emitToUser(req, item.requested_by, 'notification', { type: 'replacement_rejected', title, message });

  // Suppression automatique (replacement_items part en cascade).
  await query('DELETE FROM replacements WHERE id = $1', [req.params.id]);

  return res.json({ success: true, message: 'Remplacement refusé et supprimé.' });
};

// ──────────────────────────────────────────────────────────────
// DELETE /api/replacements/overlay/:id
// Le chef supprime les siens ; l'auteur retire sa proposition non confirmée.
// ──────────────────────────────────────────────────────────────
const deleteOverlayReplacement = async (req, res) => {
  const repl = await query(
    'SELECT * FROM replacements WHERE id = $1 AND establishment_id = $2 AND schedule_id IS NOT NULL',
    [req.params.id, req.user.establishmentId]
  );
  const item = repl.rows[0];
  if (!item) return res.status(404).json({ success: false, message: 'Remplacement introuvable' });

  const isChef = await isChefOfDepartment(req.user, item.department_id);
  const isAuthorPending = item.requested_by === req.user.id && item.confirmation_status === 'pending_chef';
  if (!isChef && !isAuthorPending) {
    return res.status(403).json({ success: false, message: 'Vous ne pouvez pas supprimer ce remplacement.' });
  }

  await query('DELETE FROM replacements WHERE id = $1', [req.params.id]);
  return res.json({ success: true, message: 'Remplacement supprimé.' });
};

module.exports = {
  getEligibleSchedules,
  getScheduleStaff,
  getOverlayReplacements,
  createOverlayReplacement,
  confirmOverlayReplacement,
  rejectOverlayReplacement,
  deleteOverlayReplacement,
};
