const { query, transaction } = require('../../config/database');

// GET /api/departments
const getDepartments = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const result = await query(
    `SELECT d.*,
            COUNT(DISTINCT ud.user_id) FILTER (WHERE u.is_active = TRUE) AS member_count,
            parent.name AS parent_name,
            -- Chef de service (is_head = TRUE)
            head_user.id         AS head_id,
            head_user.first_name AS head_first_name,
            head_user.last_name  AS head_last_name,
            head_role.code       AS head_role_code,
            -- Surveillant du service (role service_supervisor dans ce dept)
            surv.id              AS supervisor_id,
            surv.first_name      AS supervisor_first_name,
            surv.last_name       AS supervisor_last_name
     FROM departments d
     LEFT JOIN user_departments ud ON d.id = ud.department_id
     LEFT JOIN users u ON ud.user_id = u.id
     LEFT JOIN departments parent ON d.parent_id = parent.id
     -- Chef (is_head = TRUE)
     LEFT JOIN user_departments ud_head ON d.id = ud_head.department_id AND ud_head.is_head = TRUE
     LEFT JOIN users head_user ON ud_head.user_id = head_user.id AND head_user.is_active = TRUE
     LEFT JOIN roles head_role ON head_user.role_id = head_role.id
     -- Surveillant (role service_supervisor affecte a ce dept)
     LEFT JOIN (
       SELECT ud2.department_id, u2.id, u2.first_name, u2.last_name
       FROM user_departments ud2
       JOIN users u2 ON ud2.user_id = u2.id
       JOIN roles r2 ON u2.role_id = r2.id
       WHERE r2.code = 'service_supervisor' AND u2.is_active = TRUE
     ) surv ON surv.department_id = d.id
     WHERE d.establishment_id = $1 AND d.is_active = TRUE
     GROUP BY d.id, parent.name, head_user.id, head_user.first_name, head_user.last_name, head_role.code,
              surv.id, surv.first_name, surv.last_name
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
    `SELECT u.id, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
            u.speciality, u.grade, u.avatar_url, u.email, u.is_active, u.can_login,
            r.code AS role_code, r.name AS role_name, ud.is_head, ud.is_primary, ud.joined_at
     FROM users u
     JOIN roles r ON u.role_id = r.id
     JOIN user_departments ud ON u.id = ud.user_id
     WHERE ud.department_id = $1
     ORDER BY ud.is_head DESC, r.level, u.last_name`,
    [req.params.id]
  );

  return res.json({ success: true, data: { ...result.rows[0], members: members.rows } });
};

// POST /api/departments
const createDepartment = async (req, res) => {
  const { code, name, nameAr, departmentType, floor, wing, phone, bedCount, minGuardCount, parentId } = req.body;
  const eid = req.user.isSuperAdmin ? (req.body.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Seul le directeur peut creer des services' });
  }

  const result = await query(
    `INSERT INTO departments (establishment_id, code, name, name_ar, department_type, floor, wing, phone, bed_count, min_guard_count, parent_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [eid, code.toUpperCase(), name, nameAr, departmentType || 'other', floor, wing, phone, bedCount, minGuardCount || 1, parentId || null]
  );
  return res.status(201).json({ success: true, data: result.rows[0] });
};

// PUT /api/departments/:id
const updateDepartment = async (req, res) => {
  const { name, nameAr, departmentType, floor, wing, phone, bedCount, minGuardCount, isActive, parentId } = req.body;

  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Seul le directeur peut modifier des services' });
  }

  const result = await query(
    `UPDATE departments SET
       name             = COALESCE($1, name),
       name_ar          = COALESCE($2, name_ar),
       department_type  = COALESCE($3, department_type),
       floor            = COALESCE($4, floor),
       wing             = COALESCE($5, wing),
       phone            = COALESCE($6, phone),
       bed_count        = COALESCE($7, bed_count),
       min_guard_count  = COALESCE($8, min_guard_count),
       is_active        = COALESCE($9, is_active),
       parent_id        = COALESCE($10, parent_id)
     WHERE id = $11 AND establishment_id = $12 RETURNING *`,
    [name, nameAr, departmentType, floor, wing, phone, bedCount, minGuardCount, isActive, parentId, req.params.id, req.user.establishmentId]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Service introuvable' });
  return res.json({ success: true, data: result.rows[0] });
};

// DELETE /api/departments/:id
const deleteDepartment = async (req, res) => {
  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Seul le directeur peut supprimer des services' });
  }

  const activeShifts = await query(
    `SELECT COUNT(*) FROM shifts
     WHERE department_id = $1 AND status IN ('planned','confirmed')
       AND shift_date >= CURRENT_DATE`,
    [req.params.id]
  );
  if (parseInt(activeShifts.rows[0].count) > 0) {
    return res.status(409).json({
      success: false,
      message: 'Impossible de supprimer : ce service a des gardes planifiees actives.',
    });
  }

  await query(
    `UPDATE departments SET is_active = FALSE WHERE id = $1 AND establishment_id = $2`,
    [req.params.id, req.user.establishmentId]
  );
  return res.json({ success: true, message: 'Service desactive avec succes' });
};

// PUT /api/departments/:id/head â€” Designer le chef de service
const setDepartmentHead = async (req, res) => {
  const { userId } = req.body;
  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }

  await transaction(async (client) => {
    // Retirer le statut chef de l'ancien chef
    await client.query(
      `UPDATE user_departments SET is_head = FALSE WHERE department_id = $1`,
      [req.params.id]
    );
    // Affecter le nouveau chef
    if (userId) {
      await client.query(
        `INSERT INTO user_departments (user_id, department_id, is_head, is_primary)
         VALUES ($1, $2, TRUE, TRUE)
         ON CONFLICT (user_id, department_id) DO UPDATE SET is_head = TRUE`,
        [userId, req.params.id]
      );
      // S'assurer que le role est department_head
      const roleRes = await client.query(
        `SELECT id FROM roles WHERE establishment_id = $1 AND code = 'department_head'`,
        [req.user.establishmentId]
      );
      if (roleRes.rows[0]) {
        await client.query(
          `UPDATE users SET role_id = $1 WHERE id = $2`,
          [roleRes.rows[0].id, userId]
        );
      }
    }
  });

  return res.json({ success: true, message: 'Chef de service designe avec succes' });
};

// PUT /api/departments/:id/supervisor â€” Designer le surveillant du service
// Regles : un seul surveillant par service. Remplace l'ancien automatiquement.
const setDepartmentSupervisor = async (req, res) => {
  const { userId } = req.body;
  if (!['director', 'hospital_admin', 'super_admin', 'general_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }

  await transaction(async (client) => {
    // Trouver l'ancien surveillant de ce service et lui retirer son role
    const oldSuperv = await client.query(
      `SELECT u.id FROM user_departments ud
       JOIN users u ON ud.user_id = u.id
       JOIN roles r ON u.role_id = r.id
       WHERE ud.department_id = $1 AND r.code = 'service_supervisor' AND u.is_active = TRUE`,
      [req.params.id]
    );

    if (oldSuperv.rows.length > 0 && oldSuperv.rows[0].id !== userId) {
      // Recuperer un role "neutre" de repli (senior_doctor par defaut)
      const fallbackRole = await client.query(
        `SELECT id FROM roles WHERE establishment_id = $1 AND code = 'senior_doctor' LIMIT 1`,
        [req.user.establishmentId]
      );
      if (fallbackRole.rows[0]) {
        await client.query(
          `UPDATE users SET role_id = $1 WHERE id = $2`,
          [fallbackRole.rows[0].id, oldSuperv.rows[0].id]
        );
      }
    }

    if (userId) {
      await client.query(
        `INSERT INTO user_departments (user_id, department_id, is_head, is_primary)
         VALUES ($1, $2, FALSE, TRUE)
         ON CONFLICT (user_id, department_id) DO UPDATE SET is_primary = TRUE`,
        [userId, req.params.id]
      );
      // Assigner role service_supervisor
      const roleRes = await client.query(
        `SELECT id FROM roles WHERE establishment_id = $1 AND code = 'service_supervisor'`,
        [req.user.establishmentId]
      );
      if (roleRes.rows[0]) {
        await client.query(
          `UPDATE users SET role_id = $1 WHERE id = $2`,
          [roleRes.rows[0].id, userId]
        );
      }
    }
  });

  return res.json({ success: true, message: 'Surveillant de service designe avec succes' });
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
  return res.json({ success: true, message: 'Membre ajoute au service' });
};

// DELETE /api/departments/:id/members/:userId
const removeMember = async (req, res) => {
  await query('DELETE FROM user_departments WHERE user_id = $1 AND department_id = $2', [req.params.userId, req.params.id]);
  return res.json({ success: true, message: 'Membre retire du service' });
};

// Appele depuis establishments.controller lors de la creation d'un etablissement
const initEstablishmentDefaults = require('../schedules/rules-engine').initEstablishmentDefaults;

module.exports = {
  getDepartments, getDepartment,
  createDepartment, updateDepartment, deleteDepartment,
  setDepartmentHead, setDepartmentSupervisor,
  addMember, removeMember,
};
