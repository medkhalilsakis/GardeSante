/**
 * Vue d'ensemble du directeur — pilotage de l'établissement (Lot Y1).
 *
 * ── Pourquoi un module neuf ───────────────────────────────────
 * Le directeur disposait déjà de deux surfaces, mais aucune ne répond à la
 * question « où en est mon hôpital, du point de vue de la direction ? » :
 *
 *   • `/supervision` (`journal` + `supervision`) est **opérationnel** : la
 *     couverture du jour, l'appel, les alertes, les remplacements. C'est un
 *     écran de conduite, pas de pilotage.
 *   • `/statistics/scoped` est **quantitatif** : des gardes comptées sur une
 *     période. Il ne dit rien de l'encadrement ni des comptes.
 *
 * Ce contrôleur sert le troisième besoin : l'état administratif de
 * l'établissement — encadrement des services, composition de l'effectif, accès
 * à la plateforme, demandes en attente. Il ne réécrit ni ne remplace les deux
 * autres : il n'expose aucune donnée d'appel ni aucune alerte.
 *
 * ── Un seul appel ─────────────────────────────────────────────
 * Le panneau aurait pu se construire côté navigateur en recoupant
 * `usersAPI.getAll` et `departmentsAPI.getAll`, mais `listUsers` est plafonné
 * (`limit`) : les totaux auraient été ceux de la page reçue, pas ceux de
 * l'établissement. Les décomptes sont donc faits en SQL, où ils sont exacts.
 *
 * ── Concordance des chiffres ──────────────────────────────────
 * La répartition par catégorie de personnel reprend **mot pour mot** le
 * `COALESCE(jt.category, CASE …)` de `users.controller.js:139-142`. Sans cela,
 * cliquer sur « Personnel médical » depuis la vue d'ensemble amènerait sur une
 * liste dont le total ne correspondrait pas au chiffre affiché.
 *
 * ── Étanchéité ────────────────────────────────────────────────
 * Fichier neuf, lecture seule, aucune migration, aucun `UPDATE`. Les gardes du
 * jour passent par `spreadsheet-reader.js` (déjà partagé par le journal, la
 * supervision, le calendrier et les statistiques) : la table `shifts` n'étant
 * pas alimentée par le tableur, compter dessus renverrait zéro.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { rosterOnDate, dateKey } = require('../schedules/spreadsheet-reader');

/** Rôles autorisés à lire le pilotage de leur établissement. */
const PILOT_ROLES = [ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN];

/** Nombre d'entrées d'activité récente renvoyées. */
const ACTIVITY_LIMIT = 12;

/** Plannings en cours dont on lit le tableur pour compter l'effectif du jour. */
const ACTIVE_SCHEDULE_LIMIT = 60;

/**
 * Expression partagée avec `users.controller.js` : la catégorie de personnel
 * vient du poste quand il existe, sinon du rôle. Dupliquer la formule est
 * volontaire — l'exporter obligerait à modifier `users.controller.js`.
 */
const CATEGORY_EXPR = `COALESCE(jt.category, CASE
  WHEN r.code IN ('senior_doctor','resident') THEN 'medical'
  WHEN r.code IN ('director','hospital_admin','general_supervisor','department_head','service_supervisor','observer') THEN 'administrative'
  ELSE NULL END)`;

const CATEGORY_LABEL_EXPR = `COALESCE(jt.category_label, CASE
  WHEN r.code IN ('senior_doctor','resident') THEN 'Personnel médical'
  WHEN r.code IN ('director','hospital_admin','general_supervisor','department_head','service_supervisor','observer') THEN 'Personnel administratif'
  ELSE NULL END)`;

const CATEGORY_FALLBACK_LABELS = {
  medical: 'Personnel médical',
  paramedical: 'Personnel paramédical',
  administrative: 'Personnel administratif',
  technical: 'Personnel technique',
  worker: 'Personnel ouvrier',
  support: 'Personnel de soutien',
};

const toInt = (value) => Number(value) || 0;

/**
 * Portée : son propre établissement pour un directeur ou un admin d'hôpital ;
 * le super admin peut viser un établissement précis. Toute autre fonction est
 * refusée — ce n'est pas un écran de service.
 */
const resolveScope = (user) => {
  if (!user) return null;
  if (user.isSuperAdmin) return { establishmentId: null, isSuperAdmin: true };
  if (PILOT_ROLES.includes(user.roleCode)) {
    return { establishmentId: user.establishmentId, isSuperAdmin: false };
  }
  return null;
};

// ══════════════════════════════════════════════════════════════
// GET /api/director/overview
// ══════════════════════════════════════════════════════════════
const getDirectorOverview = async (req, res) => {
  try {
    const scope = resolveScope(req.user);
    if (!scope) {
      return res.status(403).json({
        success: false,
        message: "Cette vue d'ensemble est réservée à la direction de l'établissement",
      });
    }

    // `injectEstablishment` a déjà arbitré : pour un directeur c'est le sien,
    // pour un super admin celui demandé en query.
    const eid = req.establishmentId || scope.establishmentId || req.user.establishmentId;
    if (!eid) {
      return res.status(400).json({ success: false, message: 'Établissement non déterminé' });
    }

    const [
      establishment, staffTotals, byCategory, byRole,
      departments, planningStates, activeSchedules,
      leaves, pending, activity,
    ] = await Promise.all([
      // ── Identité de l'établissement + date serveur ──────────
      query(
        `SELECT e.id, e.name, e.code, e.governorate, e.city,
                TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS today
           FROM establishments e WHERE e.id = $1`,
        [eid]
      ),

      // ── Effectif : un seul balayage, neuf décomptes ─────────
      // Tous les filtres reprennent l'univers exact de `getUsers`
      // (`users.controller.js:92-118`) : l'établissement, rien de plus. En
      // particulier, aucun décompte n'exclut les comptes archivés, parce que la
      // liste de l'onglet Personnel ne les exclut pas non plus — et que
      // l'archivage (`user-archive.controller.js:105-112`) ne touche ni
      // `is_active` ni `can_login`. Retirer les archivés ici ferait annoncer
      // « 8 » à un chiffre cliquable qui ouvre une liste de 9.
      // `archived` reste renseigné à part, à titre d'information.
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.is_active = TRUE)::int AS active,
                COUNT(*) FILTER (WHERE u.is_active = FALSE)::int AS suspended,
                COUNT(*) FILTER (WHERE u.archived_at IS NOT NULL)::int AS archived,
                COUNT(*) FILTER (WHERE u.can_login = TRUE)::int AS with_login,
                COUNT(*) FILTER (WHERE u.can_login = FALSE)::int AS without_login,
                COUNT(*) FILTER (WHERE u.can_login = TRUE AND u.last_login IS NULL)::int AS never_connected,
                COUNT(*) FILTER (WHERE u.last_login >= NOW() - INTERVAL '7 days')::int AS connected_7d,
                COUNT(*) FILTER (WHERE u.is_on_leave = TRUE)::int AS flagged_on_leave
           FROM users u
          WHERE u.establishment_id = $1`,
        [eid]
      ),

      // ── Répartition par catégorie de personnel ─────────────
      query(
        `SELECT ${CATEGORY_EXPR} AS category,
                MIN(${CATEGORY_LABEL_EXPR}) AS label,
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE u.is_active = TRUE)::int AS active
           FROM users u
           JOIN roles r ON r.id = u.role_id
           LEFT JOIN job_titles jt ON jt.id = u.job_title_id
          WHERE u.establishment_id = $1
          GROUP BY ${CATEGORY_EXPR}
          ORDER BY COUNT(*) DESC`,
        [eid]
      ),

      // ── Répartition par rôle ───────────────────────────────
      query(
        `SELECT r.code, MIN(r.name) AS name, MIN(r.level) AS level,
                COUNT(u.id)::int AS total,
                COUNT(u.id) FILTER (WHERE u.is_active = TRUE)::int AS active
           FROM users u
           JOIN roles r ON r.id = u.role_id
          WHERE u.establishment_id = $1
          GROUP BY r.code
          ORDER BY MIN(r.level), MIN(r.name)`,
        [eid]
      ),

      // ── Encadrement service par service ────────────────────
      // `is_head` porte le chef, le rôle `service_supervisor` les surveillants :
      // un service peut compter plusieurs surveillants mais un seul chef.
      //
      // Les trois décomptes reprennent les filtres exacts de
      // `departments.controller.js:14-56` (`is_active = TRUE` sur le membre, le
      // chef et le surveillant). Sans cela, « 2 services sans chef » ici et la
      // colonne « Chef de Service » de l'onglet Services se contrediraient dès
      // qu'un chef est clôturé.
      query(
        `SELECT d.id, d.code, d.name, d.department_type, d.floor,
                d.min_guard_count,
                (SELECT COUNT(*)::int FROM user_departments udc
                   JOIN users uc ON uc.id = udc.user_id AND uc.is_active = TRUE
                  WHERE udc.department_id = d.id) AS member_count,
                (SELECT COUNT(*)::int FROM user_departments udh
                   JOIN users hu ON hu.id = udh.user_id AND hu.is_active = TRUE
                  WHERE udh.department_id = d.id AND udh.is_head = TRUE) AS head_count,
                (SELECT COUNT(*)::int FROM user_departments uds
                   JOIN users su ON su.id = uds.user_id AND su.is_active = TRUE
                   JOIN roles rs ON rs.id = su.role_id AND rs.code = 'service_supervisor'
                  WHERE uds.department_id = d.id) AS supervisor_count,
                (SELECT hu.first_name || ' ' || hu.last_name
                   FROM user_departments hud
                   JOIN users hu ON hu.id = hud.user_id AND hu.is_active = TRUE
                  WHERE hud.department_id = d.id AND hud.is_head = TRUE
                  LIMIT 1) AS head_name
           FROM departments d
          WHERE d.establishment_id = $1 AND d.is_active = TRUE
          ORDER BY d.name`,
        [eid]
      ),

      // ── Plannings par état dérivé ──────────────────────────
      // `planning_state()` (migration 019) est la seule définition de l'état :
      // la recalculer ici ferait diverger cet écran des autres.
      query(
        `SELECT planning_state(s.status, s.start_date, s.end_date) AS state,
                COUNT(*)::int AS total
           FROM schedules s
          WHERE s.establishment_id = $1
          GROUP BY 1`,
        [eid]
      ),

      // ── Tableurs en cours, pour l'effectif du jour ─────────
      query(
        `SELECT s.id, s.name, s.department_id, s.status, s.metadata, s.schedule_type,
                TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date
           FROM schedules s
          WHERE s.establishment_id = $1
            AND planning_state(s.status, s.start_date, s.end_date) = 'en_cours'
          ORDER BY s.start_date
          LIMIT ${ACTIVE_SCHEDULE_LIMIT}`,
        [eid]
      ),

      // ── Congés (absences kind = 'leave', comme LeavesPanel) ─
      query(
        `SELECT COUNT(*) FILTER (
                  WHERE CURRENT_DATE BETWEEN a.start_date AND a.end_date
                )::int AS ongoing,
                COUNT(*) FILTER (
                  WHERE a.start_date > CURRENT_DATE
                    AND a.start_date <= CURRENT_DATE + INTERVAL '7 days'
                )::int AS upcoming_7d,
                COUNT(*) FILTER (WHERE a.end_date >= CURRENT_DATE)::int AS current_and_future
           FROM absences a
          WHERE a.establishment_id = $1
            AND a.kind = 'leave'
            AND a.status <> 'cancelled'`,
        [eid]
      ),

      // ── Demandes en attente d'un arbitrage de la direction ──
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM profile_change_requests pcr
              JOIN users pu ON pu.id = pcr.user_id
             WHERE pu.establishment_id = $1 AND pcr.status = 'pending') AS profile_requests,
           (SELECT COUNT(*)::int FROM staff_loan_requests slr
             WHERE slr.establishment_id = $1 AND slr.status = 'pending') AS staff_loans,
           (SELECT COUNT(*)::int FROM schedules s
             WHERE s.establishment_id = $1
               AND s.status IN ('submitted','under_review')) AS schedules_to_review,
           (SELECT COUNT(*)::int FROM absences a
             WHERE a.establishment_id = $1 AND a.kind = 'leave'
               AND a.status = 'pending') AS leaves_pending`,
        [eid]
      ),

      // ── Activité récente de l'établissement ────────────────
      query(
        `SELECT al.id, al.action, al.category, al.description, al.severity,
                TO_CHAR(al.created_at, 'YYYY-MM-DD HH24:MI') AS at,
                u.first_name, u.last_name, r.name AS role_name
           FROM activity_logs al
           JOIN users u ON u.id = al.user_id
           JOIN roles r ON r.id = u.role_id
          WHERE u.establishment_id = $1
          ORDER BY al.created_at DESC
          LIMIT ${ACTIVITY_LIMIT}`,
        [eid]
      ),
    ]);

    if (!establishment.rows.length) {
      return res.status(404).json({ success: false, message: 'Établissement introuvable' });
    }

    const est = establishment.rows[0];
    const today = est.today || dateKey(new Date());

    // ── Effectif de garde aujourd'hui, lu dans les tableurs ──
    // `rosterOnDate` est la même lecture que l'appel du jour : les deux écrans
    // annoncent donc le même effectif, y compris pour les lignes sans code
    // journalier dont seule la période de participation est renseignée.
    //
    // Le dédoublonnage `planning|agent` et le rattachement au service
    // propriétaire du planning reprennent `journal.controller.js:869-895`. Sans
    // eux, une ligne dupliquée dans le tableur ferait annoncer 9 gardes ici et 8
    // dans « Supervision Hôpital » pour la même journée.
    const onDutyStaff = new Set();
    const coveredDepartments = new Set();
    const seenToday = new Set();
    let guardsToday = 0;
    let atHomeToday = 0;

    for (const schedule of activeSchedules.rows) {
      let covered = false;
      for (const entry of rosterOnDate(schedule, today)) {
        const dedup = entry.userId ? `${schedule.id}|${entry.userId}` : null;
        if (dedup) {
          if (seenToday.has(dedup)) continue;
          seenToday.add(dedup);
        }
        guardsToday += 1;
        covered = true;
        if (entry.userId) onDutyStaff.add(entry.userId);
        if (entry.atHome) atHomeToday += 1;
      }
      if (covered && schedule.department_id) coveredDepartments.add(schedule.department_id);
    }

    // ── Encadrement : les manques, nommés ────────────────────
    const deptRows = departments.rows.map((d) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      departmentType: d.department_type,
      floor: d.floor,
      minGuardCount: toInt(d.min_guard_count),
      memberCount: toInt(d.member_count),
      supervisorCount: toInt(d.supervisor_count),
      hasHead: toInt(d.head_count) > 0,
      headName: d.head_name || null,
      coveredToday: coveredDepartments.has(d.id),
    }));

    const stateCounts = planningStates.rows.reduce((acc, row) => {
      acc[row.state] = toInt(row.total);
      return acc;
    }, {});

    const s = staffTotals.rows[0] || {};
    const l = leaves.rows[0] || {};
    const p = pending.rows[0] || {};

    return res.json({
      success: true,
      data: {
        today,
        establishment: {
          id: est.id, name: est.name, code: est.code,
          governorate: est.governorate, city: est.city,
        },

        staff: {
          total: toInt(s.total),
          active: toInt(s.active),
          suspended: toInt(s.suspended),
          archived: toInt(s.archived),
          withLogin: toInt(s.with_login),
          withoutLogin: toInt(s.without_login),
          neverConnected: toInt(s.never_connected),
          connected7d: toInt(s.connected_7d),
          flaggedOnLeave: toInt(s.flagged_on_leave),
        },

        byCategory: byCategory.rows.map((c) => ({
          key: c.category || 'unknown',
          label: c.label
            || CATEGORY_FALLBACK_LABELS[c.category]
            || (c.category ? `Catégorie « ${c.category} »` : 'Catégorie non renseignée'),
          total: toInt(c.total),
          active: toInt(c.active),
        })),

        byRole: byRole.rows.map((r) => ({
          code: r.code,
          name: r.name,
          level: toInt(r.level),
          total: toInt(r.total),
          active: toInt(r.active),
        })),

        encadrement: {
          departments: deptRows.length,
          withHead: deptRows.filter((d) => d.hasHead).length,
          withoutHead: deptRows.filter((d) => !d.hasHead).length,
          withSupervisor: deptRows.filter((d) => d.supervisorCount > 0).length,
          withoutSupervisor: deptRows.filter((d) => d.supervisorCount === 0).length,
          empty: deptRows.filter((d) => d.memberCount === 0).length,
          list: deptRows,
        },

        planning: {
          brouillon: toInt(stateCounts.brouillon),
          soumis: toInt(stateCounts.soumis),
          enCours: toInt(stateCounts.en_cours),
          termine: toInt(stateCounts.termine),
          // Assumé et dit : au-delà de la limite, l'effectif du jour serait
          // partiel. Le panneau affiche l'avertissement plutôt que de taire
          // un décompte incomplet.
          activeRead: activeSchedules.rows.length,
          activeReadLimit: ACTIVE_SCHEDULE_LIMIT,
          guardsToday,
          atHomeToday,
          staffOnDutyToday: onDutyStaff.size,
          departmentsCoveredToday: deptRows.filter((d) => d.coveredToday).length,
        },

        leaves: {
          ongoing: toInt(l.ongoing),
          upcoming7d: toInt(l.upcoming_7d),
          currentAndFuture: toInt(l.current_and_future),
          pending: toInt(p.leaves_pending),
        },

        pending: {
          profileRequests: toInt(p.profile_requests),
          staffLoans: toInt(p.staff_loans),
          schedulesToReview: toInt(p.schedules_to_review),
          leaves: toInt(p.leaves_pending),
        },

        activity: activity.rows.map((a) => ({
          id: a.id,
          action: a.action,
          category: a.category,
          description: a.description,
          severity: a.severity,
          at: a.at,
          userName: `${a.first_name} ${a.last_name}`,
          roleName: a.role_name,
        })),
      },
    });
  } catch (err) {
    console.error('directorOverview.getDirectorOverview error:', err);
    return res.status(500).json({
      success: false,
      message: "Erreur lors du chargement de la vue d'ensemble",
    });
  }
};

module.exports = { getDirectorOverview, PILOT_ROLES };
