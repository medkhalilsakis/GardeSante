const { query }    = require('../../config/database');
const bcrypt       = require('bcryptjs');
const GOVERNORATES = require('../../config/governorates');
const { log, getIp } = require('../history/history.controller');
const { computePresence } = require('../../middleware/activity');

// ══════════════════════════════════════════════════════════════
// GET /api/admin/governorates — Liste des gouvernorats
// ══════════════════════════════════════════════════════════════
const getGovernorates = (req, res) => {
  return res.json({ success: true, data: GOVERNORATES });
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/stats — Statistiques globales Super Admin
// ══════════════════════════════════════════════════════════════
const getGlobalStats = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const now = new Date();
  const onlineThreshold = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes

  // ── Établissements ────────────────────────────────────────
  const estStats = await query(`
    SELECT
      COUNT(*)                                            AS total,
      COUNT(*) FILTER (WHERE is_active = TRUE)            AS active,
      COUNT(*) FILTER (WHERE is_active = FALSE)           AS inactive,
      COUNT(*) FILTER (WHERE type = 'hospital')           AS hospitals,
      COUNT(*) FILTER (WHERE type = 'clinic')             AS clinics,
      COUNT(*) FILTER (WHERE type = 'institute')          AS institutes,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') AS new_last_30d
    FROM establishments
    WHERE type != 'system'
  `);

  // ── Utilisateurs ──────────────────────────────────────────
  const userStats = await query(`
    SELECT
      COUNT(*) FILTER (WHERE r.code != 'super_admin')               AS total,
      COUNT(*) FILTER (WHERE u.is_active = TRUE AND r.code != 'super_admin') AS active,
      COUNT(*) FILTER (WHERE u.is_active = FALSE AND r.code != 'super_admin') AS inactive,
      COUNT(*) FILTER (WHERE r.code = 'director')                   AS directors,
      COUNT(*) FILTER (WHERE r.code = 'department_head')            AS dept_heads,
      COUNT(*) FILTER (WHERE r.code = 'general_supervisor')         AS supervisors,
      COUNT(*) FILTER (WHERE r.code = 'senior_doctor')              AS senior_doctors,
      COUNT(*) FILTER (WHERE r.code = 'resident')                   AS residents,
      COUNT(*) FILTER (
        WHERE u.last_activity_at >= $1 AND u.is_active = TRUE
      ) AS online_now,
      COUNT(*) FILTER (
        WHERE u.last_login >= NOW() - INTERVAL '24 hours'
      ) AS connected_today
    FROM users u
    JOIN roles r ON r.id = u.role_id
    JOIN establishments e ON e.id = u.establishment_id
    WHERE e.type != 'system'
  `, [onlineThreshold]);

  // ── Stats par gouvernorat ─────────────────────────────────
  const govStats = await query(`
    SELECT
      COALESCE(e.governorate, 'Non défini') AS governorate,
      COUNT(DISTINCT e.id)                  AS establishments,
      COUNT(DISTINCT u.id) FILTER (WHERE u.is_active = TRUE AND r.code != 'super_admin') AS users
    FROM establishments e
    LEFT JOIN users u ON u.establishment_id = e.id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE e.type != 'system'
    GROUP BY e.governorate
    ORDER BY establishments DESC
  `);

  // ── Évolution des établissements (12 derniers mois) ───────
  const estEvolution = await query(`
    SELECT
      TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
      COUNT(*)                                             AS count
    FROM establishments
    WHERE type != 'system'
      AND created_at >= NOW() - INTERVAL '12 months'
    GROUP BY DATE_TRUNC('month', created_at)
    ORDER BY month
  `);

  // ── Évolution connexions (30 derniers jours) ──────────────
  const loginEvolution = await query(`
    SELECT
      TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
      COUNT(*)                                               AS count
    FROM activity_logs
    WHERE action = 'login'
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY day
  `);

  // ── Dernières connexions (20 les plus récentes) ───────────
  const recentLogins = await query(`
    SELECT
      u.id, u.first_name, u.last_name, u.email, u.avatar_url,
      u.last_login, u.last_activity_at,
      r.code AS role_code, r.name AS role_name,
      e.name AS establishment_name, e.governorate
    FROM users u
    JOIN roles r ON r.id = u.role_id
    JOIN establishments e ON e.id = u.establishment_id
    WHERE u.last_login IS NOT NULL AND e.type != 'system' AND r.code != 'super_admin'
    ORDER BY u.last_login DESC
    LIMIT 20
  `);

  // ── Nouveaux établissements (10 derniers) ─────────────────
  const recentEsts = await query(`
    SELECT
      e.id, e.name, e.code, e.type, e.governorate, e.city, e.is_active, e.created_at,
      dir.first_name AS dir_first, dir.last_name AS dir_last
    FROM establishments e
    LEFT JOIN users dir ON dir.establishment_id = e.id
      AND dir.role_id = (SELECT id FROM roles WHERE establishment_id = e.id AND code='director' LIMIT 1)
    WHERE e.type != 'system'
    ORDER BY e.created_at DESC
    LIMIT 10
  `);

  // Enrichir les connexions récentes avec la présence
  const loginRows = recentLogins.rows.map(u => ({
    ...u,
    presence: computePresence(u.last_activity_at || u.last_login),
  }));

  return res.json({
    success: true,
    data: {
      establishments: estStats.rows[0],
      users:          userStats.rows[0],
      byGovernorate:  govStats.rows,
      evolution: {
        establishments: estEvolution.rows,
        logins:         loginEvolution.rows,
      },
      recentLogins: loginRows,
      recentEstablishments: recentEsts.rows,
    },
  });
};

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/establishments/:id/deactivate-cascade
// Désactive l'établissement ET tous ses utilisateurs
// ══════════════════════════════════════════════════════════════
const deactivateWithCascade = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const eid = req.params.id;

  // 1. Désactiver l'établissement
  const estResult = await query(
    `UPDATE establishments SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND type != 'system'
     RETURNING name`,
    [eid]
  );

  if (!estResult.rows[0]) {
    return res.status(404).json({ success: false, message: 'Établissement introuvable' });
  }

  // 2. Désactiver TOUS les utilisateurs de l'établissement
  const usersResult = await query(
    `UPDATE users SET is_active = FALSE, updated_at = NOW()
     WHERE establishment_id = $1`,
    [eid]
  );
  const usersDeactivated = usersResult.rowCount;

  // 3. Logger l'action
  log({
    userId:    req.user.id,
    action:    'establishment_cascade_deactivate',
    category:  'admin',
    description: `Établissement "${estResult.rows[0].name}" désactivé avec tous ses comptes`,
    entityType: 'establishments',
    entityId:   eid,
    severity:   'warning',
    ipAddress:  getIp(req),
  });

  return res.json({
    success: true,
    message: `Établissement "${estResult.rows[0].name}" et tous ses comptes ont été désactivés`,
  });
};

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/establishments/:id/activate-cascade
// Réactive l'établissement (les comptes restent désactivés
// jusqu'à réactivation manuelle)
// ══════════════════════════════════════════════════════════════
const activateEstablishment = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const eid = req.params.id;
  const { reactivateUsers = false } = req.body;

  const estResult = await query(
    `UPDATE establishments SET is_active = TRUE, updated_at = NOW()
     WHERE id = $1 AND type != 'system'
     RETURNING name`,
    [eid]
  );

  if (!estResult.rows[0]) {
    return res.status(404).json({ success: false, message: 'Établissement introuvable' });
  }

  let usersReactivated = 0;

  // Option : réactiver aussi le directeur automatiquement
  if (reactivateUsers) {
    const r = await query(
      `UPDATE users SET is_active = TRUE, updated_at = NOW()
       WHERE establishment_id = $1
         AND role_id = (SELECT id FROM roles WHERE establishment_id = $1 AND code='director' LIMIT 1)`,
      [eid]
    );
    usersReactivated = r.rowCount;
  }

  log({
    userId:    req.user.id,
    action:    'establishment_activate',
    category:  'admin',
    description: `Établissement "${estResult.rows[0].name}" réactivé${reactivateUsers ? ' (directeur réactivé)' : ''}`,
    entityType: 'establishments',
    entityId:   eid,
    ipAddress:  getIp(req),
  });

  return res.json({
    success: true,
    message: `Établissement "${estResult.rows[0].name}" réactivé`,
    usersReactivated,
  });
};

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/establishments/:id/director/password
// Reset ou définit le mot de passe du directeur
// ══════════════════════════════════════════════════════════════
const resetDirectorPassword = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères' });
  }

  const eid = req.params.id;

  // Trouver le directeur
  const dirRes = await query(
    `SELECT u.id, u.first_name, u.last_name FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.establishment_id = $1 AND r.code = 'director'
     LIMIT 1`,
    [eid]
  );

  if (!dirRes.rows[0]) {
    return res.status(404).json({ success: false, message: 'Aucun directeur trouvé' });
  }

  const director = dirRes.rows[0];
  const hash = await bcrypt.hash(newPassword, 12);

  await query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [hash, director.id]
  );

  log({
    userId:    req.user.id,
    action:    'director_password_reset',
    category:  'admin',
    description: `Mot de passe réinitialisé pour ${director.first_name} ${director.last_name}`,
    entityType: 'users',
    entityId:   director.id,
    severity:   'warning',
    ipAddress:  getIp(req),
  });

  return res.json({
    success: true,
    message: `Mot de passe du directeur ${director.first_name} ${director.last_name} réinitialisé`,
  });
};

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/establishments/:id/director/toggle-status
// Activer ou désactiver le compte du directeur
// ══════════════════════════════════════════════════════════════
const toggleDirectorStatus = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const eid = req.params.id;

  const dirRes = await query(
    `SELECT u.id, u.first_name, u.last_name, u.is_active FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.establishment_id = $1 AND r.code = 'director'
     LIMIT 1`,
    [eid]
  );

  if (!dirRes.rows[0]) {
    return res.status(404).json({ success: false, message: 'Aucun directeur trouvé' });
  }

  const director = dirRes.rows[0];
  const newStatus = !director.is_active;

  await query(
    'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2',
    [newStatus, director.id]
  );

  const action = newStatus ? 'director_activate' : 'director_deactivate';
  log({
    userId:    req.user.id,
    action,
    category:  'admin',
    description: `Directeur ${director.first_name} ${director.last_name} ${newStatus ? 'réactivé' : 'désactivé'}`,
    entityType: 'users',
    entityId:   director.id,
    severity:   newStatus ? 'info' : 'warning',
    ipAddress:  getIp(req),
  });

  return res.json({
    success: true,
    isActive: newStatus,
    message: `Directeur ${newStatus ? 'réactivé' : 'désactivé'} avec succès`,
  });
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/online-users — Utilisateurs actuellement en ligne
// ══════════════════════════════════════════════════════════════
const getOnlineUsers = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const threshold = new Date(Date.now() - 5 * 60 * 1000);

  const result = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url,
            u.last_activity_at, u.last_login,
            r.code AS role_code, r.name AS role_name,
            e.name AS establishment_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     JOIN establishments e ON e.id = u.establishment_id
     WHERE u.is_active = TRUE
       AND u.last_activity_at >= $1
       AND e.type != 'system'
       AND r.code != 'super_admin'
     ORDER BY u.last_activity_at DESC`,
    [threshold]
  );

  const data = result.rows.map(u => ({
    ...u,
    presence: computePresence(u.last_activity_at),
  }));

  return res.json({ success: true, data, count: data.length });
};

// ══════════════════════════════════════════════════════════════
// JOURS ET PÉRIODES FÉRIÉS (Super Admin)
// ══════════════════════════════════════════════════════════════
const getPublicHolidays = async (req, res) => {
  const { year, startDate, endDate } = req.query;
  const targetYear = parseInt(year || new Date().getFullYear());
  const rangeStart = String(startDate || `${targetYear}-01-01`).slice(0, 10);
  const rangeEnd = String(endDate || `${targetYear}-12-31`).slice(0, 10);
  const holidays = await query(
    `SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, year, category, is_recurring, multiplier, notes, created_by, created_at, updated_at
     FROM public_holidays
     WHERE start_date <= $2::date AND end_date >= $1::date
     ORDER BY start_date ASC`,
    [rangeStart, rangeEnd]
  );
  return res.json({ success: true, data: holidays.rows, year: targetYear, startDate: rangeStart, endDate: rangeEnd });
};

const createPublicHoliday = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { name, startDate, endDate, year, category = 'national', isRecurring = false, multiplier = 1.5, notes = '' } = req.body;
  if (!name || !startDate) {
    return res.status(400).json({ success: false, message: 'Le nom et la date de début sont obligatoires' });
  }

  const start = String(startDate).split('T')[0];
  const end = endDate ? String(endDate).split('T')[0] : start;
  const hYear = parseInt(year || start.substring(0, 4));

  const result = await query(
    `INSERT INTO public_holidays (name, start_date, end_date, year, category, is_recurring, multiplier, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [name.trim(), start, end, hYear, category, Boolean(isRecurring), parseFloat(multiplier || 1.5), notes || null, req.user.id]
  );

  log({
    userId: req.user.id, action: 'create_holiday', category: 'admin',
    description: `Jour férié ajouté: ${name} (${start} → ${end})`,
    entityType: 'public_holidays', entityId: result.rows[0].id, ipAddress: getIp(req)
  });

  return res.status(201).json({ success: true, data: result.rows[0], message: 'Jour/Période férié(e) enregistré(e)' });
};

const updatePublicHoliday = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { id } = req.params;
  const { name, startDate, endDate, year, category, isRecurring, multiplier, notes } = req.body;

  const start = String(startDate).split('T')[0];
  const end = endDate ? String(endDate).split('T')[0] : start;
  const hYear = parseInt(year || start.substring(0, 4));

  const result = await query(
    `UPDATE public_holidays
     SET name = $1, start_date = $2, end_date = $3, year = $4, category = $5,
         is_recurring = $6, multiplier = $7, notes = $8, updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [name.trim(), start, end, hYear, category || 'national', Boolean(isRecurring), parseFloat(multiplier || 1.5), notes || null, id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ success: false, message: 'Jour férié introuvable' });
  }

  return res.json({ success: true, data: result.rows[0], message: 'Jour/Période férié(e) mis(e) à jour' });
};

const deletePublicHoliday = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { id } = req.params;
  await query('DELETE FROM public_holidays WHERE id = $1', [id]);
  return res.json({ success: true, message: 'Jour férié supprimé' });
};

const seedTunisiaHolidays = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const targetYear = parseInt(req.body.year || new Date().getFullYear());

  const presets = [
    { name: 'Nouvel An', start: `${targetYear}-01-01`, end: `${targetYear}-01-01`, category: 'national', isRecurring: true, multiplier: 1.5 },
    { name: 'Fête de la Révolution & Jeunesse', start: `${targetYear}-01-14`, end: `${targetYear}-01-14`, category: 'national', isRecurring: true, multiplier: 1.5 },
    { name: "Fête de l'Indépendance", start: `${targetYear}-03-20`, end: `${targetYear}-03-20`, category: 'national', isRecurring: true, multiplier: 1.5 },
    { name: 'Fête des Martyrs', start: `${targetYear}-04-09`, end: `${targetYear}-04-09`, category: 'national', isRecurring: true, multiplier: 1.5 },
    { name: 'Fête du Travail', start: `${targetYear}-05-01`, end: `${targetYear}-05-01`, category: 'national', isRecurring: true, multiplier: 2.0 },
    { name: 'Fête de la République', start: `${targetYear}-07-25`, end: `${targetYear}-07-25`, category: 'national', isRecurring: true, multiplier: 1.5 },
    { name: 'Fête Nationale de la Femme', start: `${targetYear}-08-13`, end: `${targetYear}-08-13`, category: 'national', isRecurring: true, multiplier: 1.5 },
    { name: "Fête de l'Évacuation", start: `${targetYear}-10-15`, end: `${targetYear}-10-15`, category: 'national', isRecurring: true, multiplier: 1.5 },
  ];

  for (const h of presets) {
    await query(
      `INSERT INTO public_holidays (name, start_date, end_date, year, category, is_recurring, multiplier, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [h.name, h.start, h.end, targetYear, h.category, h.isRecurring, h.multiplier, req.user.id]
    );
  }

  const holidays = await query('SELECT id, name, start_date::text AS start_date, end_date::text AS end_date, year, category, is_recurring, multiplier, notes, created_by, created_at, updated_at FROM public_holidays WHERE year = $1 ORDER BY start_date ASC', [targetYear]);
  return res.json({ success: true, data: holidays.rows, message: `Jours fériés tunisiens préchargés pour ${targetYear}` });
};

module.exports = {
  getGovernorates,
  getGlobalStats,
  deactivateWithCascade,
  activateEstablishment,
  resetDirectorPassword,
  toggleDirectorStatus,
  getOnlineUsers,
  getPublicHolidays,
  createPublicHoliday,
  updatePublicHoliday,
  deletePublicHoliday,
  seedTunisiaHolidays,
};
