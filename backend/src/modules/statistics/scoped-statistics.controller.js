/**
 * Statistiques par portée (Lot 3).
 *
 * Une seule route sert les cinq dashboards ; la portée est déduite du rôle et
 * jamais du client :
 *   Super Admin        → plateforme (tous les hôpitaux), ou un hôpital ciblé
 *   Directeur / Admin  → son établissement
 *   Surveillant Gén.   → son établissement
 *   Chef / Surveillant → ses services uniquement
 *
 * Lecture seule. Les gardes proviennent de `schedules.metadata.spreadsheet`
 * (cf. spreadsheet-reader.js), la table `shifts` n'étant pas alimentée par le
 * flux tableur. Le fichier `statistics.controller.js` existant n'est pas modifié.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { dutyEntries, dateKey } = require('../schedules/spreadsheet-reader');

const SCOPE_PLATFORM = 'platform';
const SCOPE_ESTABLISHMENT = 'establishment';
const SCOPE_DEPARTMENTS = 'departments';

/** Portée effective de l'utilisateur — jamais élargie par un paramètre client. */
const resolveStatsScope = async (user, queryParams = {}) => {
  if (user.isSuperAdmin || user.roleCode === ROLES.SUPER_ADMIN) {
    // Le Super Admin peut se restreindre à un hôpital, mais pas descendre plus bas.
    if (queryParams.establishmentId) {
      return { kind: SCOPE_ESTABLISHMENT, establishmentId: queryParams.establishmentId, label: 'Établissement ciblé' };
    }
    return { kind: SCOPE_PLATFORM, label: 'Plateforme' };
  }

  if ([ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN, ROLES.GENERAL_SUPERVISOR].includes(user.roleCode)) {
    return { kind: SCOPE_ESTABLISHMENT, establishmentId: user.establishmentId, label: user.establishmentName || 'Établissement' };
  }

  if ([ROLES.DEPARTMENT_HEAD, ROLES.SERVICE_SUPERVISOR].includes(user.roleCode)) {
    const { rows } = await query(
      'SELECT department_id FROM user_departments WHERE user_id = $1',
      [user.id]
    );
    return {
      kind: SCOPE_DEPARTMENTS,
      establishmentId: user.establishmentId,
      departmentIds: rows.map((r) => r.department_id),
      label: 'Mes services',
    };
  }

  return null;
};

// ============================================================
// GET /api/statistics/scoped?from=&to=&establishmentId=
// ============================================================
const getScopedStatistics = async (req, res) => {
  try {
    const scope = await resolveStatsScope(req.user, req.query);
    if (!scope) {
      return res.status(403).json({ success: false, message: 'Aucune statistique disponible pour votre rôle' });
    }
    if (scope.kind === SCOPE_DEPARTMENTS && !scope.departmentIds.length) {
      return res.json({
        success: true,
        data: { scope: scope.kind, scopeLabel: scope.label, period: null, summary: emptySummary(), byDepartment: [], byState: [], topStaff: [], timeline: [] },
      });
    }

    const today = dateKey(new Date());
    // Fenêtre par défaut : le mois courant.
    const from = dateKey(req.query.from) || `${today.substring(0, 7)}-01`;
    const to = dateKey(req.query.to) || today;
    if (to < from) {
      return res.status(400).json({ success: false, message: 'La date de fin précède la date de début' });
    }

    const conditions = ['sch.start_date <= $2::date', 'sch.end_date >= $1::date'];
    const params = [from, to];
    let idx = 3;

    if (scope.kind === SCOPE_ESTABLISHMENT) {
      conditions.push(`sch.establishment_id = $${idx}`);
      params.push(scope.establishmentId);
      idx++;
    } else if (scope.kind === SCOPE_DEPARTMENTS) {
      conditions.push(`sch.department_id = ANY($${idx})`);
      params.push(scope.departmentIds);
      idx++;
    }

    const { rows: schedules } = await query(
      `SELECT sch.id, sch.name, sch.status, sch.department_id, sch.establishment_id, sch.metadata,
              TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS end_date,
              d.name AS department_name,
              e.name AS establishment_name,
              planning_state(sch.status, sch.start_date, sch.end_date) AS state
         FROM schedules sch
         LEFT JOIN departments d ON d.id = sch.department_id
         LEFT JOIN establishments e ON e.id = sch.establishment_id
        WHERE ${conditions.join(' AND ')}`,
      params
    );

    const byDepartment = new Map();
    const byState = new Map();
    const byStaff = new Map();
    const byDate = new Map();
    let totalGuards = 0;

    for (const schedule of schedules) {
      byState.set(schedule.state, (byState.get(schedule.state) || 0) + 1);

      // Les gardes sont lues comme le fait le tableur lui-même : cases cochées de
      // la ligne, ou période de participation quand elle n'en porte aucune.
      for (const entry of dutyEntries(schedule, from, to)) {
        totalGuards += 1;

        const deptId = entry.departmentId || schedule.department_id || 'sans-service';
        if (!byDepartment.has(deptId)) {
          byDepartment.set(deptId, {
            departmentId: deptId === 'sans-service' ? null : deptId,
            departmentName: schedule.department_name || 'Sans service',
            establishmentName: schedule.establishment_name || null,
            guards: 0,
            staff: new Set(),
          });
        }
        const dept = byDepartment.get(deptId);
        dept.guards += 1;
        if (entry.userId) dept.staff.add(entry.userId);

        if (entry.userId) {
          if (!byStaff.has(entry.userId)) {
            byStaff.set(entry.userId, {
              userId: entry.userId,
              name: `${entry.firstName} ${entry.lastName}`.trim() || 'Agent',
              roleName: entry.roleName,
              departmentName: schedule.department_name || null,
              guards: 0,
            });
          }
          const staff = byStaff.get(entry.userId);
          staff.guards += 1;
        }

        byDate.set(entry.date, (byDate.get(entry.date) || 0) + 1);
      }
    }

    const staffList = [...byStaff.values()].sort((a, b) => b.guards - a.guards);
    const timeline = [...byDate.entries()]
      .map(([date, count]) => ({ date, guards: count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Équité de la charge : écart entre l'agent le plus et le moins sollicité.
    const loads = staffList.map((s) => s.guards);
    const maxLoad = loads.length ? Math.max(...loads) : 0;
    const minLoad = loads.length ? Math.min(...loads) : 0;
    const avgLoad = loads.length ? totalGuards / loads.length : 0;

    return res.json({
      success: true,
      data: {
        scope: scope.kind,
        scopeLabel: scope.label,
        period: { from, to },
        summary: {
          totalGuards,
          schedulesCount: schedules.length,
          departmentsCount: byDepartment.size,
          staffCount: byStaff.size,
          daysCovered: timeline.length,
          averagePerDay: timeline.length ? Math.round((totalGuards / timeline.length) * 10) / 10 : 0,
          averagePerStaff: Math.round(avgLoad * 10) / 10,
          maxLoad,
          minLoad,
          loadGap: maxLoad - minLoad,
        },
        byDepartment: [...byDepartment.values()]
          .map((d) => ({ ...d, staff: d.staff.size }))
          .sort((a, b) => b.guards - a.guards),
        byState: [...byState.entries()].map(([state, count]) => ({ state, count })),
        topStaff: staffList.slice(0, 20),
        timeline,
      },
    });
  } catch (err) {
    console.error('getScopedStatistics error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du calcul des statistiques' });
  }
};

const emptySummary = () => ({
  totalGuards: 0, schedulesCount: 0, departmentsCount: 0,
  staffCount: 0, daysCovered: 0, averagePerDay: 0, averagePerStaff: 0,
  maxLoad: 0, minLoad: 0, loadGap: 0,
});

module.exports = { getScopedStatistics, resolveStatsScope };
