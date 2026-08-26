/**
 * Supervision hôpital (Lot 5) — portée établissement, réservée au surveillant
 * général, au directeur, à l'admin hôpital et au super admin.
 *
 * Fichier NEUF : aucun contrôleur existant n'est modifié. Les briques déjà
 * livrées sont réutilisées telles quelles — `spreadsheet-reader` pour lire les
 * gardes (jamais la table `shifts`), `planning_state()` pour l'état dérivé.
 *
 * INVARIANT À NE PAS ROUVRIR : le surveillant général possède la permission
 * `replacements.approve` (migration 006) mais la confirmation d'un remplacement
 * reste gatée par rôle dans `replacements-overlay.controller.js`. Aucun endpoint
 * d'écriture sur les remplacements n'est exposé ici.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToEstablishment, emitToUser } = require('../../realtime/emit');
const history = require('../history/history.controller');
const {
  countDuty,
  distinctDutyStaff,
  rosterOnDate,
  dateKey,
} = require('../schedules/spreadsheet-reader');
const conflictRules = require('./conflict-rules');

/** Rôles autorisés sur la supervision hôpital. */
const SUPERVISION_ROLES = [
  ROLES.GENERAL_SUPERVISOR,
  ROLES.DIRECTOR,
  ROLES.HOSPITAL_ADMIN,
];

/**
 * Portée : toujours un établissement. Le super admin peut viser un hôpital
 * précis via `?establishmentId=`, sinon il reste sur le sien.
 */
const resolveScope = (user, queryParams = {}) => {
  if (user.isSuperAdmin || user.roleCode === ROLES.SUPER_ADMIN) {
    return { establishmentId: queryParams.establishmentId || user.establishmentId, isSuperAdmin: true };
  }
  if (!SUPERVISION_ROLES.includes(user.roleCode)) return null;
  return { establishmentId: user.establishmentId, isSuperAdmin: false };
};

const forbidden = (res) => res.status(403).json({
  success: false,
  message: 'Cet écran est réservé à la supervision générale et à la direction',
  message_ar: 'هذه الشاشة مخصصة للإشراف العام والإدارة',
});

/**
 * GET /api/supervision/schedules
 * Plannings de l'hôpital, hors brouillon, avec état dérivé et volumétrie lue
 * depuis le tableur. Le SG « reçoit » ici ce que les chefs ont soumis.
 */
const listSchedules = async (req, res) => {
  try {
    const scope = resolveScope(req.user, req.query);
    if (!scope) return forbidden(res);

    const conditions = ['s.establishment_id = $1', "s.status <> 'draft'"];
    const params = [scope.establishmentId];

    if (req.query.departmentId) {
      params.push(req.query.departmentId);
      conditions.push(`s.department_id = $${params.length}`);
    }

    const result = await query(
      `SELECT s.id, s.name, s.status, s.department_id, s.metadata, s.notes,
              TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date,
              planning_state(s.status, s.start_date, s.end_date) AS state,
              d.name AS department_name,
              (SELECT COUNT(*) FROM schedule_change_proposals p
                WHERE p.schedule_id = s.id AND p.status = 'pending') AS pending_proposals
       FROM schedules s
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.start_date DESC
       LIMIT 200`,
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
        departmentId: row.department_id,
        departmentName: row.department_name,
        notes: row.notes,
        pendingProposals: Number(row.pending_proposals) || 0,
        // Volumétrie lue comme le tableur se lit : code du jour, sinon période de
        // participation. Compter les seules cases codées affichait « 0 garde ·
        // 0 agent » sur 6 plannings sur 7.
        guardCount: countDuty(row),
        staffCount: distinctDutyStaff(row).size,
      }));

    return res.json({ success: true, data: { schedules, total: schedules.length } });
  } catch (err) {
    console.error('supervision.listSchedules error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des plannings' });
  }
};

/**
 * GET /api/supervision/conflicts
 * Cohérence inter-services — ce que seul le SG peut voir, un chef n'ayant la
 * visibilité que sur son propre service.
 *
 * Trois familles :
 *  - `double_booking` : même agent, même date, deux services différents
 *  - `on_leave`       : agent affecté à une garde alors qu'il est en congé (règle I)
 *  - `uncovered_day`  : journée sans aucune garde dans un planning non terminé
 */
const listConflicts = async (req, res) => {
  try {
    const scope = resolveScope(req.user, req.query);
    if (!scope) return forbidden(res);

    const { rows } = await query(
      `SELECT s.id, s.name, s.status, s.department_id, s.metadata, s.schedule_type,
              TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date,
              planning_state(s.status, s.start_date, s.end_date) AS state,
              d.name AS department_name
       FROM schedules s
       LEFT JOIN departments d ON s.department_id = d.id
       WHERE s.establishment_id = $1 AND s.status <> 'draft'
         AND planning_state(s.status, s.start_date, s.end_date) IN ('soumis', 'en_cours')
       ORDER BY s.start_date DESC
       LIMIT 100`,
      [scope.establishmentId]
    );

    // Index (userId|date) → affectations, lu comme le tableur se lit lui-même
    // (code du jour, sinon période de participation). Voir conflict-rules.js.
    const byUserDate = conflictRules.buildDutyIndex(rows);

    const conflicts = [];

    // 1. Double affectation dans deux services distincts
    conflicts.push(...conflictRules.detectDoubleBooking(byUserDate));

    // 2. Garde posée sur un agent en congé — règle I, vérifiée en base
    const userIds = [...new Set([...byUserDate.keys()].map((k) => k.split('|')[0]))];
    if (userIds.length) {
      const leaves = await query(
        `SELECT a.user_id,
                TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
                t.name AS type_name
         FROM absences a
         LEFT JOIN absence_types t ON a.absence_type_id = t.id
         WHERE a.user_id = ANY($1::uuid[])
           AND a.kind = 'leave'
           AND a.status IN ('approved', 'pending')`,
        [userIds]
      );
      conflicts.push(...conflictRules.detectOnLeave(byUserDate, leaves.rows));
    }

    // 3. Journées non couvertes dans un planning en cours ou à venir
    conflicts.push(...conflictRules.detectUncoveredDays(rows, dateKey(new Date())));

    conflictRules.sortConflicts(conflicts);

    return res.json({
      success: true,
      data: {
        conflicts,
        summary: conflictRules.summarizeConflicts(conflicts),
        schedulesAnalyzed: rows.length,
      },
    });
  } catch (err) {
    console.error('supervision.listConflicts error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'analyse de cohérence' });
  }
};

/**
 * GET /api/supervision/overview
 * Supervision de tous les services : couverture du jour, absentéisme, retards,
 * remplacements, incidents. Les gardes sont lues dans le tableur, jamais dans
 * `shifts` (table non alimentée par ce flux).
 */
const getOverview = async (req, res) => {
  try {
    const scope = resolveScope(req.user, req.query);
    if (!scope) return forbidden(res);

    const eid = scope.establishmentId;
    const today = dateKey(new Date());

    const [estRes, deptRes, schedRes, absRes, alertRes, evtRes, repRes, loanRes] = await Promise.all([
      query('SELECT name FROM establishments WHERE id = $1', [eid]),
      query(
        `SELECT d.id, d.name,
                COUNT(DISTINCT ud.user_id) FILTER (WHERE u.is_active = TRUE) AS staff_count
         FROM departments d
         LEFT JOIN user_departments ud ON d.id = ud.department_id
         LEFT JOIN users u ON ud.user_id = u.id
         WHERE d.establishment_id = $1 AND d.is_active = TRUE
         GROUP BY d.id, d.name
         ORDER BY d.name`,
        [eid]
      ),
      query(
        `SELECT s.id, s.name, s.status, s.department_id, s.metadata,
                TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date,
                planning_state(s.status, s.start_date, s.end_date) AS state
         FROM schedules s
         WHERE s.establishment_id = $1 AND s.status <> 'draft'`,
        [eid]
      ),
      query(
        // Un retard n'est PAS un `kind` : c'est un `shift_absence` dont le type
        // porte le code `retard` et qui renseigne `late_minutes`. Le compteur
        // lisait `kind = 'late'`, valeur qui n'existe dans aucune ligne — d'où
        // « 0 retard » en permanence. Le total des signalements reste inchangé,
        // les retards en sont seulement extraits.
        `SELECT a.kind, a.department_id, COUNT(*) AS total,
                COUNT(*) FILTER (WHERE t.code = 'retard' OR a.late_minutes IS NOT NULL) AS late_total
         FROM absences a
         LEFT JOIN absence_types t ON t.id = a.absence_type_id
         WHERE a.establishment_id = $1
           AND $2::date BETWEEN a.start_date AND a.end_date
           AND a.status <> 'cancelled'
         GROUP BY a.kind, a.department_id`,
        [eid, today]
      ),
      query(
        `SELECT severity, COUNT(*) AS total
         FROM service_alerts
         WHERE establishment_id = $1 AND resolved_at IS NULL
         GROUP BY severity`,
        [eid]
      ),
      query(
        `SELECT event_type, COUNT(*) AS total
         FROM shift_events
         WHERE establishment_id = $1 AND event_time::date = $2::date
         GROUP BY event_type`,
        [eid, today]
      ),
      query(
        `SELECT status, COUNT(*) AS total
         FROM replacements
         WHERE establishment_id = $1
         GROUP BY status`,
        [eid]
      ),
      query(
        `SELECT status, COUNT(*) AS total
         FROM staff_loan_requests
         WHERE establishment_id = $1
         GROUP BY status`,
        [eid]
      ),
    ]);

    const tally = (rows, key = 'status') => rows.reduce((acc, row) => {
      acc[row[key]] = Number(row.total) || 0;
      return acc;
    }, {});

    // Les absences sont groupées par (kind, department_id) : `tally` écraserait
    // les services les uns après les autres au lieu de les additionner (deux
    // congés dans deux services le même jour n'en affichaient qu'un). Somme
    // explicite, et retards comptés à part — un retard est un `shift_absence`
    // de type `retard` (avec `late_minutes`), le `kind = 'late'` n'existe pas.
    let latesToday = 0;
    const absencesByKind = absRes.rows.reduce((acc, row) => {
      acc[row.kind] = (acc[row.kind] || 0) + (Number(row.total) || 0);
      latesToday += Number(row.late_total) || 0;
      return acc;
    }, {});

    const alerts = tally(alertRes.rows, 'severity');
    const events = tally(evtRes.rows, 'event_type');
    const replacements = tally(repRes.rows);
    const loans = tally(loanRes.rows);

    // Couverture par service, calculée sur les plannings actifs du jour.
    // Lecture par `rosterOnDate` : les codes journaliers sont facultatifs dans le
    // tableur, et les compter seuls annonçait « 0 garde, 0 agent, 0/3 services
    // couverts » alors que sept agents étaient de service. La clé de
    // dédoublonnage est celle du journal (`journal.controller.js:861-885`) pour
    // que le surveillant général et le surveillant de service affichent le même
    // nombre de gardes sur la même portée.
    const activeToday = schedRes.rows.filter((s) => s.state === 'en_cours');
    const guardsByDept = new Map();
    const seen = new Set();
    let guardsToday = 0;
    const onDutyToday = new Set();

    for (const schedule of activeToday) {
      for (const entry of rosterOnDate(schedule, today)) {
        const key = `${schedule.id}|${entry.userId || '—'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        guardsToday += 1;
        if (entry.userId) onDutyToday.add(entry.userId);
        const dept = schedule.department_id;
        guardsByDept.set(dept, (guardsByDept.get(dept) || 0) + 1);
      }
    }

    const absencesByDept = absRes.rows.reduce((acc, row) => {
      acc[row.department_id] = (acc[row.department_id] || 0) + (Number(row.total) || 0);
      return acc;
    }, {});

    const departments = deptRes.rows.map((d) => ({
      id: d.id,
      name: d.name,
      staffCount: Number(d.staff_count) || 0,
      guardsToday: guardsByDept.get(d.id) || 0,
      absencesToday: absencesByDept[d.id] || 0,
      activeSchedules: activeToday.filter((s) => s.department_id === d.id).length,
      covered: (guardsByDept.get(d.id) || 0) > 0,
    }));

    const byState = schedRes.rows.reduce((acc, s) => {
      acc[s.state] = (acc[s.state] || 0) + 1;
      return acc;
    }, {});

    return res.json({
      success: true,
      data: {
        today,
        scopeLabel: estRes.rows[0]?.name || 'Établissement',
        summary: {
          departments: departments.length,
          departmentsCovered: departments.filter((d) => d.covered).length,
          guardsToday,
          staffOnDutyToday: onDutyToday.size,
          schedulesSubmitted: byState.soumis || 0,
          schedulesActive: byState.en_cours || 0,
          leavesToday: absencesByKind.leave || 0,
          shiftAbsencesToday: absencesByKind.shift_absence || 0,
          latesToday,
          incidentsToday: events.incident || 0,
          reinforcementsToday: events.reinforcement || 0,
          openAlerts: Object.values(alerts).reduce((a, b) => a + b, 0),
          criticalAlerts: (alerts.critical || 0) + (alerts.urgent || 0),
          replacementsPending: replacements.pending || 0,
          replacementsConfirmed: (replacements.confirmed || 0) + (replacements.accepted || 0),
          loansPending: loans.pending || 0,
        },
        departments,
      },
    });
  } catch (err) {
    console.error('supervision.getOverview error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement de la supervision' });
  }
};

/**
 * GET /api/supervision/loans
 * Prêts de personnel de tout l'hôpital, en lecture.
 *
 * `staff-loans.controller.js` (Lot 1) ne renvoie que les demandes dont
 * l'utilisateur est demandeur ou propriétaire : le SG, qui n'est ni l'un ni
 * l'autre, n'y voit rien. On lit donc ici sans toucher à ce contrôleur.
 *
 * La DÉCISION reste au chef du service propriétaire — aucune écriture ici.
 */
const listLoans = async (req, res) => {
  try {
    const scope = resolveScope(req.user, req.query);
    if (!scope) return forbidden(res);

    const conditions = ['l.establishment_id = $1'];
    const params = [scope.establishmentId];

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`l.status = $${params.length}`);
    }

    const result = await query(
      `SELECT l.id, l.status, l.response_reason, l.requested_at, l.responded_at,
              TO_CHAR(l.shift_date, 'YYYY-MM-DD') AS shift_date,
              l.schedule_id, l.staff_user_id,
              u.first_name AS staff_first_name, u.last_name AS staff_last_name,
              rd.name AS requesting_department_name,
              od.name AS owner_department_name,
              rc.first_name AS requester_first_name, rc.last_name AS requester_last_name,
              oc.first_name AS owner_first_name,     oc.last_name AS owner_last_name,
              s.name AS schedule_name
       FROM staff_loan_requests l
       JOIN users u ON l.staff_user_id = u.id
       JOIN departments rd ON l.requesting_department_id = rd.id
       JOIN departments od ON l.owner_department_id = od.id
       LEFT JOIN users rc ON l.requesting_chief_id = rc.id
       LEFT JOIN users oc ON l.owner_chief_id = oc.id
       LEFT JOIN schedules s ON l.schedule_id = s.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.requested_at DESC
       LIMIT 150`,
      params
    );

    const loans = result.rows.map((r) => ({
      id: r.id,
      status: r.status,
      shiftDate: r.shift_date,
      responseReason: r.response_reason,
      requestedAt: r.requested_at,
      respondedAt: r.responded_at,
      scheduleId: r.schedule_id,
      scheduleName: r.schedule_name,
      staffName: `${r.staff_first_name} ${r.staff_last_name}`.trim(),
      requestingDepartment: r.requesting_department_name,
      ownerDepartment: r.owner_department_name,
      requesterName: [r.requester_first_name, r.requester_last_name].filter(Boolean).join(' '),
      ownerName: [r.owner_first_name, r.owner_last_name].filter(Boolean).join(' '),
    }));

    return res.json({
      success: true,
      data: {
        loans,
        summary: {
          total: loans.length,
          pending: loans.filter((l) => l.status === 'pending').length,
          approved: loans.filter((l) => ['approved', 'auto_approved'].includes(l.status)).length,
          rejected: loans.filter((l) => l.status === 'rejected').length,
        },
      },
    });
  } catch (err) {
    console.error('supervision.listLoans error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des prêts de personnel' });
  }
};

/**
 * POST /api/supervision/report
 * Transmission d'un rapport de supervision à la direction. Écrit une
 * notification par directeur et trace l'action dans l'historique immuable.
 */
const sendReport = async (req, res) => {
  try {
    const scope = resolveScope(req.user, req.query);
    if (!scope) return forbidden(res);

    const { title, summary, scheduleId, priority } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Le titre du rapport est obligatoire' });
    }

    const directors = await query(
      `SELECT u.id FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.establishment_id = $1 AND u.is_active = TRUE
         AND r.code IN ($2, $3)`,
      [scope.establishmentId, ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN]
    );

    if (!directors.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Aucun directeur actif dans cet établissement',
        message_ar: 'لا يوجد مدير نشط في هذه المؤسسة',
      });
    }

    const senderName = `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || 'La supervision';
    const cleanTitle = String(title).trim().slice(0, 255);

    await Promise.all(directors.rows.map((d) => createNotification({
      establishmentId: scope.establishmentId,
      recipientId: d.id,
      senderId: req.user.id,
      type: 'supervision_report',
      title: `Rapport de supervision : ${cleanTitle}`,
      titleAr: 'تقرير الإشراف',
      message: `${senderName} vous transmet un rapport.${summary ? ` ${String(summary).slice(0, 600)}` : ''}`,
      entityType: scheduleId ? 'schedules' : 'supervision',
      entityId: scheduleId || null,
      priority: priority === 'urgent' ? 'urgent' : 'high',
    })));

    await history.log({
      userId: req.user.id,
      action: 'supervision_report_sent',
      category: 'schedule',
      description: `Rapport de supervision transmis à ${directors.rows.length} destinataire(s) : ${cleanTitle}`,
      entityType: scheduleId ? 'schedules' : 'supervision',
      entityId: scheduleId || null,
      metadata: { recipients: directors.rows.length, priority: priority || 'high' },
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent'],
    });

    for (const d of directors.rows) {
      emitToUser(req.app, d.id, 'notification:new', { type: 'supervision_report' });
    }
    emitToEstablishment(req.app, scope.establishmentId, 'supervision:report', { title: cleanTitle });

    return res.status(201).json({
      success: true,
      message: `Rapport transmis à ${directors.rows.length} destinataire(s)`,
    });
  } catch (err) {
    console.error('supervision.sendReport error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'envoi du rapport' });
  }
};

module.exports = {
  listSchedules,
  listConflicts,
  getOverview,
  listLoans,
  sendReport,
};
