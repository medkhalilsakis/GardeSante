/**
 * Lecture partagée du tableur de garde.
 *
 * Le tableur vit dans `schedules.metadata.spreadsheet` : la table `shifts` n'est
 * pas alimentée par ce flux. Le calendrier hôpital, les statistiques par portée,
 * la supervision et les exports lisent donc tous la même source, plutôt que
 * d'inventer une seconde vérité.
 *
 * ── Une seule notion : de service, ou pas ─────────────────────
 * Le tableur n'a plus de codes de garde (J/N/S/G/R). Une case est **cochée** ou
 * vide, et une ligne peut aussi exprimer son service par ses **périodes de
 * participation** (colonnes « Période - début / fin », cf. `periods.js`). La
 * règle d'arbitrage est unique, au niveau de la ligne :
 *
 *   • planning spécial (week-ends / fériés) → les cases cochées, JAMAIS la
 *     période : la sélection y est discontinue, et une période min/max ne doit
 *     pas remplir les jours intermédiaires ;
 *   • planning normal, ligne SANS aucune case cochée → la période fait foi.
 *     C'est le cas courant : un chef qui ne renseigne que la période de chaque
 *     agent et les heures de garde ;
 *   • planning normal, ligne AVEC des cases cochées → les cases font foi.
 *     L'Assistant V2 et l'import Excel produisent une répartition jour par jour ;
 *     l'ignorer étalerait chaque agent sur toute sa fenêtre de présence.
 *
 * Corollaire côté tableur : éditer les périodes d'une ligne efface ses cases,
 * pour que le geste du chef prenne toujours effet (SmartSpreadsheet.jsx).
 *
 * Aucune écriture : ce module est strictement en lecture.
 */

const { normalizePeriods, dateInPeriods } = require('./periods');

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

/**
 * Une case du tableur vaut-elle « de service » ?
 *
 * Le tableur écrit désormais `true`. Les deux autres branches ne servent qu'aux
 * plannings et fichiers antérieurs : toute valeur non vide compte comme un
 * service, sauf « R », qui était l'ancien code Repos et n'a jamais désigné une
 * garde.
 */
const isMarked = (value) => {
  if (value === true) return true;
  const text = String(value ?? '').trim();
  if (!text) return false;
  return text.charAt(0).toUpperCase() !== 'R';
};

/** Jours cochés d'une seule ligne, en clés 'YYYY-MM-DD'. */
const rowMarkedDays = (row) => {
  const days = new Set();
  for (const [rawDate, rawValue] of Object.entries(row?.shifts || {})) {
    if (!isMarked(rawValue)) continue;
    const date = dateKey(rawDate);
    if (date) days.add(date);
  }
  return days;
};

/**
 * Planning « spécial » (week-ends et jours fériés) : la sélection des jours est
 * discontinue et vit dans `row.shifts`. Les jours non sélectionnés ne sont pas
 * des trous de couverture — ils sont hors périmètre du planning.
 *
 * Trois marqueurs, l'un ou l'autre selon la voie de création (formulaire, import,
 * duplication) : la colonne `schedule_type` n'est pas toujours dans le SELECT de
 * l'appelant, d'où le repli sur les deux drapeaux de `metadata`.
 */
const isSpecialSchedule = (schedule) => (
  schedule?.schedule_type === 'special_weekend_holiday'
  || schedule?.metadata?.schedule_kind === 'weekend_holiday'
  || schedule?.metadata?.special_days_only === true
);

/**
 * Jours cochés dans le tableur, toutes lignes confondues. Dans un planning
 * spécial, c'est le périmètre réel du planning : les jours que le chef a
 * sélectionnés.
 */
const markedDays = (schedule) => {
  const rows = Array.isArray(schedule?.metadata?.spreadsheet?.rows)
    ? schedule.metadata.spreadsheet.rows
    : [];
  const days = new Set();
  for (const row of rows) {
    if (row?.isProposedNewRow) continue;
    for (const day of rowMarkedDays(row)) days.add(day);
  }
  return days;
};

/**
 * Une ligne du tableur est-elle de service à cette date ? C'est la règle
 * d'arbitrage décrite en tête de fichier, isolée ici pour que les exports —
 * qui travaillent sur des lignes fusionnées, hors objet `schedule` — appliquent
 * exactement la même, sans la réécrire.
 */
const rowOnDuty = (row, date, { isSpecial = false, scheduleStart = '', scheduleEnd = '' } = {}) => {
  const day = dateKey(date);
  if (!day) return false;
  const marks = rowMarkedDays(row);
  if (isSpecial || marks.size > 0) return marks.has(day);
  return dateInPeriods(day, normalizePeriods(row, scheduleStart, scheduleEnd));
};

/**
 * Personnel de service à une date donnée, selon la règle d'arbitrage décrite en
 * tête de fichier.
 *
 * Les lignes proposées non validées (`isProposedNewRow`) sont ignorées : elles
 * n'appartiennent pas encore au planning. Les lignes sans personnel sélectionné
 * — la ligne vierge que le tableur ajoute toujours — le sont aussi : elles ne
 * doivent jamais devenir un agent fantôme dans l'appel du jour.
 */
const rosterOnDate = (schedule, date) => {
  const day = dateKey(date);
  if (!day) return [];

  const rows = Array.isArray(schedule?.metadata?.spreadsheet?.rows)
    ? schedule.metadata.spreadsheet.rows
    : [];
  const context = {
    isSpecial: isSpecialSchedule(schedule),
    scheduleStart: dateKey(schedule?.start_date),
    scheduleEnd: dateKey(schedule?.end_date),
  };

  const entries = [];
  let rowIndex = -1;
  for (const row of rows) {
    rowIndex += 1;
    if (row?.isProposedNewRow) continue;
    if (!row?.userId) continue;
    if (!rowOnDuty(row, day, context)) continue;

    entries.push({
      date: day,
      // Libellé constant : il n'y a plus qu'une seule nature de service. Les
      // écrans qui affichaient le code affichent ce libellé.
      label: 'De service',
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      departmentId: row.deptId || schedule.department_id || null,
      userId: row.userId,
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      roleName: row.roleName || '',
      matricule: row.matricule || '',
      shiftStart: row.shiftStart || '',
      shiftEnd: row.shiftEnd || '',
      // Garde à domicile (astreinte) — absent ⇒ false ⇒ garde à l'hôpital.
      atHome: row.atHome === true,
      // Origine de l'entrée, pour les règles. `rowKey` identifie la ligne du
      // tableur ; `continuous` dit que cette ligne est lue par sa **période** et
      // non par ses cases (cf. l'arbitrage en tête de fichier). Les jours d'une
      // période sont une seule affectation continue, pas une suite de gardes
      // distinctes : le moteur de règles doit les traiter comme un seul bloc.
      rowKey: row.id || `ligne-${rowIndex}`,
      continuous: !context.isSpecial && rowMarkedDays(row).size === 0,
    });
  }
  return entries;
};

/**
 * Toutes les affectations d'un planning sur un intervalle, au sens de
 * `rosterOnDate`.
 *
 * `from` / `to` sont facultatifs et **bornés** aux dates du planning : passer un
 * mois entier sur un planning de dix jours n'itère que ces dix jours. Les bornes
 * sont comparées en chaînes 'YYYY-MM-DD' (jamais de `new Date()` sur une colonne
 * DATE, qui décalerait d'un jour selon le fuseau).
 */
const dutyEntries = (schedule, from, to) => {
  const scheduleStart = dateKey(schedule?.start_date);
  const scheduleEnd = dateKey(schedule?.end_date);
  if (!scheduleStart || !scheduleEnd) return [];

  const wanted = dateKey(from);
  const until = dateKey(to);
  const first = wanted && wanted > scheduleStart ? wanted : scheduleStart;
  const last = until && until < scheduleEnd ? until : scheduleEnd;
  if (first > last) return [];

  const entries = [];
  for (const day of datesBetween(first, last)) {
    for (const entry of rosterOnDate(schedule, day)) entries.push(entry);
  }
  return entries;
};

/**
 * Durée d'une affectation, en heures, d'après les colonnes « Heure début / fin »
 * de la ligne.
 *
 * Une fin antérieure ou égale au début franchit minuit : 19:00 → 07:00 fait
 * 12 h, et 07:00 → 07:00 est la façon dont le tableur note une garde de 24 h.
 * Sans horaire lisible on retient 12 h, la fenêtre par défaut du tableur — un
 * agent de service compte toujours des heures, jamais zéro.
 */
const entryHours = (entry) => {
  const start = String(entry?.shiftStart || '').split(':').map(Number);
  const end = String(entry?.shiftEnd || '').split(':').map(Number);
  if (!Number.isFinite(start[0]) || !Number.isFinite(end[0])) return 12;
  const startMinutes = start[0] * 60 + (start[1] || 0);
  const endMinutes = end[0] * 60 + (end[1] || 0);
  const minutes = endMinutes <= startMinutes
    ? (24 * 60 - startMinutes) + endMinutes
    : endMinutes - startMinutes;
  return minutes > 0 ? minutes / 60 : 12;
};

/** Nombre d'affectations (agent × jour) sur l'intervalle. */
const countDuty = (schedule, from, to) => dutyEntries(schedule, from, to).length;

/** Agents distincts de service sur l'intervalle. */
const distinctDutyStaff = (schedule, from, to) => {
  const ids = new Set();
  for (const entry of dutyEntries(schedule, from, to)) {
    if (entry.userId) ids.add(entry.userId);
  }
  return ids;
};

/**
 * Jours de service restants d'un planning à partir d'une date (incluse) : somme
 * des (agent × jour) encore à venir, bornée par les dates du planning.
 */
const remainingDutyDays = (schedule, from) => (
  countDuty(schedule, dateKey(from) || dateKey(new Date()), null)
);

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
  dateKey,
  datesBetween,
  isMarked,
  rowMarkedDays,
  isSpecialSchedule,
  markedDays,
  rowOnDuty,
  rosterOnDate,
  dutyEntries,
  entryHours,
  countDuty,
  distinctDutyStaff,
  remainingDutyDays,
  planningState,
};
