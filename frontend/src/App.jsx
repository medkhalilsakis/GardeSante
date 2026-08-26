import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useAuthStore, useUIStore } from './store';
import AppLayout from './components/layout/AppLayout';
import { PageLoader, AccessDenied, NotFound } from './components/layout/AppStates';
import './index.css';

const LoginPage                = lazy(() => import('./pages/auth/LoginPage'));
const DashboardPage            = lazy(() => import('./pages/dashboard/DashboardPage'));
const DirectorDashboard        = lazy(() => import('./pages/director/DirectorDashboard'));
const SuperAdminDashboard      = lazy(() => import('./pages/superadmin/SuperAdminDashboard'));
const SuperAdminMapPage        = lazy(() => import('./pages/superadmin/SuperAdminMapPage'));
const SchedulesPage            = lazy(() => import('./pages/schedules/SchedulesPage'));
const ScheduleDetailPage       = lazy(() => import('./pages/schedules/ScheduleDetailPage'));
const ShiftsPage               = lazy(() => import('./pages/shifts/ShiftsPage'));
const AbsencesPage             = lazy(() => import('./pages/absences/AbsencesPage'));
const StatisticsPage           = lazy(() => import('./pages/statistics/StatisticsPage'));
const UsersPage                = lazy(() => import('./pages/users/UsersPage'));
const DepartmentsPage          = lazy(() => import('./pages/departments/DepartmentsPage'));
const SettingsPage             = lazy(() => import('./pages/settings/SettingsPage'));
const ProfilePage              = lazy(() => import('./pages/profile/ProfilePage'));
const ProfileRequestsAdminPage = lazy(() => import('./pages/profile/ProfileRequestsAdminPage'));
const HistoryPage              = lazy(() => import('./pages/history/HistoryPage'));
const ChefDeServiceDashboard   = lazy(() => import('./pages/schedules/ChefDeServiceDashboard'));
const SurveillantDashboard     = lazy(() => import('./pages/surveillant/SurveillantDashboard'));
const GeneralSupervisorDashboard = lazy(() => import('./pages/supervision/GeneralSupervisorDashboard'));
const PlanningInboxPage        = lazy(() => import('./pages/surveillant/PlanningInboxPage'));
const StaffLoansPage           = lazy(() => import('./pages/staff-loans/StaffLoansPage'));
const NotificationsPage        = lazy(() => import('./pages/notifications/NotificationsPage'));
const AppelDuJourPage          = lazy(() => import('./pages/appel/AppelDuJourPage'));
const NotesPage                = lazy(() => import('./pages/notes/NotesPage'));
const ServicePortfolioPage     = lazy(() => import('./pages/portfolio/ServicePortfolioPage'));
const IncidentsPage            = lazy(() => import('./pages/incidents/IncidentsPage'));

// Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
      refetchOnWindowFocus: false,
    },
  },
});

// Route protégée
function ProtectedRoute({ children, permission, roles }) {
  const { isAuthenticated, hasPermission, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if ((permission && !hasPermission(permission)) || (roles && !roles.includes(user?.roleCode))) {
    return <AccessDenied permission={permission} />;
  }
  return children;
}

export default function App() {
  const { theme } = useUIStore();

  // Appliquer le thème persisté au chargement de l'app
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme || 'light');
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* App — Layout principal */}
            <Route element={
              <AppLayout
                title="GardeSante"
                subtitle="Tableau de bord"
              />
            }>
              <Route path="/dashboard" element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              } />

              {/* Super Admin — tableau de bord global */}
              <Route path="/admin" element={
                <ProtectedRoute roles={['super_admin']}>
                  <SuperAdminDashboard />
                </ProtectedRoute>
              } />

              {/* Super Admin — consultation cartographique des établissements */}
              <Route path="/admin/carte" element={
                <ProtectedRoute roles={['super_admin']}>
                  <SuperAdminMapPage />
                </ProtectedRoute>
              } />

              {/* Dashboard Directeur — /director et /director/:section */}
              <Route path="/director" element={
                <ProtectedRoute>
                  <DirectorDashboard />
                </ProtectedRoute>
              } />
              <Route path="/director/:section" element={
                <ProtectedRoute>
                  <DirectorDashboard />
                </ProtectedRoute>
              } />

              <Route path="/schedules" element={
                <ProtectedRoute permission="schedules.read">
                  <SchedulesPage />
                </ProtectedRoute>
              } />

              <Route path="/schedules/:id" element={
                <ProtectedRoute permission="schedules.read">
                  <ScheduleDetailPage />
                </ProtectedRoute>
              } />

              <Route path="/shifts" element={
                <ProtectedRoute permission="shifts.read">
                  <ShiftsPage />
                </ProtectedRoute>
              } />

              <Route path="/absences" element={
                <ProtectedRoute permission="absences.read">
                  <AbsencesPage />
                </ProtectedRoute>
              } />


              <Route path="/statistics" element={
                <ProtectedRoute permission="stats.read">
                  <StatisticsPage />
                </ProtectedRoute>
              } />

              <Route path="/users" element={
                <ProtectedRoute permission="users.read">
                  <UsersPage />
                </ProtectedRoute>
              } />

              <Route path="/departments" element={
                <ProtectedRoute permission="departments.read">
                  <DepartmentsPage />
                </ProtectedRoute>
              } />

              <Route path="/settings" element={
                <ProtectedRoute>
                  <SettingsPage />
                </ProtectedRoute>
              } />



              {/* Historique — tous les utilisateurs */}
              <Route path="/history" element={
                <ProtectedRoute>
                  <HistoryPage />
                </ProtectedRoute>
              } />

              {/* Mon Profil */}
              <Route path="/profile" element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              } />

              {/* Super Admin — demandes de modification profil */}
              <Route path="/admin/profile-requests" element={
                <ProtectedRoute roles={['super_admin']}>
                  <ProfileRequestsAdminPage />
                </ProtectedRoute>
              } />
              {/* Chef de Service — tableau de bord planning */}
              <Route path="/chef-de-service" element={
                <ProtectedRoute>
                  <ChefDeServiceDashboard />
                </ProtectedRoute>
              } />

              {/* Surveillant de service — journal, alertes et suivi des gardes courantes */}
              <Route path="/surveillant" element={
                <ProtectedRoute>
                  <SurveillantDashboard />
                </ProtectedRoute>
              } />

              {/* Surveillant général — supervision de tous les services de l'hôpital */}
              <Route path="/supervision" element={
                <ProtectedRoute>
                  <GeneralSupervisorDashboard />
                </ProtectedRoute>
              } />

              {/* Espace « Planning à consulter » — indépendant du dashboard surveillant */}
              <Route path="/planning-a-consulter" element={
                <ProtectedRoute>
                  <PlanningInboxPage />
                </ProtectedRoute>
              } />

              {/* Gestion des prêts de personnel — interface dédiée */}
              <Route path="/staff-loans" element={
                <ProtectedRoute>
                  <StaffLoansPage />
                </ProtectedRoute>
              } />

              {/* Gestion des notifications — interface dédiée, tous les rôles */}
              <Route path="/notifications" element={
                <ProtectedRoute>
                  <NotificationsPage />
                </ProtectedRoute>
              } />

              {/* Appel du jour — présence / absence en garde courante (point 6).
                  Chef, surveillant, SG et directeur ; le filtrage fin est fait
                  dans la page et, surtout, par le serveur. */}
              <Route path="/appel-du-jour" element={
                <ProtectedRoute>
                  <AppelDuJourPage />
                </ProtectedRoute>
              } />

              <Route path="/incidents" element={
                <ProtectedRoute>
                  <IncidentsPage />
                </ProtectedRoute>
              } />

              {/* Portfolio du service (point 5) — lecture seule.
                  Ouverte à tous : `GET /api/portfolio` borne déjà la réponse au
                  périmètre de l'appelant et refuse les rôles non autorisés. */}
              <Route path="/portfolio" element={
                <ProtectedRoute>
                  <ServicePortfolioPage />
                </ProtectedRoute>
              } />

              {/* Notes et circulaires — interface indépendante (point 7).
                  Ouverte à tous : le serveur décide de ce que chacun voit. */}
              <Route path="/notes" element={
                <ProtectedRoute>
                  <NotesPage />
                </ProtectedRoute>
              } />

            </Route>

            {/* 404 */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--gs-paper)',
            color: 'var(--gs-ink)',
            border: '1px solid var(--gs-rule-strong)',
            borderRadius: '10px',
            fontSize: '13px',
            fontFamily: 'var(--gs-body)',
            boxShadow: 'var(--gs-shadow-lift)',
          },
          // Les deux seules couleurs qu'un message d'état peut porter : ce qui
          // est fait (« de service ») et ce qui bloque.
          success: { iconTheme: { primary: 'var(--gs-duty)', secondary: 'var(--gs-paper)' } },
          error: { iconTheme: { primary: 'var(--gs-alert)', secondary: 'var(--gs-paper)' } },
        }}
      />
    </QueryClientProvider>
  );
}
