/**
 * Résolution de l'action associée à une notification (point 2).
 *
 * La chaîne de branches vivait en ligne dans `Header.jsx` : elle est déplacée
 * ici sans changer une seule décision, puis complétée du cas manquant — les
 * demandes de prêt de personnel, qui n'avaient jusqu'ici aucune action.
 *
 * Deux appelants : le menu déroulant du `Header` et la page dédiée aux
 * notifications. Un seul endroit à faire évoluer pour un nouveau type.
 *
 * Retourne `null` quand le type n'a pas encore d'action — l'appelant reste
 * libre d'afficher son propre message.
 */

/**
 * @param {object} notif   Notification telle que renvoyée par l'API
 *                         (`entity_type`, `entity_id`, `target_schedule_id`).
 * @param {string} roleCode Rôle du lecteur — le fil des notes en dépend.
 * @returns {{ path: string, label: string } | null}
 */
export function resolveNotificationTarget(notif, roleCode) {
  if (!notif) return null;

  // Une note ou circulaire ouvre le fil correspondant au rôle du lecteur.
  if (notif.entity_type === 'notes') {
    if (roleCode === 'super_admin') return { path: '/admin', label: 'Ouvrir les notes' };
    if (roleCode === 'director' || roleCode === 'hospital_admin') {
      return { path: '/director/notes', label: 'Ouvrir les notes' };
    }
    // Point 7 : l'onglet Notes du planning des gardes n'existe plus, l'écran
    // indépendant `/notes` le remplace pour tous les autres rôles.
    return { path: '/notes', label: 'Ouvrir les notes' };
  }

  // Un remplacement ouvre l'onglet dédié, jamais le tableur (qui reste intact).
  if (notif.entity_type === 'replacements') {
    const q = notif.target_schedule_id ? `&scheduleId=${notif.target_schedule_id}` : '';
    return { path: `/chef-de-service?tab=remplacements${q}`, label: 'Voir le remplacement' };
  }

  // NOUVEAU — demande de prêt de personnel : la notification pointe désormais
  // vers l'interface dédiée, avec la demande mise en évidence.
  if (notif.entity_type === 'staff_loan_requests') {
    const q = notif.entity_id ? `?focus=${notif.entity_id}` : '';
    return { path: `/staff-loans${q}`, label: 'Traiter la demande' };
  }

  if (notif.target_schedule_id) {
    return {
      path: `/chef-de-service?scheduleId=${notif.target_schedule_id}`,
      label: 'Ouvrir le planning',
    };
  }

  return null;
}

export default resolveNotificationTarget;
