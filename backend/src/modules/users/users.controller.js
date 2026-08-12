const { query, transaction } = require('../../config/database');
const bcrypt = require('bcryptjs');
const { CARE_CATEGORIES } = require('../../config/personnel-categories');
// Garde-fou : les rôles transversaux à l'hôpital (surveillant général)
// n'appartiennent à aucun service. Voir departments/hospital-wide-roles.js.
const { isHospitalWideRole, REFUSAL: NO_DEPT_REFUSAL } = require('../departments/hospital-wide-roles');

// -────────────────────────────────────────────────────────────
// Hierarchie STRICTE de creation de comptes :
//   super_admin          -> director
//   director             -> general_supervisor, department_head,
//                          service_supervisor, senior_doctor,
//                          resident, autre
//   general_supervisor   -> department_head, service_supervisor
//   department_head      -> senior_doctor, resident, autre
// Note: 'autre' = personnel sans acces plateforme (ambulancier,
//        gardiennage, recette, etc.) identifie par job_title_id
// -────────────────────────────────────────────────────────────

const CREATABLE_ROLES = {
  super_admin:        ['director'],
  director:           ['general_supervisor', 'department_head', 'service_supervisor', 'senior_doctor', 'resident', 'autre'],
  general_supervisor: ['department_head', 'service_supervisor'],
  department_head:    ['senior_doctor', 'resident', 'autre'],
};

// Roles sans acces plateforme (can_login = FALSE)
const NO_LOGIN_ROLES = ['senior_doctor', 'resident', 'autre'];

// Roles qui DOIVENT etre associes a un service unique
const ROLES_REQUIRING_DEPT = ['department_head', 'service_supervisor', 'senior_doctor', 'resident'];

// -────────────────────────────────────────────────────────────
// « Chef de service » est un TITRE, pas un metier.
// Le role plateforme reste `department_head` (toutes les
// permissions en dependent), et le metier reel de la personne
// est porte par un role secondaire OPTIONNEL : un chef de
// service peut etre medecin senior, resident, etc.
// Le role secondaire est purement descriptif : il n'ouvre
// aucun droit supplementaire.
// -────────────────────────────────────────────────────────────
const TITLE_ROLES = ['department_head'];
const SECONDARY_ROLE_CODES = ['senior_doctor', 'resident', 'autre'];

/**
 * Resout le code du role secondaire en UUID.
 * Retourne { error } si invalide, { id } sinon (id peut etre null pour « aucun »).
 */
const resolveSecondaryRole = async (secondaryRoleCode, primaryRoleCode, eid) => {
  if (!secondaryRoleCode) return { id: null };

  if (!TITLE_ROLES.includes(primaryRoleCode)) {
    return { error: 'Un role secondaire ne peut etre associe qu\'au titre « Chef de service ».' };
  }
  if (secondaryRoleCode === primaryRoleCode) {
    return { error: 'Le role secondaire doit etre different du role principal.' };
  }
  if (!SECONDARY_ROLE_CODES.includes(secondaryRoleCode)) {
    return { error: `Role secondaire "${secondaryRoleCode}" non autorise. Valeurs possibles : ${SECONDARY_ROLE_CODES.join(', ')}.` };
  }

  const r = await query(
    'SELECT id FROM roles WHERE establishment_id = $1 AND code = $2',
    [eid, secondaryRoleCode]
  );
  if (!r.rows[0]) return { error: `Role secondaire "${secondaryRoleCode}" introuvable pour cet etablissement.` };
  return { id: r.rows[0].id };
};

// Services d'un agent, agreges en JSONB (jsonb et non json : le `SELECT
// DISTINCT` de getUsers a besoin d'un operateur d'egalite, que `json` n'a pas).
const DEPARTMENTS_JSON = `
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', d2.id, 'name', d2.name, 'nameAr', d2.name_ar, 'code', d2.code,
             'isHead', ud2.is_head, 'isPrimary', ud2.is_primary
           ) ORDER BY ud2.is_primary DESC, d2.name)
      FROM user_departments ud2
      JOIN departments d2 ON d2.id = ud2.department_id
     WHERE ud2.user_id = u.id
  ), '[]'::jsonb) AS departments`;


// GET /api/users
const getUsers = async (req, res) => {
  const { page = 1, limit = 20, search, roleCode, departmentId, isActive, canLogin } = req.query;
  const offset = (page - 1) * limit;
  const eid = req.user.isSuperAdmin
    ? (req.query.establishmentId || req.user.establishmentId)
    : req.user.establishmentId;

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
  if (canLogin !== undefined) {
    conditions.push(`u.can_login = $${idx}`); params.push(canLogin === 'true'); idx++;
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
            u.can_login, u.last_login, u.created_at,
            r.code AS role_code, r.name AS role_name, r.name_ar AS role_name_ar, r.level AS role_level,
            r2.code AS secondary_role_code, r2.name AS secondary_role_name, r2.name_ar AS secondary_role_name_ar,
            jt.id AS job_title_id, jt.name AS job_title, jt.category AS personnel_category, jt.category_label AS personnel_category_label,
            e.name AS establishment_name,
            ${DEPARTMENTS_JSON}
     FROM users u
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN roles r2 ON r2.id = u.secondary_role_id
     JOIN establishments e ON u.establishment_id = e.id
     LEFT JOIN job_titles jt ON jt.id = u.job_title_id
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
            r2.code AS secondary_role_code, r2.name AS secondary_role_name, r2.name_ar AS secondary_role_name_ar,
            e.name AS establishment_name, e.code AS establishment_code
     FROM users u
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN roles r2 ON r2.id = u.secondary_role_id
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

  const { password_hash, refresh_token, password_reset_token, ...safeUser } = result.rows[0];
  return res.json({ success: true, data: { ...safeUser, departments: depts.rows } });
};

// POST /api/users — Creer un compte selon la hierarchie
const createUser = async (req, res) => {
  const {
    email, password, firstName, lastName, firstNameAr, lastNameAr,
    matricule, phone, speciality, grade, roleCode, departmentId, jobTitleId,
    preferredLanguage, establishmentId: bodyEstId, secondaryRoleCode,
  } = req.body;

  if (!email || !firstName || !lastName || !roleCode) {
    return res.status(400).json({ success: false, message: 'Email, prenom, nom et role sont requis' });
  }

  // Verifier la permission de creer ce role
  const allowed = CREATABLE_ROLES[req.user.roleCode] || [];
  if (!req.user.isSuperAdmin && !allowed.includes(roleCode)) {
    return res.status(403).json({
      success: false,
      message: `Votre role (${req.user.roleCode}) ne peut pas creer le role "${roleCode}".`,
    });
  }

  // Determiner l'etablissement cible
  let eid;
  if (req.user.isSuperAdmin) {
    if (!bodyEstId) {
      return res.status(400).json({ success: false, message: 'establishmentId requis pour le Super Admin' });
    }
    eid = bodyEstId;
  } else {
    eid = req.user.establishmentId;
    if (bodyEstId && bodyEstId !== eid) {
      return res.status(403).json({ success: false, message: 'Vous ne pouvez creer des comptes que dans votre etablissement.' });
    }
  }

  // Recuperer l'UUID du role
  const roleResult = await query(
    'SELECT id, code FROM roles WHERE establishment_id = $1 AND code = $2',
    [eid, roleCode]
  );
  if (!roleResult.rows[0]) {
    return res.status(400).json({
      success: false,
      message: `Role "${roleCode}" introuvable pour cet etablissement. Verifiez que l'etablissement a bien ete initialise.`,
    });
  }

  // Le personnel de soins doit toujours appartenir à un service.
  // Le rôle système couvre les médecins sans intitulé; l'intitulé couvre le paramédical.
  let jobTitle = null;
  if (jobTitleId) {
    const titleResult = await query(
      'SELECT id, name, category FROM job_titles WHERE id = $1 AND establishment_id = $2 AND is_active = TRUE',
      [jobTitleId, eid]
    );
    jobTitle = titleResult.rows[0];
    if (!jobTitle) return res.status(400).json({ success: false, message: 'Titre de poste invalide pour cet établissement.' });
  }
  if ((ROLES_REQUIRING_DEPT.includes(roleCode) || CARE_CATEGORIES.has(jobTitle?.category)) && !departmentId) {
    return res.status(400).json({ success: false, message: 'Le personnel médical ou paramédical doit obligatoirement être affecté à un service.' });
  }

  // Role secondaire optionnel (« Chef de service » est un titre : le metier
  // reel est porte a cote). Purement descriptif, aucun droit supplementaire.
  const secondary = await resolveSecondaryRole(secondaryRoleCode, roleCode, eid);
  if (secondary.error) return res.status(400).json({ success: false, message: secondary.error });

  // Quatrieme et dernier site d'ecriture de `user_departments` : le role est
  // deja connu ici (corps de la requete), donc pas besoin d'aller le relire en
  // base comme le fait `checkDepartmentMembership`.
  if (departmentId && isHospitalWideRole(roleCode)) {
    return res.status(400).json(NO_DEPT_REFUSAL);
  }

  // ── Contrainte unicite : un seul chef de service par service ──
  // Les surveillants de service, eux, peuvent etre PLUSIEURS pour un meme
  // service : aucune verification d'unicite n'est faite pour ce role.
  if (departmentId) {
    if (roleCode === 'department_head') {
      const existing = await query(
        `SELECT u.id, u.first_name, u.last_name
         FROM user_departments ud
         JOIN users u ON ud.user_id = u.id
         WHERE ud.department_id = $1 AND ud.is_head = TRUE AND u.is_active = TRUE`,
        [departmentId]
      );
      if (existing.rows.length > 0) {
        const ex = existing.rows[0];
        return res.status(409).json({
          success: false,
          message: `Ce service a deja un chef de service : ${ex.first_name} ${ex.last_name}. Utilisez "Designer Chef de Service" pour le remplacer.`,
        });
      }
    }
  }

  const passwordHash = await bcrypt.hash(password || 'GardeSante@2025', 10);
  const canLogin = !NO_LOGIN_ROLES.includes(roleCode);

  // is_head = TRUE uniquement pour department_head
  const isHead = (roleCode === 'department_head');

  // Derivation du speciality depuis le nom du titre de poste
  // (pour compatibilite avec les vues existantes qui affichent speciality)
  let resolvedSpeciality = speciality || null;
  if (jobTitleId) {
    try {
      if (jobTitle) resolvedSpeciality = jobTitle.name;
    } catch (_) {}
  }

  const result = await transaction(async (client) => {
    const u = await client.query(
      `INSERT INTO users (
         establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar,
         email, phone, password_hash, speciality, grade, preferred_language, can_login, job_title_id,
         secondary_role_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, email, first_name, last_name, matricule, can_login, created_at`,
      [eid, roleResult.rows[0].id, matricule || null, firstName, lastName,
       firstNameAr || null, lastNameAr || null,
       email, phone || null, passwordHash, resolvedSpeciality, grade || null,
       preferredLanguage || 'fr', canLogin, jobTitleId || null, secondary.id]
    );

    if (departmentId) {
      // Securite : retirer l'ancien is_head si on affecte un nouveau chef
      if (isHead) {
        await client.query(
          `UPDATE user_departments SET is_head = FALSE WHERE department_id = $1`,
          [departmentId]
        );
      }
      await client.query(
        `INSERT INTO user_departments (user_id, department_id, is_head, is_primary)
         VALUES ($1,$2,$3,TRUE)
         ON CONFLICT (user_id, department_id) DO UPDATE SET is_head = $3, is_primary = TRUE`,
        [u.rows[0].id, departmentId, isHead]
      );
    }

    return u.rows[0];
  });

  return res.status(201).json({
    success: true,
    data: result,
    message: canLogin
      ? `Compte cree. Email : ${email} - Mot de passe : ${password || 'GardeSante@2025'}`
      : 'Profil medical cree (sans acces plateforme).',
  });
};

// PUT /api/users/:id — Modifier un utilisateur
const updateUser = async (req, res) => {
  const { firstName, lastName, firstNameAr, lastNameAr, phone, speciality, grade, isOnLeave, preferredLanguage } = req.body;

  // Role secondaire optionnel — traite a part pour ne rien changer a la requete
  // existante. Absent du body = on n'y touche pas ; chaine vide / null = on retire.
  if (Object.prototype.hasOwnProperty.call(req.body, 'secondaryRoleCode')) {
    const target = await query(
      `SELECT u.establishment_id, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1`,
      [req.params.id]
    );
    if (!target.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    if (!req.user.isSuperAdmin && target.rows[0].establishment_id !== req.user.establishmentId) {
      return res.status(403).json({ success: false, message: 'Utilisateur hors de votre etablissement.' });
    }

    const secondary = await resolveSecondaryRole(
      req.body.secondaryRoleCode || null, target.rows[0].role_code, target.rows[0].establishment_id
    );
    if (secondary.error) return res.status(400).json({ success: false, message: secondary.error });
    await query('UPDATE users SET secondary_role_id = $1, updated_at = NOW() WHERE id = $2', [secondary.id, req.params.id]);
  }

  const result = await query(
    `UPDATE users SET
       first_name        = COALESCE($1, first_name),
       last_name         = COALESCE($2, last_name),
       first_name_ar     = COALESCE($3, first_name_ar),
       last_name_ar      = COALESCE($4, last_name_ar),
       phone             = COALESCE($5, phone),
       speciality        = COALESCE($6, speciality),
       grade             = COALESCE($7, grade),
       is_on_leave       = COALESCE($8, is_on_leave),
       preferred_language= COALESCE($9, preferred_language),
       updated_at        = NOW()
     WHERE id = $10 AND establishment_id = $11
     RETURNING id, email, first_name, last_name, updated_at`,
    [firstName, lastName, firstNameAr, lastNameAr, phone, speciality, grade,
     isOnLeave, preferredLanguage, req.params.id, req.user.isSuperAdmin ? undefined : req.user.establishmentId]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  return res.json({ success: true, data: result.rows[0], message: 'Utilisateur mis a jour' });
};

// PUT /api/users/:id/deactivate — Cloturer un compte
const deactivateUser = async (req, res) => {
  if (!['director', 'hospital_admin', 'super_admin', 'general_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ success: false, message: 'Vous ne pouvez pas cloturer votre propre compte' });
  }
  await query(
    `UPDATE users SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 AND establishment_id = $2`,
    [req.params.id, req.user.establishmentId]
  );
  return res.json({ success: true, message: 'Compte cloture avec succes' });
};

// PUT /api/users/:id/activate — Reactiver un compte
const activateUser = async (req, res) => {
  if (!['director', 'hospital_admin', 'super_admin', 'general_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }
  await query(
    `UPDATE users SET is_active = TRUE, updated_at = NOW()
     WHERE id = $1 AND establishment_id = $2`,
    [req.params.id, req.user.establishmentId]
  );
  return res.json({ success: true, message: 'Compte reactive avec succes' });
};

// DELETE /api/users/:id — Soft delete (alias deactivate)
const deleteUser = async (req, res) => {
  await query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [req.params.id]);
  return res.json({ success: true, message: 'Utilisateur desactive' });
};

// GET /api/users/:id/shifts
const getUserShifts = async (req, res) => {
  const { from, to, status } = req.query;
  let conditions = ['s.user_id = $1'];
  let params = [req.params.id];
  let idx = 2;

  if (from) { conditions.push(`s.shift_date >= $${idx}`); params.push(from); idx++; }
  if (to)   { conditions.push(`s.shift_date <= $${idx}`); params.push(to);   idx++; }
  if (status){ conditions.push(`s.status = $${idx}`);     params.push(status);idx++; }

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
       COUNT(*) FILTER (WHERE s.status = 'completed')       AS completed,
       COUNT(*) FILTER (WHERE s.status = 'absent')          AS absent,
       COUNT(*) FILTER (WHERE s.status = 'replaced')        AS replaced,
       COALESCE(SUM(st.duration_hours) FILTER (WHERE s.status IN ('completed','confirmed','planned')), 0) AS total_hours,
       COUNT(*) FILTER (WHERE s.is_extra = TRUE)            AS extra_shifts
     FROM shifts s
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.user_id = $1 AND ${dateFilter}`,
    params
  );
  return res.json({ success: true, data: result.rows[0] });
};

// GET /api/users/roles-available — Roles que l'acteur connecte peut creer
const getCreatableRoles = async (req, res) => {
  const allowed = req.user.isSuperAdmin
    ? ['director', 'hospital_admin', 'general_supervisor', 'department_head', 'service_supervisor', 'senior_doctor', 'resident', 'observer']
    : (CREATABLE_ROLES[req.user.roleCode] || []);

  const result = await query(
    `SELECT id, code, name, name_ar, level
     FROM roles
     WHERE establishment_id = $1 AND code = ANY($2::text[])
     ORDER BY level`,
    [req.user.establishmentId, allowed]
  );

  // Roles metier cumulables avec le titre « Chef de service ». Expose a cote de
  // `data` pour ne rien changer a la forme deja consommee par le frontend.
  const secondaryRoles = await query(
    `SELECT id, code, name, name_ar, level
     FROM roles
     WHERE establishment_id = $1 AND code = ANY($2::text[])
     ORDER BY level`,
    [req.user.establishmentId, SECONDARY_ROLE_CODES]
  );

  return res.json({ success: true, data: result.rows, secondaryRoles: secondaryRoles.rows });
};

module.exports = {
  getUsers, getUser,
  createUser, updateUser, deleteUser,
  activateUser, deactivateUser,
  getUserShifts, getUserStats,
  getCreatableRoles,
};

