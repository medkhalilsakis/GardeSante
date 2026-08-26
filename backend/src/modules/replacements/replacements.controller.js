const { query } = require('../../config/database');

// Trouver les meilleurs candidats pour un remplacement (algorithme de scoring)
const findCandidates = async (shiftId, establishmentId, departmentId) => {
  const shift = await query(
    `SELECT s.*, st.duration_hours, st.start_time FROM shifts s
     JOIN shift_types st ON s.shift_type_id = st.id WHERE s.id = $1`,
    [shiftId]
  );
  if (!shift.rows[0]) return [];
  const s = shift.rows[0];

  // Médecins du même service, actifs, non en congé
  const candidates = await query(
    `SELECT u.id, u.first_name, u.last_name, u.speciality, u.grade,
            COUNT(s2.id) FILTER (
              WHERE s2.shift_date BETWEEN $3::date - 7 AND $3::date + 7
              AND s2.status != 'cancelled'
            ) AS recent_shifts,
            COUNT(a.id) FILTER (
              WHERE a.start_date <= $3 AND a.end_date >= $3 AND a.status = 'approved'
            ) AS has_approved_absence
     FROM users u
     JOIN user_departments ud ON u.id = ud.user_id
     LEFT JOIN shifts s2 ON u.id = s2.user_id
     LEFT JOIN absences a ON u.id = a.user_id
     WHERE ud.department_id = $1
       AND u.establishment_id = $2
       AND u.is_active = TRUE
       AND u.is_on_leave = FALSE
       AND u.id != $4
     GROUP BY u.id, u.first_name, u.last_name, u.speciality, u.grade
     HAVING COUNT(a.id) FILTER (WHERE a.start_date <= $3 AND a.end_date >= $3 AND a.status = 'approved') = 0
     ORDER BY recent_shifts ASC`,
    [departmentId, establishmentId, s.shift_date, s.user_id]
  );

  // Calculer un score simple
  return candidates.rows.map((c, index) => ({
    ...c,
    score: Math.max(0, 100 - (c.recent_shifts * 10) - (index * 5)),
    availabilityStatus: 'available',
  }));
};

const getReplacements = async (req, res) => {
  const { status, departmentId, urgency, page = 1, limit = 20 } = req.query;
  const eid = req.user.isSuperAdmin ? (req.query.establishmentId || req.user.establishmentId) : req.user.establishmentId;
  const offset = (page - 1) * limit;

  // Un remplacement de la couche overlay ne référence AUCUNE garde de la table
  // `shifts` : `shift_id` reste NULL, la ligne porte son planning (`schedule_id`)
  // et sa propre période. Les jointures internes sur `shifts` écartaient donc
  // tous les remplacements réels — dans le comptage comme dans les données, la
  // liste était structurellement vide. D'où les LEFT JOIN, et la dérivation du
  // service et de la date depuis `schedules` quand la garde est absente.
  const fromClause = `
     FROM replacements r
     LEFT JOIN shifts s          ON r.shift_id = s.id
     LEFT JOIN schedules sch     ON r.schedule_id = sch.id
     LEFT JOIN shift_types st    ON s.shift_type_id = st.id
     LEFT JOIN departments d     ON COALESCE(s.department_id, r.department_id, sch.department_id) = d.id
     LEFT JOIN users absent      ON r.absent_user_id = absent.id
     LEFT JOIN users replacement ON r.replacement_user_id = replacement.id
     JOIN users requester        ON r.requested_by = requester.id`;

  let conditions = ['r.establishment_id = $1'];
  let params = [eid]; let idx = 2;
  if (status) { conditions.push(`r.status = $${idx}`); params.push(status); idx++; }
  if (departmentId) {
    conditions.push(`COALESCE(s.department_id, r.department_id, sch.department_id) = $${idx}`);
    params.push(departmentId); idx++;
  }
  if (urgency) { conditions.push(`r.urgency = $${idx}`); params.push(urgency); idx++; }

  const countResult = await query(
    `SELECT COUNT(*) ${fromClause} WHERE ${conditions.join(' AND ')}`,
    params
  );

  // Les colonnes dérivées sont placées APRÈS `r.*` : à nom égal, node-postgres
  // retient la dernière, donc la valeur dérivée. Les dates sont formatées côté
  // serveur — une colonne DATE brute se décale d'un jour au passage par
  // `new Date()` dans le navigateur.
  const result = await query(
    `SELECT r.*,
            COALESCE(TO_CHAR(s.shift_date, 'YYYY-MM-DD'), TO_CHAR(r.start_date, 'YYYY-MM-DD')) AS shift_date,
            TO_CHAR(r.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(r.end_date,   'YYYY-MM-DD') AS end_date,
            COALESCE(s.department_id, r.department_id, sch.department_id) AS department_id,
            sch.name AS schedule_name,
            st.name AS shift_type_name, st.color,
            COALESCE(st.start_time, r.start_time) AS start_time,
            COALESCE(st.end_time,   r.end_time)   AS end_time,
            absent.first_name AS absent_first, absent.last_name AS absent_last, absent.speciality AS absent_speciality,
            replacement.first_name AS replacement_first, replacement.last_name AS replacement_last,
            requester.first_name AS requested_by_first, requester.last_name AS requested_by_last,
            d.name AS department_name, d.name_ar AS department_name_ar
     ${fromClause}
     WHERE ${conditions.join(' AND ')}
     ORDER BY CASE r.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END, r.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, parseInt(limit), offset]
  );

  return res.json({
    success: true, data: result.rows,
    pagination: { total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
  });
};

const createReplacement = async (req, res) => {
  const { shiftId, absenceId, notes, urgency } = req.body;
  const eid = req.user.isSuperAdmin ? (req.body.establishmentId || req.user.establishmentId) : req.user.establishmentId;

  const shift = await query('SELECT * FROM shifts WHERE id = $1', [shiftId]);
  if (!shift.rows[0]) return res.status(404).json({ success: false, message: 'Garde introuvable' });

  const result = await query(
    `INSERT INTO replacements (establishment_id, shift_id, absent_user_id, absence_id, urgency, notes, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [eid, shiftId, shift.rows[0].user_id, absenceId || null, urgency || 'normal', notes, req.user.id]
  );

  // Trouver et proposer des candidats
  const candidates = await findCandidates(shiftId, eid, shift.rows[0].department_id);
  for (const candidate of candidates.slice(0, 5)) {
    await query(
      `INSERT INTO replacement_candidates (replacement_id, user_id, score, notified_at)
       VALUES ($1,$2,$3,NOW())`,
      [result.rows[0].id, candidate.id, candidate.score]
    );
  }

  return res.status(201).json({ success: true, data: result.rows[0], candidates: candidates.slice(0, 5) });
};

const acceptReplacement = async (req, res) => {
  const { replacementUserId } = req.body;
  const result = await query(
    `UPDATE replacements SET status = 'accepted', replacement_user_id = $1, accepted_at = NOW(), updated_at = NOW()
     WHERE id = $2 RETURNING *`,
    [replacementUserId, req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Remplacement introuvable' });

  // Marquer la garde comme remplacée et créer une nouvelle garde pour le remplaçant
  const repl = result.rows[0];
  const origShift = await query('SELECT * FROM shifts WHERE id = $1', [repl.shift_id]);
  const os = origShift.rows[0];

  await query(`UPDATE shifts SET status = 'replaced', updated_at = NOW() WHERE id = $1`, [repl.shift_id]);
  await query(
    `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, status, is_extra, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'planned',TRUE,'Remplacement',$7)`,
    [os.schedule_id, os.establishment_id, os.department_id, replacementUserId, os.shift_type_id, os.shift_date, req.user.id]
  );

  return res.json({ success: true, data: result.rows[0], message: 'Remplacement accepté et garde créée' });
};

const rejectReplacement = async (req, res) => {
  const result = await query(
    `UPDATE replacements SET status = 'rejected', updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  return res.json({ success: true, data: result.rows[0], message: 'Remplacement rejeté' });
};

const getCandidates = async (req, res) => {
  const repl = await query('SELECT * FROM replacements WHERE id = $1', [req.params.id]);
  if (!repl.rows[0]) return res.status(404).json({ success: false, message: 'Remplacement introuvable' });
  const r = repl.rows[0];

  const shift = await query('SELECT * FROM shifts WHERE id = $1', [r.shift_id]);
  const candidates = await findCandidates(r.shift_id, r.establishment_id, shift.rows[0].department_id);
  return res.json({ success: true, data: candidates });
};

module.exports = { getReplacements, createReplacement, acceptReplacement, rejectReplacement, getCandidates };
