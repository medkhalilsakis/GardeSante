const { query } = require('../../config/database');

// ─── Helper — enregistrer une action ─────────────────────────
const log = async ({
  userId, action, category = 'general', description, descriptionAr,
  entityType, entityId, metadata = {}, ipAddress, userAgent, severity = 'info',
}) => {
  try {
    await query(
      `INSERT INTO activity_logs
         (user_id, action, category, description, description_ar,
          entity_type, entity_id, metadata, ip_address, user_agent, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        userId, action, category, description, descriptionAr,
        entityType || null, entityId || null,
        JSON.stringify(metadata),
        ipAddress || null, userAgent || null, severity,
      ]
    );
  } catch (err) {
    // Ne jamais faire planter l'API à cause d'un log raté
    console.warn('⚠️  activity_log error:', err.message);
  }
};
exports.log = log;

// ─── Extraire IP depuis la requête ───────────────────────────
const getIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  null;
exports.getIp = getIp;

// ──────────────────────────────────────────────────────────────
// GET /api/history/mine  — historique personnel (lecture seule)
// ──────────────────────────────────────────────────────────────
exports.getMine = async (req, res) => {
  const { page = 1, limit = 30, category, action, from, to } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const conditions = ['al.user_id = $1'];
  const params = [req.user.id];
  let idx = 2;

  if (category) { conditions.push(`al.category = $${idx}`); params.push(category); idx++; }
  if (action)   { conditions.push(`al.action ILIKE $${idx}`); params.push(`%${action}%`); idx++; }
  if (from)     { conditions.push(`al.created_at >= $${idx}`); params.push(from); idx++; }
  if (to)       { conditions.push(`al.created_at <= $${idx}`); params.push(to + ' 23:59:59'); idx++; }

  const where = conditions.join(' AND ');

  const [rows, cnt] = await Promise.all([
    query(
      `SELECT al.id, al.action, al.category, al.description, al.description_ar,
              al.entity_type, al.entity_id, al.metadata, al.severity, al.created_at,
              al.ip_address
       FROM activity_logs al
       WHERE ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit), offset]
    ),
    query(`SELECT COUNT(*) FROM activity_logs al WHERE ${where}`, params),
  ]);

  return res.json({
    success: true,
    data: rows.rows,
    pagination: {
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
};

// ──────────────────────────────────────────────────────────────
// GET /api/history/all  — tous les utilisateurs (super_admin)
// ──────────────────────────────────────────────────────────────
exports.getAll = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { page = 1, limit = 40, userId, category, action, from, to, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const conditions = [];
  const params = [];
  let idx = 1;

  if (userId)   { conditions.push(`al.user_id = $${idx}`); params.push(userId); idx++; }
  if (category) { conditions.push(`al.category = $${idx}`); params.push(category); idx++; }
  if (action)   { conditions.push(`al.action ILIKE $${idx}`); params.push(`%${action}%`); idx++; }
  if (from)     { conditions.push(`al.created_at >= $${idx}`); params.push(from); idx++; }
  if (to)       { conditions.push(`al.created_at <= $${idx}`); params.push(to + ' 23:59:59'); idx++; }
  if (search)   {
    conditions.push(`(u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR u.email ILIKE $${idx})`);
    params.push(`%${search}%`); idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows, cnt] = await Promise.all([
    query(
      `SELECT al.id, al.action, al.category, al.description, al.description_ar,
              al.entity_type, al.entity_id, al.metadata, al.severity, al.created_at,
              al.ip_address,
              u.id AS user_id, u.first_name, u.last_name, u.email, u.avatar_url,
              r.name AS role_name, r.code AS role_code,
              e.name AS establishment_name
       FROM activity_logs al
       JOIN users u ON al.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       JOIN establishments e ON u.establishment_id = e.id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit), offset]
    ),
    query(
      `SELECT COUNT(*) FROM activity_logs al
       JOIN users u ON al.user_id = u.id
       ${where}`,
      params
    ),
  ]);

  return res.json({
    success: true,
    data: rows.rows,
    pagination: {
      total: parseInt(cnt.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
};

// ──────────────────────────────────────────────────────────────
// GET /api/history/users/:id  — super_admin lit le profil d'un user
// ──────────────────────────────────────────────────────────────
exports.getUserHistory = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }

  const { page = 1, limit = 30, category } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const uid = req.params.id;

  const conditions = ['al.user_id = $1'];
  const params = [uid];
  let idx = 2;
  if (category) { conditions.push(`al.category = $${idx}`); params.push(category); idx++; }

  const where = conditions.join(' AND ');

  const [rows, cnt, userRow] = await Promise.all([
    query(
      `SELECT al.id, al.action, al.category, al.description, al.severity, al.created_at, al.ip_address, al.metadata
       FROM activity_logs al WHERE ${where}
       ORDER BY al.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limit), offset]
    ),
    query(`SELECT COUNT(*) FROM activity_logs al WHERE ${where}`, params),
    query(
      `SELECT u.first_name, u.last_name, u.email, u.avatar_url, r.name AS role_name, e.name AS establishment_name
       FROM users u JOIN roles r ON u.role_id=r.id JOIN establishments e ON u.establishment_id=e.id WHERE u.id=$1`,
      [uid]
    ),
  ]);

  if (!userRow.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  return res.json({
    success: true,
    user: userRow.rows[0],
    data: rows.rows,
    pagination: { total: parseInt(cnt.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
  });
};

// ──────────────────────────────────────────────────────────────
// GET /api/history/users  — liste des users (super_admin, pour filtrage)
// ──────────────────────────────────────────────────────────────
exports.getUsersList = async (req, res) => {
  if (!req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
  }
  const result = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url,
            r.name AS role_name, r.code AS role_code, e.name AS establishment_name
     FROM users u
     JOIN roles r ON u.role_id = r.id
     JOIN establishments e ON u.establishment_id = e.id
     WHERE u.is_active = TRUE
     ORDER BY u.last_name, u.first_name`,
    []
  );
  return res.json({ success: true, data: result.rows });
};

// ──────────────────────────────────────────────────────────────
// GET /api/history/categories  — liste des catégories disponibles
// ──────────────────────────────────────────────────────────────
exports.getCategories = async (req, res) => {
  const uid = req.user.isSuperAdmin ? null : req.user.id;
  const result = uid
    ? await query('SELECT DISTINCT category FROM activity_logs WHERE user_id=$1 ORDER BY category', [uid])
    : await query('SELECT DISTINCT category FROM activity_logs ORDER BY category', []);
  return res.json({ success: true, data: result.rows.map(r => r.category) });
};
