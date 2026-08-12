const { query, transaction } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');
const { initEstablishmentDefaults } = require('../schedules/rules-engine');

// ──────────────────────────────────────────────────────────────
// GET /api/establishments — liste (super_admin : tous | autres : le leur)
// ──────────────────────────────────────────────────────────────
const getAll = async (req, res) => {
  const isSA = req.user.isSuperAdmin;

  const result = await query(
    `SELECT
       e.id, e.code, e.name, e.name_ar, e.type, e.address, e.city,
       e.phone, e.email, e.logo_url, e.is_active, e.created_at,
       -- Adresse détaillée (localisation de l'établissement)
       e.governorate, e.delegation, e.postal_code, e.address_details,
       e.latitude, e.longitude,
       COUNT(DISTINCT u.id) FILTER (
         WHERE u.is_active = TRUE AND r_u.code != 'super_admin'
       ) AS user_count,
       COUNT(DISTINCT d.id) AS dept_count,
       dir.id         AS director_id,
       dir.first_name AS director_first_name,
       dir.last_name  AS director_last_name,
       dir.email      AS director_email
     FROM establishments e
     LEFT JOIN users u   ON u.establishment_id = e.id
     LEFT JOIN roles r_u ON r_u.id = u.role_id
     LEFT JOIN departments d ON d.establishment_id = e.id
     LEFT JOIN roles r_dir ON r_dir.establishment_id = e.id AND r_dir.code = 'director'
     LEFT JOIN users dir ON dir.establishment_id = e.id
       AND dir.role_id = r_dir.id
       AND dir.is_active = TRUE
     WHERE e.type != 'system'
       ${isSA ? '' : 'AND e.id = $1'}
     GROUP BY e.id, dir.id, dir.first_name, dir.last_name, dir.email
     ORDER BY e.name`,
    isSA ? [] : [req.user.establishmentId]
  );

  return res.json({ success: true, data: result.rows });
};


// ──────────────────────────────────────────────────────────────
// GET /api/establishments/:id
// ──────────────────────────────────────────────────────────────
const getOne = async (req, res) => {
  const result = await query(
    `SELECT e.*,
            dir.id AS director_id, dir.first_name AS director_first_name,
            dir.last_name AS director_last_name, dir.email AS director_email
     FROM establishments e
     LEFT JOIN users dir ON dir.establishment_id = e.id
       AND dir.role_id = (
         SELECT id FROM roles WHERE establishment_id = e.id AND code = 'director' LIMIT 1
       )
     WHERE e.id = $1 AND e.type != 'system'`,
    [req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Établissement introuvable' });

  // Configs
  const configs = await query(
    'SELECT config_key, config_value, config_type, description FROM establishment_configs WHERE establishment_id = $1',
    [req.params.id]
  );

  return res.json({
    success: true,
    data: { ...result.rows[0], configs: configs.rows },
  });
};

// ──────────────────────────────────────────────────────────────
// POST /api/establishments — Super Admin uniquement
// Crée l'établissement + ses rôles automatiquement
// ──────────────────────────────────────────────────────────────
const create = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  // Adresse détaillée : gouvernorat / ville / délégation / code postal / adresse
  // précise. Les coordonnées (latitude, longitude) sont acceptées dès maintenant
  // pour la future carte des hôpitaux, mais restent facultatives.
  const {
    code, name, nameAr, type = 'hospital', address, city, phone, email, governorate,
    delegation, postalCode, addressDetails, latitude, longitude,
  } = req.body;
  if (!code || !name) {
    return res.status(400).json({ success: false, message: 'Code et nom de l\'établissement requis' });
  }

  const result = await transaction(async (client) => {
    // 1. Créer l'établissement
    const est = await client.query(
      `INSERT INTO establishments (code, name, name_ar, type, address, city, phone, email, governorate,
                                   delegation, postal_code, address_details, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [code.toUpperCase(), name, nameAr || null, type, address || null, city || null, phone || null,
       email || null, governorate || null,
       delegation || null, postalCode || null, addressDetails || null,
       latitude === '' || latitude == null ? null : latitude,
       longitude === '' || longitude == null ? null : longitude]
    );

    const eid = est.rows[0].id;

    // 2. Créer les rôles standards pour cet établissement (via la fonction SQL)
    await client.query('SELECT create_roles_for_establishment($1)', [eid]);

    // 3. Configs par défaut
    await client.query(
      `INSERT INTO establishment_configs (establishment_id, config_key, config_value, config_type, description)
       VALUES
         ($1,'planning_period','monthly','string','Période de planification'),
         ($1,'max_shifts_per_month','8','integer','Nombre max de gardes par mois'),
         ($1,'min_rest_hours','24','integer','Repos minimum entre 2 gardes (heures)'),
         ($1,'auto_notification','true','boolean','Notifications automatiques'),
         ($1,'allow_self_replacement','false','boolean','Auto-remplacement autorisé'),
         ($1,'workflow_type','standard','string','Type de workflow')
       ON CONFLICT (establishment_id, config_key) DO NOTHING`,
      [eid]
    );

    return est.rows[0];
  });

  // 4. Initialiser les colonnes + regles par defaut du moteur de planning
  try {
    await initEstablishmentDefaults(result.id, req.user.id);
  } catch (e) {
    console.warn('[init-defaults] Non bloquant :', e.message);
  }

  // 5. Seeder les titres de poste hospitaliers pour cet etablissement
  try {
    await query('SELECT seed_job_titles_for_establishment($1)', [result.id]);
  } catch (e) {
    console.warn('[seed-job-titles] Non bloquant :', e.message);
  }

  log({
    userId: req.user.id,
    action: 'establishment_create',
    category: 'admin',
    description: `Établissement créé : ${name} (${code})`,
    entityType: 'establishments',
    entityId: result.id,
    ipAddress: getIp(req),
    severity: 'info',
  });

  return res.status(201).json({
    success: true,
    data: result,
    message: `Établissement "${name}" créé avec ses rôles standards.`,
  });
};

// ──────────────────────────────────────────────────────────────
// PUT /api/establishments/:id — Modifier
// ──────────────────────────────────────────────────────────────
const update = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const {
    name, nameAr, type, address, city, phone, email, isActive, governorate,
    delegation, postalCode, addressDetails, latitude, longitude,
  } = req.body;

  const num = (v) => (v === '' || v == null ? null : v);

  const result = await query(
    `UPDATE establishments SET
       name            = COALESCE($1, name),
       name_ar         = COALESCE($2, name_ar),
       type            = COALESCE($3, type),
       address         = COALESCE($4, address),
       city            = COALESCE($5, city),
       phone           = COALESCE($6, phone),
       email           = COALESCE($7, email),
       is_active       = COALESCE($8, is_active),
       governorate     = COALESCE($9, governorate),
       delegation      = COALESCE($10, delegation),
       postal_code     = COALESCE($11, postal_code),
       address_details = COALESCE($12, address_details),
       latitude        = COALESCE($13, latitude),
       longitude       = COALESCE($14, longitude),
       updated_at      = NOW()
     WHERE id = $15 AND type != 'system'
     RETURNING *`,
    [name, nameAr, type, address, city, phone, email, isActive, governorate ?? null,
     delegation ?? null, postalCode ?? null, addressDetails ?? null,
     num(latitude), num(longitude), req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Établissement introuvable' });

  log({
    userId: req.user.id,
    action: 'establishment_update',
    category: 'admin',
    description: `Établissement modifié : ${result.rows[0].name}`,
    entityType: 'establishments',
    entityId: req.params.id,
    ipAddress: getIp(req),
  });

  return res.json({ success: true, data: result.rows[0], message: 'Établissement mis à jour' });
};

// ──────────────────────────────────────────────────────────────
// DELETE /api/establishments/:id — Désactiver (soft delete)
// ──────────────────────────────────────────────────────────────
const deactivate = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const result = await query(
    `UPDATE establishments SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND type != 'system'
     RETURNING name`,
    [req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Établissement introuvable' });

  log({
    userId: req.user.id,
    action: 'establishment_deactivate',
    category: 'admin',
    description: `Établissement désactivé : ${result.rows[0].name}`,
    entityType: 'establishments',
    entityId: req.params.id,
    severity: 'warning',
    ipAddress: getIp(req),
  });

  return res.json({ success: true, message: `Établissement "${result.rows[0].name}" désactivé` });
};

// ──────────────────────────────────────────────────────────────
// PUT /api/establishments/:id/activate — Réactiver
// ──────────────────────────────────────────────────────────────
const activate = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const result = await query(
    `UPDATE establishments SET is_active = TRUE, updated_at = NOW()
     WHERE id = $1 RETURNING name`,
    [req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Établissement introuvable' });
  return res.json({ success: true, message: `Établissement "${result.rows[0].name}" réactivé` });
};

// ──────────────────────────────────────────────────────────────
// GET /api/establishments/:id/roles — Rôles d'un établissement
// ──────────────────────────────────────────────────────────────
const getRoles = async (req, res) => {
  const result = await query(
    `SELECT r.id, r.code, r.name, r.name_ar, r.level,
            COUNT(u.id) AS user_count
     FROM roles r
     LEFT JOIN users u ON u.role_id = r.id AND u.is_active = TRUE
     WHERE r.establishment_id = $1
     GROUP BY r.id ORDER BY r.level`,
    [req.params.id]
  );
  return res.json({ success: true, data: result.rows });
};

// ──────────────────────────────────────────────────────────────
// PUT /api/establishments/:id/config — Mettre à jour une config
// ──────────────────────────────────────────────────────────────
const updateConfig = async (req, res) => {
  const { configs } = req.body; // [{ key, value }]
  if (!Array.isArray(configs)) {
    return res.status(400).json({ success: false, message: 'configs doit être un tableau' });
  }

  for (const { key, value } of configs) {
    await query(
      `INSERT INTO establishment_configs (establishment_id, config_key, config_value)
       VALUES ($1,$2,$3)
       ON CONFLICT (establishment_id, config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [req.params.id, key, value]
    );
  }

  return res.json({ success: true, message: 'Configuration mise à jour' });
};

// ──────────────────────────────────────────────────────────────
// GET /api/establishments/:id/personnel
// Liste tout le personnel d'un établissement + stats gardes du mois
// ──────────────────────────────────────────────────────────────
const getPersonnel = async (req, res) => {
  const { roleCode, isActive, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  const eid = req.params.id;

  let conditions = [`u.establishment_id = $1`, `r.code != 'super_admin'`];
  let params = [eid];
  let idx = 2;

  if (isActive !== undefined) { conditions.push(`u.is_active = $${idx}`); params.push(isActive === 'true'); idx++; }
  if (roleCode)  { conditions.push(`r.code = $${idx}`); params.push(roleCode); idx++; }
  if (search)    { conditions.push(`(u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.matricule ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
  // Filtre archivage — appliqué uniquement s'il est explicitement demandé,
  // pour que la liste par défaut reste strictement identique à avant.
  if (req.query.archived === 'true')  conditions.push('u.archived_at IS NOT NULL');
  if (req.query.archived === 'false') conditions.push('u.archived_at IS NULL');

  const where = conditions.join(' AND ');
  const now = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;

  const result = await query(
    `SELECT
       u.id, u.matricule, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
       u.email, u.phone, u.speciality, u.grade, u.is_active, u.is_on_leave,
       u.avatar_url, u.can_login, u.last_login, u.created_at,
       u.hourly_rate, u.base_salary, u.hire_date,
       u.archived_at, u.archive_reason,
       r.code AS role_code, r.name AS role_name, r.level AS role_level,
       r2.code AS secondary_role_code, r2.name AS secondary_role_name,
       -- Départements (agrégé)
       STRING_AGG(DISTINCT d.name, ', ' ORDER BY d.name) AS departments,
       -- Détail des services : nom + rôle tenu dans le service (chef ou membre)
       COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'id', d2.id, 'name', d2.name, 'code', d2.code, 'isHead', ud2.is_head
                ) ORDER BY ud2.is_head DESC, d2.name)
           FROM user_departments ud2
           JOIN departments d2 ON d2.id = ud2.department_id
          WHERE ud2.user_id = u.id
       ), '[]'::jsonb) AS departments_detail,
       -- Gardes du mois courant
       COUNT(DISTINCT s.id) FILTER (
         WHERE EXTRACT(YEAR FROM s.shift_date) = ${year}
           AND EXTRACT(MONTH FROM s.shift_date) = ${month}
           AND s.status != 'cancelled'
       ) AS shifts_this_month,
       COALESCE(SUM(st.duration_hours) FILTER (
         WHERE EXTRACT(YEAR FROM s.shift_date) = ${year}
           AND EXTRACT(MONTH FROM s.shift_date) = ${month}
           AND s.status IN ('completed','confirmed','planned')
       ), 0) AS hours_this_month
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN roles r2 ON r2.id = u.secondary_role_id
     LEFT JOIN user_departments ud ON ud.user_id = u.id
     LEFT JOIN departments d ON d.id = ud.department_id
     LEFT JOIN shifts s ON s.user_id = u.id
     LEFT JOIN shift_types st ON st.id = s.shift_type_id
     WHERE ${where}
     GROUP BY u.id, r.id, r2.id
     ORDER BY r.level, u.last_name, u.first_name
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  );

  const countRes = await query(
    `SELECT COUNT(DISTINCT u.id) FROM users u JOIN roles r ON r.id = u.role_id WHERE ${where}`,
    params
  );

  return res.json({
    success: true,
    data: result.rows,
    pagination: {
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
};

// ──────────────────────────────────────────────────────────────
// GET /api/establishments/:id/history
// Historique d'activité d'un établissement (super_admin uniquement)
// ──────────────────────────────────────────────────────────────
const getEstablishmentHistory = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { page = 1, limit = 30, category, severity, userId, from, to } = req.query;
  const offset = (page - 1) * limit;
  const eid = req.params.id;

  let conditions = [
    `(al.establishment_id = $1 OR u.establishment_id = $1)`
  ];
  let params = [eid];
  let idx = 2;

  if (category) { conditions.push(`al.category = $${idx}`); params.push(category); idx++; }
  if (severity) { conditions.push(`al.severity = $${idx}`); params.push(severity); idx++; }
  if (userId)   { conditions.push(`al.user_id = $${idx}`);  params.push(userId);  idx++; }
  if (from)     { conditions.push(`al.created_at >= $${idx}`); params.push(from);  idx++; }
  if (to)       { conditions.push(`al.created_at <= $${idx}`); params.push(to);    idx++; }

  const where = conditions.join(' AND ');

  const result = await query(
    `SELECT al.*,
            u.first_name, u.last_name, u.email, u.avatar_url,
            r.code AS role_code, r.name AS role_name
     FROM activity_logs al
     LEFT JOIN users u ON al.user_id = u.id
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE ${where}
     ORDER BY al.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  );

  const countRes = await query(
    `SELECT COUNT(*) FROM activity_logs al LEFT JOIN users u ON al.user_id = u.id WHERE ${where}`,
    params
  );

  return res.json({
    success: true,
    data: result.rows,
    pagination: {
      total: parseInt(countRes.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
};

// ──────────────────────────────────────────────────────────────
// GET /api/establishments/:id/director
// ──────────────────────────────────────────────────────────────
const getDirector = async (req, res) => {
  const eid = req.params.id;
  const result = await query(
    `SELECT u.id, u.matricule, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
            u.email, u.phone, u.speciality, u.grade, u.is_active, u.avatar_url,
            u.hire_date, u.base_salary, u.hourly_rate, u.created_at, u.last_login
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.establishment_id = $1 AND r.code = 'director'
     LIMIT 1`,
    [eid]
  );
  return res.json({ success: true, data: result.rows[0] || null });
};

// ──────────────────────────────────────────────────────────────
// PUT /api/establishments/:id/director — Modifier le directeur
// ──────────────────────────────────────────────────────────────
const updateDirector = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const eid = req.params.id;
  const { firstName, lastName, email, phone, matricule, baseSalary, hourlyRate, hireDate, isActive } = req.body;

  // Trouver le directeur actuel
  const dirRes = await query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.establishment_id = $1 AND r.code = 'director' LIMIT 1`,
    [eid]
  );

  if (!dirRes.rows[0]) {
    return res.status(404).json({ success: false, message: 'Aucun directeur trouvé pour cet établissement' });
  }

  const dirId = dirRes.rows[0].id;

  const result = await query(
    `UPDATE users SET
       first_name  = COALESCE($1, first_name),
       last_name   = COALESCE($2, last_name),
       email       = COALESCE($3, email),
       phone       = COALESCE($4, phone),
       matricule   = COALESCE($5, matricule),
       base_salary = COALESCE($6, base_salary),
       hourly_rate = COALESCE($7, hourly_rate),
       hire_date   = COALESCE($8, hire_date),
       is_active   = COALESCE($9, is_active),
       updated_at  = NOW()
     WHERE id = $10
     RETURNING id, first_name, last_name, email, phone, matricule, is_active, updated_at`,
    [firstName, lastName, email, phone, matricule, baseSalary, hourlyRate, hireDate, isActive, dirId]
  );

  log({
    userId: req.user.id,
    action: 'director_update',
    category: 'admin',
    description: `Directeur modifié pour l'établissement ${eid}`,
    entityType: 'users',
    entityId: dirId,
    ipAddress: getIp(req),
  });

  return res.json({ success: true, data: result.rows[0], message: 'Directeur mis à jour' });
};

// ──────────────────────────────────────────────────────────────
// DELETE /api/establishments/:id/director — Supprimer le directeur
// ──────────────────────────────────────────────────────────────
const removeDirector = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const eid = req.params.id;
  const dirRes = await query(
    `SELECT u.id, u.first_name, u.last_name FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.establishment_id = $1 AND r.code = 'director' LIMIT 1`,
    [eid]
  );

  if (!dirRes.rows[0]) {
    return res.status(404).json({ success: false, message: 'Aucun directeur à supprimer' });
  }

  const dir = dirRes.rows[0];

  // Soft delete
  await query(`UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [dir.id]);

  log({
    userId: req.user.id,
    action: 'director_remove',
    category: 'admin',
    description: `Directeur ${dir.first_name} ${dir.last_name} désactivé pour l'établissement ${eid}`,
    entityType: 'users',
    entityId: dir.id,
    severity: 'warning',
    ipAddress: getIp(req),
  });

  return res.json({ success: true, message: `Compte directeur désactivé.` });
};

// ──────────────────────────────────────────────────────────────
// DELETE /api/establishments/personnel/:userId — Soft delete personnel
// Super Admin uniquement
// ──────────────────────────────────────────────────────────────
const removePersonnel = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { userId } = req.params;

  // Récupérer infos
  const userRes = await query(
    `SELECT u.id, u.first_name, u.last_name, r.code AS role_code, u.establishment_id
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId]
  );

  if (!userRes.rows[0]) {
    return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  }

  const target = userRes.rows[0];

  // Interdire de supprimer le super_admin
  if (target.role_code === 'super_admin') {
    return res.status(403).json({ success: false, message: 'Impossible de supprimer le Super Admin' });
  }

  await query(`UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [userId]);

  log({
    userId: req.user.id,
    action: 'user_deactivate',
    category: 'admin',
    description: `Compte de ${target.first_name} ${target.last_name} (${target.role_code}) désactivé par le Super Admin`,
    entityType: 'users',
    entityId: userId,
    severity: 'warning',
    ipAddress: getIp(req),
  });

  return res.json({ success: true, message: `Compte de ${target.first_name} ${target.last_name} désactivé.` });
};

// ──────────────────────────────────────────────────────────────
// PUT /api/establishments/personnel/:userId — Modifier infos personnel
// Super Admin uniquement (salaire, taux horaire, date embauche)
// ──────────────────────────────────────────────────────────────
const updatePersonnel = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { userId } = req.params;
  const { baseSalary, hourlyRate, hireDate, phone, speciality, grade, isActive } = req.body;

  const result = await query(
    `UPDATE users SET
       base_salary = COALESCE($1, base_salary),
       hourly_rate = COALESCE($2, hourly_rate),
       hire_date   = COALESCE($3, hire_date),
       phone       = COALESCE($4, phone),
       speciality  = COALESCE($5, speciality),
       grade       = COALESCE($6, grade),
       is_active   = COALESCE($7, is_active),
       updated_at  = NOW()
     WHERE id = $8
     RETURNING id, first_name, last_name, base_salary, hourly_rate, hire_date, updated_at`,
    [baseSalary, hourlyRate, hireDate, phone, speciality, grade, isActive, userId]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  return res.json({ success: true, data: result.rows[0], message: 'Informations mises à jour' });
};

// ──────────────────────────────────────────────────────────────
// GET /api/establishments/personnel/:userId/salary
// Rapport salaire mensuel estimé
// ──────────────────────────────────────────────────────────────
const getSalaryReport = async (req, res) => {
  const { userId } = req.params;
  const { year = new Date().getFullYear(), month = new Date().getMonth() + 1 } = req.query;

  const userRes = await query(
    `SELECT u.first_name, u.last_name, u.base_salary, u.hourly_rate,
            u.hire_date, u.speciality, u.grade, u.avatar_url,
            r.name AS role_name, r.code AS role_code,
            e.name AS establishment_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     JOIN establishments e ON e.id = u.establishment_id
     WHERE u.id = $1`,
    [userId]
  );

  if (!userRes.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  const user = userRes.rows[0];

  // Stats gardes du mois
  const shiftsRes = await query(
    `SELECT
       COUNT(*) FILTER (WHERE s.status NOT IN ('cancelled'))         AS total_shifts,
       COUNT(*) FILTER (WHERE s.status = 'completed')                AS completed,
       COUNT(*) FILTER (WHERE s.status = 'absent')                   AS absent,
       COUNT(*) FILTER (WHERE s.status IN ('completed','confirmed','planned')) AS billable_shifts,
       COALESCE(SUM(st.duration_hours) FILTER (
         WHERE s.status IN ('completed','confirmed','planned')
       ), 0) AS total_hours,
       COALESCE(SUM(st.duration_hours) FILTER (
         WHERE s.status IN ('completed','confirmed','planned') AND s.is_extra = TRUE
       ), 0) AS extra_hours
     FROM shifts s
     JOIN shift_types st ON st.id = s.shift_type_id
     WHERE s.user_id = $1
       AND EXTRACT(YEAR  FROM s.shift_date) = $2
       AND EXTRACT(MONTH FROM s.shift_date) = $3`,
    [userId, year, month]
  );

  const stats = shiftsRes.rows[0];
  const baseSalary   = parseFloat(user.base_salary)  || 0;
  const hourlyRate   = parseFloat(user.hourly_rate)   || 0;
  const extraHours   = parseFloat(stats.extra_hours)  || 0;
  const totalHours   = parseFloat(stats.total_hours)  || 0;
  const extraPay     = extraHours * hourlyRate;
  const totalSalary  = baseSalary + extraPay;

  // Ancienneté
  let seniority = null;
  if (user.hire_date) {
    const hireDate = new Date(user.hire_date);
    const now      = new Date();
    const diffMs   = now - hireDate;
    const diffYears  = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
    const diffMonths = Math.floor((diffMs / (1000 * 60 * 60 * 24 * 30.44)) % 12);
    seniority = { years: diffYears, months: diffMonths };
  }

  return res.json({
    success: true,
    data: {
      user: { ...user, seniority },
      period: { year: parseInt(year), month: parseInt(month) },
      shifts: stats,
      salary: {
        baseSalary,
        hourlyRate,
        extraHours,
        extraPay,
        totalHours,
        totalSalary,
      },
    },
  });
};

module.exports = {
  getAll, getOne, create, update, deactivate, activate, getRoles, updateConfig,
  getPersonnel, getEstablishmentHistory,
  getDirector, updateDirector, removeDirector,
  removePersonnel, updatePersonnel, getSalaryReport,
};

