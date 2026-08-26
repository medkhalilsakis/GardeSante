/**
 * Supervision plateforme (Lot 6) — Super Admin, LECTURE SEULE.
 *
 * « Le Super Admin ... permet de voir (consulter uniquement) toutes les gardes
 * de chaque hôpital » : ce fichier n'expose donc aucune écriture, aucun statut
 * modifiable, aucune confirmation. Le seul verbe HTTP monté est GET.
 *
 * Fichier NEUF : `admin.controller.js` n'est pas modifié. Les gardes sont lues
 * dans `schedules.metadata.spreadsheet` via le lecteur partagé — jamais dans la
 * table `shifts`, que ce flux n'alimente pas.
 */

const { query } = require('../../config/database');
const {
  rosterOnDate,
  countDuty,
  distinctDutyStaff,
  dateKey,
} = require('../schedules/spreadsheet-reader');

/** Toute cette surface est réservée au super admin, sans exception. */
const requireSuperAdmin = (req, res) => {
  if (req.user.isSuperAdmin) return true;
  res.status(403).json({
    success: false,
    message: 'Réservé au Super Admin',
    message_ar: 'مخصص للمشرف العام',
  });
  return false;
};

/**
 * GET /api/admin-oversight/establishments
 * Un hôpital par ligne, avec sa volumétrie : de quoi choisir où regarder avant
 * d'ouvrir un tableau. Les compteurs viennent du tableur, pas de `shifts`.
 */
const listEstablishments = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const today = dateKey(new Date());

    const [estRes, schedRes, absRes, repRes] = await Promise.all([
      query(
        `SELECT e.id, e.name, e.code, e.city, e.is_active,
                (SELECT COUNT(*) FROM users u WHERE u.establishment_id = e.id AND u.is_active = TRUE) AS staff_count,
                (SELECT COUNT(*) FROM departments d WHERE d.establishment_id = e.id AND d.is_active = TRUE) AS department_count
         FROM establishments e
         ORDER BY e.name`,
        []
      ),
      query(
        `SELECT s.id, s.establishment_id, s.metadata,
                planning_state(s.status, s.start_date, s.end_date) AS state,
                TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date
         FROM schedules s
         WHERE s.status <> 'draft'`,
        []
      ),
      query(
        `SELECT establishment_id, kind, COUNT(*) AS total
         FROM absences
         WHERE status <> 'cancelled' AND $1::date BETWEEN start_date AND end_date
         GROUP BY establishment_id, kind`,
        [today]
      ),
      query(
        `SELECT establishment_id, status, COUNT(*) AS total
         FROM replacements
         GROUP BY establishment_id, status`,
        []
      ),
    ]);

    // Agrégation en mémoire : une seule passe par jeu de lignes, indexée par hôpital.
    const guardsToday = new Map();
    const byState = new Map();
    for (const s of schedRes.rows) {
      const bucket = byState.get(s.establishment_id) || { soumis: 0, en_cours: 0, termine: 0 };
      if (bucket[s.state] != null) bucket[s.state] += 1;
      byState.set(s.establishment_id, bucket);
      if (s.state !== 'en_cours') continue;
      const n = rosterOnDate(s, today).length;
      if (n) guardsToday.set(s.establishment_id, (guardsToday.get(s.establishment_id) || 0) + n);
    }

    const absByEst = absRes.rows.reduce((acc, r) => {
      const b = acc[r.establishment_id] || { leave: 0, shift_absence: 0, late: 0 };
      b[r.kind] = Number(r.total) || 0;
      acc[r.establishment_id] = b;
      return acc;
    }, {});
    const repByEst = repRes.rows.reduce((acc, r) => {
      const b = acc[r.establishment_id] || { total: 0, pending: 0 };
      b.total += Number(r.total) || 0;
      if (r.status === 'pending') b.pending += Number(r.total) || 0;
      acc[r.establishment_id] = b;
      return acc;
    }, {});

    const establishments = estRes.rows.map((e) => {
      const st = byState.get(e.id) || { soumis: 0, en_cours: 0, termine: 0 };
      const ab = absByEst[e.id] || { leave: 0, shift_absence: 0, late: 0 };
      const rp = repByEst[e.id] || { total: 0, pending: 0 };
      return {
        id: e.id,
        name: e.name,
        code: e.code,
        city: e.city,
        isActive: e.is_active,
        staffCount: Number(e.staff_count) || 0,
        departmentCount: Number(e.department_count) || 0,
        schedulesSubmitted: st.soumis,
        schedulesActive: st.en_cours,
        schedulesFinished: st.termine,
        guardsToday: guardsToday.get(e.id) || 0,
        leavesToday: ab.leave,
        shiftAbsencesToday: ab.shift_absence,
        latesToday: ab.late,
        replacementsTotal: rp.total,
        replacementsPending: rp.pending,
      };
    });

    return res.json({
      success: true,
      data: {
        today,
        establishments,
        summary: {
          establishments: establishments.length,
          active: establishments.filter((e) => e.isActive).length,
          staff: establishments.reduce((a, e) => a + e.staffCount, 0),
          guardsToday: establishments.reduce((a, e) => a + e.guardsToday, 0),
          schedulesSubmitted: establishments.reduce((a, e) => a + e.schedulesSubmitted, 0),
          schedulesActive: establishments.reduce((a, e) => a + e.schedulesActive, 0),
          replacementsPending: establishments.reduce((a, e) => a + e.replacementsPending, 0),
          shiftAbsencesToday: establishments.reduce((a, e) => a + e.shiftAbsencesToday, 0),
        },
      },
    });
  } catch (err) {
    console.error('adminOversight.listEstablishments error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des établissements' });
  }
};

/**
 * GET /api/admin-oversight/schedules
 * Les gardes de tous les hôpitaux (ou d'un seul via `?establishmentId=`).
 * Les brouillons restent invisibles : ils appartiennent à leur chef de service.
 */
const listSchedules = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const conditions = ["s.status <> 'draft'"];
    const params = [];

    if (req.query.establishmentId) {
      params.push(req.query.establishmentId);
      conditions.push(`s.establishment_id = $${params.length}`);
    }
    if (req.query.departmentId) {
      params.push(req.query.departmentId);
      conditions.push(`s.department_id = $${params.length}`);
    }

    const result = await query(
      `SELECT s.id, s.name, s.status, s.department_id, s.establishment_id, s.metadata, s.notes,
              TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date,
              planning_state(s.status, s.start_date, s.end_date) AS state,
              d.name AS department_name,
              e.name AS establishment_name, e.code AS establishment_code
       FROM schedules s
       LEFT JOIN departments d ON s.department_id = d.id
       LEFT JOIN establishments e ON s.establishment_id = e.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.start_date DESC
       LIMIT 300`,
      params
    );

    const state = req.query.state;
    const schedules = result.rows
      .filter((row) => !state || row.state === state)
      .map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        state: row.state,
        startDate: row.start_date,
        endDate: row.end_date,
        notes: row.notes,
        departmentId: row.department_id,
        departmentName: row.department_name,
        establishmentId: row.establishment_id,
        establishmentName: row.establishment_name,
        establishmentCode: row.establishment_code,
        guardCount: countDuty(row),
        staffCount: distinctDutyStaff(row).size,
      }));

    return res.json({ success: true, data: { schedules, total: schedules.length } });
  } catch (err) {
    console.error('adminOversight.listSchedules error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des plannings' });
  }
};

/**
 * GET /api/admin-oversight/absences
 * Absences (garde courante, retards) et congés d'un hôpital, lecture seule.
 */
const listAbsences = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const { establishmentId, kind, from, to, limit = 200 } = req.query;
    const conditions = ["a.status <> 'cancelled'"];
    const params = [];

    if (establishmentId) {
      params.push(establishmentId);
      conditions.push(`a.establishment_id = $${params.length}`);
    }
    if (kind) {
      params.push(kind);
      conditions.push(`a.kind = $${params.length}`);
    }
    if (from) { params.push(from); conditions.push(`a.end_date   >= $${params.length}::date`); }
    if (to)   { params.push(to);   conditions.push(`a.start_date <= $${params.length}::date`); }

    params.push(parseInt(limit));

    const result = await query(
      `SELECT a.id, a.kind, a.reason, a.status, a.is_justified, a.created_at,
              TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
              TO_CHAR(a.start_time, 'HH24:MI') AS start_time,
              at.name AS type_name, at.color AS type_color,
              u.first_name, u.last_name, u.avatar_url,
              d.name AS department_name,
              e.name AS establishment_name
       FROM absences a
       LEFT JOIN absence_types at ON a.absence_type_id = at.id
       JOIN users u ON a.user_id = u.id
       LEFT JOIN departments d ON a.department_id = d.id
       JOIN establishments e ON a.establishment_id = e.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.start_date DESC
       LIMIT $${params.length}`,
      params
    );

    // Même forme que `listSchedules` : enveloppe nommée et clés camelCase, pour
    // que les trois endpoints de ce module se lisent de la même façon côté client.
    const absences = result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      reason: row.reason,
      isJustified: row.is_justified,
      startDate: row.start_date,
      endDate: row.end_date,
      startTime: row.start_time,
      typeName: row.type_name,
      typeColor: row.type_color,
      firstName: row.first_name,
      lastName: row.last_name,
      avatarUrl: row.avatar_url,
      departmentName: row.department_name,
      establishmentName: row.establishment_name,
      createdAt: row.created_at,
    }));

    return res.json({ success: true, data: { absences, total: absences.length } });
  } catch (err) {
    console.error('adminOversight.listAbsences error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des absences' });
  }
};

/**
 * GET /api/admin-oversight/replacements
 * Remplacements d'un hôpital, lecture seule — aucune action possible ici.
 */
const listReplacements = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const { establishmentId, status, limit = 200 } = req.query;
    const conditions = ['1=1'];
    const params = [];

    if (establishmentId) {
      params.push(establishmentId);
      conditions.push(`r.establishment_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    params.push(parseInt(limit));

    // Forme identique à `listOverlayReplacements` (Lot « remplacements ») : les
    // binômes vivent dans `replacement_items`, pas en colonnes sur la ligne mère.
    const result = await query(
      `SELECT r.id, r.status, r.confirmation_status, r.scope, r.reason, r.rejection_reason,
              r.created_at, r.confirmed_at, r.created_by_role,
              TO_CHAR(r.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(r.end_date,   'YYYY-MM-DD') AS end_date,
              TO_CHAR(r.start_time, 'HH24:MI') AS start_time,
              TO_CHAR(r.end_time,   'HH24:MI') AS end_time,
              r.schedule_id, s.name AS schedule_name,
              d.name AS department_name,
              e.name AS establishment_name, e.id AS establishment_id,
              COALESCE(items.items, '[]'::json) AS items
       FROM replacements r
       LEFT JOIN schedules s ON r.schedule_id = s.id
       LEFT JOIN departments d ON r.department_id = d.id
       JOIN establishments e ON r.establishment_id = e.id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'absentName',      TRIM(au.first_name || ' ' || au.last_name),
           'replacementName', TRIM(ru.first_name || ' ' || ru.last_name),
           'isCrossDepartment', ri.is_cross_department
         )) AS items
         FROM replacement_items ri
         JOIN users au ON au.id = ri.absent_user_id
         JOIN users ru ON ru.id = ri.replacement_user_id
         WHERE ri.replacement_id = r.id
       ) items ON TRUE
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    const replacements = result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      confirmationStatus: row.confirmation_status,
      scope: row.scope,
      reason: row.reason,
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      confirmedAt: row.confirmed_at,
      createdByRole: row.created_by_role,
      startDate: row.start_date,
      endDate: row.end_date,
      startTime: row.start_time,
      endTime: row.end_time,
      scheduleId: row.schedule_id,
      scheduleName: row.schedule_name,
      departmentName: row.department_name,
      establishmentName: row.establishment_name,
      establishmentId: row.establishment_id,
      items: row.items || [],
    }));

    return res.json({ success: true, data: { replacements, total: replacements.length } });
  } catch (err) {
    console.error('adminOversight.listReplacements error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des remplacements' });
  }
};

module.exports = {
  listEstablishments,
  listSchedules,
  listAbsences,
  listReplacements,
};