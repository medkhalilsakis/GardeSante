import React, { useEffect, useRef } from 'react';
import { useUIStore, useAuthStore, useNotificationStore } from '../../store';
import { notificationsAPI } from '../../api';
import { useTranslation } from '../../utils/helpers';
import toast from 'react-hot-toast';
import '../../styles/layout.css';

const BellIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 01-3.46 0"/>
  </svg>
);

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
  </svg>
);

export default function Header({ title, subtitle, actions }) {
  const { sidebarCollapsed, theme, toggleTheme } = useUIStore();
  const { user } = useAuthStore();
  const { unreadCount, markAllRead } = useNotificationStore();
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

  const priorityColors = { urgent: '#EF4444', high: '#F59E0B', normal: '#6366F1', low: '#8BA3C7' };

  return (
    <header className={`header ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {/* Titre */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 className="header-title" style={{ fontSize: 'var(--font-xl)' }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</p>}
      </div>

      {/* Actions custom */}
      {actions && <div className="header-actions" style={{ flexShrink: 0 }}>{actions}</div>}

      <div className="header-actions">
        {/* Toggle Thème */}
        <button
          className="header-btn"
          onClick={toggleTheme}
          title={theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
          style={{ position: 'relative', overflow: 'hidden' }}
        >
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s',
            transform: theme === 'dark' ? 'rotate(0deg) scale(1)' : 'rotate(20deg) scale(0.8)',
            opacity: theme === 'dark' ? 1 : 0,
            position: 'absolute',
          }}>
            <SunIcon />
          </span>
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.2s',
            transform: theme === 'light' ? 'rotate(0deg) scale(1)' : 'rotate(-20deg) scale(0.8)',
            opacity: theme === 'light' ? 1 : 0,
            position: 'absolute',
          }}>
            <MoonIcon />
          </span>
        </button>

        {/* Notifications */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <button className="header-btn" onClick={openNotifications} title={t('nav.notifications')}>
            <BellIcon />
            {unreadCount > 0 && <span className="badge-dot" />}
          </button>

          {showNotif && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 10px)', right: 0,
              width: 380, maxHeight: 480, overflowY: 'auto',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--border-radius-lg)',
              boxShadow: 'var(--shadow-xl)',
              zIndex: 200,
              animation: 'slideUp var(--transition-spring)',
            }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
              }}>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-md)' }}>
                  {t('nav.notifications')} {unreadCount > 0 && <span style={{ color: 'var(--color-danger)', fontSize: 'var(--font-xs)' }}>({unreadCount})</span>}
                </span>
                {unreadCount > 0 && (
                  <button onClick={handleMarkAllRead} style={{
                    background: 'none', border: 'none', color: 'var(--color-primary-light)',
                    fontSize: 'var(--font-xs)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
                  }}>
                    Tout marquer lu
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                  Aucune notification
                </div>
              ) : (
                notifications.map((notif) => (
                  <div key={notif.id} style={{
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: notif.is_read ? 'transparent' : 'var(--color-primary-10)',
                    cursor: 'pointer',
                    transition: 'background var(--transition-fast)',
                  }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50', marginTop: 6, flexShrink: 0,
                        background: priorityColors[notif.priority] || '#6366F1',
                        borderRadius: '50%',
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                          {notif.title}
                        </p>
                        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {notif.message}
                        </p>
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                          {new Date(notif.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Info utilisateur */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 12px',
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--border-radius-sm)',
          border: '1px solid var(--border-subtle)',
          cursor: 'default',
        }}>
          <div className="avatar avatar-sm" style={{ background: 'var(--color-primary-20)', color: 'var(--color-primary-light)', fontWeight: 700, fontSize: 11 }}>
            {(user?.firstName?.[0] || '') + (user?.lastName?.[0] || '')}
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {user?.firstName} {user?.lastName}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {user?.establishmentCode}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
