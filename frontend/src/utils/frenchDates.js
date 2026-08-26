/**
 * Dates françaises, sans jamais construire de `Date`
 * ══════════════════════════════════════════════════
 *
 * Fichier neuf. Toutes ces fonctions prennent une clé `YYYY-MM-DD` telle que
 * l'API la renvoie (les contrôleurs castent leurs colonnes DATE en
 * `TO_CHAR(col, 'YYYY-MM-DD')`) et rendent du texte.
 *
 * Pourquoi aucun `new Date()` : une colonne DATE de PostgreSQL arrive sans
 * heure, `new Date('2026-08-01')` l'interprète en UTC puis l'affiche dans le
 * fuseau du navigateur — à Tunis (UTC+1) le 1er août devient le 31 juillet.
 * Une expression régulière sur la chaîne n'a pas ce défaut.
 *
 * Réutilisable par tous les écrans de la plateforme : un planning, une garde,
 * une absence et une note se datent de la même façon.
 */

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Décompose une clé `YYYY-MM-DD`, ou `null` si ce n'en est pas une. */
export const dateParts = (key) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
};

/** « 1er » pour le premier du mois, le chiffre nu ensuite. */
export const dayLabel = (day) => (day === 1 ? '1er' : String(day));

/** « 3 août », ou « 3 août 2026 » avec l'année. */
export const shortFrenchDate = (key, withYear = false) => {
  const p = dateParts(key);
  if (!p) return String(key || '');
  return `${dayLabel(p.d)} ${MONTHS_SHORT[p.m - 1]}${withYear ? ` ${p.y}` : ''}`;
};

/** « 3 août 2026 » en entier. */
export const longFrenchDate = (key) => {
  const p = dateParts(key);
  if (!p) return String(key || '');
  return `${dayLabel(p.d)} ${MONTHS[p.m - 1]} ${p.y}`;
};

/**
 * « du 1er au 31 août 2026 » quand tout tient dans le même mois,
 * « du 11 septembre au 30 novembre 2026 » sinon.
 */
export const frenchRange = (startKey, endKey) => {
  const a = dateParts(startKey), b = dateParts(endKey);
  if (!a || !b) return '';
  if (a.y === b.y && a.m === b.m) return `du ${dayLabel(a.d)} au ${dayLabel(b.d)} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y === b.y) return `du ${dayLabel(a.d)} ${MONTHS[a.m - 1]} au ${dayLabel(b.d)} ${MONTHS[b.m - 1]} ${a.y}`;
  return `du ${dayLabel(a.d)} ${MONTHS[a.m - 1]} ${a.y} au ${dayLabel(b.d)} ${MONTHS[b.m - 1]} ${b.y}`;
};

/** « Août 2026 » — ou « Août → Novembre 2026 » pour une période à cheval. */
export const frenchSpan = (startKey, endKey) => {
  const a = dateParts(startKey), b = dateParts(endKey);
  if (!a) return '';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  if (!b || (a.y === b.y && a.m === b.m)) return `${cap(MONTHS[a.m - 1])} ${a.y}`;
  if (a.y === b.y) return `${cap(MONTHS[a.m - 1])} → ${cap(MONTHS[b.m - 1])} ${a.y}`;
  return `${cap(MONTHS[a.m - 1])} ${a.y} → ${cap(MONTHS[b.m - 1])} ${b.y}`;
};

/**
 * « lundi 3 août 2026 ». Le jour de la semaine demande un calcul de calendrier :
 * on ancre la date à midi pour qu'aucun décalage de fuseau ne la fasse basculer.
 */
export const frenchWeekday = (key) => {
  const p = dateParts(key);
  if (!p) return '';
  return WEEKDAYS[new Date(`${key}T12:00:00`).getDay()];
};

/** « lundi 3 août 2026 », jour de la semaine compris. */
export const fullFrenchDate = (key) => {
  const p = dateParts(key);
  if (!p) return String(key || '');
  return `${frenchWeekday(key)} ${longFrenchDate(key)}`;
};

/**
 * Met en français les dates ISO **contenues dans une phrase déjà composée**.
 *
 * Deux sources produisent du texte serveur avec des `YYYY-MM-DD` dedans, et
 * aucune des deux ne peut être corrigée à la source :
 *   • le message d'une alerte (`absences-shift.controller.js`) est écrit en base
 *     au moment du signalement — l'historique ne se réécrit pas, et le corriger
 *     désormais laisserait les anciennes lignes en ISO ;
 *   • le détail d'une anomalie (`conflict-rules.js`) est composé par un module
 *     pur partagé avec la vue du chef de service — le modifier toucherait un
 *     écran hors périmètre.
 *
 * D'où la mise en forme à la lecture, qui vaut pour les anciennes lignes comme
 * pour les nouvelles. À n'employer que sur du texte déjà formé : une date qu'on
 * affiche seule passe par `longFrenchDate`.
 */
export const frenchifyIsoDates = (text) => String(text || '').replace(
  /\d{4}-\d{2}-\d{2}/g,
  (key) => longFrenchDate(key),
);

export { MONTHS as FRENCH_MONTHS, MONTHS_SHORT as FRENCH_MONTHS_SHORT, WEEKDAYS as FRENCH_WEEKDAYS };
