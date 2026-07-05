const { query, transaction } = require('../../config/database');
const bcrypt = require('bcryptjs');

// GET /api/users
const getUsers = async (req, res) => {
  const { page = 1, limit = 20, search, roleCode, departmentId, isActive } = req.query;
  const offset = (page - 1) * limit;
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  let conditions = ['u.establishment_id = $1'];
  let params = [eid];
  let idx = 2;

  if (search) {
    conditions.push(`(u.first_name ILIKE $${idx} OR u.last_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.matricule ILIKE $${idx})`);
    params.push(`%${search}%`); idx++;
  }
  if (roleCode) {
    conditions.push(`r.code = $${idx}`); params.push(roleCode); idx++;
  }
  if (departmentId) {
    conditions.push(`ud.department_id = $${idx}`); params.push(departmentId); idx++;
  }
  if (isActive !== undefined) {
    conditions.push(`u.is_active = $${idx}`); params.push(isActive === 'true'); idx++;
  }

  const where = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(DISTINCT u.id) FROM users u
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN user_departments ud ON u.id = ud.user_id
     WHERE ${where}`,
    params
  );

  const result = await query(
    `SELECT DISTINCT u.id, u.matricule, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
            u.email, u.phone, u.speciality, u.grade, u.is_active, u.is_on_leave, u.avatar_url,
            u.last_login, u.created_at,
            r.code AS role_code, r.name AS role_name, r.name_ar AS role_name_ar, r.level AS role_level
     FROM users u
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN user_departments ud ON u.id = ud.user_id
     WHERE ${where}
     ORDER BY u.last_name, u.first_name
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  );

  return res.json({
    success: true,
    data: result.rows,
    pagination: {
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
    },
  });
};

// GET /api/users/:id
const getUser = async (req, res) => {
  const eid = req.user.isSuperAdmin ? null : req.user.establishmentId;
  const result = await query(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.name_ar AS role_name_ar,
            e.name AS establishment_name
     FROM users u
     JOIN roles r ON u.role_id = r.id
     JOIN establishments e ON u.establishment_id = e.id
     WHERE u.id = $1 ${eid ? 'AND u.establishment_id = $2' : ''}`,
    eid ? [req.params.id, eid] : [req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  const depts = await query(
    `SELECT d.id, d.name, d.name_ar, d.code, ud.is_head, ud.is_primary
     FROM departments d JOIN user_departments ud ON d.id = ud.department_id
     WHERE ud.user_id = $1`,
    [req.params.id]
  );

  return res.json({ success: true, data: { ...result.rows[0], departments: depts.rows } });
};

// POST /api/users
const createUser = async (req, res) => {
  const {
    email, password, firstName, lastName, firstNameAr, lastNameAr,
    matricule, phone, speciality, grade, roleId, establishmentId, preferredLanguage
  } = req.body;

  const eid = req.user.isSuperAdmin ? establishmentId : req.user.establishmentId;

  const passwordHash = await bcrypt.hash(password || 'GardeSante@2025', 10);

  const result = await query(
    `INSERT INTO users (establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar,
                        email, phone, password_hash, speciality, grade, preferred_language)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, email, first_name, last_name, matricule, created_at`,
    [eid, roleId, matricule, firstName, lastName, firstNameAr, lastNameAr,
     email, phone, passwordHash, speciality, grade, preferredLanguage || 'fr']
  );

  return res.status(201).json({ success: true, data: result.rows[0], message: 'Utilisateur créé avec succès' });
};

// PUT /api/users/:id
const updateUser = async (req, res) => {
  const { firstName, lastName, firstNameAr, lastNameAr, phone, speciality, grade, roleId, isActive, isOnLeave, preferredLanguage } = req.body;

  const result = await query(
    `UPDATE users SET
       first_name = COALESCE($1, first_name),
       last_name = COALESCE($2, last_name),
       first_name_ar = COALESCE($3, first_name_ar),
       last_name_ar = COALESCE($4, last_name_ar),
       phone = COALESCE($5, phone),
       speciality = COALESCE($6, speciality),
       grade = COALESCE($7, grade),
       role_id = COALESCE($8, role_id),
       is_active = COALESCE($9, is_active),
       is_on_leave = COALESCE($10, is_on_leave),
       preferred_language = COALESCE($11, preferred_language),
       updated_at = NOW()
     WHERE id = $12 RETURNING id, email, first_name, last_name, updated_at`,
    [firstName, lastName, firstNameAr, lastNameAr, phone, speciality, grade, roleId, isActive, isOnLeave, preferredLanguage, req.params.id]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  return res.json({ success: true, data: result.rows[0], message: 'Utilisateur mis à jour' });
};

// DELETE /api/users/:id
const deleteUser = async (req, res) => {
  // Soft delete
  await query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [req.params.id]);
  return res.json({ success: true, message: 'Utilisateur désactivé' });
};

// GET /api/users/:id/shifts
const getUserShifts = async (req, res) => {
  const { from, to, status } = req.query;
  let conditions = ['s.user_id = $1'];
  let params = [req.params.id];
  let idx = 2;

  if (from) { conditions.push(`s.shift_date >= $${idx}`); params.push(from); idx++; }
  if (to) { conditions.push(`s.shift_date <= $${idx}`); params.push(to); idx++; }
  if (status) { conditions.push(`s.status = $${idx}`); params.push(status); idx++; }

  const result = await query(
    `SELECT s.*, st.name AS shift_type_name, st.color, st.duration_hours, st.start_time, st.end_time,
            d.name AS department_name, sch.name AS schedule_name
     FROM shifts s
     JOIN shift_types st ON s.shift_type_id = st.id
     JOIN departments d ON s.department_id = d.id
     JOIN schedules sch ON s.schedule_id = sch.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.shift_date DESC`,
    params
  );

  return res.json({ success: true, data: result.rows });
};

// GET /api/users/:id/stats
const getUserStats = async (req, res) => {
  const { year = new Date().getFullYear(), month } = req.query;

  let dateFilter = `EXTRACT(YEAR FROM s.shift_date) = $2`;
  let params = [req.params.id, year];
  if (month) { dateFilter += ` AND EXTRACT(MONTH FROM s.shift_date) = $3`; params.push(month); }

  const result = await query(
    `SELECT
       COUNT(*) FILTER (WHERE s.status NOT IN ('cancelled')) AS total_shifts,
       COUNT(*) FILTER (WHERE s.status = 'completed') AS completed,
       COUNT(*) FILTER (WHERE s.status = 'absent') AS absent,
       COUNT(*) FILTER (WHERE s.status = 'replaced') AS replaced,
       SUM(st.duration_hours) FILTER (WHERE s.status IN ('completed','confirmed','planned')) AS total_hours,
       COUNT(*) FILTER (WHERE s.is_extra = TRUE) AS extra_shifts
     FROM shifts s
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.user_id = $1 AND ${dateFilter}`,
    params
  );

  return res.json({ success: true, data: result.rows[0] });
};

module.exports = { getUsers, getUser, createUser, updateUser, deleteUser, getUserShifts, getUserStats };
