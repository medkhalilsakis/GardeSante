/**
 * Validation serveur de l'Assistant Intelligent V2 (Lot 7).
 *
 * Le pré-contrôle actuel vit côté client (`runPreCheck` dans
 * ChefDeServiceDashboard.jsx) et ne teste que deux choses : présence d'un senior
 * et cohérence des bornes de période. Ce module ajoute la validation *serveur*,
 * seule digne de confiance, et détecte :
 *
 *   1. congés          — règle I, via `leave-check.js` (source de vérité partagée)
 *   2. doubles affectations — un agent deux fois le même jour
 *   3. sous-effectif   — moins de gardes que le service en exige un jour donné
 *   4. surcharge       — plus de gardes qu'autorisé sur la période ou la semaine
 *   5. repos insuffisant — gardes consécutives / repos minimal non respecté
 *
 * Chaque anomalie porte une correction applicable (`fix`), que le contrôleur sait
 * exécuter sans deviner : `{ action, userId, date }`. Rien n'est corrigé ici — ce
 * module est pur et sans écriture, donc testable et rejouable.
 */

const { findLeaveViolations } = require('../absences/leave-check');
const { normalizeCode, isGuard, REST_CODE } = require('./spreadsheet-reader');

const SEVERITY = { ERROR: 'error', WARNING: 'warning' };

/** Nom lisible d'une ligne du tableur, pour des messages parlants. */
const rowName = (row) =>
  `${row.firstName || ''} ${row.lastName || ''}`.trim() || 'Agent sans nom';

/** Toutes les cases qui comptent comme garde, à plat. */
const guardAssignments = (rows) => {
  const out = [];
  for (const row of rows || []) {
    if (!row.userId) continue;
    for (const [date, code] of Object.entries(row.shifts || {})) {
      if (!isGuard(code)) continue;
      out.push({ userId: row.userId, date: String(date).slice(0, 10), code: normalizeCode(code), row });
    }
  }
  return out;
};

/** Lundi de la semaine ISO d'une date 'YYYY-MM-DD' — clé de regroupement stable. */
const weekKey = (date) => {
  const d = new Date(`${date}T12:00:00`);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Écart en jours entre deux dates 'YYYY-MM-DD'. */
const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

// ── 1. Congés (règle I) ───────────────────────────────────────
const checkLeaves = async (assignments, startDate, endDate) => {
  const violations = await findLeaveViolations(
    assignments.map((a) => ({ userId: a.userId, date: a.date })),
    startDate,
    endDate
  );

  const byUser = new Map(assignments.map((a) => [a.userId, a.row]));
  return violations.map((v) => ({
    id: `leave-${v.userId}-${v.date}`,
    type: 'on_leave',
    severity: SEVERITY.ERROR,
    userId: v.userId,
    date: v.date,
    message: `${rowName(byUser.get(v.userId) || {})} est en ${v.typeName || 'congé'} le ${v.date} (du ${v.leaveStart} au ${v.leaveEnd}) : cette garde est interdite.`,
    fix: { action: 'clear_cell', userId: v.userId, date: v.date },
    fixLabel: 'Retirer cette garde',
  }));
};

// ── 2. Doubles affectations ───────────────────────────────────
const checkDoubleBooking = (rows) => {
  const seen = new Map();
  const anomalies = [];

  for (const row of rows || []) {
    if (!row.userId) continue;
    for (const [date, code] of Object.entries(row.shifts || {})) {
      if (!isGuard(code)) continue;
      const key = `${row.userId}|${String(date).slice(0, 10)}`;
      if (seen.has(key)) {
        anomalies.push({
          id: `double-${key}`,
          type: 'double_booking',
          severity: SEVERITY.ERROR,
          userId: row.userId,
          date: String(date).slice(0, 10),
          message: `${rowName(row)} apparaît deux fois en garde le ${String(date).slice(0, 10)}.`,
          fix: { action: 'clear_cell', userId: row.userId, date: String(date).slice(0, 10) },
          fixLabel: 'Ne garder qu\'une affectation',
        });
      } else {
        seen.set(key, true);
      }
    }
  }
  return anomalies;
};

// ── 3. Sous-effectif ──────────────────────────────────────────
const checkUnderstaffing = (rows, dates, requirements = {}) => {
  const minPerDay = Number(requirements.minPerDay) || 0;
  const seniorCount = Number(requirements.seniorCount) || 0;
  if (!minPerDay && !seniorCount) return [];

  const isSenior = (row) => {
    const label = String(row.roleName || row.roleCode || '').toLowerCase();
    return label.includes('senior') || label.includes('sénior') || label.includes('médecin');
  };

  const anomalies = [];
  for (const date of dates) {
    const onGuard = (rows || []).filter((r) => r.userId && isGuard(r.shifts?.[date]));

    if (minPerDay && onGuard.length < minPerDay) {
      anomalies.push({
        id: `understaffed-${date}`,
        type: 'understaffed',
        severity: SEVERITY.ERROR,
        date,
        message: `Le ${date}, ${onGuard.length} agent(s) en garde sur les ${minPerDay} requis.`,
        fix: { action: 'fill_day', date, count: minPerDay - onGuard.length },
        fixLabel: 'Compléter avec les agents les moins chargés',
      });
    }

    if (seniorCount && onGuard.filter(isSenior).length < seniorCount) {
      anomalies.push({
        id: `missing-senior-${date}`,
        type: 'missing_senior',
        severity: SEVERITY.WARNING,
        date,
        message: `Le ${date}, aucun senior n'encadre la garde (requis : ${seniorCount}).`,
        fix: { action: 'fill_day_senior', date, count: seniorCount },
        fixLabel: 'Affecter un senior disponible',
      });
    }
  }
  return anomalies;
};

// ── 4. Surcharge ──────────────────────────────────────────────
const checkOverload = (rows, requirements = {}) => {
  const maxPerWeek = Number(requirements.maxPerWeek) || 0;
  const anomalies = [];

  for (const row of rows || []) {
    if (!row.userId) continue;
    const guardDates = Object.entries(row.shifts || {})
      .filter(([, code]) => isGuard(code))
      .map(([date]) => String(date).slice(0, 10))
      .sort();

    const maxTotal = Number(row.maxShifts) || Number(requirements.maxPerPeriod) || 0;
    if (maxTotal && guardDates.length > maxTotal) {
      anomalies.push({
        id: `overload-total-${row.userId}`,
        type: 'overload',
        severity: SEVERITY.WARNING,
        userId: row.userId,
        message: `${rowName(row)} totalise ${guardDates.length} gardes pour un maximum de ${maxTotal}.`,
        fix: { action: 'trim_extra', userId: row.userId, keep: maxTotal },
        fixLabel: 'Retirer les gardes en excès',
      });
    }

    if (maxPerWeek) {
      const perWeek = guardDates.reduce((acc, d) => {
        const k = weekKey(d);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
      for (const [week, count] of Object.entries(perWeek)) {
        if (count > maxPerWeek) {
          anomalies.push({
            id: `overload-week-${row.userId}-${week}`,
            type: 'overload_week',
            severity: SEVERITY.WARNING,
            userId: row.userId,
            date: week,
            message: `${rowName(row)} a ${count} gardes sur la semaine du ${week} (maximum ${maxPerWeek}).`,
            fix: { action: 'trim_week', userId: row.userId, week, keep: maxPerWeek },
            fixLabel: 'Alléger cette semaine',
          });
        }
      }
    }
  }
  return anomalies;
};

// ── 5. Repos insuffisant ──────────────────────────────────────
const checkRest = (rows, requirements = {}) => {
  // `minRestHours` est exprimé en heures dans le formulaire existant ; une garde
  // couvrant 24 h, on le ramène en jours d'écart minimal entre deux gardes.
  const minRestDays = Math.max(
    requirements.noConsecutiveShifts ? 1 : 0,
    Math.floor((Number(requirements.minRestHours) || 0) / 24)
  );
  if (!minRestDays) return [];

  const anomalies = [];
  for (const row of rows || []) {
    if (!row.userId) continue;
    const guardDates = Object.entries(row.shifts || {})
      .filter(([, code]) => isGuard(code))
      .map(([date]) => String(date).slice(0, 10))
      .sort();

    for (let i = 1; i < guardDates.length; i += 1) {
      const gap = daysBetween(guardDates[i - 1], guardDates[i]);
      if (gap <= minRestDays) {
        anomalies.push({
          id: `rest-${row.userId}-${guardDates[i]}`,
          type: 'insufficient_rest',
          severity: SEVERITY.WARNING,
          userId: row.userId,
          date: guardDates[i],
          message: `${rowName(row)} enchaîne les gardes du ${guardDates[i - 1]} et du ${guardDates[i]} (repos minimal : ${minRestDays} jour(s)).`,
          fix: { action: 'clear_cell', userId: row.userId, date: guardDates[i] },
          fixLabel: 'Libérer la seconde garde',
        });
      }
    }
  }
  return anomalies;
};

/**
 * Validation complète d'une proposition.
 * @returns {Promise<{anomalies: object[], counts: object, valid: boolean}>}
 */
const validateProposal = async ({ rows = [], dates = [], startDate, endDate, requirements = {} }) => {
  const assignments = guardAssignments(rows);

  const anomalies = [
    ...(await checkLeaves(assignments, startDate, endDate)),
    ...checkDoubleBooking(rows),
    ...checkUnderstaffing(rows, dates, requirements),
    ...checkOverload(rows, requirements),
    ...checkRest(rows, requirements),
  ];

  const errors = anomalies.filter((a) => a.severity === SEVERITY.ERROR);
  return {
    anomalies,
    counts: {
      total: anomalies.length,
      errors: errors.length,
      warnings: anomalies.length - errors.length,
      guards: assignments.length,
    },
    // Un avertissement n'empêche pas d'enregistrer : seule une erreur bloque.
    valid: errors.length === 0,
  };
};

module.exports = {
  SEVERITY,
  REST_CODE,
  validateProposal,
  guardAssignments,
  weekKey,
  checkLeaves,
  checkDoubleBooking,
  checkUnderstaffing,
  checkOverload,
  checkRest,
};
