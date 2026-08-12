const { query } = require('../../config/database');

// Dashboard principal - KPIs globaux
const getDashboard = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = today.substring(0, 7);

  const [todayShifts, pendingSchedules, openReplacements, monthAbsences, coverageRate, staffStats] = await Promise.all([
    // Gardes aujourd'hui
    query(`SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'absent') AS absent,
      COUNT(*) FILTER (WHERE status = 'planned') AS planned
      FROM shifts WHERE establishment_id = $1 AND shift_date = $2 AND status != 'cancelled'`,
      [eid, today]
    ),
    // Plannings en vigueur (envoyés ou en cours) — il n'y a plus d'approbation
    // à attendre : un planning envoyé est effectif (migration 026).
    query(`SELECT COUNT(*) FROM schedules WHERE establishment_id = $1 AND status IN ('submitted','active')`, [eid]),
    // Remplacements ouverts
    query(`SELECT COUNT(*) FROM replacements WHERE establishment_id = $1 AND status IN ('pending','proposed')`, [eid]),
    // Absences ce mois
    query(`SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'pending') AS pending,
      COUNT(*) FILTER (WHERE status = 'approved') AS approved
      FROM absences WHERE establishment_id = $1 AND TO_CHAR(start_date,'YYYY-MM') = $2`,
      [eid, thisMonth]
    ),
    // Taux de couverture (gardes avec médecin vs gardes totales)
    query(`SELECT
      COUNT(*) AS total_shifts,
      COUNT(*) FILTER (WHERE status != 'absent') AS covered_shifts,
      ROUND(COUNT(*) FILTER (WHERE status != 'absent')::numeric / NULLIF(COUNT(*),0) * 100, 1) AS coverage_rate
      FROM shifts WHERE establishment_id = $1 AND shift_date >= $2::date - 30 AND status != 'cancelled'`,
      [eid, today]
    ),
    // Statistiques staff
    query(`SELECT COUNT(*) AS total_staff,
      COUNT(*) FILTER (WHERE is_active = TRUE) AS active_staff,
      COUNT(*) FILTER (WHERE is_on_leave = TRUE) AS on_leave
      FROM users WHERE establishment_id = $1`,
      [eid]
    ),
  ]);

  return res.json({
    success: true,
    data: {
      today: {
        date: today,
        shifts: todayShifts.rows[0],
      },
      // `pendingSchedules` est conservé sous ce nom pour ne rien casser côté
      // client, mais il compte désormais les plannings EN VIGUEUR.
      // `schedulesInForce` est le nom exact du même chiffre.
      pendingSchedules: parseInt(pendingSchedules.rows[0].count),
      schedulesInForce: parseInt(pendingSchedules.rows[0].count),
      openReplacements: parseInt(openReplacements.rows[0].count),
      monthAbsences: monthAbsences.rows[0],
      coverage: coverageRate.rows[0],
      staff: staffStats.rows[0],
    },
  });
};

// Statistiques gardes par médecin
const getShiftStats = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const { departmentId, from, to } = req.query;
  const start = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const end = to || new Date().toISOString().split('T')[0];

  let conditions = ['s.establishment_id = $1', 's.shift_date BETWEEN $2 AND $3'];
  let params = [eid, start, end]; let idx = 4;

  if (departmentId) { conditions.push(`s.department_id = $${idx}`); params.push(departmentId); idx++; }

  const result = await query(
    `SELECT u.id, u.first_name, u.last_name, u.speciality, u.grade,
            COUNT(s.id) FILTER (WHERE s.status != 'cancelled') AS total_shifts,
            COUNT(s.id) FILTER (WHERE s.status = 'completed') AS completed,
            COUNT(s.id) FILTER (WHERE s.status = 'absent') AS absent,
            COUNT(s.id) FILTER (WHERE s.status = 'replaced') AS replaced,
            SUM(st.duration_hours) FILTER (WHERE s.status IN ('completed','confirmed','planned')) AS total_hours,
            ROUND(COUNT(s.id) FILTER (WHERE s.status = 'absent')::numeric /
              NULLIF(COUNT(s.id) FILTER (WHERE s.status != 'cancelled'),0) * 100, 1) AS absence_rate
     FROM users u
     LEFT JOIN shifts s ON u.id = s.user_id AND ${conditions.join(' AND ')}
     LEFT JOIN shift_types st ON s.shift_type_id = st.id
     WHERE u.establishment_id = $1 AND u.is_active = TRUE
     GROUP BY u.id, u.first_name, u.last_name, u.speciality, u.grade
     ORDER BY total_shifts DESC NULLS LAST`,
    params
  );

  return res.json({ success: true, data: result.rows, period: { from: start, to: end } });
};

// Statistiques d'absence par type et département
const getAbsenceStats = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const { year = new Date().getFullYear() } = req.query;

  const byMonth = await query(
    `SELECT TO_CHAR(start_date, 'YYYY-MM') AS month,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'approved') AS approved,
            COUNT(*) FILTER (WHERE status = 'rejected') AS rejected
     FROM absences WHERE establishment_id = $1 AND EXTRACT(YEAR FROM start_date) = $2
     GROUP BY month ORDER BY month`,
    [eid, year]
  );

  const byType = await query(
    `SELECT at.name, at.name_ar, at.color, COUNT(a.id) AS total
     FROM absences a JOIN absence_types at ON a.absence_type_id = at.id
     WHERE a.establishment_id = $1 AND EXTRACT(YEAR FROM a.start_date) = $2
     GROUP BY at.id, at.name, at.name_ar, at.color ORDER BY total DESC`,
    [eid, year]
  );

  const byDept = await query(
    `SELECT d.name, d.name_ar, COUNT(a.id) AS total,
            ROUND(AVG(a.end_date - a.start_date + 1),1) AS avg_duration_days
     FROM absences a JOIN departments d ON a.department_id = d.id
     WHERE a.establishment_id = $1 AND EXTRACT(YEAR FROM a.start_date) = $2 AND a.status = 'approved'
     GROUP BY d.id, d.name, d.name_ar ORDER BY total DESC`,
    [eid, year]
  );

  return res.json({ success: true, data: { byMonth: byMonth.rows, byType: byType.rows, byDepartment: byDept.rows } });
};

// Rapport de couverture par service
const getCoverageReport = async (req, res) => {
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const { from, to } = req.query;
  const start = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
  const end = to || new Date().toISOString().split('T')[0];

  const result = await query(
    `SELECT d.name, d.name_ar,
            COUNT(s.id) AS total_shifts,
            COUNT(s.id) FILTER (WHERE s.status IN ('completed','confirmed','planned','replaced')) AS covered,
            COUNT(s.id) FILTER (WHERE s.status = 'absent') AS uncovered,
            ROUND(COUNT(s.id) FILTER (WHERE s.status IN ('completed','confirmed','planned','replaced'))::numeric /
              NULLIF(COUNT(s.id) FILTER (WHERE s.status != 'cancelled'),0) * 100, 1) AS coverage_rate
     FROM departments d
     LEFT JOIN shifts s ON d.id = s.department_id AND s.shift_date BETWEEN $2 AND $3 AND s.status != 'cancelled'
     WHERE d.establishment_id = $1 AND d.is_active = TRUE
     GROUP BY d.id, d.name, d.name_ar
     ORDER BY coverage_rate ASC`,
    [eid, start, end]
  );

  return res.json({ success: true, data: result.rows, period: { from: start, to: end } });
};

module.exports = { getDashboard, getShiftStats, getAbsenceStats, getCoverageReport };
