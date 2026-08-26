const { query, transaction } = require('../../config/database');
// Garde-fou : les rôles transversaux à l'hôpital (surveillant général) ne
// peuvent pas être rattachés à un service. Voir hospital-wide-roles.js.
const { checkDepartmentMembership, REFUSAL: NO_DEPT_REFUSAL } = require('./hospital-wide-roles');

// Les routes de détail et de rattachement reçoivent un UUID de service dans
// l'URL. Pour un acteur normal, la portée est toujours son établissement ; le
// super admin conserve sa portée plateforme. Les contrôles ci-dessous utilisent
// ensuite l'établissement réellement porté par le service, jamais un UUID
// fourni librement par le client.
const scopedEstablishmentId = (req) => (req.user.isSuperAdmin ? null : req.user.establishmentId);

// GET /api/departments
// `?head=<userId>` restreint la liste aux services dont cet utilisateur est chef.
// Sans ce filtre le chef de service pouvait se retrouver positionné par défaut
// sur un service qui n'est pas le sien, et n'y plus retrouver ses plannings.
const getDepartments = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const headId = req.query.head || null;

  // Un seul chef par service, mais plusieurs surveillants possibles : les
  // surveillants sont agrégés en tableau pour ne pas dupliquer la ligne du
  // service. `supervisor_*` reste renseigné avec le premier, pour compatibilité.
  const build = (headFilter) => `
     SELECT d.*,
            (SELECT COUNT(*) FROM user_departments udc
               JOIN users uc ON uc.id = udc.user_id
              WHERE udc.department_id = d.id AND uc.is_active = TRUE) AS member_count,
            parent.name AS parent_name,
            head.id         AS head_id,
            head.first_name AS head_first_name,
            head.last_name  AS head_last_name,
            head.role_code  AS head_role_code,
            surv.first_id         AS supervisor_id,
            surv.first_first_name AS supervisor_first_name,
            surv.first_last_name  AS supervisor_last_name,
            COALESCE(surv.list, '[]'::json) AS supervisors,
            COALESCE(surv.cnt, 0)           AS supervisor_count
       FROM departments d
       LEFT JOIN departments parent ON d.parent_id = parent.id
       LEFT JOIN LATERAL (
         SELECT hu.id, hu.first_name, hu.last_name, hr.code AS role_code
           FROM user_departments udh
           JOIN users hu ON hu.id = udh.user_id AND hu.is_active = TRUE
           LEFT JOIN roles hr ON hr.id = hu.role_id
          WHERE udh.department_id = d.id AND udh.is_head = TRUE
          LIMIT 1
       ) head ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'id', s.id, 'firstName', s.first_name, 'lastName', s.last_name
                ) ORDER BY s.last_name, s.first_name)          AS list,
                (array_agg(s.id         ORDER BY s.last_name, s.first_name))[1] AS first_id,
                (array_agg(s.first_name ORDER BY s.last_name, s.first_name))[1] AS first_first_name,
                (array_agg(s.last_name  ORDER BY s.last_name, s.first_name))[1] AS first_last_name,
                COUNT(*)                                        AS cnt
           FROM user_departments uds
           JOIN users s ON s.id = uds.user_id AND s.is_active = TRUE
           JOIN roles rs ON rs.id = s.role_id
          WHERE uds.department_id = d.id AND rs.code = 'service_supervisor'
       ) surv ON TRUE
      WHERE d.establishment_id = $1 AND d.is_active = TRUE
      ${headFilter}
      ORDER BY d.name`;

  let result;
  if (headId) {
    result = await query(
      build(`AND EXISTS (SELECT 1 FROM user_departments uf
                          WHERE uf.department_id = d.id AND uf.user_id = $2 AND uf.is_head = TRUE)`),
      [eid, headId]
    );
    // Repli : un chef sans `is_head` verrait une liste vide et ne pourrait plus
    // rien créer. On retombe sur ses services d'appartenance, puis sur tout.
    if (result.rows.length === 0) {
      result = await query(
        build(`AND EXISTS (SELECT 1 FROM user_departments uf
                            WHERE uf.department_id = d.id AND uf.user_id = $2)`),
        [eid, headId]
      );
    }
    if (result.rows.length === 0) result = await query(build(''), [eid]);
  } else {
    result = await query(build(''), [eid]);
  }

  return res.json({ success: true, data: result.rows });
};

// GET /api/departments/:id
const getDepartment = async (req, res) => {
  // `member_count` ne compte que les agents **actifs**, comme la liste le fait
  // déjà plus haut (`:21`). Sans le filtre, un service dont un agent a été
  // archivé annonçait un effectif supérieur à la liste `members` affichée juste
  // à côté — et le KPI « Personnel » du tableau de bord du chef, qui lit ce
  // champ, dépassait le nombre de lignes réellement présentes.
  const scopeId = scopedEstablishmentId(req);
  const result = await query(
    `SELECT d.*, COUNT(DISTINCT ud.user_id) FILTER (WHERE u.is_active = TRUE) AS member_count
      FROM departments d
      LEFT JOIN user_departments ud ON d.id = ud.department_id
      LEFT JOIN users u ON u.id = ud.user_id
      WHERE d.id = $1 ${scopeId ? 'AND d.establishment_id = $2' : ''} GROUP BY d.id`,
    scopeId ? [req.params.id, scopeId] : [req.params.id]
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

  const members = await query(
    `SELECT COUNT(*) FROM user_departments ud
      JOIN users u ON u.id = ud.user_id AND u.is_active = TRUE
     WHERE ud.department_id = $1`, [req.params.id]
  );
  if (parseInt(members.rows[0].count) > 0) {
    return res.status(409).json({
      success: false,
      code: 'DEPARTMENT_HAS_MEMBERS',
      memberCount: parseInt(members.rows[0].count),
      message: 'Ce service contient encore du personnel. Migrez tout le personnel vers un autre service avant sa désactivation.',
    });
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

// POST /api/departments/:id/migrate-and-deactivate
const migrateAndDeactivateDepartment = async (req, res) => {
  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Seul le directeur peut migrer et désactiver un service' });
  }
  const { targetDepartmentId } = req.body;
  if (!targetDepartmentId || targetDepartmentId === req.params.id) {
    return res.status(400).json({ success: false, message: 'Choisissez un autre service de destination.' });
  }

  const eid = req.user.establishmentId;
  const result = await transaction(async (client) => {
    const departments = await client.query(
      `SELECT id, name, is_active FROM departments
       WHERE establishment_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
      [eid, [req.params.id, targetDepartmentId]]
    );
    const source = departments.rows.find((d) => d.id === req.params.id);
    const target = departments.rows.find((d) => d.id === targetDepartmentId);
    if (!source) return { error: 404, message: 'Service source introuvable.' };
    if (!target || !target.is_active) return { error: 400, message: 'Le service de destination est invalide ou inactif.' };

    const activeShifts = await client.query(
      `SELECT COUNT(*) FROM shifts WHERE department_id = $1
       AND status IN ('planned','confirmed') AND shift_date >= CURRENT_DATE`, [source.id]
    );
    if (parseInt(activeShifts.rows[0].count) > 0) {
      return { error: 409, message: 'Ce service possède encore des gardes planifiées actives. Migrez ou terminez-les avant la désactivation.' };
    }

    const moved = await client.query(
      `INSERT INTO user_departments (user_id, department_id, is_head, is_primary)
       SELECT user_id, $2, FALSE, is_primary FROM user_departments WHERE department_id = $1
       ON CONFLICT (user_id, department_id) DO UPDATE
       SET is_primary = user_departments.is_primary OR EXCLUDED.is_primary
       RETURNING user_id`, [source.id, target.id]
    );
    await client.query('DELETE FROM user_departments WHERE department_id = $1', [source.id]);
    await client.query('UPDATE departments SET is_active = FALSE WHERE id = $1', [source.id]);
    return { moved: moved.rowCount, source: source.name, target: target.name };
  });

  if (result.error) return res.status(result.error).json({ success: false, message: result.message });
  return res.json({ success: true, data: result, message: `${result.moved} personnel(s) migré(s) vers ${result.target}. Service désactivé.` });
};

// PUT /api/departments/:id/head â€” Designer le chef de service
const setDepartmentHead = async (req, res) => {
  const { userId } = req.body;
  if (!['director', 'hospital_admin', 'super_admin'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }

  const membership = await checkDepartmentMembership(userId);
  if (!membership.allowed) return res.status(400).json(NO_DEPT_REFUSAL);

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

// PUT /api/departments/:id/supervisor â€” Designer un surveillant du service
// Regles : un service n'a qu'UN SEUL chef, mais peut avoir PLUSIEURS
// surveillants. Designer un nouveau surveillant AJOUTE donc la personne sans
// retirer son role a qui que ce soit.
// Cas particulier conserve : appeler la route sans `userId` retire le role a
// tous les surveillants actuels (« vider la liste »), comme avant.
const setDepartmentSupervisor = async (req, res) => {
  const { userId } = req.body;
  if (!['director', 'hospital_admin', 'super_admin', 'general_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }

  // Un surveillant général ne devient pas surveillant d'un service : sa portée
  // est l'hôpital entier. Le cas `!userId` (vider la liste) n'est pas concerné.
  const membership = await checkDepartmentMembership(userId);
  if (!membership.allowed) return res.status(400).json(NO_DEPT_REFUSAL);

  await transaction(async (client) => {
    if (!userId) {
      // Aucun destinataire : on retire le role a tous les surveillants du service.
      const current = await client.query(
        `SELECT u.id FROM user_departments ud
         JOIN users u ON ud.user_id = u.id
         JOIN roles r ON u.role_id = r.id
         WHERE ud.department_id = $1 AND r.code = 'service_supervisor' AND u.is_active = TRUE`,
        [req.params.id]
      );
      if (current.rows.length > 0) {
        const fallbackRole = await client.query(
          `SELECT id FROM roles WHERE establishment_id = $1 AND code = 'senior_doctor' LIMIT 1`,
          [req.user.establishmentId]
        );
        if (fallbackRole.rows[0]) {
          await client.query(
            `UPDATE users SET role_id = $1 WHERE id = ANY($2::uuid[])`,
            [fallbackRole.rows[0].id, current.rows.map(r => r.id)]
          );
        }
      }
      return;
    }

    await client.query(
      `INSERT INTO user_departments (user_id, department_id, is_head, is_primary)
       VALUES ($1, $2, FALSE, TRUE)
       ON CONFLICT (user_id, department_id) DO UPDATE SET is_primary = TRUE`,
      [userId, req.params.id]
    );
    // Assigner role service_supervisor (les autres surveillants gardent le leur)
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
  });

  return res.json({ success: true, message: 'Surveillant de service designe avec succes' });
};

// DELETE /api/departments/:id/supervisor/:userId â€” Retirer UN surveillant
// Retire uniquement la personne visee ; les autres surveillants du service
// conservent leur role. Le compte n'est ni supprime ni desactive : il retrouve
// simplement un role metier neutre (medecin senior).
const removeDepartmentSupervisor = async (req, res) => {
  if (!['director', 'hospital_admin', 'super_admin', 'general_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }

  const current = await query(
    `SELECT u.id FROM user_departments ud
     JOIN users u ON ud.user_id = u.id
     JOIN roles r ON u.role_id = r.id
     WHERE ud.department_id = $1 AND ud.user_id = $2 AND r.code = 'service_supervisor'`,
    [req.params.id, req.params.userId]
  );
  if (!current.rows[0]) {
    return res.status(404).json({ success: false, message: 'Cette personne n\'est pas surveillant de ce service.' });
  }

  const fallbackRole = await query(
    `SELECT id FROM roles WHERE establishment_id = $1 AND code = 'senior_doctor' LIMIT 1`,
    [req.user.establishmentId]
  );
  if (!fallbackRole.rows[0]) {
    return res.status(409).json({ success: false, message: 'Aucun role de repli disponible pour cet etablissement.' });
  }
  await query('UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2',
    [fallbackRole.rows[0].id, req.params.userId]);

  return res.json({ success: true, message: 'Surveillant retire du service' });
};

// POST /api/departments/:id/members
const addMember = async (req, res) => {
  const { userId, isHead, isPrimary } = req.body;

  // Seul garde-fou de cette route : elle insère directement ce que porte le
  // corps de la requête, c'est donc la porte d'entrée la plus exposée pour un
  // rattachement interdit.
  const membership = await checkDepartmentMembership(userId);
  if (!membership.allowed) return res.status(400).json(NO_DEPT_REFUSAL);

  const target = await query(
    `SELECT d.establishment_id AS department_establishment_id,
            u.establishment_id AS user_establishment_id
       FROM departments d
       LEFT JOIN users u ON u.id = $2
      WHERE d.id = $1`,
    [req.params.id, userId]
  );
  if (!target.rows[0]) return res.status(404).json({ success: false, message: 'Service introuvable' });
  if (!target.rows[0].user_establishment_id) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  if (target.rows[0].department_establishment_id !== target.rows[0].user_establishment_id) {
    return res.status(400).json({ success: false, message: 'Le personnel doit appartenir au même établissement que le service.' });
  }
  if (!req.user.isSuperAdmin && target.rows[0].department_establishment_id !== req.user.establishmentId) {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }

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
  const target = await query(
    `SELECT d.establishment_id AS department_establishment_id,
            u.establishment_id AS user_establishment_id
       FROM departments d
       LEFT JOIN users u ON u.id = $2
      WHERE d.id = $1`,
    [req.params.id, req.params.userId]
  );
  if (!target.rows[0]) return res.status(404).json({ success: false, message: 'Service introuvable' });
  if (!target.rows[0].user_establishment_id) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  if (target.rows[0].department_establishment_id !== target.rows[0].user_establishment_id) {
    return res.status(400).json({ success: false, message: 'Le personnel doit appartenir au même établissement que le service.' });
  }
  if (!req.user.isSuperAdmin && target.rows[0].department_establishment_id !== req.user.establishmentId) {
    return res.status(403).json({ success: false, message: 'Accès refusé' });
  }
  await query('DELETE FROM user_departments WHERE user_id = $1 AND department_id = $2', [req.params.userId, req.params.id]);
  return res.json({ success: true, message: 'Membre retire du service' });
};

// Appele depuis establishments.controller lors de la creation d'un etablissement
const initEstablishmentDefaults = require('../schedules/rules-engine').initEstablishmentDefaults;

module.exports = {
  getDepartments, getDepartment,
  createDepartment, updateDepartment, deleteDepartment, migrateAndDeactivateDepartment,
  setDepartmentHead, setDepartmentSupervisor, removeDepartmentSupervisor,
  addMember, removeMember,
};
