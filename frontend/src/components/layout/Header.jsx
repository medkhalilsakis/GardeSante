import React, { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useUIStore, useAuthStore, useNotificationStore } from '../../store';
import { notificationsAPI } from '../../api';
import { useTranslation } from '../../utils/helpers';
import { resolveNotificationTarget } from '../../utils/notificationTarget';
import { longFrenchDate, frenchWeekday } from '../../utils/frenchDates';
import GsEmpty from '../gs/GsEmpty';
import toast from 'react-hot-toast';
import '../../styles/layout.css';

const BellIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
);

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
);

const MenuIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

/** La clé du jour, prise sur l'horloge locale — jamais sur une colonne DATE. */
const todayKey = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * L'âge d'une notification, pas sa date. « il y a 20 min » se lit d'un coup
 * d'œil dans un volet déroulant ; « 21 août, 14:32 » demande un calcul. La date
 * exacte reste dans l'infobulle, pour qui en a besoin.
 */
const agoLabel = (value) => {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const min = Math.round((Date.now() - then) / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 8) return `il y a ${days} j`;
  return new Date(then).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

export default function Header({ title, subtitle, actions, onOpenNav, navOpen = false }) {
  const { sidebarCollapsed, theme, toggleTheme } = useUIStore();
  const { user } = useAuthStore();
  const { unreadCount, markAllRead, markAsRead } = useNotificationStore();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [showNotif, setShowNotif] = React.useState(false);
  const [notifications, setNotifications] = React.useState([]);
  const notifRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotif(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Échap referme le volet : il se superpose au contenu, il doit se fermer au
  // clavier comme au clic à côté.
  useEffect(() => {
    if (!showNotif) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowNotif(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showNotif]);

  const openNotifications = async () => {
    setShowNotif(!showNotif);
    if (!showNotif) {
      try {
        const res = await notificationsAPI.getAll({ limit: 10 });
        setNotifications(res.data.data);
      } catch {}
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
      markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success('Notifications marquées comme lues');
    } catch {}
  };

  const openNotificationAction = async (notif) => {
    if (!notif.is_read) {
      try { await notificationsAPI.markRead(notif.id); markAsRead(notif.id); } catch {}
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
    }
    setShowNotif(false);
    // Les branches par type vivent désormais dans `utils/notificationTarget`,
    // partagées avec la page dédiée aux notifications. Comportement identique
    // pour les types déjà gérés, plus les demandes de prêt de personnel.
    const target = resolveNotificationTarget(notif, user?.roleCode);
    if (target) {
      navigate(target.path);
      return;
    }
    toast('Cette notification ne possède pas encore d’action associée.');
  };

  const dayKey = todayKey();
  const initials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase();
  const isSuperAdmin = user?.roleCode === 'super_admin';

  return (
    <header className={`header ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Sous 900 px la barre latérale est un tiroir : c'est ici qu'on l'ouvre. */}
      <button
        type="button"
        className="gsh-burger"
        onClick={onOpenNav}
        aria-label="Ouvrir le menu"
        aria-controls="gs-nav"
        aria-expanded={navOpen}
      >
        <MenuIcon />
      </button>

      <div className="gsh-head-titles">
        <h1 className="header-title">{title}</h1>
        {subtitle && <p className="gsh-head-sub">{subtitle}</p>}
      </div>

      {actions && <div className="header-actions">{actions}</div>}

      <div className="header-actions">
        {/* Toute cette plateforme parle d'aujourd'hui : le registre se date en
            tête, une fois, plutôt que dans chaque écran. */}
        <span className="gsh-today" title={`Nous sommes le ${frenchWeekday(dayKey)} ${longFrenchDate(dayKey)}`}>
          <span>{frenchWeekday(dayKey)}</span>
          {longFrenchDate(dayKey)}
        </span>

        <button
          type="button"
          className="header-btn gsh-theme"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
          aria-label={theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
        >
          <span className="gsh-theme-glyph" data-on={String(theme === 'dark')}><SunIcon /></span>
          <span className="gsh-theme-glyph" data-on={String(theme !== 'dark')}><MoonIcon /></span>
        </button>

        <div className="gsh-notif-anchor" ref={notifRef}>
          <button
            type="button"
            className="header-btn"
            onClick={openNotifications}
            title={t('nav.notifications')}
            aria-label={unreadCount > 0 ? `${t('nav.notifications')} — ${unreadCount} non lue(s)` : t('nav.notifications')}
            aria-expanded={showNotif}
          >
            <BellIcon />
            {unreadCount > 0 && <span className="badge-dot" />}
          </button>

          {showNotif && (
            <div className="gsh-notif" role="dialog" aria-label={t('nav.notifications')}>
              <div className="gsh-notif-head">
                <strong>
                  {t('nav.notifications')}
                  {unreadCount > 0 && <b>{unreadCount} non lue{unreadCount > 1 ? 's' : ''}</b>}
                </strong>
                {unreadCount > 0 && (
                  <button type="button" className="gs-btn is-quiet" onClick={handleMarkAllRead}>
                    Tout marquer lu
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div className="gsh-notif-empty">
                  <GsEmpty
                    bare
                    title="Aucune notification"
                    hint="Les demandes, alertes et validations qui vous concernent apparaîtront ici."
                  />
                </div>
              ) : (
                <ul className="gsh-notif-list">
                  {notifications.map((notif) => {
                    const target = resolveNotificationTarget(notif, user?.roleCode);
                    return (
                      <li key={notif.id}>
                        <button
                          type="button"
                          className="gsh-notif-item"
                          data-unread={String(!notif.is_read)}
                          onClick={() => openNotificationAction(notif)}
                        >
                          <span className="gsh-notif-dot" data-priority={notif.priority || 'low'} aria-hidden="true" />
                          <span className="gsh-notif-lines">
                            <span className="gsh-notif-title">{notif.title}</span>
                            <span className="gsh-notif-msg">{notif.message}</span>
                            <span className="gsh-notif-foot-line">
                              <span
                                className="gsh-notif-time"
                                title={new Date(notif.created_at).toLocaleString('fr-FR')}
                              >
                                {agoLabel(notif.created_at)}
                              </span>
                              {/* L'action promise est annoncée avant le clic : c'est
                                  elle qui distingue une notification à traiter
                                  d'une simple information. */}
                              {target && <span className="gsh-notif-cta">{target.label}</span>}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="gsh-notif-foot">
                <Link to="/notifications" className="gs-btn is-quiet" onClick={() => setShowNotif(false)}>
                  Toutes les notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Qui je suis. Le bloc était décoratif — il ouvre maintenant la fiche de
            profil, sauf pour le Super Admin qui n'en a pas. */}
        {isSuperAdmin ? (
          <span className="gsh-me" data-static="true">
            <span className="gsh-me-initials">{initials}</span>
            <span className="gsh-me-lines">
              <span className="gsh-me-name">{user?.firstName} {user?.lastName}</span>
              <span className="gsh-me-sub">Plateforme</span>
            </span>
          </span>
        ) : (
          <Link to="/profile" className="gsh-me" title="Ouvrir mon profil">
            <span className="gsh-me-initials">{initials}</span>
            <span className="gsh-me-lines">
              <span className="gsh-me-name">{user?.firstName} {user?.lastName}</span>
              <span className="gsh-me-sub">{user?.establishmentCode}</span>
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
