/**
 * Règles de cohérence des plannings — fonctions pures, sans `req` ni `res`.
 *
 * ── Pourquoi ce fichier ───────────────────────────────────────
 * Les trois détecteurs vivaient dans `listConflicts` (supervision.controller.js)
 * et n'étaient donc utilisables que par le surveillant général, sur la portée
 * établissement. La vue d'ensemble du chef de service a besoin des deux mêmes
 * règles sur la portée d'un seul service : les extraire ici évite de réécrire la
 * règle une seconde fois — et donc de la voir diverger entre les deux écrans.
 *
 * ── Le défaut corrigé au passage ──────────────────────────────
 * L'index des affectations ne lisait que les cases explicitement saisies. Or une
 * ligne de tableur peut n'exprimer son service que par sa période de
 * participation : sur la base de démonstration, 32 lignes sur 33 sont dans ce
 * cas. Conséquences mesurées avant correction :
 *   • « agent affecté pendant un congé » (règle exigée : *le chef ne peut pas
 *     affecter un personnel en congés*) ne se déclenchait JAMAIS ;
 *   • « double affectation » non plus ;
 *   • « journée sans garde » se déclenchait AU CONTRAIRE toujours — 7 anomalies
 *     dont « 23 journée(s) sans garde » sur un planning à 4 agents par jour.
 * `dutyEntries()` lit le tableur comme le tableur se lit lui-même (règle
 * d'arbitrage unique, cf. en-tête de `spreadsheet-reader.js`).
 *
 * ── Regroupement ──────────────────────────────────────────────
 * Une affectation par période couvre tous les jours de la période : un seul congé
 * mal placé produirait dix anomalies critiques pour un seul vrai problème. Les
 * anomalies `double_booking` et `on_leave` sont donc groupées par (agent,
 * plannings) et portent `days[]` / `dayCount`, comme `uncovered_day` le faisait
 * déjà pour les journées.
 *
 * Lecture seule, aucune requête : les congés sont passés par l'appelant.
 */

const {
  dutyEntries,
  datesBetween,
  dateKey,
  isSpecialSchedule,
  markedDays,
} = require('../schedules/spreadsheet-reader');

/**
 * Index des affectations réelles : `userId|date` → entrées, tous plannings
 * confondus. `window.from` / `window.to` sont facultatifs et bornés par
 * `dutyEntries` aux dates de chaque planning.
 */
const buildDutyIndex = (schedules, window = {}) => {
  const byUserDate = new Map();
  for (const schedule of schedules || []) {
    for (const entry of dutyEntries(schedule, window.from, window.to)) {
      if (!entry.userId) continue;
      const key = `${entry.userId}|${entry.date}`;
      if (!byUserDate.has(key)) byUserDate.set(key, []);
      byUserDate.get(key).push({
        ...entry,
        departmentId: schedule.department_id || entry.departmentId || null,
        departmentName: schedule.department_name || null,
        scheduleName: schedule.name,
      });
    }
  }
  return byUserDate;
};

/** Libellé « nom complet » d'une entrée d'affectation. */
const staffNameOf = (entry) => `${entry.firstName || ''} ${entry.lastName || ''}`.trim() || 'Agent';

/** Résumé d'une liste de jours : « 3 jour(s) » avec les 8 premiers cités. */
const daysDetail = (days) => `${days.slice(0, 8).join(', ')}${days.length > 8 ? '…' : ''}`;

/**
 * Règle : un agent affecté le même jour dans deux services distincts.
 * Groupé par (agent, ensemble de services) — un chevauchement qui dure une
 * semaine reste UNE anomalie, avec sept jours listés.
 */
const detectDoubleBooking = (index) => {
  const groups = new Map();

  for (const [key, entries] of index) {
    const services = new Set(entries.map((e) => e.departmentId).filter(Boolean));
    if (services.size < 2) continue;
    const [userId, date] = key.split('|');
    const groupKey = `${userId}|${[...services].sort().join('+')}`;
    if (!groups.has(groupKey)) groups.set(groupKey, { userId, entries: [], days: [] });
    const group = groups.get(groupKey);
    group.days.push(date);
    group.entries.push(...entries);
  }

  return [...groups.values()].map((group) => {
    const days = [...new Set(group.days)].sort();
    const places = [...new Map(group.entries.map((e) => [
      `${e.departmentName || '—'}|${e.scheduleName}`,
      `${e.departmentName || 'Service inconnu'} (${e.scheduleName})`,
    ])).values()];
    return {
      type: 'double_booking',
      severity: 'critical',
      date: days[0],
      days,
      dayCount: days.length,
      userId: group.userId,
      staffName: staffNameOf(group.entries[0]),
      title: days.length > 1
        ? `Agent affecté dans deux services sur ${days.length} journée(s)`
        : 'Agent affecté dans deux services le même jour',
      detail: `${places.join(' / ')} — ${daysDetail(days)}`,
      schedules: [...new Set(group.entries.map((e) => e.scheduleId))],
    };
  });
};

/**
 * Règle I : une garde posée sur un agent en congé.
 * `leaveRows` vient de l'appelant, forme attendue par ligne :
 * `{ user_id, start_date, end_date, type_name }` en 'YYYY-MM-DD'.
 * Groupé par (agent, congé) : un congé d'une semaine chevauché = une anomalie.
 */
const detectOnLeave = (index, leaveRows) => {
  if (!index.size || !leaveRows?.length) return [];

  const conflicts = [];
  for (const leave of leaveRows) {
    const days = [];
    const entries = [];
    for (const [key, list] of index) {
      const [userId, date] = key.split('|');
      if (userId !== leave.user_id) continue;
      if (date < leave.start_date || date > leave.end_date) continue;
      days.push(date);
      entries.push(...list);
    }
    if (!days.length) continue;

    days.sort();
    const first = entries[0];
    conflicts.push({
      type: 'on_leave',
      severity: 'critical',
      date: days[0],
      days,
      dayCount: days.length,
      userId: leave.user_id,
      staffName: staffNameOf(first),
      title: days.length > 1
        ? `Agent affecté sur ${days.length} journée(s) de son congé`
        : 'Agent affecté pendant un congé',
      detail: `${leave.type_name || 'Congé'} du ${leave.start_date} au ${leave.end_date} — affecté sur ${first.scheduleName} (${first.departmentName || '—'}) : ${daysDetail(days)}`,
      schedules: [...new Set(entries.map((e) => e.scheduleId))],
    });
  }
  return conflicts;
};

/**
 * Règle : journée à venir sans personne de service dans un planning non terminé.
 * Un trou passé n'est plus actionnable, il n'est donc pas signalé.
 *
 * Le périmètre d'un planning dépend de son type :
 *   • planning normal  → toutes les journées de `start_date` à `end_date` ;
 *   • planning spécial (week-ends / fériés) → **uniquement les jours que le chef a
 *     sélectionnés** dans le tableur. Un planning de gardes fériées de septembre
 *     couvre 6 journées choisies : compter les 24 autres comme « sans garde »
 *     inventait un trou là où il n'y a pas de périmètre (constaté : « 24 journée(s)
 *     sans garde » sur un planning intégralement couvert).
 *
 * Cas limite gardé : un planning spécial sans **aucun** jour sélectionné ne couvre
 * rien du tout. Ce n'est pas une liste de journées manquantes, c'est le planning
 * entier qui est vide — il est signalé comme tel, avec `dayCount: 0`.
 */
const detectUncoveredDays = (schedules, today = dateKey(new Date())) => {
  const conflicts = [];
  for (const schedule of schedules || []) {
    const covered = new Set(dutyEntries(schedule).map((e) => e.date));
    const place = `${schedule.name} (${schedule.department_name || '—'})`;

    let scope;
    if (isSpecialSchedule(schedule)) {
      const selected = markedDays(schedule);
      if (!selected.size) {
        // Planning spécial soumis sans un seul jour sélectionné.
        if (dateKey(schedule.end_date) < today) continue;
        conflicts.push({
          type: 'uncovered_day',
          severity: 'error',
          date: dateKey(schedule.start_date),
          days: [],
          dayCount: 0,
          title: 'Planning spécial sans aucun jour de garde sélectionné',
          detail: `${place} — aucune journée n'est sélectionnée dans le tableur : personne n'est de service.`,
          schedules: [schedule.id],
        });
        continue;
      }
      scope = [...selected].sort();
    } else {
      scope = datesBetween(schedule.start_date, schedule.end_date);
    }

    const uncovered = scope.filter((day) => day >= today && !covered.has(day));
    if (!uncovered.length) continue;
    conflicts.push({
      type: 'uncovered_day',
      severity: uncovered.length > 3 ? 'error' : 'warning',
      date: uncovered[0],
      days: uncovered,
      dayCount: uncovered.length,
      title: `${uncovered.length} journée(s) sans garde`,
      detail: `${place} — ${daysDetail(uncovered)}`,
      schedules: [schedule.id],
    });
  }
  return conflicts;
};

/** Ordre de restitution : le plus grave d'abord, puis par date. */
const SEVERITY_ORDER = { critical: 0, error: 1, warning: 2, info: 3 };

const sortConflicts = (conflicts) => conflicts.sort((a, b) => (
  (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || String(a.date).localeCompare(String(b.date))
));

/** Résumé stable — ces clés sont consommées par les tableaux de bord. */
const summarizeConflicts = (conflicts) => ({
  total: conflicts.length,
  critical: conflicts.filter((c) => c.severity === 'critical').length,
  doubleBooking: conflicts.filter((c) => c.type === 'double_booking').length,
  onLeave: conflicts.filter((c) => c.type === 'on_leave').length,
  uncovered: conflicts.filter((c) => c.type === 'uncovered_day').length,
});

module.exports = {
  buildDutyIndex,
  detectDoubleBooking,
  detectOnLeave,
  detectUncoveredDays,
  sortConflicts,
  summarizeConflicts,
};
