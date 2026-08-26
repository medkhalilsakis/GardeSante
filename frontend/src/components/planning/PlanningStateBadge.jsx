import React from 'react';
import './PlanningStateBadge.css';

/**
 * Badge affichant l'état dérivé d'un planning.
 * États : brouillon | soumis | en_cours | termine
 *
 * `state` est facultatif : quand le serveur a déjà calculé l'état via la fonction
 * SQL planning_state(), on l'affiche tel quel plutôt que de le redériver côté client.
 *
 * Les intitulés et la correspondance état → couleur sont exportés : le calendrier
 * de l'hôpital et les compteurs du Super Admin les recopiaient à la main, et une
 * règle recopiée est une règle qui finit par diverger.
 */

/** Intitulés officiels d'un état de planning. */
export const PLANNING_STATES = {
  brouillon: { label: 'Brouillon',  labelAr: 'مسودة' },
  // Un planning envoyé est effectif : il n'y a plus d'approbation à attendre,
  // il est « en vigueur » jusqu'à sa date de début.
  soumis:    { label: 'En vigueur', labelAr: 'ساري' },
  en_cours:  { label: 'En cours',   labelAr: 'جاري' },
  termine:   { label: 'Terminé',    labelAr: 'منتهي' },
  // Le calendrier de l'hôpital connaît un cinquième cas que `planning_state()`
  // ne produit pas : un planning suspendu. Il vit ici pour que les deux
  // surfaces partagent un seul vocabulaire.
  suspendu:  { label: 'Suspendu',   labelAr: 'معلق' },
};

/**
 * Couleur d'un état, sous forme de jeton — pour les surfaces qui ont besoin de
 * la teinte seule (pastille de calendrier, segment de barre) et non du badge
 * entier. Brouillon et terminé partagent l'encre pâle : ni l'un ni l'autre
 * n'est en vigueur, et seul le badge distingue l'ouvert du clos, par sa forme.
 */
export const PLANNING_STATE_COLOR = {
  brouillon: 'var(--gs-ink-faint)',
  soumis:    'var(--gs-seal)',
  en_cours:  'var(--gs-duty)',
  termine:   'var(--gs-ink-faint)',
  suspendu:  'var(--gs-alert)',
};

/** État dérivé comme la fonction SQL `planning_state()`. */
export const derivePlanningState = (status, startDate, endDate) => {
  if (status === 'draft') return 'brouillon';

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  if (today < start) return 'soumis';
  if (today >= start && today <= end) return 'en_cours';
  return 'termine';
};

export default function PlanningStateBadge({ state: stateProp, status, startDate, endDate, size = 'md' }) {
  const derived = stateProp || derivePlanningState(status, startDate, endDate);
  const state = PLANNING_STATES[derived] ? derived : 'brouillon';

  return (
    <span className={`gspb is-${state} is-${size}`}>
      {PLANNING_STATES[state].label}
    </span>
  );
}
