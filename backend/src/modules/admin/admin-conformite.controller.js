/**
 * Fiche de conformité des établissements — Super Admin (Lot X6, C1).
 *
 * Le Super Admin pouvait créer un hôpital, nommer son directeur et consulter son
 * personnel, mais jamais répondre à la question du pilotage national : *cet
 * hôpital est-il en état de tenir ses gardes ?* Les trous existaient bel et bien
 * — un établissement sans chef de service, sans coordonnées GPS ou sans
 * catalogue de gardes reste muet dans toutes les listes actuelles.
 *
 * Ce module n'invente aucune donnée : il agrège ce que la base contient déjà en
 * huit contrôles, et distingue ce qui **bloque** l'exploitation de ce qui est
 * seulement **incomplet**.
 *
 * ── Pourquoi huit contrôles et non les sept annoncés ──────────
 * L'onglet « Référentiels » (Lot X4) juge déjà un établissement « prêt » sur les
 * types de garde ET les types d'absence. Si cette fiche ignorait les types
 * d'absence, deux écrans du même tableau de bord donneraient deux verdicts
 * différents sur le même hôpital. Le contrôle est donc repris ici, et la fiche
 * expose les deux lectures côte à côte :
 *   • `referentielsReady` — exactement le prédicat de l'onglet Référentiels ;
 *   • `operational`       — aucun contrôle bloquant en échec (verdict de cette
 *                           fiche, strictement plus exigeant).
 * Ainsi la fiche contient le verdict de l'autre écran au lieu de le contredire.
 *
 * ── Étanchéité ────────────────────────────────────────────────
 * Fichier neuf. Aucun contrôleur existant n'est modifié : les requêtes sont
 * écrites ici, et les deux réparations réutilisent des briques déjà en service
 * (`ensureDefaultShiftTypes`, `ensureDefaultAbsenceTypes`,
 * `seed_job_titles_for_establishment`) sans toucher à leur code.
 */

const { query } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');
const { ensureDefaultShiftTypes, STANDARD_SHIFT_CODES } = require('../schedules/shift-types.service');
const { ensureDefaultAbsenceTypes } = require('../absences/absence-types.service');

/**
 * Types d'absence sans lesquels l'appel du jour ne peut rien enregistrer.
 * Même liste que `admin-referentiels.controller.js` — les deux écrans doivent
 * juger sur le même critère.
 */
const REQUIRED_ABSENCE_CODES = ['retard', 'absence_injustifiee'];

/** Bornage GPS de la Tunisie, repris de `establishments.controller.js`. */
const TN_BOUNDS = { latMin: 30, latMax: 38, lngMin: 7, lngMax: 12.5 };

/** Statuts de planning qui valent « soumis » : le brouillon ne compte pas. */
const SUBMITTED_STATUSES = ['submitted', 'under_review', 'approved', 'active'];

const requireSuperAdmin = (req, res) => {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ success: false, message: 'Réservé au Super Admin' });
    return false;
  }
  return true;
};

const fail = (res, code, message) => res.status(code).json({ success: false, message });
const toInt = (value) => Number(value) || 0;

/**
 * Construit un contrôle. `severity: 'blocking'` signifie que l'exploitation est
 * impossible tant que la ligne est rouge ; `'warning'`, que le dossier est
 * incomplet sans empêcher de travailler.
 *
 * `fix` décrit à l'interface où corriger : `tab` pour un onglet du tableau de
 * bord, `repair` pour une réparation automatique offerte par ce module.
 */
const check = (key, label, ok, detail, severity, fix, hint) => ({
  key, label, ok, detail, severity,
  fix: fix || null,
  hint: hint || null,
});

/**
 * Les huit contrôles d'un établissement, à partir d'une ligne déjà agrégée.
 * Fonction pure : la liste et la fiche détaillée l'appellent toutes deux, donc
 * elles ne peuvent pas diverger.
 */
const buildChecks = (row) => {
  const shiftCodes = row.shift_codes || [];
  const absenceCodes = row.absence_codes || [];
  const missingShift = STANDARD_SHIFT_CODES.filter((c) => !shiftCodes.includes(c));
  const missingAbsence = REQUIRED_ABSENCE_CODES.filter((c) => !absenceCodes.includes(c));
  const departments = toInt(row.departments_total);
  const deptWithoutHead = toInt(row.departments_without_head);
  const hasGps = row.latitude !== null && row.longitude !== null;
  const gpsInTunisia = hasGps
    && Number(row.latitude) >= TN_BOUNDS.latMin && Number(row.latitude) <= TN_BOUNDS.latMax
    && Number(row.longitude) >= TN_BOUNDS.lngMin && Number(row.longitude) <= TN_BOUNDS.lngMax;

  return [
    check(
      'director',
      'Directeur nommé et actif',
      toInt(row.active_directors) > 0,
      toInt(row.active_directors) > 0
        ? `${row.director_name}${toInt(row.active_directors) > 1 ? ` (+${toInt(row.active_directors) - 1} autre[s])` : ''}`
        : (toInt(row.directors_total) > 0
          ? 'Un compte de direction existe mais il est désactivé'
          : 'Aucun compte de direction'),
      'blocking',
      { kind: 'tab', target: 'establishments', estTab: 'director' },
      'Onglet « Établissements » → Directeur',
    ),
    check(
      'departments',
      'Au moins un service',
      departments > 0,
      departments > 0
        ? `${departments} service(s) actif(s)`
        : 'Aucun service : aucun planning ne peut être créé',
      'blocking',
      { kind: 'tab', target: 'establishments', estTab: 'overview' },
      'Le directeur crée les services depuis « Gestion des services »',
    ),
    check(
      'shiftTypes',
      'Types de garde standards (J / S / N / G)',
      missingShift.length === 0,
      missingShift.length === 0
        ? `${shiftCodes.length} type(s) actif(s)`
        : `Manque : ${missingShift.join(', ')} — le tableur refusera ces codes`,
      'blocking',
      { kind: 'repair', target: 'referentiels' },
      'Réparable en un clic',
    ),
    check(
      'absenceTypes',
      'Types d\'absence de l\'appel du jour',
      missingAbsence.length === 0,
      missingAbsence.length === 0
        ? `${absenceCodes.length} type(s) actif(s)`
        : `Manque : ${missingAbsence.join(', ')} — l'appel du jour ne pourra rien enregistrer`,
      'blocking',
      { kind: 'repair', target: 'referentiels' },
      'Réparable en un clic',
    ),
    check(
      'heads',
      'Un chef par service',
      departments > 0 && deptWithoutHead === 0,
      departments === 0
        ? 'Sans objet : aucun service'
        : (deptWithoutHead === 0
          ? `${departments} service(s) pourvu(s)`
          : `${deptWithoutHead} service(s) sans chef actif`),
      'warning',
      { kind: 'tab', target: 'establishments', estTab: 'overview' },
      'Le directeur désigne un chef depuis « Gestion des services »',
    ),
    check(
      'jobTitles',
      'Fonctions hospitalières amorcées',
      toInt(row.job_titles_total) > 0,
      toInt(row.job_titles_total) > 0
        ? `${toInt(row.job_titles_total)} fonction(s) au catalogue`
        : 'Catalogue vide : aucune fonction proposée à la création d\'un compte',
      'warning',
      { kind: 'repair', target: 'fonctions' },
      'Réparable en un clic',
    ),
    check(
      'gps',
      'Coordonnées GPS renseignées',
      hasGps && gpsInTunisia,
      !hasGps
        ? 'Absentes : l\'établissement ne figure pas sur la carte'
        : (gpsInTunisia
          ? `${Number(row.latitude).toFixed(4)}, ${Number(row.longitude).toFixed(4)}`
          : `Hors du territoire tunisien (${Number(row.latitude).toFixed(4)}, ${Number(row.longitude).toFixed(4)})`),
      'warning',
      { kind: 'tab', target: 'establishments', estTab: 'overview' },
      'Onglet « Établissements » → Modifier',
    ),
    check(
      'schedule',
      'Un planning soumis ce mois-ci',
      toInt(row.schedules_submitted_month) > 0,
      toInt(row.schedules_submitted_month) > 0
        ? `${toInt(row.schedules_submitted_month)} planning(s) soumis`
        : (toInt(row.schedules_draft_month) > 0
          ? `${toInt(row.schedules_draft_month)} brouillon(s) seulement : rien de soumis`
          : 'Aucun planning pour le mois en cours'),
      'warning',
      null,
      'Relève des chefs de service',
    ),
  ];
};

/**
 * Requête d'agrégation partagée par la liste et la fiche. `$1` vaut NULL pour
 * balayer tous les établissements, ou l'identifiant d'un seul.
 *
 * Le mois courant est calculé par PostgreSQL (`date_trunc('month', CURRENT_DATE)`)
 * et jamais côté Node : construire une borne avec `new Date()` décalerait d'un
 * jour au changement de mois sous un fuseau positif.
 */
const AGGREGATE_SQL = `
  SELECT e.id, e.code, e.name, e.type, e.governorate, e.city, e.is_active,
         e.latitude, e.longitude, e.created_at,
         (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
           WHERE u.establishment_id = e.id AND r.code IN ('director','hospital_admin')) AS directors_total,
         (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id
           WHERE u.establishment_id = e.id AND r.code IN ('director','hospital_admin')
             AND u.is_active = TRUE) AS active_directors,
         (SELECT u.first_name || ' ' || u.last_name FROM users u JOIN roles r ON r.id = u.role_id
           WHERE u.establishment_id = e.id AND r.code IN ('director','hospital_admin')
             AND u.is_active = TRUE
           ORDER BY r.code = 'director' DESC, u.created_at LIMIT 1) AS director_name,
         (SELECT COUNT(*) FROM departments d
           WHERE d.establishment_id = e.id AND d.is_active = TRUE) AS departments_total,
         (SELECT COUNT(*) FROM departments d
           WHERE d.establishment_id = e.id AND d.is_active = TRUE
             AND NOT EXISTS (
               SELECT 1 FROM user_departments ud JOIN users u ON u.id = ud.user_id
                WHERE ud.department_id = d.id AND ud.is_head = TRUE AND u.is_active = TRUE
             )) AS departments_without_head,
         COALESCE((SELECT ARRAY_AGG(UPPER(st.code) ORDER BY st.code) FROM shift_types st
                    WHERE st.establishment_id = e.id AND st.is_active = TRUE), '{}') AS shift_codes,
         COALESCE((SELECT ARRAY_AGG(at.code ORDER BY at.code) FROM absence_types at
                    WHERE at.establishment_id = e.id AND at.is_active = TRUE), '{}') AS absence_codes,
         (SELECT COUNT(*) FROM job_titles jt
           WHERE jt.establishment_id = e.id AND jt.is_active = TRUE) AS job_titles_total,
         (SELECT COUNT(*) FROM users u
           WHERE u.establishment_id = e.id AND u.is_active = TRUE) AS staff_total,
         -- La colonne schedules.establishment_id est la clé faisant foi et
         -- n'est jamais nulle : compter par cette colonne plutôt qu'en passant
         -- par le service évite de perdre un planning si son service change de
         -- rattachement.
         (SELECT COUNT(*) FROM schedules s
           WHERE s.establishment_id = e.id
             AND s.start_date >= date_trunc('month', CURRENT_DATE)
             AND s.start_date <  date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
             AND s.status = ANY($2::text[])) AS schedules_submitted_month,
         (SELECT COUNT(*) FROM schedules s
           WHERE s.establishment_id = e.id
             AND s.start_date >= date_trunc('month', CURRENT_DATE)
             AND s.start_date <  date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
             AND s.status = 'draft') AS schedules_draft_month
    FROM establishments e
   WHERE e.type <> 'system'
     AND ($1::uuid IS NULL OR e.id = $1::uuid)
   ORDER BY e.name`;

/** Assemble une fiche à partir d'une ligne agrégée. */
const buildFiche = (row) => {
  const checks = buildChecks(row);
  const blocking = checks.filter((c) => c.severity === 'blocking' && !c.ok);
  const warnings = checks.filter((c) => c.severity === 'warning' && !c.ok);
  const shiftOk = checks.find((c) => c.key === 'shiftTypes')?.ok === true;
  const absenceOk = checks.find((c) => c.key === 'absenceTypes')?.ok === true;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    governorate: row.governorate,
    city: row.city,
    isActive: row.is_active,
    staff: toInt(row.staff_total),
    departments: toInt(row.departments_total),
    checks,
    score: { passed: checks.filter((c) => c.ok).length, total: checks.length },
    blocking: blocking.length,
    warnings: warnings.length,
    // Verdict de cette fiche : aucun contrôle bloquant en échec.
    operational: blocking.length === 0,
    // Verdict de l'onglet « Référentiels » (Lot X4), repris à l'identique pour
    // que les deux écrans ne puissent pas se contredire.
    referentielsReady: shiftOk && absenceOk,
    // Un dossier « complet » n'a plus aucune ligne rouge, même mineure.
    complete: blocking.length === 0 && warnings.length === 0,
  };
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/conformite
// Tableau de conformité de tout le réseau.
// ══════════════════════════════════════════════════════════════
const getConformite = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const result = await query(AGGREGATE_SQL, [null, SUBMITTED_STATUSES]);
    const establishments = result.rows.map(buildFiche);

    // Un compteur par contrôle : c'est ce qui dit à la direction *où* le réseau
    // faiblit, plutôt qu'un simple total d'établissements en défaut.
    const byCheck = {};
    for (const est of establishments) {
      for (const c of est.checks) {
        if (!byCheck[c.key]) byCheck[c.key] = { key: c.key, label: c.label, severity: c.severity, failing: 0 };
        if (!c.ok) byCheck[c.key].failing += 1;
      }
    }

    return res.json({
      success: true,
      data: {
        establishments,
        summary: {
          establishments: establishments.length,
          operational: establishments.filter((e) => e.operational).length,
          complete: establishments.filter((e) => e.complete).length,
          blocked: establishments.filter((e) => !e.operational).length,
          inactive: establishments.filter((e) => !e.isActive).length,
          checks: Object.values(byCheck).sort((a, b) => b.failing - a.failing),
        },
      },
    });
  } catch (err) {
    console.error('adminConformite.getConformite error:', err);
    return fail(res, 500, 'Erreur lors du calcul de la conformité');
  }
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/conformite/:id
// Fiche détaillée : les mêmes contrôles, plus le nom de ce qui manque.
// ══════════════════════════════════════════════════════════════
const getConformiteDetail = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { id } = req.params;

    const result = await query(AGGREGATE_SQL, [id, SUBMITTED_STATUSES]);
    if (!result.rows.length) return fail(res, 404, 'Établissement introuvable');
    const fiche = buildFiche(result.rows[0]);

    // Le détail nominatif — c'est lui qui rend la ligne rouge actionnable :
    // « 3 services sans chef » ne sert à rien sans les trois noms.
    const [deptRes, dirRes, schedRes] = await Promise.all([
      query(
        `SELECT d.id, d.name, d.code,
                (SELECT u.first_name || ' ' || u.last_name
                   FROM user_departments ud JOIN users u ON u.id = ud.user_id
                  WHERE ud.department_id = d.id AND ud.is_head = TRUE AND u.is_active = TRUE
                  LIMIT 1) AS head_name,
                (SELECT COUNT(*) FROM user_departments ud JOIN users u ON u.id = ud.user_id
                  WHERE ud.department_id = d.id AND u.is_active = TRUE) AS staff_count
           FROM departments d
          WHERE d.establishment_id = $1 AND d.is_active = TRUE
          ORDER BY d.name`,
        [id]
      ),
      query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.is_active, u.can_login,
                r.code AS role_code, r.name AS role_name,
                TO_CHAR(u.last_login, 'YYYY-MM-DD HH24:MI') AS last_login
           FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.establishment_id = $1 AND r.code IN ('director','hospital_admin')
          ORDER BY r.code = 'director' DESC, u.created_at`,
        [id]
      ),
      query(
        `SELECT s.id, s.name, s.status, d.name AS department_name,
                TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(s.end_date, 'YYYY-MM-DD') AS end_date
           FROM schedules s LEFT JOIN departments d ON d.id = s.department_id
          WHERE s.establishment_id = $1
            AND s.start_date >= date_trunc('month', CURRENT_DATE)
            AND s.start_date <  date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
          ORDER BY d.name, s.start_date`,
        [id]
      ),
    ]);

    return res.json({
      success: true,
      data: {
        ...fiche,
        detail: {
          departments: deptRes.rows.map((d) => ({
            id: d.id, name: d.name, code: d.code,
            headName: d.head_name, staffCount: toInt(d.staff_count),
          })),
          directors: dirRes.rows.map((u) => ({
            id: u.id,
            name: `${u.first_name} ${u.last_name}`,
            email: u.email,
            isActive: u.is_active,
            canLogin: u.can_login,
            roleCode: u.role_code,
            roleName: u.role_name,
            lastLogin: u.last_login,
          })),
          schedulesThisMonth: schedRes.rows.map((s) => ({
            id: s.id, name: s.name, status: s.status,
            departmentName: s.department_name,
            startDate: s.start_date, endDate: s.end_date,
            submitted: SUBMITTED_STATUSES.includes(s.status),
          })),
        },
      },
    });
  } catch (err) {
    console.error('adminConformite.getConformiteDetail error:', err);
    return fail(res, 500, 'Erreur lors du chargement de la fiche');
  }
};

// ══════════════════════════════════════════════════════════════
// POST /api/admin/conformite/:id/repair
// Réparation des seules lignes rouges réparables sans décision métier :
// les référentiels et le catalogue de fonctions. Jamais un directeur, jamais un
// service — nommer quelqu'un ou créer un service relève de la direction.
// ══════════════════════════════════════════════════════════════
const repairConformite = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { id } = req.params;
    const { targets } = req.body || {};

    const wanted = Array.isArray(targets) && targets.length ? targets : ['referentiels', 'fonctions'];
    const doRef = wanted.includes('referentiels');
    const doFn = wanted.includes('fonctions');
    if (!doRef && !doFn) return fail(res, 400, 'Aucune réparation demandée');

    const est = await query(
      `SELECT id, name FROM establishments WHERE id = $1 AND type <> 'system'`,
      [id]
    );
    if (!est.rows.length) return fail(res, 404, 'Établissement introuvable');

    const done = [];

    if (doRef) {
      const created = await ensureDefaultShiftTypes(id);
      // `ensureDefaultShiftTypes` insère avec `ON CONFLICT DO NOTHING` — à
      // dessein : un établissement qui a adapté ses horaires ou ses couleurs ne
      // doit pas les voir réécrits. Conséquence à couvrir ici : un type
      // standard **présent mais désactivé** ne serait pas réinséré, la ligne
      // resterait rouge et la réparation annoncerait « déjà complets ». On
      // réactive donc explicitement les codes du vocabulaire du tableur, sans
      // toucher au reste de leur définition. Symétrique de
      // `ensureDefaultAbsenceTypes`, qui réactive déjà via `DO UPDATE`.
      const revived = await query(
        `UPDATE shift_types SET is_active = TRUE
          WHERE establishment_id = $1 AND UPPER(code) = ANY($2::text[])
            AND is_active = FALSE
          RETURNING code`,
        [id, STANDARD_SHIFT_CODES]
      );
      await ensureDefaultAbsenceTypes(id);

      const parts = [];
      if (created > 0) parts.push(`${created} type(s) de garde créé(s)`);
      if (revived.rowCount > 0) {
        parts.push(`${revived.rowCount} réactivé(s) (${revived.rows.map((r) => r.code).join(', ')})`);
      }
      done.push(parts.length ? parts.join(' et ') : 'types de garde déjà complets');
    }

    if (doFn) {
      const before = await query(
        'SELECT COUNT(*)::int AS n FROM job_titles WHERE establishment_id = $1', [id]
      );
      // Même enchaînement que la création d'établissement : la fonction SQL
      // amorce, puis les catégories sont normalisées sur les trois familles de
      // la migration 031. Reproduit ici pour ne pas modifier
      // `establishments.controller.js`, qui n'expose pas cette étape.
      await query('SELECT seed_job_titles_for_establishment($1)', [id]);
      await query(
        `UPDATE job_titles SET category = CASE
           WHEN category IN ('medical','paramedical','nursing','surgical') THEN 'medical'
           WHEN category IN ('administrative','admin') THEN 'administrative'
           ELSE 'auxiliary' END
         WHERE establishment_id = $1`, [id]
      );
      await query(
        `UPDATE job_titles SET category_label = CASE category
           WHEN 'medical' THEN 'Personnel médical'
           WHEN 'administrative' THEN 'Personnel administratif'
           ELSE 'Personnel auxiliaire' END
         WHERE establishment_id = $1`, [id]
      );
      const after = await query(
        'SELECT COUNT(*)::int AS n FROM job_titles WHERE establishment_id = $1', [id]
      );
      const added = after.rows[0].n - before.rows[0].n;
      done.push(added > 0
        ? `${added} fonction(s) ajoutée(s) au catalogue`
        : 'catalogue de fonctions déjà amorcé');
    }

    log({
      userId: req.user.id,
      action: 'conformite_repair',
      category: 'admin',
      description: `Conformité réparée pour « ${est.rows[0].name} » : ${done.join(', ')}`,
      entityType: 'establishments',
      entityId: id,
      metadata: { targets: wanted, done },
      ipAddress: getIp(req),
    });

    // La fiche recalculée est renvoyée : l'interface n'a pas à deviner l'effet.
    const fresh = await query(AGGREGATE_SQL, [id, SUBMITTED_STATUSES]);

    return res.json({
      success: true,
      data: buildFiche(fresh.rows[0]),
      message: `${est.rows[0].name} — ${done.join(' · ')}.`,
    });
  } catch (err) {
    console.error('adminConformite.repairConformite error:', err);
    return fail(res, 500, 'Erreur lors de la réparation');
  }
};

module.exports = {
  getConformite,
  getConformiteDetail,
  repairConformite,
  // Exportés pour les tests et pour toute réutilisation ultérieure.
  buildChecks,
  buildFiche,
  REQUIRED_ABSENCE_CODES,
  SUBMITTED_STATUSES,
};
