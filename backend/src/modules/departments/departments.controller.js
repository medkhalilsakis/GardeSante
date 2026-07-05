const { query } = require('../../config/database');

// GET /api/departments
const getDepartments = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const result = await query(
    `SELECT d.*, 
            COUNT(DISTINCT ud.user_id) AS member_count,
            parent.name AS parent_name
     FROM departments d
     LEFT JOIN user_departments ud ON d.id = ud.department_id
     LEFT JOIN departments parent ON d.parent_id = parent.id
     WHERE d.establishment_id = $1 AND d.is_active = TRUE
     GROUP BY d.id, parent.name
     ORDER BY d.name`,
    [eid]
  );
  return res.json({ success: true, data: result.rows });
};

// GET /api/departments/:id
const getDepartment = async (req, res) => {
  const result = await query(
    `SELECT d.*, COUNT(DISTINCT ud.user_id) AS member_count
     FROM departments d LEFT JOIN user_departments ud ON d.id = ud.department_id
     WHERE d.id = $1 GROUP BY d.id`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Service introuvable' });

  const members = await query(
    `SELECT u.id, u.first_name, u.last_name, u.speciality, u.grade, u.avatar_url,
            r.code AS role_code, r.name AS role_name, ud.is_head, ud.is_primary
     FROM users u
     JOIN roles r ON u.role_id = r.id
     JOIN user_departments ud ON u.id = ud.user_id
     WHERE ud.department_id = $1 AND u.is_active = TRUE
     ORDER BY ud.is_head DESC, u.last_name`,
    [req.params.id]
  );

  return res.json({ success: true, data: { ...result.rows[0], members: members.rows } });
};

// POST /api/departments
const createDepartment = async (req, res) => {
  const { code, name, nameAr, floor, phone, parentId } = req.body;
  const eid = req.user.isSuperAdmin ? (req.body.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  const result = await query(
    `INSERT INTO departments (establishment_id, code, name, name_ar, floor, phone, parent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eid, code, name, nameAr, floor, phone, parentId || null]
  );
  return res.status(201).json({ success: true, data: result.rows[0] });
};

// PUT /api/departments/:id
const updateDepartment = async (req, res) => {
  const { name, nameAr, floor, phone, isActive, parentId } = req.body;
  const result = await query(
    `UPDATE departments SET
       name = COALESCE($1, name), name_ar = COALESCE($2, name_ar),
       floor = COALESCE($3, floor), phone = COALESCE($4, phone),
       is_active = COALESCE($5, is_active), parent_id = COALESCE($6, parent_id)
     WHERE id = $7 RETURNING *`,
    [name, nameAr, floor, phone, isActive, parentId, req.params.id]
  );
  return res.json({ success: true, data: result.rows[0] });
};

// POST /api/departments/:id/members
const addMember = async (req, res) => {
  const { userId, isHead, isPrimary } = req.body;
  await query(
    `INSERT INTO user_departments (user_id, department_id, is_head, is_primary)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, department_id) DO UPDATE SET is_head = $3, is_primary = $4`,
    [userId, req.params.id, isHead || false, isPrimary !== false]
  );
  return res.json({ success: true, message: 'Membre ajouté au service' });
};

// DELETE /api/departments/:id/members/:userId
const removeMember = async (req, res) => {
  await query('DELETE FROM user_departments WHERE user_id = $1 AND department_id = $2', [req.params.userId, req.params.id]);
  return res.json({ success: true, message: 'Membre retiré du service' });
};

module.exports = { getDepartments, getDepartment, createDepartment, updateDepartment, addMember, removeMember };
