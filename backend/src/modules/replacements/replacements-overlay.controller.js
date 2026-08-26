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
const { dutyEntries } = require('../schedules/spreadsheet-reader');
// Journal d'activité : un refus SUPPRIME la ligne de remplacement (voir
// `rejectOverlayReplacement`). Sans trace dans `activity_logs`, ce qui a été
// demandé puis refusé ne subsiste nulle part. Le journal est le seul historique
// immuable du parcours de surcouche.
const { log, getIp } = require('../history/history.controller');

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
 * Même émission, vers la room du service (`department:<id>`), que rejoignent
 * tous les membres du service via `joinDepartment` (`useRealtime.js`).
 *
 * Elle manquait : un remplacement créé, confirmé ou refusé ne prévenait que son
 * auteur, et seulement par la notification. Les panneaux « Remplacements », la
 * supervision de l'hôpital et la vue d'ensemble du chef n'apprenaient donc rien
 * avant leur prochain rafraîchissement périodique — alors que le client écoute
 * déjà `replacement:created`, `replacement:confirmed` et `replacement:rejected`
 * depuis le Lot 0. Personne ne les émettait.
 *
 * Helper local, sur le modèle de `emitToUser` juste au-dessus : le module reste
 * autonome, et la signature `(req, …)` ne peut pas être confondue avec celle de
 * `realtime/emit.js`, qui attend `app`.
 */
const emitToDept = (req, departmentId, event, payload) => {
  if (!departmentId) return;
  try {
    const io = req.app.get('io');
    if (io) io.to(`department:${departmentId}`).emit(event, payload);
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
    emitToUser(req, id, 'notification:new', { type: 'replacement_created', title, message, entityId: replacementId });
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
    emitToUser(req, id, 'notification:new', { type: 'replacement_pending_confirmation', title, message, entityId: replacementId });
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
 * Roster d'un planning, quelle que soit sa génération.
 *
 * Le Tableur est la source moderne de vérité : une ligne compte pour chaque
 * jour où elle est réellement de service. Les anciens plannings sans lignes
 * de Tableur sont lus dans `shifts` pour préserver les remplacements existants.
 */
const loadScheduleRoster = async (schedule) => {
  if (Array.isArray(schedule?.metadata?.spreadsheet?.rows)) {
    const counts = new Map();
    for (const entry of dutyEntries(schedule)) {
      if (!entry.userId) continue;
      counts.set(entry.userId, (counts.get(entry.userId) || 0) + 1);
    }
    return { counts, userIds: [...counts.keys()] };
  }

  const { rows } = await query(
    `SELECT user_id, COUNT(*)::integer AS shift_count
       FROM shifts
      WHERE schedule_id = $1 AND status <> 'cancelled'
      GROUP BY user_id`,
    [schedule.id]
  );
  const counts = new Map(rows.map((row) => [row.user_id, Number(row.shift_count) || 0]));
  // Certains plannings historiques ne possédaient que des affectations de
  // roster, sans ligne `shifts`. Elles restent éligibles au remplacement.
  const assignments = await query(
    `SELECT DISTINCT user_id
       FROM schedule_staff_assignments
      WHERE schedule_id = $1`,
    [schedule.id]
  );
  for (const row of assignments.rows) {
    if (!counts.has(row.user_id)) counts.set(row.user_id, 0);
  }
  return { counts, userIds: [...counts.keys()] };
};

/**
 * Utilisateurs de garde sur une période, pour l'avertissement de conflit d'un
 * remplaçant. Les dates sont des clés DATE ; aucune conversion UTC n'est faite.
 */
const loadDutyUserIds = async ({ establishmentId, userIds, from, to, excludeScheduleId }) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length || !from || !to) return new Set();

  const params = [establishmentId, from, to];
  const requestedIds = new Set(ids);
  const conditions = [
    'sch.establishment_id = $1',
    'sch.start_date <= $3',
    'sch.end_date >= $2',
    "sch.status NOT IN ('draft', 'cancelled', 'rejected')",
  ];
  if (excludeScheduleId) {
    params.push(excludeScheduleId);
    conditions.push(`sch.id <> $${params.length}`);
  }
  const schedules = await query(
    `SELECT sch.id, sch.start_date, sch.end_date, sch.schedule_type, sch.metadata
       FROM schedules sch
      WHERE ${conditions.join(' AND ')}`,
    params
  );

  const modernIds = [];
  const found = new Set();
  for (const schedule of schedules.rows) {
    if (!Array.isArray(schedule.metadata?.spreadsheet?.rows)) continue;
    modernIds.push(schedule.id);
    for (const entry of dutyEntries(schedule, from, to)) {
      if (requestedIds.has(entry.userId)) found.add(entry.userId);
    }
  }

  const legacyParams = [ids, from, to, establishmentId];
  const legacyConditions = [
    's.user_id = ANY($1::uuid[])',
    's.shift_date BETWEEN $2 AND $3',
    's.establishment_id = $4',
    "s.status <> 'cancelled'",
  ];
  if (excludeScheduleId) {
    legacyParams.push(excludeScheduleId);
    legacyConditions.push(`s.schedule_id <> $${legacyParams.length}`);
  }
  if (modernIds.length) {
    legacyParams.push(modernIds);
    legacyConditions.push(`s.schedule_id <> ALL($${legacyParams.length}::uuid[])`);
  }
  const legacy = await query(
    `SELECT DISTINCT s.user_id
       FROM shifts s
      WHERE ${legacyConditions.join(' AND ')}`,
    legacyParams
  );
  for (const row of legacy.rows) found.add(row.user_id);
  return found;
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
    // Garde courante : elle a commencé mais n'est pas encore terminée.
    // Une garde future ne peut pas faire l'objet d'un remplacement.
    'sch.start_date <= CURRENT_DATE',
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
    `SELECT id, department_id, establishment_id, status, start_date, end_date, metadata,
            (start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE) AS is_current,
            (final_version_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM schedule_versions sv WHERE sv.schedule_id = schedules.id AND sv.is_final = TRUE)
              OR status IN ('submitted','under_review','approved','active')) AS is_finalized
       FROM schedules
      WHERE id = $1 AND establishment_id = $2`,
    [scheduleId, req.user.establishmentId]
  );
  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const currentSchedule = sched.rows[0];
  if (!currentSchedule.is_current) {
    return res.status(400).json({ success: false, message: 'Seules les gardes actuellement en cours sont concernées.' });
  }
  if (currentSchedule.status === 'draft') {
    return res.status(400).json({ success: false, message: 'Les brouillons ne sont pas concernés par les remplacements.' });
  }
  if (!currentSchedule.is_finalized) {
    return res.status(400).json({ success: false, message: "Ce planning n'est pas encore soumis définitivement." });
  }

  const roster = await loadScheduleRoster(currentSchedule);
  if (!roster.userIds.length) return res.json({ success: true, data: [] });

  const { rows } = await query(
    `SELECT DISTINCT u.id, u.first_name, u.last_name, u.matricule, u.speciality, u.grade,
            r.name AS role_name, r.code AS role_code,
            d.id AS department_id, d.name AS department_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN user_departments ud ON ud.user_id = u.id AND ud.is_primary = TRUE
     LEFT JOIN departments d ON d.id = ud.department_id
     WHERE u.id = ANY($1::uuid[])
     ORDER BY u.last_name, u.first_name`,
    [roster.userIds]
  );
  for (const row of rows) row.shift_count = roster.counts.get(row.id) || 0;

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

  // Une demande ciblée (`scheduleId`) et la liste générale ne se bornent pas de
  // la même façon :
  //
  //  • La fenêtre « garde courante » (le planning couvre aujourd'hui) est ce qui
  //    fait de la LISTE une liste de gardes en cours. Sur une demande ciblée elle
  //    n'a plus de sens et devient nuisible : l'aperçu d'un tableur déjà terminé
  //    ou pas encore commencé n'affichait aucun remplacement, alors qu'il en
  //    portait bien.
  //  • La borne d'établissement est levée pour le seul Super Admin, et seulement
  //    sur une demande ciblée : son propre établissement est le compte plateforme
  //    (`00000000-…`), qui ne possède aucun planning, donc la borne lui renvoyait
  //    toujours une liste vide — même piège que `getScheduleDetail`. Sa liste
  //    générale, elle, ne change pas.
  //
  // Le cloisonnement par service ci-dessous n'est pas touché : c'est une règle de
  // confidentialité, pas une borne technique.
  const targeted = !!scheduleId;
  const conditions = ['r.schedule_id IS NOT NULL'];
  const params = [];
  let idx = 1;

  if (!(req.user.isSuperAdmin && targeted)) {
    conditions.push(`r.establishment_id = $${idx}`);
    params.push(req.user.establishmentId);
    idx++;
  }
  if (!targeted) {
    conditions.push('sch.start_date <= CURRENT_DATE', 'sch.end_date >= CURRENT_DATE');
  }

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
     WHERE sch.id = $1 AND sch.establishment_id = $2
       AND sch.start_date <= CURRENT_DATE
       AND sch.end_date >= CURRENT_DATE`,
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

  // Le personnel d'origine doit appartenir au roster de la garde sélectionnée.
  const roster = await loadScheduleRoster(schedule);
  const rosterIds = new Set(roster.userIds.filter((id) => absentIds.includes(id)));
  const missing = absentIds.filter(id => !rosterIds.has(id));
  if (missing.length) {
    return res.status(400).json({ success: false, message: 'Chaque personnel remplacé doit être affecté au planning sélectionné.' });
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
  const conflictIds = await loadDutyUserIds({
    establishmentId: user.establishmentId,
    userIds: replacerIds,
    from: period.startDate || schedStart,
    to: period.endDate || schedEnd,
  });
  const conflictRes = conflictIds.size
    ? await query(
      `SELECT id AS user_id, first_name, last_name
         FROM users
        WHERE id = ANY($1::uuid[])`,
      [[...conflictIds]]
    )
    : { rows: [] };
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

  // Le service entier voit la nouvelle ligne apparaître sans rechargement.
  emitToDept(req, schedule.department_id, 'replacement:created', {
    replacementId: created.id, scheduleId: schedule.id, departmentId: schedule.department_id,
    pendingChef: !isChef,
  });

  log({
    userId: user.id,
    action: 'replacement_overlay_created',
    category: 'replacement',
    description: `Remplacement déposé sur « ${schedule.name || 'Planning'} » (${items.length} binôme(s)), ${isChef ? 'confirmé d\'office' : 'en attente du chef de service'}`,
    entityType: 'replacements', entityId: created.id,
    metadata: {
      scheduleId: schedule.id, departmentId: schedule.department_id,
      scope: period.scope, startDate: period.startDate, endDate: period.endDate,
      pairs: items.map((it) => ({ absentUserId: it.absentUserId, replacementUserId: it.replacementUserId })),
      confirmationStatus, warnings: warnings.length,
    },
    ipAddress: getIp(req), userAgent: req.headers['user-agent'],
  });

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
  emitToUser(req, item.requested_by, 'notification:new', { type: 'replacement_confirmed', title, message, entityId: item.id });
  // Le remplacement s'applique désormais par-dessus le tableur : tout le service
  // doit le voir sans rechargement, pas seulement l'auteur de la proposition.
  emitToDept(req, item.department_id, 'replacement:confirmed', {
    replacementId: item.id, scheduleId: item.schedule_id, departmentId: item.department_id,
  });

  log({
    userId: req.user.id,
    action: 'replacement_overlay_confirmed',
    category: 'replacement',
    description: `Remplacement confirmé sur « ${item.schedule_name || 'Planning'} »`,
    entityType: 'replacements', entityId: item.id,
    metadata: { scheduleId: item.schedule_id, departmentId: item.department_id, requestedBy: item.requested_by },
    ipAddress: getIp(req), userAgent: req.headers['user-agent'],
  });

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
  emitToUser(req, item.requested_by, 'notification:new', { type: 'replacement_rejected', title, message });

  // Relevé des binômes AVANT la suppression : c'est la seule occasion de savoir
  // qui devait remplacer qui. La cascade sur `replacement_items` emporte tout.
  const doomed = await query(
    'SELECT absent_user_id, replacement_user_id FROM replacement_items WHERE replacement_id = $1',
    [req.params.id]
  );

  // Suppression automatique (replacement_items part en cascade).
  await query('DELETE FROM replacements WHERE id = $1', [req.params.id]);

  // Le refus efface la demande : sans cette ligne de journal, il ne resterait
  // aucune trace de ce qui a été proposé ni du motif du refus.
  log({
    userId: req.user.id,
    action: 'replacement_overlay_rejected',
    category: 'replacement',
    description: `Remplacement refusé et supprimé sur « ${item.schedule_name || 'Planning'} »${reason ? ` : ${reason}` : ''}`,
    entityType: 'replacements', entityId: item.id,
    metadata: {
      scheduleId: item.schedule_id, departmentId: item.department_id,
      requestedBy: item.requested_by, reason: reason || null,
      scope: item.scope, startDate: item.start_date, endDate: item.end_date,
      pairs: doomed.rows.map((r) => ({ absentUserId: r.absent_user_id, replacementUserId: r.replacement_user_id })),
    },
    severity: 'warning',
    ipAddress: getIp(req), userAgent: req.headers['user-agent'],
  });

  // Émis APRÈS la suppression : la ligne doit disparaître des panneaux du
  // service, et la file « à confirmer » du chef retomber d'un cran.
  emitToDept(req, item.department_id, 'replacement:rejected', {
    replacementId: item.id, scheduleId: item.schedule_id, departmentId: item.department_id,
  });

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

  // Même raison que pour le refus : la ligne va disparaître, on relève d'abord.
  const doomed = await query(
    'SELECT absent_user_id, replacement_user_id FROM replacement_items WHERE replacement_id = $1',
    [req.params.id]
  );

  await query('DELETE FROM replacements WHERE id = $1', [req.params.id]);

  log({
    userId: req.user.id,
    action: 'replacement_overlay_deleted',
    category: 'replacement',
    description: isAuthorPending && !isChef
      ? 'Proposition de remplacement retirée par son auteur'
      : `Remplacement ${item.confirmation_status === 'confirmed' ? 'confirmé ' : ''}supprimé par le chef de service`,
    entityType: 'replacements', entityId: item.id,
    metadata: {
      scheduleId: item.schedule_id, departmentId: item.department_id,
      requestedBy: item.requested_by, confirmationStatus: item.confirmation_status,
      scope: item.scope, startDate: item.start_date, endDate: item.end_date,
      pairs: doomed.rows.map((r) => ({ absentUserId: r.absent_user_id, replacementUserId: r.replacement_user_id })),
    },
    severity: 'warning',
    ipAddress: getIp(req), userAgent: req.headers['user-agent'],
  });

  // Un remplacement confirmé qui disparaît change la garde effective : le
  // service doit le voir immédiatement, comme pour un refus.
  emitToDept(req, item.department_id, 'replacement:rejected', {
    replacementId: item.id, scheduleId: item.schedule_id, departmentId: item.department_id,
  });

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
