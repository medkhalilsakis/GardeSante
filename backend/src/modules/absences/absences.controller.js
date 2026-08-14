const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { ensureDefaultAbsenceTypes } = require('./absence-types.service');

const DEPARTMENT_SCOPED_ROLES = [ROLES.DEPARTMENT_HEAD, ROLES.SERVICE_SUPERVISOR];
const SELF_ONLY_ROLES = [ROLES.SENIOR_DOCTOR, ROLES.RESIDENT];

const getScopedDepartmentIds = async (userId) => {
  const { rows } = await query(
    'SELECT department_id FROM user_departments WHERE user_id = $1',
    [userId]
  );
  return rows.map((row) => row.department_id);
};

const getAbsences = async (req, res) => {
  try {
    const {
      departmentId, userId, from, to, isJustified,
      page = 1, limit = 20,
    } = req.query;
    const eid = req.user.isSuperAdmin
      ? (req.query.establishmentId || req.user.establishmentId)
      : req.user.establishmentId;
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const offset = (safePage - 1) * safeLimit;

    // `status` reste une colonne technique partagée avec les congés et
    // l'annulation. Il ne fait plus partie du workflow fonctionnel des absences.
    const conditions = [
      'a.establishment_id = $1',
      "COALESCE(a.kind, 'shift_absence') <> 'leave'",
      "a.status <> 'cancelled'",
    ];
    const params = [eid];

    if (SELF_ONLY_ROLES.includes(req.user.roleCode)) {
      params.push(req.user.id);
      conditions.push(`a.user_id = $${params.length}`);
    } else if (userId) {
      params.push(userId);
      conditions.push(`a.user_id = $${params.length}`);
    }

    if (DEPARTMENT_SCOPED_ROLES.includes(req.user.roleCode) && !req.user.isSuperAdmin) {
      const scopedDepartmentIds = await getScopedDepartmentIds(req.user.id);
      params.push(scopedDepartmentIds);
      conditions.push(`a.department_id = ANY($${params.length}::uuid[])`);
    }

    if (departmentId) {
      params.push(departmentId);
      conditions.push(`a.department_id = $${params.length}`);
    }
    // Le filtre conserve toute absence qui chevauche l'intervalle demandé.
    if (from) {
      params.push(String(from).slice(0, 10));
      conditions.push(`a.end_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(String(to).slice(0, 10));
      conditions.push(`a.start_date <= $${params.length}::date`);
    }
    if (isJustified === 'true' || isJustified === 'false') {
      params.push(isJustified === 'true');
      conditions.push(`a.is_justified = $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const countResult = await query(`SELECT COUNT(*) FROM absences a WHERE ${where}`, params);

    const dataParams = [...params, safeLimit, offset];
    const result = await query(
      `SELECT a.id, a.user_id, a.department_id, a.shift_id, a.schedule_id,
              a.absence_type_id, a.start_date, a.end_date, a.start_time, a.end_time,
              a.reason, a.justification_url, a.is_justified, a.late_minutes, a.created_at,
              at.name AS absence_type_name, at.name_ar AS absence_type_name_ar, at.color AS absence_type_color,
              u.first_name, u.last_name, u.speciality,
              d.name AS department_name, d.name_ar AS department_name_ar
       FROM absences a
       JOIN absence_types at ON a.absence_type_id = at.id
       JOIN users u ON a.user_id = u.id
       JOIN departments d ON a.department_id = d.id
       WHERE ${where}
       ORDER BY a.created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const total = parseInt(countResult.rows[0].count, 10);
    return res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    console.error('getAbsences error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des absences' });
  }
};

const createAbsence = async (req, res) => {
  try {
    const {
      userId, departmentId, absenceTypeId, startDate, endDate,
      startTime, endTime, reason, shiftId, isJustified,
    } = req.body;
    const eid = req.user.isSuperAdmin
      ? (req.body.establishmentId || req.user.establishmentId)
      : req.user.establishmentId;
    const targetUserId = userId || req.user.id;
    const start = String(startDate || '').slice(0, 10);
    const end = String(endDate || '').slice(0, 10);

    if (!targetUserId || !absenceTypeId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      return res.status(400).json({
        success: false,
        message: 'Personnel, type, date de début et date de fin sont obligatoires',
      });
    }
    if (end < start) {
      return res.status(400).json({ success: false, message: 'La date de fin doit être postérieure à la date de début' });
    }
    if (typeof isJustified !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Indiquez si l’absence est justifiée ou non' });
    }
    if (SELF_ONLY_ROLES.includes(req.user.roleCode) && targetUserId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Vous ne pouvez déclarer que votre propre absence' });
    }

    await ensureDefaultAbsenceTypes(eid);

    const targetResult = await query(
      `SELECT u.id, u.establishment_id,
              COALESCE(
                (SELECT ud.department_id FROM user_departments ud
                 WHERE ud.user_id = u.id AND ud.department_id = $2::uuid LIMIT 1),
                (SELECT ud.department_id FROM user_departments ud
                 WHERE ud.user_id = u.id
                 ORDER BY ud.is_primary DESC, ud.joined_at ASC LIMIT 1)
              ) AS department_id
       FROM users u
       WHERE u.id = $1 AND u.is_active = TRUE`,
      [targetUserId, departmentId || null]
    );
    const target = targetResult.rows[0];
    if (!target || target.establishment_id !== eid) {
      return res.status(404).json({ success: false, message: 'Personnel introuvable dans cet établissement' });
    }
    if (!target.department_id) {
      return res.status(400).json({ success: false, message: 'Ce personnel n’est rattaché à aucun service' });
    }

    if (DEPARTMENT_SCOPED_ROLES.includes(req.user.roleCode) && !req.user.isSuperAdmin) {
      const allowedDepartments = await getScopedDepartmentIds(req.user.id);
      if (!allowedDepartments.includes(target.department_id)) {
        return res.status(403).json({ success: false, message: 'Ce personnel ne fait pas partie de votre service' });
      }
    }

    const typeResult = await query(
      `SELECT id FROM absence_types
       WHERE id = $1 AND establishment_id = $2 AND is_active = TRUE
         AND COALESCE(is_leave, FALSE) = FALSE`,
      [absenceTypeId, eid]
    );
    if (!typeResult.rows.length) {
      return res.status(400).json({ success: false, message: 'Type d’absence invalide' });
    }

    const overlap = await query(
      `SELECT id FROM absences
       WHERE user_id = $1 AND status <> 'cancelled'
         AND (start_date, end_date) OVERLAPS ($2::date, $3::date)
       LIMIT 1`,
      [targetUserId, start, end]
    );
    if (overlap.rows.length) {
      return res.status(409).json({ success: false, message: 'Une absence ou un congé existe déjà pour cette période' });
    }

    // La valeur `approved` est conservée uniquement comme état technique
    // « actif » imposé par le schéma partagé. Aucun approbateur n'est enregistré.
    const result = await query(
      `INSERT INTO absences
         (establishment_id, department_id, user_id, shift_id, absence_type_id,
          start_date, end_date, start_time, end_time, reason, declared_by,
          kind, is_justified, status)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,
               'shift_absence',$12,'approved')
       RETURNING *`,
      [
        eid, target.department_id, targetUserId, shiftId || null, absenceTypeId,
        start, end, startTime || null, endTime || null, reason || null,
        req.user.id, isJustified,
      ]
    );

    if (shiftId) {
      await query(
        `UPDATE shifts SET status = 'absent', updated_at = NOW()
         WHERE id = $1 AND establishment_id = $2 AND user_id = $3`,
        [shiftId, eid, targetUserId]
      );
    }

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('createAbsence error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la déclaration de l’absence' });
  }
};

const cancelAbsence = async (req, res) => {
  const result = await query(
    `UPDATE absences SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND COALESCE(kind, 'shift_absence') <> 'leave'
     RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!result.rows[0]) return res.status(403).json({ success: false, message: 'Non autorisé' });
  return res.json({ success: true, message: 'Absence annulée' });
};

const getAbsenceTypes = async (req, res) => {
  const eid = req.user.isSuperAdmin
    ? (req.query.establishmentId || req.user.establishmentId)
    : req.user.establishmentId;
  await ensureDefaultAbsenceTypes(eid);
  const result = await query(
    `SELECT * FROM absence_types
     WHERE establishment_id = $1 AND is_active = TRUE
       AND COALESCE(is_leave, FALSE) = FALSE
     ORDER BY name`,
    [eid]
  );
  return res.json({ success: true, data: result.rows });
};

module.exports = { getAbsences, createAbsence, cancelAbsence, getAbsenceTypes };
