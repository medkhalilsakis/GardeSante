/**
 * Résolution de l'action associée à une notification (point 2).
 *
 * La chaîne de branches vivait en ligne dans `Header.jsx` : elle est déplacée
 * ici sans changer une seule décision, puis complétée des cas manquants.
 *
 * Deux appelants : le menu déroulant du `Header` et la page dédiée aux
 * notifications. Un seul endroit à faire évoluer pour un nouveau type.
 *
 * Trois types présents en base n'avaient aucune branche — `absences`,
 * `shift_events`, et les propositions dont le planning n'est plus résolvable :
 * ils tombaient sur `null`, donc sur « Cette notification ne possède pas encore
 * d'action associée. » Ils sont traités ici.
 *
 * Retourne `null` quand le type n'a réellement pas d'action — l'appelant reste
 * libre d'afficher son propre message.
 */

/**
 * Écran « plannings » de chaque rôle, et ce qu'il sait ouvrir.
 *
 * `/chef-de-service` lit `?scheduleId=` et `?tab=` (deep-link géré dans
 * `ChefDeServiceDashboard`) ; les autres écrans n'ont pas cette entrée, on ne
 * leur passe donc pas de paramètre qu'ils ignoreraient. Le surveillant général
 * partage volontairement la route du chef — c'est son entrée de menu
 * « Plannings de l'Hôpital ».
 */
export const planningScreen = (roleCode) => {
  switch (roleCode) {
    case 'department_head':
    case 'general_supervisor':
      return { path: '/chef-de-service', deepLink: true };
    case 'service_supervisor':
      return { path: '/planning-a-consulter', deepLink: false };
    case 'director':
    case 'hospital_admin':
      return { path: '/supervision', deepLink: false };
    case 'super_admin':
      return { path: '/admin', deepLink: false };
    default:
      return { path: '/dashboard', deepLink: false };
  }
};

/**
 * @param {object} notif   Notification telle que renvoyée par l'API
 *                         (`entity_type`, `entity_id`, `target_schedule_id`).
 * @param {string} roleCode Rôle du lecteur — la destination en dépend.
 * @returns {{ path: string, label: string } | null}
 */
export function resolveNotificationTarget(notif, roleCode) {
  if (!notif) return null;

  const screen = planningScreen(roleCode);

  // Une note ou circulaire ouvre le fil correspondant au rôle du lecteur.
  if (notif.entity_type === 'notes') {
    if (roleCode === 'super_admin') return { path: '/admin', label: 'Ouvrir les notes' };
    // Point 7 : l'onglet Notes du planning des gardes n'existe plus, l'écran
    // indépendant `/notes` le remplace pour tous les rôles.
    return { path: '/notes', label: 'Ouvrir les notes' };
  }

  // Un remplacement ouvre l'onglet dédié, jamais le tableur (qui reste intact).
  if (notif.entity_type === 'replacements') {
    if (!screen.deepLink) return { path: screen.path, label: 'Voir le remplacement' };
    const q = notif.target_schedule_id ? `&scheduleId=${notif.target_schedule_id}` : '';
    return { path: `${screen.path}?tab=remplacements${q}`, label: 'Voir le remplacement' };
  }

  // Demande de prêt de personnel : l'interface dédiée, demande mise en évidence.
  if (notif.entity_type === 'staff_loan_requests') {
    const q = notif.entity_id ? `?focus=${notif.entity_id}` : '';
    return { path: `/staff-loans${q}`, label: 'Traiter la demande' };
  }

  // Congé ou absence déclarée : l'écran des absences, ouvert aux quatre rôles
  // métier (permission `absences.read`).
  if (notif.entity_type === 'absences') {
    return { path: '/absences', label: 'Voir l\'absence' };
  }

  // Évènement de garde signalé sur le terrain : l'écran des alertes.
  if (notif.entity_type === 'shift_events') {
    return { path: '/incidents', label: 'Ouvrir l\'alerte' };
  }

  // Demande de modification de profil : le Super Admin la traite, le demandeur
  // consulte la décision sur son profil.
  if (notif.entity_type === 'profile_change_request') {
    return roleCode === 'super_admin'
      ? { path: '/admin/profile-requests', label: 'Traiter la demande' }
      : { path: '/profile', label: 'Voir ma demande' };
  }

  if (notif.target_schedule_id) {
    return {
      path: screen.deepLink ? `${screen.path}?scheduleId=${notif.target_schedule_id}` : screen.path,
      label: 'Ouvrir le planning',
    };
  }

  // Proposition de modification dont le planning n'est plus résolvable (il a pu
  // être supprimé) : l'écran des plannings du rôle reste la bonne destination.
  if (notif.entity_type === 'schedule_change_proposals' || notif.entity_type === 'schedules') {
    return { path: screen.path, label: 'Ouvrir les plannings' };
  }

  return null;
}

export default resolveNotificationTarget;
