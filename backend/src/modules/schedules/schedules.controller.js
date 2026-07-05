const { query, transaction } = require('../../config/database');
const { SCHEDULE_STATUS, SHIFT_STATUS, NOTIFICATION_TYPES } = require('../../config/constants');

// ============================================================
// DÉTECTION DES CONFLITS
// ============================================================
const detectConflicts = async (departmentId, startDate, endDate, excludeScheduleId = null) => {
  const conflicts = [];

  // 1. Doubles affectations (même médecin, même jour, 2 gardes)
  const doubleResult = await query(
    `SELECT u.id AS user_id, u.first_name, u.last_name, s.shift_date,
            COUNT(*) AS shift_count, array_agg(s.id) AS shift_ids
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN schedules sch ON s.schedule_id = sch.id
     WHERE s.department_id = $1
       AND s.shift_date BETWEEN $2 AND $3
       AND s.status NOT IN ('cancelled')
       ${excludeScheduleId ? 'AND s.schedule_id != $4' : ''}
     GROUP BY u.id, u.first_name, u.last_name, s.shift_date
     HAVING COUNT(*) > 1`,
    excludeScheduleId ? [departmentId, startDate, endDate, excludeScheduleId] : [departmentId, startDate, endDate]
  );

  doubleResult.rows.forEach(row => {
    conflicts.push({
      type: 'DOUBLE_ASSIGNMENT',
      severity: 'high',
      message: `${row.first_name} ${row.last_name} est affecté(e) à ${row.shift_count} gardes le ${row.shift_date}`,
      userId: row.user_id,
      date: row.shift_date,
      shiftIds: row.shift_ids,
    });
  });

  // 2. Repos insuffisant (< min_rest_hours entre 2 gardes)
  const restResult = await query(
    `WITH ordered_shifts AS (
       SELECT s.user_id, s.shift_date, st.start_time, st.end_time, st.is_overnight, st.duration_hours,
              u.first_name, u.last_name, s.id,
              LAG(s.shift_date) OVER (PARTITION BY s.user_id ORDER BY s.shift_date) AS prev_date,
              LAG(st.duration_hours) OVER (PARTITION BY s.user_id ORDER BY s.shift_date) AS prev_duration
       FROM shifts s
       JOIN shift_types st ON s.shift_type_id = st.id
       JOIN users u ON s.user_id = u.id
       WHERE s.department_id = $1 AND s.shift_date BETWEEN $2 AND $3 AND s.status != 'cancelled'
     )
     SELECT * FROM ordered_shifts
     WHERE prev_date IS NOT NULL
       AND (shift_date::timestamp - prev_date::timestamp) < INTERVAL '24 hours'`,
    [departmentId, startDate, endDate]
  );

  restResult.rows.forEach(row => {
    conflicts.push({
      type: 'INSUFFICIENT_REST',
      severity: 'medium',
      message: `${row.first_name} ${row.last_name}: repos insuffisant entre ${row.prev_date} et ${row.shift_date}`,
      userId: row.user_id,
      date: row.shift_date,
    });
  });

  return conflicts;
};

// ============================================================
// GÉNÉRATION AUTOMATIQUE (Round-Robin équitable)
// ============================================================
const generateSchedule = async (req, res) => {
  const { departmentId, startDate, endDate, shiftTypeId, scheduleId } = req.body;

  // Récupérer les médecins du service
  const doctorsResult = await query(
    `SELECT u.id, u.first_name, u.last_name,
            COUNT(s.id) AS shift_count_current_month
     FROM users u
     JOIN user_departments ud ON u.id = ud.user_id
     LEFT JOIN shifts s ON u.id = s.user_id
       AND s.shift_date BETWEEN $2 AND $3
       AND s.status != 'cancelled'
     WHERE ud.department_id = $1 AND u.is_active = TRUE AND u.is_on_leave = FALSE
     GROUP BY u.id, u.first_name, u.last_name
     ORDER BY shift_count_current_month ASC, RANDOM()`,
    [departmentId, startDate, endDate]
  );

  if (!doctorsResult.rows.length) {
    return res.status(400).json({ success: false, message: 'Aucun médecin disponible dans ce service' });
  }

  const doctors = doctorsResult.rows;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const shifts = [];
  let doctorIndex = 0;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const doctor = doctors[doctorIndex % doctors.length];

    shifts.push({
      scheduleId,
      establishmentId: req.user.establishmentId,
      departmentId,
      userId: doctor.id,
      shiftTypeId,
      shiftDate: dateStr,
      status: SHIFT_STATUS.PLANNED,
      createdBy: req.user.id,
    });

    doctorIndex++;
  }

  // Insérer en batch
  await transaction(async (client) => {
    for (const shift of shifts) {
      await client.query(
        `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT DO NOTHING`,
        [shift.scheduleId, shift.establishmentId, shift.departmentId, shift.userId, shift.shiftTypeId, shift.shiftDate, shift.status, shift.createdBy]
      );
    }
  });

  return res.json({
    success: true,
    message: `${shifts.length} gardes générées avec succès (algorithme round-robin)`,
    data: { shiftsGenerated: shifts.length },
  });
};

// ============================================================
// CRUD PLANNINGS
// ============================================================

const getSchedules = async (req, res) => {
  const { status, departmentId, from, to, page = 1, limit = 20 } = req.query;
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const offset = (page - 1) * limit;

  let conditions = ['sch.establishment_id = $1'];
  let params = [eid]; let idx = 2;

  if (status) { conditions.push(`sch.status = $${idx}`); params.push(status); idx++; }
  if (departmentId) { conditions.push(`sch.department_id = $${idx}`); params.push(departmentId); idx++; }
  if (from) { conditions.push(`sch.start_date >= $${idx}`); params.push(from); idx++; }
  if (to) { conditions.push(`sch.end_date <= $${idx}`); params.push(to); idx++; }

  // Filtrer par service pour les chefs
  if (!req.user.isSuperAdmin && ['department_head', 'service_supervisor'].includes(req.user.roleCode)) {
    const deptResult = await query(
      `SELECT department_id FROM user_departments WHERE user_id = $1`,
      [req.user.id]
    );
    if (deptResult.rows.length) {
      conditions.push(`sch.department_id = ANY($${idx})`);
      params.push(deptResult.rows.map(r => r.department_id)); idx++;
    }
  }

  const where = conditions.join(' AND ');

  const countResult = await query(`SELECT COUNT(*) FROM schedules sch WHERE ${where}`, params);
  const result = await query(
    `SELECT sch.*, d.name AS department_name, d.name_ar AS department_name_ar,
            u.first_name AS created_by_first, u.last_name AS created_by_last,
            COUNT(s.id) AS total_shifts
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN users u ON sch.created_by = u.id
     LEFT JOIN shifts s ON sch.id = s.schedule_id AND s.status != 'cancelled'
     WHERE ${where}
     GROUP BY sch.id, d.name, d.name_ar, u.first_name, u.last_name
     ORDER BY sch.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  );

  return res.json({
    success: true, data: result.rows,
    pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
  });
};

const getSchedule = async (req, res) => {
  const result = await query(
    `SELECT sch.*, d.name AS department_name, d.name_ar AS department_name_ar,
            u.first_name AS created_by_first, u.last_name AS created_by_last
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN users u ON sch.created_by = u.id
     WHERE sch.id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });

  const shifts = await query(
    `SELECT s.*, u.first_name, u.last_name, u.speciality,
            st.name AS shift_type_name, st.color, st.start_time, st.end_time, st.duration_hours
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.schedule_id = $1 AND s.status != 'cancelled'
     ORDER BY s.shift_date, st.start_time`,
    [req.params.id]
  );

  const history = await query(
    `SELECT swh.*, u.first_name, u.last_name FROM schedule_workflow_history swh
     JOIN users u ON swh.actor_id = u.id
     WHERE swh.schedule_id = $1 ORDER BY swh.created_at`,
    [req.params.id]
  );

  const conflicts = await detectConflicts(result.rows[0].department_id, result.rows[0].start_date, result.rows[0].end_date);

  return res.json({
    success: true,
    data: { ...result.rows[0], shifts: shifts.rows, history: history.rows, conflicts },
  });
};

const createSchedule = async (req, res) => {
  const { departmentId, name, startDate, endDate, notes, workflowId } = req.body;
  const eid = req.user.isSuperAdmin ? (req.body.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  const result = await query(
    `INSERT INTO schedules (establishment_id, department_id, name, start_date, end_date, notes, workflow_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [eid, departmentId, name, startDate, endDate, notes, workflowId || null, req.user.id]
  );
  return res.status(201).json({ success: true, data: result.rows[0] });
};

const updateSchedule = async (req, res) => {
  const { name, notes, startDate, endDate } = req.body;
  const schedule = await query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
  if (!schedule.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  if (!['draft', 'rejected'].includes(schedule.rows[0].status)) {
    return res.status(400).json({ success: false, message: 'Seuls les plannings en brouillon peuvent être modifiés' });
  }

  const result = await query(
    `UPDATE schedules SET name = COALESCE($1,name), notes = COALESCE($2,notes),
     start_date = COALESCE($3,start_date), end_date = COALESCE($4,end_date), updated_at = NOW()
     WHERE id = $5 RETURNING *`,
    [name, notes, startDate, endDate, req.params.id]
  );
  return res.json({ success: true, data: result.rows[0] });
};

const submitSchedule = async (req, res) => {
  const { comment } = req.body;
  await query(`UPDATE schedules SET status = 'submitted', updated_at = NOW() WHERE id = $1`, [req.params.id]);
  await query(
    `INSERT INTO schedule_workflow_history (schedule_id, step_order, action, actor_id, comment)
     VALUES ($1, 0, 'submitted', $2, $3)`,
    [req.params.id, req.user.id, comment]
  );
  return res.json({ success: true, message: 'Planning soumis pour validation' });
};

const approveSchedule = async (req, res) => {
  const { comment } = req.body;
  const schedule = await query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
  const sch = schedule.rows[0];

  const newStatus = sch.current_workflow_step >= 1 ? SCHEDULE_STATUS.APPROVED : SCHEDULE_STATUS.UNDER_REVIEW;
  const nextStep = (sch.current_workflow_step || 0) + 1;

  await query(
    `UPDATE schedules SET status = $1, current_workflow_step = $2, updated_at = NOW() WHERE id = $3`,
    [newStatus, nextStep, req.params.id]
  );
  await query(
    `INSERT INTO schedule_workflow_history (schedule_id, step_order, action, actor_id, comment) VALUES ($1,$2,'approved',$3,$4)`,
    [req.params.id, nextStep, req.user.id, comment]
  );
  return res.json({ success: true, message: `Planning ${newStatus === SCHEDULE_STATUS.APPROVED ? 'approuvé' : 'transmis à l\'étape suivante'}` });
};

const rejectSchedule = async (req, res) => {
  const { comment } = req.body;
  await query(
    `UPDATE schedules SET status = 'rejected', rejection_reason = $1, updated_at = NOW() WHERE id = $2`,
    [comment, req.params.id]
  );
  await query(
    `INSERT INTO schedule_workflow_history (schedule_id, step_order, action, actor_id, comment) VALUES ($1,$2,'rejected',$3,$4)`,
    [req.params.id, 0, req.user.id, comment]
  );
  return res.json({ success: true, message: 'Planning rejeté' });
};

const getConflicts = async (req, res) => {
  const schedule = await query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
  if (!schedule.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const conflicts = await detectConflicts(schedule.rows[0].department_id, schedule.rows[0].start_date, schedule.rows[0].end_date, req.params.id);
  return res.json({ success: true, data: conflicts, count: conflicts.length });
};

module.exports = { getSchedules, getSchedule, createSchedule, updateSchedule, submitSchedule, approveSchedule, rejectSchedule, generateSchedule, getConflicts, detectConflicts };
