/**
 * Statistiques des prêts de personnel (point 5) — lecture seule.
 *
 * POURQUOI UN FICHIER À PART : `listLoans` (staff-loans.controller.js) est borné
 * à `owner_chief_id = acteur OR requesting_chief_id = acteur`. C'est correct pour
 * une boîte de réception, mais un directeur n'y voit alors RIEN — il n'est ni
 * prêteur ni emprunteur. Les statistiques ont besoin d'une portée propre, donc
 * d'une lecture séparée. `listLoans` n'est pas touché.
 *
 * La portée n'est jamais choisie par le client : elle est déduite du rôle,
 * exactement comme `resolveJournalScope`.
 *   • Super Admin            → plateforme (ou l'établissement ciblé)
 *   • Directeur / SG / admin → son établissement
 *   • Chef de service        → SES services (`is_head = TRUE`), en prêt comme en
 *                              emprunt : un chef doit voir ce qu'il prête ET ce
 *                              qu'il emprunte.
 *   • Tout autre rôle        → 403
 *
 * Aucun INSERT/UPDATE : ce module ne fait que des SELECT.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');

const SCOPE_PLATFORM = 'platform';
const SCOPE_ESTABLISHMENT = 'establishment';
const SCOPE_DEPARTMENTS = 'departments';

const STATUSES = ['pending', 'approved', 'rejected', 'auto_approved'];

/** 'YYYY-MM-DD' ou null — jamais de `new Date(string)`, qui décalerait d'un jour. */
const dateKey = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
  return m ? m[1] : null;
};

/**
 * Lundi de la semaine ISO contenant `iso`, en chaîne. Sert de clé de série
 * temporelle : l'agrégation hebdomadaire lisse le bruit d'une activité qui est,
 * par nature, très irrégulière d'un jour à l'autre.
 */
const weekStart = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const offset = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - offset);
  return dateKey(d);
};

/** Portée effective, sur le modèle de `resolveJournalScope`. */
const resolveLoanScope = async (user, queryParams = {}) => {
  if (user.isSuperAdmin || user.roleCode === ROLES.SUPER_ADMIN) {
    if (queryParams.establishmentId) {
      return { kind: SCOPE_ESTABLISHMENT, establishmentId: queryParams.establishmentId, label: 'Établissement ciblé' };
    }
    return { kind: SCOPE_PLATFORM, label: 'Plateforme' };
  }

  if ([ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN, ROLES.GENERAL_SUPERVISOR].includes(user.roleCode)) {
    return {
      kind: SCOPE_ESTABLISHMENT,
      establishmentId: user.establishmentId,
      label: user.establishmentName || 'Établissement',
    };
  }

  if (user.roleCode === ROLES.DEPARTMENT_HEAD) {
    // Seuls les services dont il est CHEF : un chef n'a pas à voir les prêts
    // d'un service où il n'est que membre.
    const { rows } = await query(
      'SELECT department_id FROM user_departments WHERE user_id = $1 AND is_head = TRUE',
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

/**
 * Fragment WHERE correspondant à la portée. Pousse les paramètres dans `params`
 * et renvoie la condition, ou `null` quand la portée ne peut rien contenir
 * (chef sans service : on renvoie un jeu vide, pas une erreur).
 */
const scopeClause = (scope, params) => {
  if (scope.kind === SCOPE_PLATFORM) return 'TRUE';

  if (scope.kind === SCOPE_ESTABLISHMENT) {
    if (!scope.establishmentId) return null;
    params.push(scope.establishmentId);
    return `l.establishment_id = $${params.length}`;
  }

  if (scope.kind === SCOPE_DEPARTMENTS) {
    if (!scope.departmentIds?.length) return null;
    params.push(scope.departmentIds);
    const idx = params.length;
    // Prêteur OU emprunteur : les deux directions concernent le chef.
    return `(l.owner_department_id = ANY($${idx}) OR l.requesting_department_id = ANY($${idx}))`;
  }

  return null;
};

/** Compteurs vides — même forme quel que soit le chemin, le client ne teste rien. */
const emptyCounts = () => STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), { total: 0 });

/**
 * Taux d'acceptation. Les demandes `pending` sont EXCLUES du dénominateur : une
 * demande non répondue n'est ni un refus ni une acceptation, l'inclure ferait
 * baisser mécaniquement le taux à chaque nouvelle demande.
 * Les `auto_approved` comptent comme acceptées (l'agent a bien été prêté).
 */
const acceptanceRate = (counts) => {
  const decided = counts.approved + counts.rejected + counts.auto_approved;
  if (!decided) return { rate: null, decided: 0 };
  return {
    rate: Math.round(((counts.approved + counts.auto_approved) / decided) * 1000) / 10,
    decided,
  };
};

const bump = (bucket, status) => {
  bucket.total += 1;
  if (bucket[status] === undefined) bucket[status] = 0;
  bucket[status] += 1;
};

// ============================================================
// GET /api/staff-loans/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
// ============================================================
const getStaffLoanStats = async (req, res) => {
  try {
    const scope = await resolveLoanScope(req.user, req.query);
    if (!scope) {
      return res.status(403).json({
        success: false,
        message: 'Votre rôle ne donne pas accès aux statistiques de prêts de personnel',
        message_ar: 'دورك لا يمنح حق الوصول إلى إحصائيات إعارة الموظفين',
      });
    }

    const today = dateKey(new Date());
    const from = dateKey(req.query.from) || `${today.slice(0, 4)}-01-01`;
    const to = dateKey(req.query.to) || today;
    if (to < from) {
      return res.status(400).json({ success: false, message: 'La date de fin précède la date de début' });
    }

    const params = [from, to];
    const clause = scopeClause(scope, params);

    // Portée vide (chef sans service) : réponse valide, jeu vide.
    if (!clause) {
      return res.json({
        success: true,
        data: {
          scope: scope.kind,
          scopeLabel: scope.label,
          period: { from, to },
          summary: { ...emptyCounts(), decided: 0, acceptanceRate: null, avgResponseHours: null, staffCount: 0, schedulesCount: 0, departmentsCount: 0 },
          timeline: [],
          byLender: [],
          byBorrower: [],
          topStaff: [],
        },
      });
    }

    // `requested_at` est un TIMESTAMPTZ : on le compare en DATE pour que la
    // fenêtre soit inclusive des deux côtés, comme le reste du projet.
    const { rows } = await query(
      `SELECT l.id, l.status,
              TO_CHAR(l.requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS requested_day,
              CASE WHEN l.responded_at IS NULL THEN NULL
                   ELSE EXTRACT(EPOCH FROM (l.responded_at - l.requested_at)) / 3600.0
              END AS response_hours,
              l.staff_user_id, l.schedule_id,
              l.owner_department_id, l.requesting_department_id,
              od.name AS owner_department_name,
              rd.name AS requesting_department_name,
              u.first_name, u.last_name,
              r.name AS role_name
         FROM staff_loan_requests l
         LEFT JOIN departments od ON od.id = l.owner_department_id
         LEFT JOIN departments rd ON rd.id = l.requesting_department_id
         LEFT JOIN users u ON u.id = l.staff_user_id
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE (l.requested_at AT TIME ZONE 'UTC')::date BETWEEN $1::date AND $2::date
          AND ${clause}
        ORDER BY l.requested_at DESC
        LIMIT 5000`,
      params
    );

    const summary = { ...emptyCounts() };
    const byWeek = new Map();
    const byLender = new Map();
    const byBorrower = new Map();
    const byStaff = new Map();
    const staffSeen = new Set();
    const schedulesSeen = new Set();
    const departmentsSeen = new Set();
    let responseHoursSum = 0;
    let responseHoursCount = 0;

    const bucketFor = (map, id, name) => {
      const key = id || name || '—';
      if (!map.has(key)) {
        map.set(key, { departmentId: id || null, departmentName: name || 'Service', ...emptyCounts() });
      }
      return map.get(key);
    };

    for (const row of rows) {
      const status = STATUSES.includes(row.status) ? row.status : 'pending';
      bump(summary, status);

      const week = weekStart(row.requested_day);
      if (!byWeek.has(week)) byWeek.set(week, { week, ...emptyCounts() });
      bump(byWeek.get(week), status);

      bump(bucketFor(byLender, row.owner_department_id, row.owner_department_name), status);
      bump(bucketFor(byBorrower, row.requesting_department_id, row.requesting_department_name), status);

      const staffKey = row.staff_user_id || row.id;
      if (!byStaff.has(staffKey)) {
        byStaff.set(staffKey, {
          userId: row.staff_user_id,
          name: `${row.last_name || ''} ${row.first_name || ''}`.trim() || 'Agent',
          roleName: row.role_name || null,
          departmentName: row.owner_department_name || null,
          ...emptyCounts(),
        });
      }
      bump(byStaff.get(staffKey), status);

      if (row.staff_user_id) staffSeen.add(row.staff_user_id);
      if (row.schedule_id) schedulesSeen.add(row.schedule_id);
      if (row.owner_department_id) departmentsSeen.add(row.owner_department_id);
      if (row.requesting_department_id) departmentsSeen.add(row.requesting_department_id);

      if (row.response_hours !== null && row.response_hours !== undefined) {
        responseHoursSum += Number(row.response_hours);
        responseHoursCount += 1;
      }
    }

    const rate = acceptanceRate(summary);
    const withRate = (bucket) => ({ ...bucket, acceptanceRate: acceptanceRate(bucket).rate });
    const rank = (map) => [...map.values()]
      .map(withRate)
      .sort((a, b) => (b.total - a.total) || a.departmentName.localeCompare(b.departmentName, 'fr'))
      .slice(0, 12);

    return res.json({
      success: true,
      data: {
        scope: scope.kind,
        scopeLabel: scope.label,
        period: { from, to },
        summary: {
          ...summary,
          decided: rate.decided,
          acceptanceRate: rate.rate,
          avgResponseHours: responseHoursCount
            ? Math.round((responseHoursSum / responseHoursCount) * 10) / 10
            : null,
          responsesMeasured: responseHoursCount,
          staffCount: staffSeen.size,
          schedulesCount: schedulesSeen.size,
          departmentsCount: departmentsSeen.size,
        },
        timeline: [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week)),
        byLender: rank(byLender),
        byBorrower: rank(byBorrower),
        topStaff: [...byStaff.values()]
          .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'fr'))
          .slice(0, 20),
      },
    });
  } catch (err) {
    console.error('getStaffLoanStats error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du calcul des statistiques de prêts' });
  }
};

module.exports = { getStaffLoanStats, resolveLoanScope };
