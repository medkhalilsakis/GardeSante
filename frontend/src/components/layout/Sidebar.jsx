import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore, useUIStore } from '../../store';
import { useTranslation } from '../../utils/helpers';
import Avatar from '../common/Avatar';
import '../../styles/layout.css';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

// Icônes SVG inline
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
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {icons[name] || null}
    </svg>
  );
};

export default function Sidebar({ unreadCount = 0 }) {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar, language, setLanguage } = useUIStore();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const hasPermission  = useAuthStore((s) => s.hasPermission);
  const isSuperAdmin   = user?.roleCode === 'super_admin';
  const isAdmin        = ['super_admin', 'hospital_admin'].includes(user?.roleCode);
  const isDirector     = user?.roleCode === 'director';
  const isChef         = ['department_head', 'service_supervisor'].includes(user?.roleCode);
  const isManagement   = ['super_admin', 'hospital_admin', 'director', 'general_supervisor'].includes(user?.roleCode);
  const canManageSchedules = hasPermission('schedules.read');
  const canManageUsers     = hasPermission('users.read');

  const avatarUrl = user?.avatarUrl
    ? (user.avatarUrl.startsWith('http') ? user.avatarUrl : `${API_BASE}${user.avatarUrl}`)
    : null;

  // Navigation super admin : uniquement gestion plateforme
  const superAdminNav = [
    { key: 'platform', label: 'Plateforme', items: [
      { to: '/admin',                      icon: 'dashboard',   label: 'Tableau de bord' },
      { to: '/admin/profile-requests',     icon: 'review',      label: 'Demandes profil' },
    ]},
    { key: 'personal', label: 'Mon espace', items: [
      { to: '/history', icon: 'history', label: 'Mon historique' },
    ]},
  ];

  // Navigation utilisateurs standards
  const navItems = isSuperAdmin ? superAdminNav : [
    { key: 'main', label: 'Principal', items: [
      { to: '/dashboard',    icon: 'dashboard',    label: t('nav.dashboard') },
      // /schedules visible uniquement pour les non-chefs
      { to: '/schedules',    icon: 'schedules',    label: t('nav.schedules'), show: canManageSchedules && !isChef },
      { to: '/shifts',       icon: 'shifts',       label: t('nav.shifts') },
      { to: '/absences',     icon: 'absences',     label: t('nav.absences') },
      { to: '/replacements', icon: 'replacements', label: t('nav.replacements') },
    ]},
    { key: 'chef', label: 'Mon Service', show: isChef, items: [
      { to: '/chef-de-service',          icon: 'planning',  label: '📋 Planning des Gardes' },
    ]},
    { key: 'analytics', label: 'Analytique', show: isManagement, items: [
      { to: '/statistics', icon: 'statistics', label: t('nav.statistics') },
    ]},
    { key: 'director', label: 'Gestion', show: isDirector, items: [
      { to: '/director/personnel', icon: 'personnel', label: 'Gestion des personnels' },
      { to: '/director/services',  icon: 'services',  label: 'Gestion des services' },
    ]},
    { key: 'personal', label: 'Mon espace', items: [
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
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-icon"><Icon name="pulse" size={18} /></div>
        <div className="logo-text">
          <span className="logo-name">GardeSante</span>
          <span className="logo-sub">{user?.establishmentCode || 'Platform'}</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((section) => {
          if (section.show === false) return null;
          const visible = section.items.filter(i => i.show !== false);
          if (!visible.length) return null;
          return (
            <div key={section.key}>
              {!sidebarCollapsed && <p className="nav-section-title">{section.label}</p>}
              {visible.map((item) => (
                <NavLink key={item.to} to={item.to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  title={sidebarCollapsed ? item.label : ''}>
                  <span className="nav-icon"><Icon name={item.icon} size={18} /></span>
                  <span className="nav-label">{item.label}</span>
                  {item.to === '/notifications' && unreadCount > 0 && (
                    <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        {/* Toggle langue */}
        {!sidebarCollapsed && (
          <button onClick={() => setLanguage(language === 'fr' ? 'ar' : 'fr')} style={{
            width:'100%', background:'var(--bg-elevated)', border:'1px solid var(--border-subtle)',
            borderRadius:'var(--border-radius-sm)', color:'var(--text-secondary)',
            fontSize:'var(--font-xs)', fontWeight:600, padding:'6px', cursor:'pointer',
            marginBottom:'8px', fontFamily:'inherit', transition:'all var(--transition-fast)',
          }}>
            {language === 'fr' ? '🇩🇿 العربية' : '🇫🇷 Français'}
          </button>
        )}

        {/* User card — clic → profil | icône logout */}
        <div className="user-info" style={{ position:'relative' }}>
          {/* Zone clic → profil */}
          <div style={{ display:'flex', alignItems:'center', gap:'var(--space-3)', flex:1, cursor:'pointer', overflow:'hidden' }}
            onClick={() => !isSuperAdmin && navigate('/profile')}
            title={sidebarCollapsed ? `${user?.firstName} ${user?.lastName}` : (isSuperAdmin ? '' : 'Mon profil')}>
            <Avatar
              avatarUrl={avatarUrl}
              firstName={user?.firstName}
              lastName={user?.lastName}
              size="sm"
              style={{ flexShrink:0 }}
            />
            <div className="user-details">
              <p className="user-name">{user?.firstName} {user?.lastName}</p>
              <p className="user-role">{t(`roles.${user?.roleCode}`) || user?.roleName}</p>
            </div>
          </div>

          {/* Bouton déconnexion séparé */}
          {!sidebarCollapsed && (
            <button onClick={handleLogout} title="Déconnexion" style={{
              background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)',
              padding:'4px', display:'flex', borderRadius:6, flexShrink:0,
              transition:'color 0.15s',
            }}
              onMouseEnter={e => e.target.style.color='var(--color-danger)'}
              onMouseLeave={e => e.target.style.color='var(--text-muted)'}>
              <Icon name="logout" size={16} />
            </button>
          )}
        </div>

        {/* Collapse toggle */}
        <button onClick={toggleSidebar} style={{
          marginTop:'8px', width:'100%', background:'transparent',
          border:'1px solid var(--border-subtle)', borderRadius:'var(--border-radius-sm)',
          color:'var(--text-muted)', padding:'6px', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'center',
          transition:'all var(--transition-fast)',
          transform: sidebarCollapsed ? 'rotate(180deg)' : 'none',
        }} title={sidebarCollapsed ? 'Agrandir' : 'Réduire'}>
          <Icon name="chevron" size={16} />
        </button>
      </div>
    </aside>
  );
}
