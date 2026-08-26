import React, { useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, useUIStore, useNotificationStore } from '../../store';
import { authAPI, notificationsAPI } from '../../api';
import { useRealtime } from '../../hooks/useRealtime';
import Sidebar from './Sidebar';
import Header from './Header';
import UrgentNotesBanner from '../notes/UrgentNotesBanner';
import './app-shell.css';

export default function AppLayout({ title = 'GardeSante', subtitle, headerActions }) {
  const { isAuthenticated } = useAuthStore();
  const updateUser = useAuthStore((s) => s.updateUser);
  const { sidebarCollapsed, language, direction } = useUIStore();
  const { unreadCount, setNotifications } = useNotificationStore();
  // Sous 900 px la barre latérale n'est plus une colonne mais un tiroir. Son
  // ouverture est un état de la coque, pas une préférence : elle ne rejoint pas
  // le store persisté, elle se referme à chaque changement de page.
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

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

  // Le tiroir se referme dès qu'on a navigué : il a fait son travail, et le
  // laisser ouvert masquerait la page qu'on vient de demander.
  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  // Ouvert, le tiroir recouvre la page : Échap le referme, et le défilement du
  // corps est gelé pour qu'on ne fasse pas glisser le contenu sous le voile.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [navOpen]);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout" dir={direction} data-nav={navOpen ? 'open' : undefined}>
      {/* Première tabulation de la page : sauter la navigation pour aller au
          contenu. Le lien reste invisible jusqu'à ce qu'il reçoive le focus. */}
      <a className="gsh-skip" href="#gs-main">Aller au contenu</a>

      <Sidebar unreadCount={unreadCount} navOpen={navOpen} onCloseNav={() => setNavOpen(false)} />

      {/* Le voile n'existe que pendant l'ouverture du tiroir : il ferme au clic
          et rappelle que la page derrière est momentanément hors service. */}
      {navOpen && (
        <div className="gsh-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}

      <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <Header
          title={title}
          subtitle={subtitle}
          actions={headerActions}
          navOpen={navOpen}
          onOpenNav={() => setNavOpen(true)}
        />
        <main className="page-container" id="gs-main">
          <UrgentNotesBanner />
          <div className="animate-in">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
