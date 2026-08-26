/**
 * Boîte de réception des plannings — « Planning à consulter » (point 3).
 *
 * Espace indépendant du surveillant de service : il y retrouve les plannings de
 * SES services, une fois envoyés par le chef, pour les consulter et proposer des
 * modifications. Il n'y a ni approbation ni refus (point 4) — la consultation et
 * la proposition sont les seules actions.
 *
 * Fichier NEUF : aucun contrôleur existant n'est modifié.
 *
 * Pourquoi ne pas réutiliser `/api/supervision/schedules` : `SUPERVISION_ROLES`
 * (supervision.controller.js) = surveillant général + directeur + admin hôpital.
 * Le `service_supervisor` en est volontairement exclu, et sa portée n'est pas
 * l'établissement mais ses seuls services (`user_departments`).
 *
 * Portées :
 *   - service_supervisor / department_head : leurs services (`user_departments`)
 *   - general_supervisor / director / hospital_admin : tout l'établissement
 *   - super_admin : l'établissement visé par `?establishmentId=`, sinon le sien
 *
 * Un brouillon n'est jamais « à consulter » : `status <> 'draft'` dans tous les cas.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { countDuty, distinctDutyStaff } = require('./spreadsheet-reader');

/** Rôles dont la portée est l'établissement entier. */
const ESTABLISHMENT_SCOPE = [
  ROLES.GENERAL_SUPERVISOR,
  ROLES.DIRECTOR,
  ROLES.HOSPITAL_ADMIN,
];

/** Rôles dont la portée se limite aux services d'appartenance. */
const DEPARTMENT_SCOPE = [
  ROLES.SERVICE_SUPERVISOR,
  ROLES.DEPARTMENT_HEAD,
];

const forbidden = (res) => res.status(403).json({
  success: false,
  message: 'Cet espace est réservé aux surveillants et à la hiérarchie du service',
  message_ar: 'هذه المساحة مخصصة للمشرفين وللتسلسل الإداري للمصلحة',
});

/**
 * GET /api/schedule-inbox
 * Query : `?state=` (brouillon|soumis|en_cours|termine), `?departmentId=`,
 *         `?establishmentId=` (super admin seulement).
 */
const listInbox = async (req, res) => {
  try {
    const { user } = req;
    const isSuperAdmin = user.isSuperAdmin || user.roleCode === ROLES.SUPER_ADMIN;
    const byEstablishment = isSuperAdmin || ESTABLISHMENT_SCOPE.includes(user.roleCode);
    const byDepartment = DEPARTMENT_SCOPE.includes(user.roleCode);

    if (!byEstablishment && !byDepartment) return forbidden(res);

    const establishmentId = isSuperAdmin
      ? (req.query.establishmentId || user.establishmentId)
      : user.establishmentId;

    const conditions = ['s.establishment_id = $1', "s.status <> 'draft'"];
    const params = [establishmentId];

    // Portée service : on borne aux services de l'appelant. Chefs comme
    // surveillants vivent dans `user_departments` — seul `is_head` les distingue,
    // et il ne doit pas filtrer ici (le surveillant n'est pas chef).
    if (!byEstablishment) {
      params.push(user.id);
      conditions.push(`s.department_id IN (
        SELECT ud.department_id FROM user_departments ud WHERE ud.user_id = $${params.length}
      )`);
    }

    if (req.query.departmentId) {
      params.push(req.query.departmentId);
      conditions.push(`s.department_id = $${params.length}`);
    }

    const result = await query(
      `SELECT s.id, s.name, s.status, s.department_id, s.metadata, s.notes,
              TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date,
              TO_CHAR(s.updated_at, 'YYYY-MM-DD') AS updated_on,
              planning_state(s.status, s.start_date, s.end_date) AS state,
              d.name AS department_name,
              auth.first_name AS author_first_name,
              auth.last_name  AS author_last_name,
              (SELECT COUNT(*) FROM schedule_change_proposals p
                WHERE p.schedule_id = s.id AND p.status = 'pending') AS pending_proposals,
              (SELECT COUNT(*) FROM schedule_change_proposals p
                WHERE p.schedule_id = s.id AND p.proposed_by = $${params.length + 1}) AS my_proposals
       FROM schedules s
       LEFT JOIN departments d ON s.department_id = d.id
       LEFT JOIN users auth ON auth.id = s.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.start_date DESC
       LIMIT 200`,
      [...params, user.id]
    );

    const wanted = req.query.state;
    const schedules = result.rows
      .filter((row) => !wanted || row.state === wanted)
      .map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        state: row.state,
        startDate: row.start_date,
        endDate: row.end_date,
        updatedOn: row.updated_on,
        departmentId: row.department_id,
        departmentName: row.department_name,
        authorName: [row.author_first_name, row.author_last_name].filter(Boolean).join(' ') || null,
        notes: row.notes,
        pendingProposals: Number(row.pending_proposals) || 0,
        myProposals: Number(row.my_proposals) || 0,
        // Lecture « de service » : la plupart des chefs ne saisissent que la
        // période de participation de chaque agent. Ne compter que les cases
        // cochées affichait « 0 garde · 0 agent » sur presque toutes les cartes
        // de « Planning à consulter ».
        guardCount: countDuty(row),
        staffCount: distinctDutyStaff(row).size,
      }));

    return res.json({
      success: true,
      data: {
        schedules,
        total: schedules.length,
        scope: byEstablishment ? 'establishment' : 'departments',
      },
    });
  } catch (err) {
    console.error('scheduleInbox.listInbox error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des plannings à consulter' });
  }
};

module.exports = { listInbox };
