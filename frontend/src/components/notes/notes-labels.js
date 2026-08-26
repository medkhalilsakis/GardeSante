/**
 * Libellés partagés des notes.
 *
 * La priorité et la catégorie étaient déclarées deux fois — dans la carte et
 * dans la lecture — avec des couleurs en dur à chaque endroit. Les couleurs
 * sont parties dans `notes-ui.css` (la priorité est une échelle de poids, pas
 * un jeu de teintes) ; il ne reste ici que les mots, en un seul exemplaire.
 */

export const PRIORITY_LABELS = {
  low: 'Faible',
  normal: 'Normal',
  high: 'Élevée',
  urgent: 'Urgent',
};

export const CATEGORY_LABELS = {
  note: 'Note',
  circulaire: 'Circulaire',
  directive: 'Directive',
  info: 'Information',
};

/** Classe de pastille correspondant au niveau de priorité. */
export const priorityClass = (priority) =>
  `gsn-pill is-${PRIORITY_LABELS[priority] ? priority : 'normal'}`;
