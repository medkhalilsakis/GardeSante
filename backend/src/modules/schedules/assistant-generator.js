/**
 * Génération de l'Assistant Intelligent V2 (Lot 7).
 *
 * Réutilise les trois moteurs existants de `rules-engine.js`
 * (generateRoundRobin / generateABRotation / generateCyclic) — jamais réécrits :
 * ils proposent un candidat par date, ce module vérifie ensuite sa disponibilité
 * réelle et le remplace au besoin. S'y ajoute le mode « périodes », qui suit
 * l'ordre explicite du brief (ou `schedule_staff_assignments` à défaut).
 *
 * Contrats communs aux quatre modes :
 *   - les congés (règle I) sont écartés À LA GÉNÉRATION via `leave-check.js` :
 *     un agent en congé n'est jamais posé en garde ce jour-là. C'est l'écart
 *     principal comblé par rapport à `generateProposals`, qui les ignorait ;
 *   - `periodStart` / `periodEnd` bornent les affectations de chaque agent ;
 *   - `excludedDays` (0 = dimanche) et `maxShifts` sont respectés ;
 *   - sortie : lignes `{ userId, lastName, firstName, roleName, shifts }` — la
 *     forme exacte attendue par le tableur et par `confirmProposal`.
 *
 * Aucune écriture : ce module ne fait que calculer.
 */

const { datesBetween } = require('./spreadsheet-reader');
const { getLeavesInPeriod, isOnLeaveAt } = require('../absences/leave-check');
const {
  generateRoundRobin,
  generateABRotation,
  generateCyclic,
} = require('./rules-engine');

const dayKey = (value) => String(value || '').slice(0, 10);

/** Jour de la semaine local (0 = dimanche), sans dérive de fuseau. */
const weekdayOf = (date) => new Date(`${dayKey(date)}T12:00:00`).getDay();

const isSeniorRole = (member) => {
  const label = String(member.roleName || member.roleCode || '').toLowerCase();
  return label.includes('senior') || label.includes('sénior') || label.includes('médecin');
};

/**
 * Normalise les membres reçus du client et charge leurs congés en une requête.
 * Renvoie aussi le prédicat `available`, seul juge de la disponibilité.
 */
const prepare = async ({ members, startDate, endDate, scheduleId }) => {
  const days = datesBetween(startDate, endDate);

  let roster = (members || [])
    .filter((m) => m.userId || m.id)
    .map((m, index) => ({
      // `id` est l'alias lu par les moteurs de `rules-engine` (member.id) ;
      // `userId` est la clé interne et celle attendue par le tableur.
      id: m.userId || m.id,
      userId: m.userId || m.id,
      lastName: m.lastName || m.last_name || '',
      firstName: m.firstName || m.first_name || '',
      roleName: m.roleName || m.role_name || m.roleCode || m.role_code || '',
      phone: m.phone || '',
      matricule: m.matricule || '',
      deptId: m.deptId || m.dept_id || m.departmentId || '',
      periodStart: dayKey(m.periodStart || m.period_start) || dayKey(startDate),
      periodEnd: dayKey(m.periodEnd || m.period_end) || dayKey(endDate),
      maxShifts: Number(m.maxShifts ?? m.maxShiftsMonth) || 0,
      excludedDays: Array.isArray(m.excludedDays) ? m.excludedDays.map(Number) : [],
      // Garde à domicile (astreinte) — absent ⇒ false ⇒ garde à l'hôpital, en
      // présence. Champ purement descriptif : il n'entre dans aucune règle de
      // génération, il voyage jusqu'au tableur produit.
      atHome: (m.atHome ?? m.at_home) === true,
      position: Number.isFinite(Number(m.position)) ? Number(m.position) : index,
    }));

  // Ordre explicite : si le client n'a rien positionné, on lit celui déjà
  // enregistré pour ce planning plutôt que d'inventer un ordre alphabétique.
  if (scheduleId && roster.length && roster.every((r) => r.position === roster[0].position)) {
    const { query } = require('../../config/database');
    const saved = await query(
      `SELECT user_id, position FROM schedule_staff_assignments
       WHERE schedule_id = $1 ORDER BY position`,
      [scheduleId]
    );
    if (saved.rows.length) {
      const rank = new Map(saved.rows.map((r, i) => [r.user_id, r.position ?? i]));
      roster = roster.map((r) => ({ ...r, position: rank.has(r.userId) ? rank.get(r.userId) : 999 }));
    }
  }

  roster.sort((a, b) => a.position - b.position);

  const leavesByUser = await getLeavesInPeriod(
    roster.map((r) => r.userId),
    dayKey(startDate),
    dayKey(endDate)
  );

  // État vivant de la génération : qui est déjà posé quel jour, et combien de fois.
  const state = { busy: new Map(), counts: new Map(), lastDate: new Map() };

  const takenOn = (date) => state.busy.get(dayKey(date)) || new Set();

  const available = (member, date) => {
    if (!member?.userId) return false;
    const d = dayKey(date);
    if (d < member.periodStart || d > member.periodEnd) return false;
    if (member.excludedDays.includes(weekdayOf(d))) return false;
    if (takenOn(d).has(member.userId)) return false;
    if (member.maxShifts && (state.counts.get(member.userId) || 0) >= member.maxShifts) return false;
    if (isOnLeaveAt(leavesByUser.get(member.userId), d)) return false;
    return true;
  };

  const assign = (member, date) => {
    const d = dayKey(date);
    if (!state.busy.has(d)) state.busy.set(d, new Set());
    state.busy.get(d).add(member.userId);
    state.counts.set(member.userId, (state.counts.get(member.userId) || 0) + 1);
    state.lastDate.set(member.userId, d);
    if (!state.grid) state.grid = new Map();
    if (!state.grid.has(member.userId)) state.grid.set(member.userId, {});
    // Une seule notion : de service ce jour-là. Le tableur lit ce marqueur.
    state.grid.get(member.userId)[d] = true;
  };

  /** Le moins chargé d'abord ; à charge égale, celui qui a gardé le plus tôt. */
  const leastLoaded = (candidates) =>
    candidates
      .slice()
      .sort((a, b) => {
        const ca = state.counts.get(a.userId) || 0;
        const cb = state.counts.get(b.userId) || 0;
        if (ca !== cb) return ca - cb;
        const la = state.lastDate.get(a.userId) || '';
        const lb = state.lastDate.get(b.userId) || '';
        if (la !== lb) return la < lb ? -1 : 1;
        return a.position - b.position;
      })[0] || null;

  return { roster, days, state, available, assign, leastLoaded, leavesByUser };
};

/** Assemble les lignes de sortie depuis la grille accumulée. */
const toRows = (ctx) =>
  ctx.roster.map((member) => {
    const shifts = {};
    const grid = ctx.state.grid?.get(member.userId) || {};
    for (const [date, onDuty] of Object.entries(grid)) {
      if (onDuty) shifts[date] = true;
    }
    return {
      id: `row-${member.userId}`,
      userId: member.userId,
      lastName: member.lastName,
      firstName: member.firstName,
      roleName: member.roleName,
      phone: member.phone,
      matricule: member.matricule,
      periodStart: member.periodStart,
      periodEnd: member.periodEnd,
      shiftStart: '07:00',
      shiftEnd: '07:00',
      atHome: member.atHome === true,
      deptId: member.deptId,
      shifts,
    };
  });

/**
 * Applique les couples (agent, date) proposés par un moteur de `rules-engine`.
 * Un candidat indisponible n'est pas perdu : la garde va au suppléant le moins
 * chargé. Sans suppléant, la case reste vide — le validateur la signalera en
 * sous-effectif plutôt que d'enfreindre une règle en silence.
 */
const applyEngineOutput = (ctx, generated) => {
  const byId = new Map(ctx.roster.map((r) => [r.userId, r]));
  let reassigned = 0;
  let skipped = 0;

  for (const item of generated) {
    const date = dayKey(item.shift_date);
    const proposed = byId.get(item.user_id);

    if (proposed && ctx.available(proposed, date)) {
      ctx.assign(proposed, date);
      continue;
    }

    const substitute = ctx.leastLoaded(ctx.roster.filter((r) => ctx.available(r, date)));
    if (!substitute) { skipped += 1; continue; }
    ctx.assign(substitute, date);
    reassigned += 1;
  }

  return { reassigned, skipped };
};

// ── Mode 1 — manuel ───────────────────────────────────────────
// Le chef veut remplir lui-même : on livre les lignes prêtes (bornes de présence
// et congés déjà connus) mais aucune garde posée. C'est un point de départ, pas
// une proposition — il n'y a donc rien à rééquilibrer.
const modeManual = (ctx) => ({
  rows: toRows(ctx),
  notes: ['Grille vierge : les gardes sont à saisir dans le tableur.'],
});

// ── Mode 2 — rotation automatique ─────────────────────────────
// `generateRoundRobin` trie par charge existante puis distribue en cycle.
const modeRotation = (ctx, requirements) => {
  const perDay = Math.max(1, Number(requirements.minPerDay) || 1);
  const notes = [];

  for (let pass = 0; pass < perDay; pass += 1) {
    const counts = Object.fromEntries(
      ctx.roster.map((r) => [r.userId, ctx.state.counts.get(r.userId) || 0])
    );
    const outcome = applyEngineOutput(
      ctx,
      generateRoundRobin(ctx.roster, ctx.days, null, counts)
    );
    if (outcome.reassigned) notes.push(`${outcome.reassigned} garde(s) réattribuée(s) pour cause d'indisponibilité.`);
    if (outcome.skipped) notes.push(`${outcome.skipped} garde(s) non pourvue(s) : plus aucun agent disponible.`);
  }

  return { rows: toRows(ctx), notes };
};

// ── Mode 3 — répartition par périodes ─────────────────────────
// L'ordre de relais fait foi : `generateCyclic` parcourt le roster dans l'ordre
// des positions, chaque agent prenant son tour sur sa fenêtre de présence.
const modePeriods = (ctx, requirements) => {
  const perDay = Math.max(1, Number(requirements.minPerDay) || 1);
  const notes = [];
  const cycleLength = ctx.roster.length || 1;

  for (let pass = 0; pass < perDay; pass += 1) {
    // Décaler le cycle d'un cran à chaque passe évite de reproposer le même
    // agent pour la 2e garde du jour (il serait écarté puis remplacé).
    const rotated = ctx.roster.slice(pass % cycleLength).concat(ctx.roster.slice(0, pass % cycleLength));
    const outcome = applyEngineOutput(ctx, generateCyclic(rotated, ctx.days, null, cycleLength));
    if (outcome.reassigned) notes.push(`${outcome.reassigned} garde(s) déplacée(s) hors période de présence ou congé.`);
    if (outcome.skipped) notes.push(`${outcome.skipped} garde(s) non pourvue(s).`);
  }

  return { rows: toRows(ctx), notes };
};

// ── Mode 3bis — rotation A/B ──────────────────────────────────
// Deux équipes qui alternent chaque semaine, via `generateABRotation`.
// Ce moteur propose l'équipe ENTIÈRE chaque jour de sa semaine ; on ne retient
// que l'effectif demandé, sinon tout le service serait de garde tous les jours.
const modeRotationAB = (ctx, requirements) => {
  const perDay = Math.max(1, Number(requirements.minPerDay) || 1);
  const half = Math.ceil(ctx.roster.length / 2);

  const proposed = generateABRotation(
    ctx.roster.slice(0, half),
    ctx.roster.slice(half),
    ctx.days,
    null
  );

  // Regrouper par date, puis retenir les moins chargés de l'équipe de service :
  // couper dans l'ordre du tableau reviendrait à toujours désigner le même agent
  // et à en laisser un autre sans aucune garde.
  const teamByDate = new Map();
  for (const item of proposed) {
    const date = dayKey(item.shift_date);
    if (!teamByDate.has(date)) teamByDate.set(date, []);
    teamByDate.get(date).push(item.user_id);
  }

  const byId = new Map(ctx.roster.map((r) => [r.userId, r]));
  let reassigned = 0;
  let skipped = 0;

  for (const date of ctx.days) {
    const team = (teamByDate.get(date) || []).map((id) => byId.get(id)).filter(Boolean);
    for (let placed = 0; placed < perDay; placed += 1) {
      const fromTeam = ctx.leastLoaded(team.filter((r) => ctx.available(r, date)));
      if (fromTeam) { ctx.assign(fromTeam, date); continue; }
      // Équipe de service épuisée : on emprunte à l'autre équipe plutôt que de
      // laisser la garde vide.
      const fallback = ctx.leastLoaded(ctx.roster.filter((r) => ctx.available(r, date)));
      if (!fallback) { skipped += 1; continue; }
      ctx.assign(fallback, date);
      reassigned += 1;
    }
  }

  const outcome = { reassigned, skipped };
  const notes = [];
  if (outcome.reassigned) notes.push(`${outcome.reassigned} garde(s) réattribuée(s) entre les équipes A et B.`);
  if (outcome.skipped) notes.push(`${outcome.skipped} garde(s) non pourvue(s).`);
  return { rows: toRows(ctx), notes };
};

// ── Mode 4 — équilibrage ──────────────────────────────────────
// Ici l'objectif prime sur le cycle : chaque jour, on complète l'effectif requis
// en prenant systématiquement le moins chargé, senior d'abord si le service en
// exige un. C'est le mode qui minimise l'écart de charge entre agents.
const modeBalanced = (ctx, requirements) => {
  const perDay = Math.max(1, Number(requirements.minPerDay) || 1);
  const seniorsRequired = Math.max(0, Number(requirements.seniorCount) || 0);
  const notes = [];
  let unfilled = 0;

  for (const date of ctx.days) {
    let placed = 0;

    for (let i = 0; i < seniorsRequired && placed < perDay; i += 1) {
      const senior = ctx.leastLoaded(
        ctx.roster.filter((r) => isSeniorRole(r) && ctx.available(r, date))
      );
      if (!senior) break;
      ctx.assign(senior, date);
      placed += 1;
    }

    while (placed < perDay) {
      const next = ctx.leastLoaded(ctx.roster.filter((r) => ctx.available(r, date)));
      if (!next) { unfilled += perDay - placed; break; }
      ctx.assign(next, date);
      placed += 1;
    }
  }

  if (unfilled) notes.push(`${unfilled} poste(s) non pourvu(s) : effectif disponible insuffisant.`);
  return { rows: toRows(ctx), notes };
};

const MODES = {
  manual:      { label: 'Saisie manuelle',          run: (ctx) => modeManual(ctx) },
  rotation:    { label: 'Rotation automatique',     run: (ctx, req) => modeRotation(ctx, req) },
  ab_rotation: { label: 'Rotation A / B',           run: (ctx, req) => modeRotationAB(ctx, req) },
  periods:     { label: 'Répartition par périodes', run: (ctx, req) => modePeriods(ctx, req) },
  balanced:    { label: 'Équilibrage de la charge', run: (ctx, req) => modeBalanced(ctx, req) },
};

/** Métriques lisibles pour l'écran de choix. */
const computeMetrics = (rows, days, requirements = {}) => {
  const counts = rows.map((r) => Object.keys(r.shifts).length);
  const total = counts.reduce((s, n) => s + n, 0);
  const target = Math.max(1, Number(requirements.minPerDay) || 1) * days.length;
  const max = counts.length ? Math.max(...counts) : 0;
  const min = counts.length ? Math.min(...counts) : 0;

  return {
    totalShifts: total,
    coveragePct: target ? Math.min(100, Math.round((total / target) * 100)) : 0,
    // Écart max/min ramené sur la moyenne : 100 = charge parfaitement égale.
    equityScore: max ? Math.round(100 - ((max - min) / max) * 100) : 100,
    maxPerAgent: max,
    minPerAgent: min,
  };
};

/**
 * Point d'entrée de l'assistant V2.
 * @returns {Promise<{mode, modeLabel, rows, days, metrics, notes}>}
 */
const generateV2 = async ({
  members = [],
  startDate,
  endDate,
  scheduleId = null,
  mode = 'balanced',
  requirements = {},
}) => {
  const selected = MODES[mode] ? mode : 'balanced';
  const ctx = await prepare({ members, startDate, endDate, scheduleId });

  if (ctx.days.length === 0 || ctx.roster.length === 0) {
    return {
      mode: selected,
      modeLabel: MODES[selected].label,
      rows: toRows(ctx),
      days: ctx.days,
      metrics: computeMetrics([], ctx.days, requirements),
      notes: ctx.days.length === 0
        ? ['Aucune date dans la période demandée.']
        : ['Aucun agent sélectionné.'],
    };
  }

  const { rows, notes } = MODES[selected].run(ctx, requirements);

  // Trace utile au chef : qui a été écarté, et pourquoi.
  const skippedForLeave = ctx.roster
    .filter((r) => (ctx.leavesByUser.get(r.userId) || []).length > 0)
    .map((r) => `${r.firstName} ${r.lastName}`.trim());
  if (skippedForLeave.length) {
    notes.push(`Congés pris en compte : ${skippedForLeave.join(', ')}.`);
  }

  return {
    mode: selected,
    modeLabel: MODES[selected].label,
    rows,
    days: ctx.days,
    metrics: computeMetrics(rows, ctx.days, requirements),
    notes,
  };
};

module.exports = {
  MODES,
  generateV2,
  computeMetrics,
  prepare,
  toRows,
  applyEngineOutput,
  isSeniorRole,
};
