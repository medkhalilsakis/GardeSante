/**
 * Activité réelle de la plateforme (Lot X3) — Super Admin, LECTURE SEULE.
 *
 * `admin.controller.js:getGlobalStats` ne compte que des établissements et des
 * comptes : rien sur les services, les plannings, les gardes, les absences, les
 * remplacements, les prêts ni les alertes. Le tableau de bord Super Admin
 * annonçait donc « statistiques » en n'affichant que de l'annuaire.
 *
 * Ce fichier est NEUF : `admin.controller.js` n'est pas modifié, `getGlobalStats`
 * garde exactement sa forme et ses appelants. Une seule ligne est ajoutée à
 * `admin.routes.js`.
 *
 * INVARIANT CENTRAL : les gardes vivent dans `schedules.metadata.spreadsheet`.
 * La table `shifts` n'est PAS alimentée par le flux tableur — la compter
 * renverrait zéro. On lit donc la même source que les exports, le calendrier
 * hôpital et la supervision, via le lecteur partagé `spreadsheet-reader`.
 *
 * Aucune écriture, aucun effet de bord : seul un GET est monté.
 */

const { query } = require('../../config/database');
const {
  rosterOnDate,
  datesBetween,
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

const toInt = (value) => Number(value) || 0;

/**
 * Bornes du mois courant, calculées à partir de la date **serveur** et rendues
 * en chaînes 'YYYY-MM-DD'. On ne passe jamais par `toISOString()` : sur un
 * serveur à l'heure de Tunis, il décalerait la journée d'un cran.
 */
const monthBounds = (today) => {
  const [year, month] = today.split('-').map(Number);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // mois 1-based → jour 0 du suivant
  const last = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { first, last };
};

/**
 * Plafond de plannings dépliés en mémoire pour le comptage des gardes.
 * Un tableur porte quelques dizaines de lignes × une trentaine de jours : au-delà
 * de ce plafond, l'agrégation nationale coûterait plus que ce qu'elle rapporte.
 * Le dépassement est **annoncé** dans la réponse (`spreadsheetsTruncated`) plutôt
 * que masqué : un chiffre tronqué en silence serait pire qu'un chiffre absent.
 */
const SPREADSHEET_SCAN_LIMIT = 400;

/**
 * GET /api/admin/platform-activity
 *
 * Les chiffres réels de la plateforme, en une seule requête HTTP :
 * services, plannings par état, gardes du jour et du mois, absences et congés,
 * remplacements, prêts de personnel, alertes ouvertes, couverture des
 * établissements et volume de traçabilité.
 */
const getPlatformActivity = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const today = dateKey(new Date());
    const { first: monthStart, last: monthEnd } = monthBounds(today);

    const [
      deptRes,
      stateRes,
      spreadRes,
      spreadCountRes,
      absRes,
      absPendingRes,
      repRes,
      loanRes,
      alertRes,
      noteRes,
      traceRes,
      coverageRes,
    ] = await Promise.all([
      // ── Services ────────────────────────────────────────────
      query(
        `SELECT COUNT(*)                                        AS total,
                COUNT(*) FILTER (WHERE d.is_active = TRUE)      AS active,
                COUNT(DISTINCT d.establishment_id)              AS establishments_with_service,
                COUNT(*) FILTER (WHERE d.created_at >= NOW() - INTERVAL '30 days') AS new_last_30d
         FROM departments d
         JOIN establishments e ON e.id = d.establishment_id
         WHERE e.type <> 'system'`,
        []
      ),

      // ── Plannings par état dérivé (fonction SQL planning_state) ──
      query(
        `SELECT planning_state(s.status, s.start_date, s.end_date) AS state,
                COUNT(*) AS total
         FROM schedules s
         JOIN establishments e ON e.id = s.establishment_id
         WHERE e.type <> 'system'
         GROUP BY 1`,
        []
      ),

      // ── Tableurs à déplier : plannings validés chevauchant le mois ──
      // `status <> 'draft'` : un brouillon n'engage personne, ses cases ne sont
      // pas des gardes de la plateforme. Le chevauchement borne le volume.
      query(
        `SELECT s.id, s.name, s.establishment_id, s.department_id, s.metadata,
                s.schedule_type,
                planning_state(s.status, s.start_date, s.end_date) AS state,
                TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date
         FROM schedules s
         JOIN establishments e ON e.id = s.establishment_id
         WHERE e.type <> 'system'
           AND s.status <> 'draft'
           AND s.end_date   >= $1::date
           AND s.start_date <= $2::date
         ORDER BY s.start_date DESC
         LIMIT $3`,
        [monthStart, monthEnd, SPREADSHEET_SCAN_LIMIT]
      ),

      // Combien y en avait-il réellement ? (pour annoncer une éventuelle troncature)
      query(
        `SELECT COUNT(*) AS total
         FROM schedules s
         JOIN establishments e ON e.id = s.establishment_id
         WHERE e.type <> 'system'
           AND s.status <> 'draft'
           AND s.end_date   >= $1::date
           AND s.start_date <= $2::date`,
        [monthStart, monthEnd]
      ),

      // ── Absences et congés en cours aujourd'hui, par nature ──
      query(
        `SELECT a.kind, COUNT(*) AS total
         FROM absences a
         JOIN establishments e ON e.id = a.establishment_id
         WHERE e.type <> 'system'
           AND a.status <> 'cancelled'
           AND $1::date BETWEEN a.start_date AND a.end_date
         GROUP BY a.kind`,
        [today]
      ),

      // Demandes en attente de validation (toutes natures, toutes dates)
      query(
        `SELECT COUNT(*) AS total
         FROM absences a
         JOIN establishments e ON e.id = a.establishment_id
         WHERE e.type <> 'system' AND a.status = 'pending'`,
        []
      ),

      // ── Remplacements ────────────────────────────────────────
      query(
        `SELECT COUNT(*)                                                       AS total,
                COUNT(*) FILTER (WHERE r.confirmation_status = 'pending_chef') AS pending_chef,
                COUNT(*) FILTER (
                  WHERE r.status NOT IN ('cancelled', 'rejected')
                    AND r.start_date IS NOT NULL
                    AND $1::date BETWEEN r.start_date AND COALESCE(r.end_date, r.start_date)
                )                                                              AS active_today,
                COUNT(*) FILTER (WHERE r.created_at >= NOW() - INTERVAL '30 days') AS last_30d
         FROM replacements r
         JOIN establishments e ON e.id = r.establishment_id
         WHERE e.type <> 'system'`,
        [today]
      ),

      // ── Prêts de personnel entre services ───────────────────
      query(
        `SELECT COUNT(*)                                                          AS total,
                COUNT(*) FILTER (WHERE l.status = 'pending')                      AS pending,
                COUNT(*) FILTER (WHERE l.status IN ('approved', 'auto_approved'))  AS approved,
                COUNT(*) FILTER (WHERE l.status = 'rejected')                      AS rejected,
                COUNT(*) FILTER (WHERE l.shift_date BETWEEN $1::date AND $2::date) AS this_month
         FROM staff_loan_requests l
         JOIN establishments e ON e.id = l.establishment_id
         WHERE e.type <> 'system'`,
        [monthStart, monthEnd]
      ),

      // ── Alertes de service ouvertes ──────────────────────────
      query(
        `SELECT COUNT(*)                                                   AS open_total,
                COUNT(*) FILTER (WHERE a.severity IN ('critical', 'urgent')) AS critical,
                COUNT(*) FILTER (WHERE a.severity = 'error')                 AS errors,
                COUNT(*) FILTER (WHERE a.acknowledged_at IS NULL)            AS unacknowledged
         FROM service_alerts a
         JOIN establishments e ON e.id = a.establishment_id
         WHERE e.type <> 'system' AND a.resolved_at IS NULL`,
        []
      ),

      // ── Notes et circulaires ────────────────────────────────
      query(
        `SELECT COUNT(*)                                                       AS total,
                COUNT(*) FILTER (WHERE scope = 'platform_directors')           AS platform,
                COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '30 days') AS last_30d
         FROM notes`,
        []
      ),

      // ── Traçabilité : volume réellement enregistré ───────────
      query(
        `SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS last_24h,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')   AS last_7d,
                COUNT(DISTINCT user_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') AS actors_7d,
                COUNT(*)                                                          AS total
         FROM activity_logs`,
        []
      ),

      // ── Couverture : où la plateforme est-elle réellement utilisée ? ──
      query(
        `SELECT COUNT(*) AS establishments,
                COUNT(*) FILTER (WHERE e.is_active = TRUE) AS active,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM departments d
                   WHERE d.establishment_id = e.id AND d.is_active = TRUE
                )) AS with_service,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM schedules s
                   WHERE s.establishment_id = e.id AND s.status <> 'draft'
                )) AS with_schedule,
                COUNT(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM schedules s
                   WHERE s.establishment_id = e.id
                     AND planning_state(s.status, s.start_date, s.end_date) = 'en_cours'
                )) AS with_active_schedule
         FROM establishments e
         WHERE e.type <> 'system'`,
        []
      ),
    ]);

    // ── Dépliage des tableurs : la seule source de vérité des gardes ──
    const byState = { brouillon: 0, soumis: 0, en_cours: 0, termine: 0 };
    for (const row of stateRes.rows) {
      if (byState[row.state] != null) byState[row.state] = toInt(row.total);
    }

    const staffMonth = new Set();
    const staffToday = new Set();
    const departmentsOnDuty = new Set();
    const establishmentsOnDuty = new Set();
    let atHomeToday = 0;
    let dutySlotsToday = 0;
    let dutySlotsMonth = 0;

    for (const schedule of spreadRes.rows) {
      // Effectif réellement de service. Une ligne de tableur exprime son service
      // par ses cases cochées ou par sa période de participation ; `rosterOnDate`
      // applique la règle d'arbitrage complète, exactement comme l'appel du jour
      // et le calendrier détaillé. Le dédoublonnage `planning|agent` reproduit
      // celui de `journal.controller.js`, pour que les deux écrans annoncent le
      // même nombre.
      const firstDay = schedule.start_date > monthStart ? schedule.start_date : monthStart;
      const lastDay = schedule.end_date < monthEnd ? schedule.end_date : monthEnd;
      for (const day of datesBetween(firstDay, lastDay)) {
        const seen = new Set();
        for (const entry of rosterOnDate(schedule, day)) {
          if (entry.userId) {
            if (seen.has(entry.userId)) continue;
            seen.add(entry.userId);
            staffMonth.add(entry.userId);
          }
          dutySlotsMonth += 1;
          if (day !== today) continue;
          dutySlotsToday += 1;
          if (entry.atHome) atHomeToday += 1;
          if (entry.userId) staffToday.add(entry.userId);
          if (entry.departmentId) departmentsOnDuty.add(entry.departmentId);
          establishmentsOnDuty.add(schedule.establishment_id);
        }
      }
    }

    const dept = deptRes.rows[0] || {};
    const abs = absRes.rows.reduce((acc, row) => {
      acc[row.kind] = toInt(row.total);
      return acc;
    }, { leave: 0, shift_absence: 0, late: 0 });
    const rep = repRes.rows[0] || {};
    const loan = loanRes.rows[0] || {};
    const alert = alertRes.rows[0] || {};
    const note = noteRes.rows[0] || {};
    const trace = traceRes.rows[0] || {};
    const cover = coverageRes.rows[0] || {};

    const scanned = spreadRes.rows.length;
    const scannable = toInt(spreadCountRes.rows[0]?.total);

    return res.json({
      success: true,
      data: {
        today,
        month: { start: monthStart, end: monthEnd },

        services: {
          total: toInt(dept.total),
          active: toInt(dept.active),
          establishmentsWithService: toInt(dept.establishments_with_service),
          newLast30d: toInt(dept.new_last_30d),
        },

        plannings: {
          total: byState.brouillon + byState.soumis + byState.en_cours + byState.termine,
          brouillon: byState.brouillon,
          soumis: byState.soumis,
          enCours: byState.en_cours,
          termine: byState.termine,
        },

        // Gardes : comptées dans le tableur, jamais dans `shifts`.
        // `dutySlots*` / `staff*` = effectif réellement de service, cases cochées
        // ou période de participation selon la ligne (la lecture de l'appel du
        // jour).
        guards: {
          dutySlotsToday,
          staffOnDutyToday: staffToday.size,
          atHomeToday,
          departmentsOnDutyToday: departmentsOnDuty.size,
          establishmentsOnDutyToday: establishmentsOnDuty.size,
          dutySlotsThisMonth: dutySlotsMonth,
          staffThisMonth: staffMonth.size,
          spreadsheetsScanned: scanned,
          spreadsheetsTruncated: Math.max(0, scannable - scanned),
        },

        absences: {
          leavesToday: abs.leave,
          shiftAbsencesToday: abs.shift_absence,
          latesToday: abs.late,
          todayTotal: abs.leave + abs.shift_absence + abs.late,
          pending: toInt(absPendingRes.rows[0]?.total),
        },

        replacements: {
          total: toInt(rep.total),
          pendingChef: toInt(rep.pending_chef),
          activeToday: toInt(rep.active_today),
          last30d: toInt(rep.last_30d),
        },

        loans: {
          total: toInt(loan.total),
          pending: toInt(loan.pending),
          approved: toInt(loan.approved),
          rejected: toInt(loan.rejected),
          thisMonth: toInt(loan.this_month),
        },

        alerts: {
          open: toInt(alert.open_total),
          critical: toInt(alert.critical),
          errors: toInt(alert.errors),
          unacknowledged: toInt(alert.unacknowledged),
        },

        notes: {
          total: toInt(note.total),
          platform: toInt(note.platform),
          last30d: toInt(note.last_30d),
        },

        traceability: {
          last24h: toInt(trace.last_24h),
          last7d: toInt(trace.last_7d),
          actors7d: toInt(trace.actors_7d),
          total: toInt(trace.total),
        },

        coverage: {
          establishments: toInt(cover.establishments),
          active: toInt(cover.active),
          withService: toInt(cover.with_service),
          withSchedule: toInt(cover.with_schedule),
          withActiveSchedule: toInt(cover.with_active_schedule),
        },
      },
    });
  } catch (err) {
    console.error('adminPlatform.getPlatformActivity error:', err);
    return res.status(500).json({
      success: false,
      message: "Erreur lors du chargement de l'activité de la plateforme",
    });
  }
};

module.exports = { getPlatformActivity };
