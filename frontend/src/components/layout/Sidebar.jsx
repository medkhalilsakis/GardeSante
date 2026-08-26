import React, { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore, useUIStore } from '../../store';
import { useTranslation } from '../../utils/helpers';
import Avatar from '../common/Avatar';
import ContextBadge from './ContextBadge';
import '../../styles/layout.css';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

/**
 * Le sprite d'icônes de la coque.
 *
 * Il était incomplet : sept entrées de menu se distinguaient par un émoji en
 * tête de libellé (`📋 📝 👥 🤝 🩺 🏥 📅`) parce que deux d'entre elles
 * partageaient la même icône. Les émojis partent — ils ne suivent ni l'encre du
 * thème ni la graisse du trait — et quatre glyphes manquants les remplacent :
 * `portfolio` (la carte d'effectif), `loans` (le passage d'un agent d'un service
 * à l'autre), `stethoscope` (la surveillance de terrain) et `hospital`
 * (l'établissement entier). Chacun est désormais lisible seul, ce qui compte :
 * sous 1024 px la barre se réduit à ses icônes.
 */
const Icon = ({ name, size = 20 }) => {
  const icons = {
    dashboard:    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
    schedules:    <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
    shifts:       <><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></>,
    absences:     <><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></>,
    replacements: <><path d="M17 1l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 23l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></>,
    statistics:   <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
    users:        <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></>,
    departments:  <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9,22 9,12 15,12 15,22" /></>,
    settings:     <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></>,
    logout:       <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
    notifications:<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></>,
    chevron:      <polyline points="9,18 15,12 9,6" />,
    pulse:        <><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>,
    profile:      <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
    review:       <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14,2 14,8 20,8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>,
    history:      <><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></>,
    personnel:    <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
    services:     <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></>,
    chef:        <><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M12 12h.01M8 12h.01M16 12h.01"/></>,
    planning:    <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="14" x2="8" y2="14"/><line x1="12" y1="14" x2="12" y2="14"/><line x1="16" y1="14" x2="16" y2="14"/></>,
    // Appel du jour (point 6) : bloc-notes avec une coche.
    appel:       <><path d="M9 2h6a1 1 0 011 1v1H8V3a1 1 0 011-1z"/><path d="M16 4h1a2 2 0 012 2v13a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2h1"/><polyline points="9,13 11,15 15,11"/></>,
    // Notes et circulaires (point 7) : porte-voix.
    notes:       <><path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 11-5.8-1.6"/></>,
    incidents:   <><path d="M10.3 2.9L1.8 17a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 2.9a2.5 2.5 0 00-4.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    map:         <><polygon points="1 6 8 2 16 6 23 2 23 18 16 22 8 18 1 22 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/><circle cx="12" cy="11" r="2"/></>,
    // L'établissement entier — un bâtiment à la croix.
    hospital:    <><path d="M4 21V8a2 2 0 012-2h12a2 2 0 012 2v13"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/><line x1="12" y1="10" x2="12" y2="16"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="2" y1="21" x2="22" y2="21"/></>,
    // La surveillance de terrain — le stéthoscope.
    stethoscope: <><path d="M4.5 3v5.5a4 4 0 008 0V3"/><path d="M8.5 12.5V15a4.5 4.5 0 009 0v-2.2"/><circle cx="17.5" cy="10.5" r="2.2"/></>,
    // L'effectif du service — une carte d'agent.
    portfolio:   <><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2.2"/><path d="M4.6 16.6a3.6 3.6 0 016.8 0"/><line x1="14" y1="9" x2="19" y2="9"/><line x1="14" y1="13" x2="19" y2="13"/></>,
    // Le prêt de personnel — un agent qui passe d'un service à l'autre.
    loans:       <><circle cx="5.5" cy="6.5" r="2.5"/><circle cx="18.5" cy="6.5" r="2.5"/><path d="M2 19v-1.5a3.5 3.5 0 013.5-3.5"/><path d="M22 19v-1.5a3.5 3.5 0 00-3.5-3.5"/><line x1="9" y1="17" x2="15" y2="17"/><polyline points="13,15 15,17 13,19"/></>,
    close:       <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {icons[name] || null}
    </svg>
  );
};

export default function Sidebar({ unreadCount = 0, navOpen = false, onCloseNav }) {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar, language, setLanguage } = useUIStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const closeRef = useRef(null);

  const hasPermission  = useAuthStore((s) => s.hasPermission);
  const isSuperAdmin   = user?.roleCode === 'super_admin';
  const isDirector     = user?.roleCode === 'director';
  // Chaque métier a désormais son écran ; `isChef` ne couvre plus que le chef de service.
  const isChef              = user?.roleCode === 'department_head';
  const isServiceSupervisor = user?.roleCode === 'service_supervisor';
  const isGeneralSupervisor = user?.roleCode === 'general_supervisor';
  // Les trois rôles gardent leur espace « service » : /schedules leur reste masqué comme avant.
  const hasServiceSpace     = isChef || isServiceSupervisor || isGeneralSupervisor;
  const isManagement   = ['super_admin', 'hospital_admin', 'director', 'general_supervisor'].includes(user?.roleCode);
  const canManageSchedules = hasPermission('schedules.read');

  const avatarUrl = user?.avatarUrl
    ? (user.avatarUrl.startsWith('http') ? user.avatarUrl : `${API_BASE}${user.avatarUrl}`)
    : null;

  // Le tiroir s'ouvre sous 900 px : la première tabulation doit tomber dedans,
  // pas rester derrière le voile sur la page.
  useEffect(() => {
    if (navOpen) closeRef.current?.focus();
  }, [navOpen]);

  // Navigation super admin : uniquement gestion plateforme
  const superAdminNav = [
    { key: 'platform', label: 'Plateforme', items: [
      { to: '/admin',                      icon: 'dashboard',   label: 'Tableau de bord', end: true },
      { to: '/admin/carte',                icon: 'map',         label: 'Carte des hôpitaux' },
      { to: '/admin/profile-requests',     icon: 'review',      label: 'Demandes de profil' },
      // Les circulaires nationales avaient un compositeur mais aucune entrée de
      // menu : l'écran /notes n'était atteignable qu'en tapant l'URL. Le suivi
      // de diffusion reste dans l'onglet « Notes » du tableau de bord.
      { to: '/notes',                      icon: 'notes',       label: 'Notes et circulaires' },
    ]},
    { key: 'personal', label: 'Mon espace', items: [
      { to: '/notifications', icon: 'notifications', label: 'Notifications' },
      { to: '/history', icon: 'history', label: 'Historique' },
    ]},
  ];

  // Navigation utilisateurs standards
  const navItems = isSuperAdmin ? superAdminNav : [
    { key: 'main', label: 'Principal', items: [
      { to: '/dashboard',    icon: 'dashboard',    label: t('nav.dashboard') },
      // /schedules visible uniquement pour les non-chefs
      { to: '/schedules',    icon: 'schedules',    label: t('nav.schedules'), show: canManageSchedules && !hasServiceSpace },
      { to: '/shifts',       icon: 'shifts',       label: t('nav.shifts') },
      { to: '/absences',     icon: 'absences',     label: t('nav.absences') },
    ]},
    // Un écran par métier : le chef garde le tableur, le surveillant reçoit le
    // suivi des gardes courantes, le surveillant général la supervision hôpital.
    { key: 'chef', label: 'Mon service', show: isChef, items: [
      { to: '/chef-de-service',          icon: 'planning',     label: 'Planning des gardes' },
      { to: '/appel-du-jour',            icon: 'appel',        label: 'Appel du jour' },
      { to: '/incidents',                icon: 'incidents',    label: 'Alertes et incidents' },
      // Consultation de tout l'effectif du service (point 5) — lecture seule.
      { to: '/portfolio',                icon: 'portfolio',    label: 'Portfolio du service' },
      { to: '/staff-loans',              icon: 'loans',        label: 'Prêts de personnel' },
    ]},
    { key: 'surveillance', label: 'Mon service', show: isServiceSupervisor, items: [
      { to: '/surveillant',              icon: 'stethoscope',  label: 'Surveillance du service' },
      { to: '/appel-du-jour',            icon: 'appel',        label: 'Appel du jour' },
      { to: '/incidents',                icon: 'incidents',    label: 'Alertes et incidents' },
      { to: '/planning-a-consulter',     icon: 'review',       label: 'Planning à consulter' },
    ]},
    { key: 'supervision', label: 'Supervision', show: isGeneralSupervisor, items: [
      { to: '/supervision',              icon: 'hospital',     label: 'Supervision générale' },
      { to: '/chef-de-service',          icon: 'planning',     label: 'Plannings de l\'hôpital' },
      { to: '/appel-du-jour',            icon: 'appel',        label: 'Appel du jour' },
      { to: '/incidents',                icon: 'incidents',    label: 'Alertes et incidents' },
      { to: '/planning-a-consulter',     icon: 'review',       label: 'Planning à consulter' },
      { to: '/staff-loans',              icon: 'loans',        label: 'Prêts de personnel' },
      { to: '/surveillant',              icon: 'stethoscope',  label: 'Suivi des gardes' },
    ]},
    { key: 'analytics', label: 'Analytique', show: isManagement, items: [
      { to: '/statistics', icon: 'statistics', label: t('nav.statistics') },
    ]},
    { key: 'director', label: 'Gestion', show: isDirector, items: [
      { to: '/supervision',        icon: 'hospital',   label: 'Supervision de l\'hôpital' },
      { to: '/appel-du-jour',      icon: 'appel',      label: 'Appel du jour' },
      { to: '/director/personnel', icon: 'personnel',  label: 'Gestion des personnels' },
      { to: '/director/services',  icon: 'services',   label: 'Gestion des services' },
      { to: '/staff-loans',        icon: 'loans',      label: 'Prêts de personnel' },
    ]},
    { key: 'personal', label: 'Mon espace', items: [
      { to: '/notifications', icon: 'notifications', label: 'Notifications' },
      // Les notes quittent le planning des gardes et deviennent un écran à part
      // (point 7). Visible pour tous : le serveur filtre déjà ce que chacun voit.
      { to: '/notes', icon: 'notes', label: 'Notes et circulaires' },
      { to: '/history', icon: 'history', label: 'Historique' },
      { to: '/profile', icon: 'profile', label: 'Mon profil' },
    ]},
  ];

  const handleLogout = async () => {
    try { await import('../../api').then(m => m.authAPI.logout()); } catch {}
    logout();
    window.location.href = '/login';
  };

  return (
    <aside
      id="gs-nav"
      className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
      aria-label="Navigation principale"
    >
      {/* Le cachet du registre : le nom de la plateforme, et sous lui le code de
          l'établissement — une donnée, donc au registre. */}
      <div className="sidebar-logo">
        <div className="logo-icon"><Icon name="pulse" size={17} /></div>
        <div className="logo-text">
          <span className="logo-name">GardeSante</span>
          <span className="logo-sub">{user?.establishmentCode || 'PLATEFORME'}</span>
        </div>
        <button
          type="button"
          ref={closeRef}
          className="gsh-nav-close"
          onClick={onCloseNav}
          aria-label="Fermer le menu"
        >
          <Icon name="close" size={17} />
        </button>
      </div>

      {/* Contexte d'appartenance — hôpital et service(s). Bloc frère du logo :
          celui-ci a une hauteur fixe (--header-height) qu'il ne faut pas
          bousculer. Le composant ne rend rien pour le Super Admin. */}
      <ContextBadge variant="sidebar" />

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((section) => {
          if (section.show === false) return null;
          const visible = section.items.filter(i => i.show !== false);
          if (!visible.length) return null;
          return (
            <div key={section.key} className="gsh-nav-group">
              {!sidebarCollapsed && <p className="nav-section-title">{section.label}</p>}
              <ul className="gsh-nav-list">
                {visible.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end}
                      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                      title={sidebarCollapsed ? item.label : undefined}>
                      <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                      <span className="nav-label">{item.label}</span>
                      {item.to === '/notifications' && unreadCount > 0 && (
                        <span className="nav-badge" title={`${unreadCount} notification(s) non lue(s)`}>
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Pied de la tranche */}
      <div className="sidebar-footer">
        {/* Langue — deux états lisibles au lieu d'une bascule dont le libellé
            annonçait la langue d'arrivée sans jamais dire laquelle était active. */}
        {!sidebarCollapsed && (
          <div className="gsh-lang" role="group" aria-label="Langue de l'interface">
            <button type="button" aria-pressed={language === 'fr'} onClick={() => setLanguage('fr')}>
              Français
            </button>
            <button type="button" aria-pressed={language === 'ar'} onClick={() => setLanguage('ar')} lang="ar">
              العربية
            </button>
          </div>
        )}

        <div className="user-info">
          {/* Le Super Admin n'a pas de fiche de profil à ouvrir : le bouton est
              alors désactivé plutôt que muet au clic. */}
          <button
            type="button"
            className="gsh-me-open"
            disabled={isSuperAdmin}
            onClick={() => navigate('/profile')}
            title={isSuperAdmin ? undefined : 'Ouvrir mon profil'}
          >
            <Avatar
              avatarUrl={avatarUrl}
              firstName={user?.firstName}
              lastName={user?.lastName}
              size="sm"
              style={{ flexShrink: 0 }}
            />
            <span className="user-details">
              <span className="user-name">{user?.firstName} {user?.lastName}</span>
              <span className="user-role">{t(`roles.${user?.roleCode}`) || user?.roleName}</span>
            </span>
          </button>

          {!sidebarCollapsed && (
            <button type="button" className="gsh-logout" onClick={handleLogout} title="Se déconnecter" aria-label="Se déconnecter">
              <Icon name="logout" size={15} />
            </button>
          )}
        </div>

        {/* Repli manuel — sans objet sous 1024 px, où la largeur décide seule ;
            la feuille de la coque le masque à ces tailles. */}
        <button
          type="button"
          className="gsh-collapse"
          onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-controls="gs-nav"
          title={sidebarCollapsed ? 'Déplier le menu' : 'Replier le menu'}
        >
          <Icon name="chevron" size={14} />
          {!sidebarCollapsed && <span>Replier</span>}
        </button>
      </div>
    </aside>
  );
}
