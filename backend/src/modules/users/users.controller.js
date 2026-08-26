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
  const { page = 1, limit = 20, search, roleCode, personnelType, departmentId, isActive, canLogin } = req.query;
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
  if (personnelType) {
    conditions.push(`COALESCE(jt.category, CASE
      WHEN r.code IN ('senior_doctor','resident') THEN 'medical'
      WHEN r.code IN ('director','hospital_admin','general_supervisor','department_head','service_supervisor','observer') THEN 'administrative'
      ELSE NULL END) = $${idx}`);
    params.push(personnelType); idx++;
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
     LEFT JOIN job_titles jt ON jt.id = u.job_title_id
     LEFT JOIN user_departments ud ON u.id = ud.user_id
     WHERE ${where}`,
    params
  );

  const result = await query(
    `SELECT DISTINCT u.id, u.matricule, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
            u.email, u.phone, u.speciality, u.grade, u.preferred_language,
            u.is_active, u.is_on_leave, u.avatar_url,
            u.can_login, u.last_login, u.created_at,
            r.code AS role_code, r.name AS role_name, r.name_ar AS role_name_ar, r.level AS role_level,
            r2.code AS secondary_role_code, r2.name AS secondary_role_name, r2.name_ar AS secondary_role_name_ar,
            jt.id AS job_title_id, jt.name AS job_title,
            COALESCE(jt.category, CASE
              WHEN r.code IN ('senior_doctor','resident') THEN 'medical'
              WHEN r.code IN ('director','hospital_admin','general_supervisor','department_head','service_supervisor','observer') THEN 'administrative'
              ELSE NULL END) AS personnel_category,
            COALESCE(jt.category_label, CASE
              WHEN r.code IN ('senior_doctor','resident') THEN 'Personnel médical'
              WHEN r.code IN ('director','hospital_admin','general_supervisor','department_head','service_supervisor','observer') THEN 'Personnel administratif'
              ELSE NULL END) AS personnel_category_label,
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
  const has = (field) => Object.prototype.hasOwnProperty.call(req.body, field);
  const targetResult = await query(
    `SELECT u.id, u.establishment_id, u.role_id, u.job_title_id, u.speciality,
            u.secondary_role_id, u.can_login, r.code AS role_code,
            (SELECT department_id FROM user_departments
              WHERE user_id = u.id AND is_primary = TRUE LIMIT 1) AS department_id
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [req.params.id]
  );
  const target = targetResult.rows[0];
  if (!target) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  if (!req.user.isSuperAdmin && target.establishment_id !== req.user.establishmentId) {
    return res.status(403).json({ success: false, message: 'Utilisateur hors de votre etablissement.' });
  }

  const desiredRoleCode = has('roleCode') ? req.body.roleCode : target.role_code;
  if (!desiredRoleCode) {
    return res.status(400).json({ success: false, message: 'Le role ou la fonction est obligatoire.' });
  }
  const allowed = CREATABLE_ROLES[req.user.roleCode] || [];
  if (!req.user.isSuperAdmin && desiredRoleCode !== target.role_code && !allowed.includes(desiredRoleCode)) {
    return res.status(403).json({
      success: false,
      message: `Votre role (${req.user.roleCode}) ne peut pas attribuer le role "${desiredRoleCode}".`,
    });
  }

  const roleResult = await query(
    'SELECT id, code FROM roles WHERE establishment_id = $1 AND code = $2',
    [target.establishment_id, desiredRoleCode]
  );
  const desiredRole = roleResult.rows[0];
  if (!desiredRole) {
    return res.status(400).json({ success: false, message: 'Role invalide pour cet etablissement.' });
  }

  const desiredJobTitleId = has('jobTitleId')
    ? (req.body.jobTitleId || null)
    : target.job_title_id;
  let desiredJobTitle = null;
  if (desiredJobTitleId) {
    const titleResult = await query(
      `SELECT id, name, category FROM job_titles
        WHERE id = $1 AND establishment_id = $2 AND is_active = TRUE`,
      [desiredJobTitleId, target.establishment_id]
    );
    desiredJobTitle = titleResult.rows[0];
    if (!desiredJobTitle) {
      return res.status(400).json({ success: false, message: 'Fonction du personnel invalide pour cet etablissement.' });
    }
  }
  if (desiredRoleCode === 'autre' && !desiredJobTitle) {
    return res.status(400).json({ success: false, message: 'Veuillez choisir une fonction du personnel.' });
  }

  const departmentSpecified = has('departmentId');
  const desiredDepartmentId = departmentSpecified
    ? (req.body.departmentId || null)
    : target.department_id;
  const needsDepartment = ROLES_REQUIRING_DEPT.includes(desiredRoleCode)
    || CARE_CATEGORIES.has(desiredJobTitle?.category);
  if (needsDepartment && !desiredDepartmentId) {
    return res.status(400).json({
      success: false,
      message: 'Le personnel medical doit obligatoirement etre affecte a un service.',
    });
  }
  if (desiredDepartmentId && isHospitalWideRole(desiredRoleCode)) {
    return res.status(400).json(NO_DEPT_REFUSAL);
  }
  if (desiredDepartmentId) {
    const department = await query(
      'SELECT id FROM departments WHERE id = $1 AND establishment_id = $2 AND is_active = TRUE',
      [desiredDepartmentId, target.establishment_id]
    );
    if (!department.rows[0]) {
      return res.status(400).json({ success: false, message: 'Service invalide pour cet etablissement.' });
    }
  }

  if (desiredRoleCode === 'department_head' && desiredDepartmentId) {
    const existingHead = await query(
      `SELECT u.id, u.first_name, u.last_name
         FROM user_departments ud
         JOIN users u ON u.id = ud.user_id
        WHERE ud.department_id = $1 AND ud.is_head = TRUE
          AND u.is_active = TRUE AND u.id <> $2
        LIMIT 1`,
      [desiredDepartmentId, req.params.id]
    );
    if (existingHead.rows[0]) {
      return res.status(409).json({
        success: false,
        message: `Ce service a deja un chef de service : ${existingHead.rows[0].first_name} ${existingHead.rows[0].last_name}.`,
      });
    }
  }

  const desiredSecondaryCode = has('secondaryRoleCode')
    ? (req.body.secondaryRoleCode || null)
    : (desiredRoleCode === target.role_code ? undefined : null);
  let secondaryRoleId = target.secondary_role_id;
  if (desiredSecondaryCode !== undefined) {
    const secondary = await resolveSecondaryRole(
      desiredSecondaryCode, desiredRoleCode, target.establishment_id
    );
    if (secondary.error) return res.status(400).json({ success: false, message: secondary.error });
    secondaryRoleId = secondary.id;
  }

  const editable = [
    ['firstName', 'first_name', true],
    ['lastName', 'last_name', true],
    ['firstNameAr', 'first_name_ar'],
    ['lastNameAr', 'last_name_ar'],
    ['email', 'email', true],
    ['phone', 'phone'],
    ['matricule', 'matricule'],
    ['grade', 'grade'],
    ['isOnLeave', 'is_on_leave'],
    ['preferredLanguage', 'preferred_language'],
  ];
  const assignments = [];
  const values = [];
  const addValue = (column, value) => {
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  };
  for (const [field, column, required] of editable) {
    if (!has(field)) continue;
    const raw = req.body[field];
    if (required && !String(raw || '').trim()) {
      return res.status(400).json({ success: false, message: `${field} est obligatoire.` });
    }
    addValue(column, typeof raw === 'string' ? (raw.trim() || null) : raw);
  }
  if (has('roleCode')) {
    addValue('role_id', desiredRole.id);
    addValue('can_login', !NO_LOGIN_ROLES.includes(desiredRoleCode));
  }
  if (has('jobTitleId') || has('roleCode')) {
    addValue('job_title_id', desiredJobTitleId);
    addValue('speciality', desiredJobTitle?.name || null);
  }
  if (has('secondaryRoleCode') || has('roleCode')) {
    addValue('secondary_role_id', secondaryRoleId);
  }
  assignments.push('updated_at = NOW()');

  const updated = await transaction(async (client) => {
    let row;
    if (assignments.length > 1) {
      values.push(req.params.id, target.establishment_id);
      const result = await client.query(
        `UPDATE users SET ${assignments.join(', ')}
          WHERE id = $${values.length - 1} AND establishment_id = $${values.length}
          RETURNING id, email, first_name, last_name, matricule, phone, grade, updated_at`,
        values
      );
      row = result.rows[0];
    } else {
      const result = await client.query(
        `UPDATE users SET updated_at = NOW()
          WHERE id = $1 AND establishment_id = $2
          RETURNING id, email, first_name, last_name, matricule, phone, grade, updated_at`,
        [req.params.id, target.establishment_id]
      );
      row = result.rows[0];
    }

    if (isHospitalWideRole(desiredRoleCode)) {
      await client.query('DELETE FROM user_departments WHERE user_id = $1', [req.params.id]);
    } else if (departmentSpecified || has('roleCode')) {
      await client.query(
        'UPDATE user_departments SET is_head = FALSE WHERE user_id = $1',
        [req.params.id]
      );
      if (departmentSpecified) {
        await client.query(
          'UPDATE user_departments SET is_primary = FALSE WHERE user_id = $1',
          [req.params.id]
        );
      }
      if (desiredDepartmentId) {
        await client.query(
          `INSERT INTO user_departments (user_id, department_id, is_head, is_primary)
           VALUES ($1,$2,$3,TRUE)
           ON CONFLICT (user_id, department_id) DO UPDATE
             SET is_head = EXCLUDED.is_head, is_primary = TRUE`,
          [req.params.id, desiredDepartmentId, desiredRoleCode === 'department_head']
        );
      }
    }
    return row;
  });

  return res.json({ success: true, data: updated, message: 'Informations du personnel mises a jour' });
};

// PUT /api/users/:id/deactivate — Cloturer un compte
const deactivateUser = async (req, res) => {
  if (!['director', 'hospital_admin', 'super_admin', 'general_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ success: false, message: 'Vous ne pouvez pas cloturer votre propre compte' });
  }
  // Le Super Admin est rattaché à l'établissement **système** : filtrer sur son
  // `establishment_id` ne désignait jamais l'agent visé, l'UPDATE ne touchait
  // aucune ligne, et l'endpoint répondait pourtant « Compte cloture avec
  // succes ». Sa portée étant nationale, aucun filtre d'établissement ne
  // s'applique à lui ; pour tous les autres rôles la clause reste identique.
  // `rowCount` est désormais vérifié : une cible hors périmètre renvoie 404 au
  // lieu d'un faux succès.
  const scoped = !req.user.isSuperAdmin;
  const result = await query(
    `UPDATE users SET is_active = FALSE, updated_at = NOW()
     WHERE id = $1 ${scoped ? 'AND establishment_id = $2' : ''}`,
    scoped ? [req.params.id, req.user.establishmentId] : [req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, message: 'Compte introuvable dans votre perimetre' });
  }
  return res.json({ success: true, message: 'Compte cloture avec succes' });
};

// PUT /api/users/:id/activate — Reactiver un compte
const activateUser = async (req, res) => {
  if (!['director', 'hospital_admin', 'super_admin', 'general_supervisor'].includes(req.user.roleCode)) {
    return res.status(403).json({ success: false, message: 'Permission refusee' });
  }
  // Meme correction que `deactivateUser` : portee nationale pour le Super Admin,
  // clause inchangee pour les autres roles, et plus de faux succes.
  const scoped = !req.user.isSuperAdmin;
  const result = await query(
    `UPDATE users SET is_active = TRUE, updated_at = NOW()
     WHERE id = $1 ${scoped ? 'AND establishment_id = $2' : ''}`,
    scoped ? [req.params.id, req.user.establishmentId] : [req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({ success: false, message: 'Compte introuvable dans votre perimetre' });
  }
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

  // Les rôles sont créés **par établissement** (`create_roles_for_establishment`,
  // migration 012) et le Super Admin n'appartient à aucun : son
  // `req.user.establishmentId` est NULL, donc la requête ne renvoyait jamais
  // rien et le formulaire de création restait vide. `req.establishmentId`
  // (posé par `injectEstablishment`) vaut l'établissement **cible** passé en
  // `?establishmentId=` pour un Super Admin, et son propre établissement pour
  // tous les autres rôles — comportement inchangé pour eux.
  const eid = req.establishmentId;

  const result = await query(
    `SELECT id, code, name, name_ar, level
     FROM roles
     WHERE establishment_id = $1 AND code = ANY($2::text[])
     ORDER BY level`,
    [eid, allowed]
  );

  // `autre` est uniquement un rôle technique de compatibilité pour les
  // fonctions sans accès. Il ne doit plus apparaître comme choix métier.
  result.rows = result.rows.filter((role) => role.code !== 'autre');

  // Roles metier cumulables avec le titre « Chef de service ». Expose a cote de
  // `data` pour ne rien changer a la forme deja consommee par le frontend.
  const secondaryRoles = await query(
    `SELECT id, code, name, name_ar, level
     FROM roles
     WHERE establishment_id = $1 AND code = ANY($2::text[])
     ORDER BY level`,
    [eid, SECONDARY_ROLE_CODES]
  );

  return res.json({
    success: true,
    data: result.rows,
    secondaryRoles: secondaryRoles.rows.filter((role) => role.code !== 'autre'),
  });
};

module.exports = {
  getUsers, getUser,
  createUser, updateUser, deleteUser,
  activateUser, deactivateUser,
  getUserShifts, getUserStats,
  getCreatableRoles,
};
