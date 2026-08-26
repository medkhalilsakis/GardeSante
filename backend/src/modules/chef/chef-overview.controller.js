/**
 * Vue d'ensemble du chef de service — pilotage d'UN service (Lot Z3).
 *
 * ── Pourquoi un module neuf ───────────────────────────────────
 * L'onglet « Vue d'ensemble » de `/chef-de-service` affichait quatre KPI, dont
 * deux structurellement faux, et rien de ce qu'un chef arbitre réellement. Les
 * surfaces existantes ne répondent pas à sa question :
 *
 *   • `journal-overview` est à portée **service** mais orienté journée (appel,
 *     événements) : il ne dit rien de ses plannings ni de ses files d'attente ;
 *   • `supervision-overview` est à portée **établissement** et refusé au chef ;
 *   • `statistics/scoped` est quantitatif, sur une période, sans arbitrage.
 *
 * Ce contrôleur sert le besoin manquant : « où en est MON service, et qu'ai-je à
 * traiter ? ». Lecture seule, aucun `UPDATE`, aucune migration.
 *
 * ── Un seul appel ─────────────────────────────────────────────
 * Tous les décomptes sont faits en SQL. Les recouper côté navigateur via
 * `usersAPI.getAll` donnerait les totaux de la **page reçue** (`listUsers` est
 * plafonné par `limit`), pas ceux du service — même raison qu'au Lot Y1.
 *
 * ── Concordance des chiffres ──────────────────────────────────
 * Deux règles sont reprises à l'identique, volontairement, pour que deux écrans
 * n'annoncent jamais deux nombres pour la même réalité :
 *
 *   1. l'effectif de garde du jour est lu par `rosterOnDate` avec le
 *      dédoublonnage `planning|agent` de `journal.controller.js:869-895` ;
 *   2. le statut d'appel d'un agent est le **plus récent** de ses événements,
 *      clé `userId|scheduleId`, table `{presence: présent, late: retard,
 *      absence: absent}` — exactement `AppelDuJourPage.jsx:383-396`. La journée
 *      d'un événement est `COALESCE(duty_date, event_time AT TIME ZONE
 *      'Africa/Tunis')`, comme `journal.controller.js:177-182`.
 *
 * ── Pièges de schéma évités ───────────────────────────────────
 *   • `service_alerts` n'a **pas** de colonne `status` : une alerte est ouverte
 *     quand `resolved_at IS NULL`.
 *   • un retard est une ligne `absences` de `kind = 'shift_absence'` dont le type
 *     porte le code `retard` (avec `late_minutes`) ; `kind = 'late'` n'existe pas.
 *   • `absence_types` est par établissement : les codes se répètent, on filtre
 *     donc sur `t.code`, jamais sur un identifiant.
 *   • `activity_logs` n'a pas de `department_id` : la portée service passe par
 *     les membres du service.
 *   • toutes les dates sortent en `TO_CHAR(…, 'YYYY-MM-DD')` — jamais un
 *     `new Date()` sur une colonne DATE, qui décalerait d'un jour.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const {
  rosterOnDate,
  dutyEntries,
  remainingDutyDays,
  dateKey,
} = require('../schedules/spreadsheet-reader');
const conflictRules = require('../supervision/conflict-rules');

/** Rôles dont la portée est le service : leurs propres lignes `user_departments`. */
const SERVICE_ROLES = [ROLES.DEPARTMENT_HEAD, ROLES.SERVICE_SUPERVISOR];

/** Rôles qui peuvent lire n'importe quel service de leur établissement. */
const ESTABLISHMENT_ROLES = [ROLES.GENERAL_SUPERVISOR, ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN];

/** Traces d'activité renvoyées. */
const ACTIVITY_LIMIT = 12;

/** Événements du journal du jour renvoyés. */
const EVENT_LIMIT = 20;

/** Plannings lus intégralement pour l'équité de la charge. */
const SCHEDULE_LIMIT = 40;

/** Agents restitués dans le classement de charge. */
const LOAD_LIMIT = 25;

const toInt = (value) => Number(value) || 0;

const fullName = (first, last) => `${first || ''} ${last || ''}`.trim() || null;

/**
 * Service à afficher et droit de le lire.
 *
 * Renvoie `{ departmentId }`, ou `{ error: { code, message } }` — jamais un
 * payload vide silencieux : un chef qui n'appartient à aucun service doit lire
 * pourquoi son écran est vide.
 */
const resolveDepartment = async (user, requested) => {
  if (!user) return { error: { code: 403, message: 'Authentification requise' } };

  const wanted = requested ? String(requested) : null;

  // Portée service : uniquement ses propres affectations.
  if (SERVICE_ROLES.includes(user.roleCode)) {
    const { rows } = await query(
      `SELECT ud.department_id, ud.is_head
         FROM user_departments ud
        WHERE ud.user_id = $1
        ORDER BY ud.is_head DESC`,
      [user.id]
    );
    if (!rows.length) {
      return {
        error: {
          code: 403,
          message: "Aucun service ne vous est rattaché : demandez à la direction de vous affecter à un service",
        },
      };
    }
    if (!wanted) return { departmentId: rows[0].department_id };
    const owned = rows.some((r) => r.department_id === wanted);
    if (!owned) {
      return { error: { code: 403, message: "Ce service ne fait pas partie des vôtres" } };
    }
    return { departmentId: wanted };
  }

  // Portée établissement : n'importe quel service de son hôpital.
  const isSuper = user.isSuperAdmin || user.roleCode === ROLES.SUPER_ADMIN;
  if (!isSuper && !ESTABLISHMENT_ROLES.includes(user.roleCode)) {
    return { error: { code: 403, message: "Cette vue d'ensemble est réservée à l'encadrement" } };
  }

  const conditions = ['d.is_active = TRUE'];
  const params = [];
  if (!isSuper) {
    params.push(user.establishmentId);
    conditions.push(`d.establishment_id = $${params.length}`);
  }
  if (wanted) {
    params.push(wanted);
    conditions.push(`d.id = $${params.length}`);
  }

  const { rows } = await query(
    `SELECT d.id FROM departments d
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.name
      LIMIT 1`,
    params
  );
  if (!rows.length) {
    return {
      error: {
        code: wanted ? 403 : 404,
        message: wanted
          ? "Ce service n'appartient pas à votre établissement"
          : "Aucun service actif dans votre établissement",
      },
    };
  }
  return { departmentId: rows[0].id };
};

// ══════════════════════════════════════════════════════════════
// GET /api/chef/overview?departmentId=
// ══════════════════════════════════════════════════════════════
const getChefOverview = async (req, res) => {
  try {
    const resolved = await resolveDepartment(req.user, req.query.departmentId);
    if (resolved.error) {
      return res.status(resolved.error.code).json({ success: false, message: resolved.error.message });
    }
    const did = resolved.departmentId;
    const actorId = req.user.id;

    const [
      identity, effectif, byRole, byCategory,
      schedules, planningStates, appel, alerts,
      events, aTraiter, activity, leaveList,
    ] = await Promise.all([
      // ── Identité du service + date serveur ──────────────────
      query(
        `SELECT d.id, d.code, d.name, d.department_type, d.floor, d.wing,
                d.bed_count, d.min_guard_count,
                e.id AS establishment_id, e.name AS establishment_name,
                TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS today,
                TO_CHAR(date_trunc('month', CURRENT_DATE)::date, 'YYYY-MM-DD') AS month_start,
                TO_CHAR((date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
                        'YYYY-MM-DD') AS month_end,
                (SELECT hu.first_name || ' ' || hu.last_name
                   FROM user_departments hud
                   JOIN users hu ON hu.id = hud.user_id AND hu.is_active = TRUE
                  WHERE hud.department_id = d.id AND hud.is_head = TRUE
                  LIMIT 1) AS head_name,
                (SELECT string_agg(su.first_name || ' ' || su.last_name, ', ')
                   FROM user_departments sud
                   JOIN users su ON su.id = sud.user_id AND su.is_active = TRUE
                   JOIN roles sr ON sr.id = su.role_id AND sr.code = 'service_supervisor'
                  WHERE sud.department_id = d.id) AS supervisor_names
           FROM departments d
           JOIN establishments e ON e.id = d.establishment_id
          WHERE d.id = $1`,
        [did]
      ),

      // ── Effectif du service ─────────────────────────────────
      // `is_active = TRUE` est filtré ici, contrairement au `member_count` de
      // `getDepartment` : un agent clôturé ne fait plus partie de l'effectif.
      // `sans_acces` est le chiffre que rien ne signalait — un agent sans
      // `can_login` ne verra jamais son planning.
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.is_active = TRUE)::int AS actifs,
                COUNT(*) FILTER (WHERE u.is_active = FALSE)::int AS suspendus,
                COUNT(*) FILTER (WHERE u.is_active = TRUE AND u.can_login = FALSE)::int AS sans_acces,
                COUNT(*) FILTER (WHERE u.is_active = TRUE AND u.can_login = TRUE
                                   AND u.last_login IS NULL)::int AS jamais_connectes,
                COUNT(*) FILTER (WHERE u.last_login >= NOW() - INTERVAL '7 days')::int AS connectes_7j,
                COUNT(*) FILTER (WHERE u.is_active = TRUE AND EXISTS (
                  SELECT 1 FROM absences a
                   WHERE a.user_id = u.id AND a.kind = 'leave'
                     AND a.status IN ('approved', 'pending')
                     AND CURRENT_DATE BETWEEN a.start_date AND a.end_date
                ))::int AS en_conge
           FROM user_departments ud
           JOIN users u ON u.id = ud.user_id
          WHERE ud.department_id = $1`,
        [did]
      ),

      // ── Répartition par fonction ────────────────────────────
      query(
        `SELECT r.code, MIN(r.name) AS name, COUNT(*)::int AS total
           FROM user_departments ud
           JOIN users u ON u.id = ud.user_id AND u.is_active = TRUE
           JOIN roles r ON r.id = u.role_id
          WHERE ud.department_id = $1
          GROUP BY r.code
          ORDER BY MIN(r.level), MIN(r.name)`,
        [did]
      ),

      // ── Répartition par catégorie de personnel ──────────────
      query(
        `SELECT COALESCE(jt.category_label, r.name) AS label, COUNT(*)::int AS total
           FROM user_departments ud
           JOIN users u ON u.id = ud.user_id AND u.is_active = TRUE
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN job_titles jt ON jt.id = u.job_title_id
          WHERE ud.department_id = $1
          GROUP BY COALESCE(jt.category_label, r.name)
          ORDER BY COUNT(*) DESC`,
        [did]
      ),

      // ── Tableurs du service (états dérivés + propositions) ──
      query(
        `SELECT s.id, s.name, s.status, s.metadata, s.schedule_type, s.department_id,
                TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date,
                TO_CHAR(s.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_on,
                planning_state(s.status, s.start_date, s.end_date) AS state,
                (SELECT COUNT(*)::int FROM schedule_change_proposals p
                  WHERE p.schedule_id = s.id AND p.status = 'pending') AS pending_proposals,
                (SELECT COUNT(*)::int FROM replacements r
                  WHERE r.schedule_id = s.id
                    AND r.confirmation_status = 'pending_chef') AS pending_replacements
           FROM schedules s
          WHERE s.department_id = $1
          ORDER BY s.start_date DESC
          LIMIT ${SCHEDULE_LIMIT}`,
        [did]
      ),

      // ── Compte par état, sur TOUS les plannings du service ──
      // Séparé de la requête ci-dessus, qui est plafonnée : le compteur reste
      // exact même si le service dépasse la limite de lecture.
      query(
        `SELECT planning_state(s.status, s.start_date, s.end_date) AS state,
                COUNT(*)::int AS total
           FROM schedules s
          WHERE s.department_id = $1
          GROUP BY 1`,
        [did]
      ),

      // ── Appel du jour : le dernier statut déclaré par agent ──
      // `DISTINCT ON` + `event_time DESC` = « le plus récent gagne », la règle
      // exacte de l'écran Appel du jour (le premier match conservé sur une liste
      // triée décroissante). La journée suit `duty_date`, sinon `event_time`
      // ramené à Africa/Tunis.
      query(
        `SELECT DISTINCT ON (e.user_id, e.schedule_id)
                e.user_id, e.schedule_id, e.event_type, e.metadata,
                TO_CHAR(e.created_at, 'HH24:MI') AS hour,
                rep.first_name AS reporter_first_name,
                rep.last_name  AS reporter_last_name
           FROM shift_events e
           LEFT JOIN users rep ON rep.id = e.reported_by
          WHERE e.department_id = $1
            AND e.event_type IN ('presence', 'late', 'absence')
            AND COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date) = CURRENT_DATE
          ORDER BY e.user_id, e.schedule_id, e.event_time DESC`,
        [did]
      ),

      // ── Alertes du service : ouverte = `resolved_at IS NULL` ─
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE a.resolved_at IS NULL)::int AS ouvertes,
                COUNT(*) FILTER (WHERE a.resolved_at IS NULL
                                   AND a.severity IN ('critical', 'urgent'))::int AS critiques,
                COUNT(*) FILTER (WHERE a.resolved_at IS NULL
                                   AND a.acknowledged_at IS NULL)::int AS non_acquittees
           FROM service_alerts a
          WHERE a.department_id = $1`,
        [did]
      ),

      // ── Journal du jour ─────────────────────────────────────
      query(
        `SELECT e.id, e.event_type, e.title, e.severity,
                TO_CHAR(e.created_at, 'HH24:MI') AS hour,
                u.first_name, u.last_name
           FROM shift_events e
           LEFT JOIN users u ON u.id = e.user_id
          WHERE e.department_id = $1
            AND COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date) = CURRENT_DATE
          ORDER BY e.event_time DESC
          LIMIT ${EVENT_LIMIT}`,
        [did]
      ),

      // ── Les files d'attente du chef, en un seul aller-retour ─
      // `$2` est l'appelant : les prêts se lisent par chef propriétaire /
      // demandeur (`listLoans` filtre de la même façon), pas par service — un SG
      // qui consulte l'écran n'est ni l'un ni l'autre et lira donc 0, ce que le
      // panneau traduit en pointant les statistiques de prêts (Lot Z4).
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM schedule_change_proposals p
             WHERE p.department_id = $1 AND p.status = 'pending') AS propositions,
           (SELECT COUNT(*)::int FROM replacements r
             WHERE (r.department_id = $1 OR r.target_department_id = $1)
               AND r.confirmation_status = 'pending_chef') AS remplacements,
           (SELECT COUNT(*)::int FROM replacements r
             WHERE (r.department_id = $1 OR r.target_department_id = $1)
               AND r.confirmation_status = 'confirmed'
               AND r.end_date >= CURRENT_DATE) AS remplacements_actifs,
           (SELECT COUNT(*)::int FROM staff_loan_requests l
             WHERE l.owner_chief_id = $2 AND l.status = 'pending') AS prets_entrants,
           (SELECT COUNT(*)::int FROM staff_loan_requests l
             WHERE l.requesting_chief_id = $2 AND l.status = 'pending') AS prets_sortants,
           (SELECT COUNT(*)::int FROM absences a
             WHERE a.department_id = $1 AND a.kind = 'leave'
               AND a.status = 'pending') AS conges_pending,
           (SELECT COUNT(*)::int FROM absences a
             WHERE a.department_id = $1 AND a.kind = 'shift_absence'
               AND a.status <> 'cancelled'
               AND a.is_justified IS NOT TRUE
               AND a.start_date >= CURRENT_DATE - INTERVAL '30 days') AS absences_non_justifiees,
           (SELECT COUNT(*)::int FROM absences a
             LEFT JOIN absence_types t ON t.id = a.absence_type_id
             WHERE a.department_id = $1 AND a.kind = 'shift_absence'
               AND a.status <> 'cancelled'
               AND CURRENT_DATE BETWEEN a.start_date AND a.end_date) AS signalements_jour,
           (SELECT COUNT(*)::int FROM absences a
             LEFT JOIN absence_types t ON t.id = a.absence_type_id
             WHERE a.department_id = $1 AND a.kind = 'shift_absence'
               AND a.status <> 'cancelled'
               AND CURRENT_DATE BETWEEN a.start_date AND a.end_date
               AND (t.code = 'retard' OR a.late_minutes IS NOT NULL)) AS retards_jour`,
        [did, actorId]
      ),

      // ── Activité récente : `activity_logs` n'a pas de service,
      //    la portée passe donc par les membres du service ─────
      query(
        `SELECT al.id, al.action, al.category, al.description, al.severity,
                TO_CHAR(al.created_at, 'YYYY-MM-DD HH24:MI') AS at,
                u.first_name, u.last_name, r.name AS role_name
           FROM activity_logs al
           JOIN users u ON u.id = al.user_id
           JOIN roles r ON r.id = u.role_id
          WHERE al.user_id IN (SELECT ud.user_id FROM user_departments ud WHERE ud.department_id = $1)
          ORDER BY al.created_at DESC
          LIMIT ${ACTIVITY_LIMIT}`,
        [did]
      ),

      // ── Congés du service, pour la règle I (garde sur congé) ─
      query(
        `SELECT a.user_id, a.status,
                TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
                t.name AS type_name,
                u.first_name, u.last_name
           FROM absences a
           LEFT JOIN absence_types t ON t.id = a.absence_type_id
           JOIN users u ON u.id = a.user_id
          WHERE a.kind = 'leave'
            AND a.status IN ('approved', 'pending')
            AND a.end_date >= CURRENT_DATE - INTERVAL '1 day'
            AND a.user_id IN (SELECT ud.user_id FROM user_departments ud WHERE ud.department_id = $1)`,
        [did]
      ),
    ]);

    if (!identity.rows.length) {
      return res.status(404).json({ success: false, message: 'Service introuvable' });
    }

    const dept = identity.rows[0];
    const today = dept.today || dateKey(new Date());
    // Bornes du mois calculées en SQL : les dériver de `today` en JS obligerait à
    // connaître la longueur du mois, et un « 31 » sur un mois de 30 jours ferait
    // renvoyer une plage vide à `datesBetween`.
    const monthStart = dept.month_start || `${today.substring(0, 7)}-01`;
    const monthEnd = dept.month_end || today;

    // ── Statut d'appel par agent, clé `userId|scheduleId` ─────
    const APPEL_MARK = { presence: 'present', late: 'late', absence: 'absent' };
    const appelByKey = new Map();
    for (const row of appel.rows) {
      const mark = APPEL_MARK[row.event_type];
      if (!mark || !row.user_id) continue;
      appelByKey.set(`${row.user_id}|${row.schedule_id || '—'}`, {
        mark,
        hour: row.hour,
        reporter: fullName(row.reporter_first_name, row.reporter_last_name),
      });
    }

    // ── Effectif de garde du jour, lu dans les tableurs ───────
    const activeSchedules = schedules.rows.filter((s) => s.state === 'en_cours');
    const gardeList = [];
    const onDuty = new Set();
    const seen = new Set();
    let atHome = 0;

    for (const schedule of activeSchedules) {
      for (const entry of rosterOnDate(schedule, today)) {
        const dedup = entry.userId ? `${schedule.id}|${entry.userId}` : null;
        if (dedup) {
          if (seen.has(dedup)) continue;
          seen.add(dedup);
        }
        if (entry.userId) onDuty.add(entry.userId);
        if (entry.atHome) atHome += 1;

        const status = entry.userId
          ? appelByKey.get(`${entry.userId}|${schedule.id}`)
          : null;
        gardeList.push({
          userId: entry.userId,
          name: fullName(entry.firstName, entry.lastName) || 'Agent',
          roleName: entry.roleName || null,
          matricule: entry.matricule || null,
          label: entry.label,
          atHome: entry.atHome === true,
          shiftStart: entry.shiftStart || null,
          shiftEnd: entry.shiftEnd || null,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          appel: status?.mark || 'pending',
          appelHour: status?.hour || null,
          appelReporter: status?.reporter || null,
        });
      }
    }
    gardeList.sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    // ── Plannings actifs, détaillés ───────────────────────────
    const activeList = activeSchedules.map((s) => {
      const days = Math.max(
        1,
        Math.round((new Date(`${s.end_date}T12:00:00`) - new Date(`${s.start_date}T12:00:00`)) / 86400000) + 1
      );
      const elapsed = Math.round(
        (new Date(`${today}T12:00:00`) - new Date(`${s.start_date}T12:00:00`)) / 86400000
      ) + 1;
      return {
        id: s.id,
        name: s.name,
        state: s.state,
        status: s.status,
        startDate: s.start_date,
        endDate: s.end_date,
        updatedOn: s.updated_on,
        dayIndex: Math.min(Math.max(elapsed, 1), days),
        dayTotal: days,
        // `remainingDutyDays` compte des AFFECTATIONS restantes, pas des jours :
        // sur un planning de 32 jours à 4 agents/jour il renvoie 92, ce qui
        // ferait mentir un libellé « jours restants ». Le tableau de bord du
        // surveillant l'affiche déjà sous « Gardes restantes » : même nom ici.
        remainingGuards: remainingDutyDays(s, today),
        staffToday: rosterOnDate(s, today).length,
        pendingProposals: toInt(s.pending_proposals),
        pendingReplacements: toInt(s.pending_replacements),
      };
    });

    const drafts = schedules.rows
      .filter((s) => s.state === 'brouillon')
      .map((s) => ({
        id: s.id, name: s.name, startDate: s.start_date,
        endDate: s.end_date, updatedOn: s.updated_on,
      }));

    const stateCounts = planningStates.rows.reduce((acc, row) => {
      acc[row.state] = toInt(row.total);
      return acc;
    }, {});

    // ── Points de vigilance, portée service ──────────────────
    // Mêmes règles que la supervision hôpital (`conflict-rules.js`) : un chef et
    // un surveillant général ne doivent pas lire deux vérités différentes.
    const analysable = schedules.rows.filter((s) => ['soumis', 'en_cours'].includes(s.state));
    const withDeptName = analysable.map((s) => ({ ...s, department_name: dept.name }));
    const dutyIndex = conflictRules.buildDutyIndex(withDeptName);
    const vigilance = [
      ...conflictRules.detectOnLeave(dutyIndex, leaveList.rows),
      ...conflictRules.detectDoubleBooking(dutyIndex),
      ...conflictRules.detectUncoveredDays(withDeptName, today),
    ];
    conflictRules.sortConflicts(vigilance);

    // ── Équité de la charge sur le mois courant ──────────────
    const loadByStaff = new Map();
    for (const schedule of analysable) {
      for (const entry of dutyEntries(schedule, monthStart, monthEnd)) {
        if (!entry.userId) continue;
        if (!loadByStaff.has(entry.userId)) {
          loadByStaff.set(entry.userId, {
            userId: entry.userId,
            name: fullName(entry.firstName, entry.lastName) || 'Agent',
            roleName: entry.roleName || null,
            guards: 0,
          });
        }
        loadByStaff.get(entry.userId).guards += 1;
      }
    }
    const loads = [...loadByStaff.values()].sort((a, b) => b.guards - a.guards);
    const counts = loads.map((s) => s.guards);
    const totalGuards = counts.reduce((a, b) => a + b, 0);
    const maxLoad = counts.length ? Math.max(...counts) : 0;
    const minLoad = counts.length ? Math.min(...counts) : 0;

    const eff = effectif.rows[0] || {};
    const al = alerts.rows[0] || {};
    const q = aTraiter.rows[0] || {};

    const congesAujourdhui = leaveList.rows
      .filter((l) => l.start_date <= today && l.end_date >= today)
      .map((l) => ({
        userId: l.user_id,
        name: fullName(l.first_name, l.last_name) || 'Agent',
        typeName: l.type_name || 'Congé',
        startDate: l.start_date,
        endDate: l.end_date,
        status: l.status,
      }));

    const pointes = gardeList.filter((g) => g.appel !== 'pending').length;

    return res.json({
      success: true,
      data: {
        today,
        department: {
          id: dept.id,
          code: dept.code,
          name: dept.name,
          departmentType: dept.department_type,
          floor: dept.floor,
          wing: dept.wing,
          bedCount: toInt(dept.bed_count),
          minGuardCount: toInt(dept.min_guard_count),
          establishmentId: dept.establishment_id,
          establishmentName: dept.establishment_name,
          headName: dept.head_name || null,
          supervisorNames: dept.supervisor_names || null,
        },

        effectif: {
          total: toInt(eff.total),
          actifs: toInt(eff.actifs),
          suspendus: toInt(eff.suspendus),
          sansAcces: toInt(eff.sans_acces),
          jamaisConnectes: toInt(eff.jamais_connectes),
          connectes7j: toInt(eff.connectes_7j),
          enCongeAujourdhui: toInt(eff.en_conge),
          disponibles: Math.max(0, toInt(eff.actifs) - toInt(eff.en_conge)),
          byRole: byRole.rows.map((r) => ({ code: r.code, name: r.name, total: toInt(r.total) })),
          byCategory: byCategory.rows.map((c) => ({ label: c.label, total: toInt(c.total) })),
          congesAujourdhui,
        },

        gardeDuJour: {
          total: gardeList.length,
          agents: onDuty.size,
          aDomicile: atHome,
          minGuardCount: toInt(dept.min_guard_count),
          pointes,
          restants: Math.max(0, gardeList.length - pointes),
          presents: gardeList.filter((g) => g.appel === 'present').length,
          retards: gardeList.filter((g) => g.appel === 'late').length,
          absents: gardeList.filter((g) => g.appel === 'absent').length,
          list: gardeList,
        },

        plannings: {
          brouillon: toInt(stateCounts.brouillon),
          soumis: toInt(stateCounts.soumis),
          enCours: toInt(stateCounts.en_cours),
          termine: toInt(stateCounts.termine),
          total: Object.values(stateCounts).reduce((a, b) => a + b, 0),
          readLimit: SCHEDULE_LIMIT,
          read: schedules.rows.length,
          active: activeList,
          drafts,
        },

        aTraiter: {
          propositions: toInt(q.propositions),
          remplacements: toInt(q.remplacements),
          remplacementsActifs: toInt(q.remplacements_actifs),
          pretsEntrants: toInt(q.prets_entrants),
          pretsSortants: toInt(q.prets_sortants),
          congesPending: toInt(q.conges_pending),
          absencesNonJustifiees: toInt(q.absences_non_justifiees),
          total: toInt(q.propositions) + toInt(q.remplacements) + toInt(q.prets_entrants)
            + toInt(q.prets_sortants) + toInt(q.conges_pending) + toInt(q.absences_non_justifiees),
        },

        vigilance: {
          total: vigilance.length,
          critical: vigilance.filter((v) => v.severity === 'critical').length,
          onLeave: vigilance.filter((v) => v.type === 'on_leave').length,
          doubleBooking: vigilance.filter((v) => v.type === 'double_booking').length,
          uncovered: vigilance.filter((v) => v.type === 'uncovered_day').length,
          list: vigilance.slice(0, 12),
        },

        charge: {
          period: { from: monthStart, to: monthEnd },
          totalGuards,
          staffCount: loads.length,
          maxLoad,
          minLoad,
          loadGap: maxLoad - minLoad,
          averagePerStaff: loads.length ? Math.round((totalGuards / loads.length) * 10) / 10 : 0,
          // Classement complet du service, du plus au moins sollicité. Un « top 5
          // + bas 5 » se recouvrirait dès que le service compte moins de dix
          // agents (7 aux Urgences) : le même agent apparaîtrait dans les deux
          // colonnes, ce qui fait douter du chiffre au lieu de l'éclairer.
          list: loads.slice(0, LOAD_LIMIT),
          listTruncated: loads.length > LOAD_LIMIT,
        },

        alertes: {
          total: toInt(al.total),
          ouvertes: toInt(al.ouvertes),
          critiques: toInt(al.critiques),
          nonAcquittees: toInt(al.non_acquittees),
        },

        journal: {
          signalementsJour: toInt(q.signalements_jour),
          retardsJour: toInt(q.retards_jour),
          incidents: events.rows.filter((e) => e.event_type === 'incident').length,
          renforts: events.rows.filter((e) => e.event_type === 'reinforcement').length,
          remarques: events.rows.filter((e) => e.event_type === 'remark').length,
          list: events.rows.map((e) => ({
            id: e.id,
            type: e.event_type,
            title: e.title,
            severity: e.severity,
            hour: e.hour,
            staffName: fullName(e.first_name, e.last_name),
          })),
        },

        activite: activity.rows.map((a) => ({
          id: a.id,
          action: a.action,
          category: a.category,
          description: a.description,
          severity: a.severity,
          at: a.at,
          actorName: fullName(a.first_name, a.last_name),
          roleName: a.role_name,
        })),
      },
    });
  } catch (err) {
    console.error('getChefOverview error:', err);
    return res.status(500).json({ success: false, message: "Erreur lors du chargement de la vue d'ensemble" });
  }
};

module.exports = { getChefOverview, resolveDepartment };
