const { query } = require('../../config/database');

const getShifts = async (req, res) => {
  const { departmentId, from, to, userId, status, scheduleId } = req.query;
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  let conditions = ['s.establishment_id = $1'];
  let params = [eid]; let idx = 2;

  if (departmentId) { conditions.push(`s.department_id = $${idx}`); params.push(departmentId); idx++; }
  if (from) { conditions.push(`s.shift_date >= $${idx}`); params.push(from); idx++; }
  if (to) { conditions.push(`s.shift_date <= $${idx}`); params.push(to); idx++; }
  if (userId) { conditions.push(`s.user_id = $${idx}`); params.push(userId); idx++; }
  if (status) { conditions.push(`s.status = $${idx}`); params.push(status); idx++; }
  if (scheduleId) { conditions.push(`s.schedule_id = $${idx}`); params.push(scheduleId); idx++; }

  const result = await query(
    `SELECT s.*, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar, u.speciality, u.grade,
            st.name AS shift_type_name, st.name_ar AS shift_type_name_ar, st.color, st.start_time, st.end_time, st.duration_hours,
            d.name AS department_name, d.name_ar AS department_name_ar
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN shift_types st ON s.shift_type_id = st.id
     JOIN departments d ON s.department_id = d.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.shift_date, st.start_time`,
    params
  );
  return res.json({ success: true, data: result.rows });
};

const createShift = async (req, res) => {
  const { scheduleId, departmentId, userId, shiftTypeId, shiftDate, notes, isExtra } = req.body;
  const eid = req.user.isSuperAdmin ? (req.body.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  // Vérifier les conflits avant insertion
  const conflict = await query(
    `SELECT id FROM shifts WHERE user_id = $1 AND shift_date = $2 AND status NOT IN ('cancelled') AND id != $3`,
    [userId, shiftDate, '00000000-0000-0000-0000-000000000000']
  );
  if (conflict.rows.length > 0) {
    return res.status(409).json({
      success: false,
      message: 'Ce médecin a déjà une garde ce jour-là',
      message_ar: 'هذا الطبيب لديه حراسة في هذا اليوم',
      conflictShiftId: conflict.rows[0].id,
    });
  }

  const result = await query(
    `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, notes, is_extra, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [scheduleId, eid, departmentId, userId, shiftTypeId, shiftDate, notes, isExtra || false, req.user.id]
  );
  return res.status(201).json({ success: true, data: result.rows[0] });
};

const updateShift = async (req, res) => {
  const { userId, shiftTypeId, shiftDate, status, notes, actualStart, actualEnd } = req.body;
  const result = await query(
    `UPDATE shifts SET
       user_id = COALESCE($1, user_id),
       shift_type_id = COALESCE($2, shift_type_id),
       shift_date = COALESCE($3, shift_date),
       status = COALESCE($4, status),
       notes = COALESCE($5, notes),
       actual_start = COALESCE($6, actual_start),
       actual_end = COALESCE($7, actual_end),
       updated_at = NOW()
     WHERE id = $8 RETURNING *`,
    [userId, shiftTypeId, shiftDate, status, notes, actualStart, actualEnd, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Garde introuvable' });
  return res.json({ success: true, data: result.rows[0] });
};

const deleteShift = async (req, res) => {
  await query(`UPDATE shifts SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [req.params.id]);
  return res.json({ success: true, message: 'Garde annulée' });
};

const confirmPresence = async (req, res) => {
  const { actualStart, actualEnd } = req.body;
  const result = await query(
    `UPDATE shifts SET status = 'confirmed', actual_start = $1, actual_end = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [actualStart || new Date(), actualEnd, req.params.id]
  );
  return res.json({ success: true, data: result.rows[0], message: 'Présence confirmée' });
};

const markAbsent = async (req, res) => {
  const result = await query(
    `UPDATE shifts SET status = 'absent', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  return res.json({ success: true, data: result.rows[0], message: 'Absence enregistrée' });
};

// Gardes du jour pour un établissement/service
const getTodayShifts = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const today = new Date().toISOString().split('T')[0];

  const result = await query(
    `SELECT * FROM v_today_shifts
     WHERE establishment_id = $1 AND shift_date = $2
     ORDER BY department_name, start_time`,
    [eid, today]
  );
  return res.json({ success: true, data: result.rows, date: today });
};

module.exports = { getShifts, createShift, updateShift, deleteShift, confirmPresence, markAbsent, getTodayShifts };
