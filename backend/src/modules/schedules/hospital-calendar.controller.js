/**
 * Calendrier hôpital (Lot 3) — toutes les gardes de tous les services d'un
 * établissement, agrégées par jour.
 *
 * Lecture seule : aucun INSERT/UPDATE, ni sur `schedules` ni sur `shifts`.
 * Les brouillons ne sont visibles que par leur service (ils ne sont pas encore
 * opposables à l'hôpital) ; le reste est visible à l'échelle de l'établissement.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { rosterOnDate, datesBetween, dateKey, planningState } = require('./spreadsheet-reader');

/** Services dont l'utilisateur est membre (chef ou surveillant). */
const getUserDepartmentIds = async (userId) => {
  const { rows } = await query(
    'SELECT department_id FROM user_departments WHERE user_id = $1',
    [userId]
  );
  return rows.map((r) => r.department_id);
};

// ============================================================
// GET /api/hospital-calendar
// ?from=YYYY-MM-DD&to=YYYY-MM-DD&departmentId=&state=
// ============================================================
const getHospitalCalendar = async (req, res) => {
  // Le Super Admin consulte l'hôpital qu'il cible, les autres le leur.
  const establishmentId = req.user.isSuperAdmin
    ? (req.query.establishmentId || req.user.establishmentId)
    : req.user.establishmentId;

  if (!establishmentId) {
    return res.status(400).json({ success: false, message: 'Aucun établissement à consulter' });
  }

  const today = dateKey(new Date());
  const from = dateKey(req.query.from) || today;
  const to = dateKey(req.query.to) || from;
  if (to < from) {
    return res.status(400).json({ success: false, message: 'La date de fin précède la date de début' });
  }

  const { departmentId, state } = req.query;

  try {
    // Les plannings qui chevauchent la fenêtre demandée.
    const conditions = [
      'sch.establishment_id = $1',
      'sch.start_date <= $3::date',
      'sch.end_date   >= $2::date',
    ];
    const params = [establishmentId, from, to];
    let idx = 4;

    if (departmentId) {
      conditions.push(`sch.department_id = $${idx}`);
      params.push(departmentId);
      idx++;
    }

    const { rows: schedules } = await query(
      `SELECT sch.id, sch.name, sch.status, sch.department_id, sch.metadata,
              TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS end_date,
              d.name AS department_name, d.department_type,
              CASE WHEN sch.status IN ('archived','rejected') THEN 'suspendu'
                   ELSE planning_state(sch.status, sch.start_date, sch.end_date) END AS state
         FROM schedules sch
         LEFT JOIN departments d ON d.id = sch.department_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY sch.start_date DESC`,
      params
    );

    // Cloisonnement des brouillons : un chef/surveillant ne voit que ceux de ses
    // services ; la direction et le SG voient l'hôpital, brouillons compris.
    const scopedRoles = [ROLES.DEPARTMENT_HEAD, ROLES.SERVICE_SUPERVISOR];
    let ownDeptIds = null;
    if (!req.user.isSuperAdmin && scopedRoles.includes(req.user.roleCode)) {
      ownDeptIds = await getUserDepartmentIds(req.user.id);
    }

    const visible = schedules.filter((s) => {
      if (s.status === 'draft' && ownDeptIds && !ownDeptIds.includes(s.department_id)) return false;
      if (state && s.state !== state) return false;
      return true;
    });

    const { rows: holidays } = await query(
      `SELECT id, name, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, category
         FROM public_holidays
        WHERE start_date <= $2::date AND end_date >= $1::date
        ORDER BY start_date`, [from, to]
    );

    // Agrégation jour par jour, bornée à la fenêtre demandée.
    const byDate = new Map();
    const departments = new Map();
    const perSchedule = new Map();
    const staffSeen = new Set();
    let totalGuards = 0;

    for (const schedule of visible) {
      const derived = schedule.state || planningState(schedule.status, schedule.start_date, schedule.end_date, today);
      if (schedule.department_id && !departments.has(schedule.department_id)) {
        departments.set(schedule.department_id, {
          id: schedule.department_id,
          name: schedule.department_name || 'Service',
          type: schedule.department_type || null,
          guards: 0,
        });
      }
      perSchedule.set(schedule.id, 0);

      // Le code journalier du tableur est FACULTATIF : un planning validé peut ne
      // porter que la période de participation de chaque agent (« Période début /
      // fin »), sans aucune lettre dans les cases. C'est le cas de tous les
      // plannings réels de cette base — `row.shifts` y est vide. `guardEntries()`,
      // qui ne lit QUE ces codes, renvoyait donc une liste vide et le calendrier
      // restait blanc alors que des gardes étaient bien en vigueur.
      //
      // On parcourt donc les jours de la fenêtre et on interroge `rosterOnDate()`,
      // la lecture partagée qui applique les deux niveaux de saisie dans l'ordre
      // (code du jour d'abord, période de la ligne ensuite) et qui alimente déjà
      // correctement l'appel du jour et le journal de service.
      const windowStart = schedule.start_date && schedule.start_date > from ? schedule.start_date : from;
      const windowEnd   = schedule.end_date   && schedule.end_date   < to   ? schedule.end_date   : to;
      if (windowEnd < windowStart) continue;

      for (const dayKey of datesBetween(windowStart, windowEnd)) {
        for (const entry of rosterOnDate(schedule, dayKey)) {
          if (!entry.isGuard) continue;

          if (!byDate.has(entry.date)) {
            byDate.set(entry.date, { date: entry.date, total: 0, byCode: {}, guards: [] });
          }
          const day = byDate.get(entry.date);
          day.total += 1;
          // Une garde déduite de la période n'a pas de code : elle est comptée
          // sous « DS » (De service) plutôt que sous une clé vide.
          const bucket = entry.code || 'DS';
          day.byCode[bucket] = (day.byCode[bucket] || 0) + 1;
          day.guards.push({
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            state: derived,
            departmentId: entry.departmentId,
            departmentName: schedule.department_name || 'Service',
            userId: entry.userId,
            name: `${entry.firstName} ${entry.lastName}`.trim() || 'Agent',
            roleName: entry.roleName,
            code: entry.code,
            label: entry.label,
            shiftStart: entry.shiftStart,
            shiftEnd: entry.shiftEnd,
          });
          totalGuards += 1;
          perSchedule.set(schedule.id, perSchedule.get(schedule.id) + 1);
          if (entry.userId) staffSeen.add(entry.userId);
          const dept = departments.get(schedule.department_id);
          if (dept) dept.guards += 1;
        }
      }
    }

    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    const peak = days.reduce((max, d) => Math.max(max, d.total), 0);

    return res.json({
      success: true,
      data: {
        period: { from, to },
        days,
        departments: [...departments.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
        schedules: visible.map((s) => ({
          id: s.id,
          name: s.name,
          state: s.state,
          status: s.status,
          departmentId: s.department_id,
          departmentName: s.department_name,
          startDate: s.start_date,
          endDate: s.end_date,
          guards: perSchedule.get(s.id) || 0,
        })),
        holidays,
        summary: {
          totalGuards,
          daysCovered: days.length,
          staffCount: staffSeen.size,
          schedulesCount: visible.length,
          peakPerDay: peak,
          averagePerDay: days.length ? Math.round((totalGuards / days.length) * 10) / 10 : 0,
        },
      },
    });
  } catch (err) {
    console.error('getHospitalCalendar error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du calendrier' });
  }
};

module.exports = { getHospitalCalendar };
