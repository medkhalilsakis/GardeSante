/**
 * Lecture partagée du tableur de garde (Lot 3).
 *
 * Le tableur vit dans `schedules.metadata.spreadsheet` : la table `shifts` n'est
 * pas alimentée par ce flux. Le calendrier hôpital et les statistiques par portée
 * lisent donc la même source que les exports (`schedule-export.controller.js`),
 * plutôt que d'inventer une seconde vérité.
 *
 * Aucune écriture : ce module est strictement en lecture.
 */

// Codes du tableur (miroir de SHIFT_META dans SmartSpreadsheet.jsx).
// « R » = Repos : la case est remplie mais ne compte PAS comme une garde.
const SHIFT_LABELS = { J: 'Jour', N: 'Nuit', S: 'Soir', G: 'Garde', R: 'Repos' };
const REST_CODE = 'R';

const dateKey = (value) => {
  if (!value) return '';
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const datesBetween = (start, end) => {
  const result = [];
  const first = dateKey(start);
  const last = dateKey(end);
  if (!first || !last) return result;
  const cursor = new Date(`${first}T12:00:00`);
  const stop = new Date(`${last}T12:00:00`);
  while (cursor <= stop) {
    result.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};

/** Normalise un code de case ; '' si la case est vide. */
const normalizeCode = (value) => {
  const code = String(value ?? '').trim().toUpperCase().charAt(0);
  return SHIFT_LABELS[code] ? code : '';
};

/** Une case compte comme garde si elle porte un code autre que Repos. */
const isGuard = (value) => {
  const code = normalizeCode(value);
  return code !== '' && code !== REST_CODE;
};

/**
 * Aplatit un planning en une liste de gardes { date, code, userId, ... }.
 * Les lignes proposées non validées (`isProposedNewRow`) sont ignorées : elles
 * n'appartiennent pas encore au planning.
 */
const guardEntries = (schedule) => {
  const rows = Array.isArray(schedule?.metadata?.spreadsheet?.rows)
    ? schedule.metadata.spreadsheet.rows
    : [];

  const entries = [];
  for (const row of rows) {
    if (row?.isProposedNewRow) continue;
    const shifts = row?.shifts || {};
    for (const [rawDate, rawValue] of Object.entries(shifts)) {
      const date = dateKey(rawDate);
      const code = normalizeCode(rawValue);
      if (!date || !code) continue;
      entries.push({
        date,
        code,
        label: SHIFT_LABELS[code],
        isGuard: code !== REST_CODE,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        departmentId: row.deptId || schedule.department_id || null,
        userId: row.userId || null,
        firstName: row.firstName || '',
        lastName: row.lastName || '',
        roleName: row.roleName || '',
        matricule: row.matricule || '',
        shiftStart: row.shiftStart || '',
        shiftEnd: row.shiftEnd || '',
        // Garde à domicile (astreinte) — absent ⇒ false ⇒ garde à l'hôpital.
        // Champ additif : aucun appelant existant ne le lit, et sa présence ne
        // modifie ni le comptage des gardes ni la sémantique des entrées.
        atHome: row.atHome === true,
      });
    }
  }
  return entries;
};

/**
 * Personnel de service à une date donnée.
 *
 * `guardEntries()` ne lit que les codes journaliers (`row.shifts`), or ces codes
 * sont FACULTATIFS dans le tableur : un chef peut valider un planning en ne
 * renseignant que la période de participation de chaque agent (colonnes
 * « Période - début / fin ») et les heures de la garde. Le calendrier détaillé du
 * tableur compte alors l'agent présent sur toute sa période — son propre
 * sous-titre l'énonce : « Son point apparaît sur tous les jours compris entre son
 * début et sa fin de période » (SmartSpreadsheet.jsx → DetailedCalendar).
 *
 * Cette lecture applique exactement la même règle, dans cet ordre :
 *   1. la case du jour porte un code -> il décide ; « R » (Repos) exclut l'agent ;
 *   2. la case est vide              -> la période de la ligne décide.
 *
 * `guardEntries()` reste inchangé : sept appelants (journal, supervision,
 * statistiques par portée, calendrier hôpital, supervision admin) comptent des
 * gardes *codées* et ne doivent pas changer de sémantique.
 */
const rosterOnDate = (schedule, date) => {
  const day = dateKey(date);
  if (!day) return [];

  const rows = Array.isArray(schedule?.metadata?.spreadsheet?.rows)
    ? schedule.metadata.spreadsheet.rows
    : [];
  const scheduleStart = dateKey(schedule?.start_date);
  const scheduleEnd = dateKey(schedule?.end_date);

  const entries = [];
  for (const row of rows) {
    if (row?.isProposedNewRow) continue;

    const code = normalizeCode((row?.shifts || {})[day]);
    if (code === REST_CODE) continue; // repos explicitement saisi

    let fromPeriod = false;
    if (!code) {
      // Sans code, seule la période fait foi. Une ligne sans personnel
      // sélectionné (la ligne vierge que le tableur ajoute toujours) ne doit
      // jamais devenir un agent fantôme dans l'appel du jour.
      if (!row?.userId) continue;
      const start = dateKey(row.periodStart || row.period_start) || scheduleStart;
      const end = dateKey(row.periodEnd || row.period_end) || scheduleEnd;
      if (!start || !end || day < start || day > end) continue;
      fromPeriod = true;
    }

    entries.push({
      date: day,
      code: fromPeriod ? '' : code,
      label: fromPeriod ? 'De service' : SHIFT_LABELS[code],
      isGuard: true,
      fromPeriod,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      departmentId: row.deptId || schedule.department_id || null,
      userId: row.userId || null,
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      roleName: row.roleName || '',
      matricule: row.matricule || '',
      shiftStart: row.shiftStart || '',
      shiftEnd: row.shiftEnd || '',
      atHome: row.atHome === true,
    });
  }
  return entries;
};

/**
 * Jours de service restants d'un planning à partir d'une date (incluse), au sens
 * de `rosterOnDate` : somme des (agent × jour) encore à venir, bornée par les
 * dates du planning.
 */
const remainingDutyDays = (schedule, from) => {
  const start = dateKey(from) || dateKey(new Date());
  const scheduleStart = dateKey(schedule?.start_date);
  const scheduleEnd = dateKey(schedule?.end_date);
  if (!scheduleEnd || scheduleEnd < start) return 0;

  const first = scheduleStart && scheduleStart > start ? scheduleStart : start;
  let total = 0;
  for (const day of datesBetween(first, scheduleEnd)) {
    total += rosterOnDate(schedule, day).length;
  }
  return total;
};

/** Nombre de gardes (hors repos) d'un planning. */
const countGuards = (schedule) => guardEntries(schedule).filter((e) => e.isGuard).length;

/** Agents distincts réellement affectés à au moins une garde. */
const distinctStaff = (schedule) => {
  const ids = new Set();
  for (const entry of guardEntries(schedule)) {
    if (entry.isGuard && entry.userId) ids.add(entry.userId);
  }
  return ids;
};

/**
 * État dérivé du planning — miroir JS de la fonction SQL planning_state()
 * introduite par la migration 019, pour les agrégats calculés en mémoire.
 */
const planningState = (status, startDate, endDate, today = dateKey(new Date())) => {
  if (!status || status === 'draft') return 'brouillon';
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (end && end < today) return 'termine';
  if (start && start > today) return 'soumis';
  return 'en_cours';
};

module.exports = {
  SHIFT_LABELS,
  REST_CODE,
  dateKey,
  datesBetween,
  normalizeCode,
  isGuard,
  guardEntries,
  rosterOnDate,
  remainingDutyDays,
  countGuards,
  distinctStaff,
  planningState,
};
