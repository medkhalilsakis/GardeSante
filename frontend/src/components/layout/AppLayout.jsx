import React, { useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import { useAuthStore, useUIStore, useNotificationStore } from '../../store';
import { authAPI, notificationsAPI } from '../../api';
import { useRealtime } from '../../hooks/useRealtime';
import Sidebar from './Sidebar';
import Header from './Header';

export default function AppLayout({ title = 'GardeSante', subtitle, headerActions }) {
  const { isAuthenticated } = useAuthStore();
  const updateUser = useAuthStore((s) => s.updateUser);
  const { sidebarCollapsed, language, direction } = useUIStore();
  const { unreadCount, setNotifications } = useNotificationStore();

  // Temps réel — invalide automatiquement les queries react-query
  useRealtime();

  // Appliquer la direction RTL
  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = language;
  }, [direction, language]);

  // Rafraîchir l'appartenance (hôpital + services) au montage. Le store zustand
  // est persisté : après une réaffectation par le directeur, la session en cours
  // afficherait sinon l'ancien service dans le badge de contexte. On ne fusionne
  // que les champs concernés pour ne rien écraser du profil déjà en place.
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    authAPI.me()
      .then((res) => {
        const me = res.data?.data;
        if (cancelled || !me) return;
        updateUser({
          permissions: me.permissions || [],
          departments: me.departments || [],
          establishmentId: me.establishment_id,
          establishmentName: me.establishment_name,
          establishmentNameAr: me.establishment_name_ar,
          establishmentCode: me.establishment_code,
        });
      })
      .catch(() => {}); // hors ligne ou 401 : l'intercepteur axios gère déjà la session
    return () => { cancelled = true; };
  }, [isAuthenticated, updateUser]);

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
