const { query } = require('../../config/database');

const getAbsences = async (req, res) => {
  const { status, departmentId, userId, from, to, page = 1, limit = 20 } = req.query;
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const offset = (page - 1) * limit;

  let conditions = ['a.establishment_id = $1'];
  let params = [eid]; let idx = 2;

  // Les médecins ne voient que leurs propres absences
  if (['senior_doctor', 'resident'].includes(req.user.roleCode)) {
    conditions.push(`a.user_id = $${idx}`); params.push(req.user.id); idx++;
  } else if (userId) {
    conditions.push(`a.user_id = $${idx}`); params.push(userId); idx++;
  }

  if (status) { conditions.push(`a.status = $${idx}`); params.push(status); idx++; }
  if (departmentId) { conditions.push(`a.department_id = $${idx}`); params.push(departmentId); idx++; }
  if (from) { conditions.push(`a.start_date >= $${idx}`); params.push(from); idx++; }
  if (to) { conditions.push(`a.end_date <= $${idx}`); params.push(to); idx++; }

  const where = conditions.join(' AND ');
  const countResult = await query(`SELECT COUNT(*) FROM absences a WHERE ${where}`, params);

  const result = await query(
    `SELECT a.*, at.name AS absence_type_name, at.name_ar AS absence_type_name_ar, at.color AS absence_type_color,
            u.first_name, u.last_name, u.speciality,
            d.name AS department_name, d.name_ar AS department_name_ar,
            approver.first_name AS approved_by_first, approver.last_name AS approved_by_last
     FROM absences a
     JOIN absence_types at ON a.absence_type_id = at.id
     JOIN users u ON a.user_id = u.id
     JOIN departments d ON a.department_id = d.id
     LEFT JOIN users approver ON a.approved_by = approver.id
     WHERE ${where}
     ORDER BY a.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  );

  return res.json({
    success: true, data: result.rows,
    pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
  });
};

const createAbsence = async (req, res) => {
  const { userId, departmentId, absenceTypeId, startDate, endDate, startTime, endTime, reason, shiftId } = req.body;
  const eid = req.user.isSuperAdmin ? (req.body.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  // Vérifier le chevauchement
  const overlap = await query(
    `SELECT id FROM absences WHERE user_id = $1 AND status != 'cancelled'
     AND (start_date, end_date) OVERLAPS ($2::date, $3::date)`,
    [userId || req.user.id, startDate, endDate]
  );
  if (overlap.rows.length) {
    return res.status(409).json({ success: false, message: 'Une absence existe déjà pour cette période' });
  }

  const result = await query(
    `INSERT INTO absences (establishment_id, department_id, user_id, shift_id, absence_type_id, start_date, end_date, start_time, end_time, reason, declared_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [eid, departmentId, userId || req.user.id, shiftId || null, absenceTypeId, startDate, endDate, startTime, endTime, reason, req.user.id]
  );

  // Si liée à une garde, marquer la garde comme absente
  if (shiftId) {
    await query(`UPDATE shifts SET status = 'absent', updated_at = NOW() WHERE id = $1`, [shiftId]);
  }

  return res.status(201).json({ success: true, data: result.rows[0] });
};

const approveAbsence = async (req, res) => {
  const { comment } = req.body;
  const result = await query(
    `UPDATE absences SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND status = 'pending' RETURNING *`,
    [req.user.id, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Absence introuvable ou déjà traitée' });
  return res.json({ success: true, data: result.rows[0], message: 'Absence approuvée' });
};

const rejectAbsence = async (req, res) => {
  const { reason } = req.body;
  const result = await query(
    `UPDATE absences SET status = 'rejected', rejection_reason = $1, approved_by = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [reason, req.user.id, req.params.id]
  );
  return res.json({ success: true, data: result.rows[0], message: 'Absence rejetée' });
};

const cancelAbsence = async (req, res) => {
  const result = await query(
    `UPDATE absences SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!result.rows[0]) return res.status(403).json({ success: false, message: 'Non autorisé' });
  return res.json({ success: true, message: 'Absence annulée' });
};

const getAbsenceTypes = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const result = await query('SELECT * FROM absence_types WHERE establishment_id = $1 AND is_active = TRUE ORDER BY name', [eid]);
  return res.json({ success: true, data: result.rows });
};

module.exports = { getAbsences, createAbsence, approveAbsence, rejectAbsence, cancelAbsence, getAbsenceTypes };
