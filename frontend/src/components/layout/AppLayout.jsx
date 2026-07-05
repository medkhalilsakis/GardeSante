import React, { useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuthStore, useUIStore, useNotificationStore } from '../../store';
import { notificationsAPI } from '../../api';
import Sidebar from './Sidebar';
import Header from './Header';

export default function AppLayout({ title = 'GardeSante', subtitle, headerActions }) {
  const { isAuthenticated } = useAuthStore();
  const { sidebarCollapsed, language, direction } = useUIStore();
  const { unreadCount, setNotifications } = useNotificationStore();

  // Appliquer la direction RTL
  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = language;
  }, [direction, language]);

  // Charger le compteur de notifications
  useEffect(() => {
    if (!isAuthenticated) return;
    const loadNotifications = async () => {
      try {
        const res = await notificationsAPI.getAll({ unreadOnly: true, limit: 5 });
        setNotifications(res.data.data, res.data.unreadCount);
      } catch {}
    };
    loadNotifications();
    const interval = setInterval(loadNotifications, 60000); // refresh toutes les 60s
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout" dir={direction}>
      <Sidebar unreadCount={unreadCount} />
      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <Header title={title} subtitle={subtitle} actions={headerActions} />
        <main className="page-container">
          <div className="animate-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
