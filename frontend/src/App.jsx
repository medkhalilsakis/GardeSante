import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store';
import AppLayout from './components/layout/AppLayout';
import './index.css';

// Lazy load pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const SchedulesPage = lazy(() => import('./pages/schedules/SchedulesPage'));
const ScheduleDetailPage = lazy(() => import('./pages/schedules/ScheduleDetailPage'));
const ShiftsPage = lazy(() => import('./pages/shifts/ShiftsPage'));
const AbsencesPage = lazy(() => import('./pages/absences/AbsencesPage'));
const ReplacementsPage = lazy(() => import('./pages/replacements/ReplacementsPage'));
const StatisticsPage = lazy(() => import('./pages/statistics/StatisticsPage'));
const UsersPage = lazy(() => import('./pages/users/UsersPage'));
const DepartmentsPage = lazy(() => import('./pages/departments/DepartmentsPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));

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

// Loading spinner
const PageLoader = () => (
  <div style={{
    height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-base)',
  }}>
    <div style={{ textAlign: 'center' }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2"
        className="animate-spin" style={{ display: 'block', margin: '0 auto 16px' }}>
        <path d="M21 12a9 9 0 11-6.219-8.56"/>
      </svg>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Chargement...</p>
    </div>
  </div>
);

// Route protégée
function ProtectedRoute({ children, permission }) {
  const { isAuthenticated, hasPermission } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (permission && !hasPermission(permission)) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        padding: 40,
      }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <p style={{ fontSize: 'var(--font-xl)', fontWeight: 700, color: 'var(--text-primary)' }}>Accès refusé</p>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Vous n'avez pas les permissions nécessaires pour accéder à cette page.</p>
      </div>
    );
  }
  return children;
}

export default function App() {
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

              <Route path="/replacements" element={
                <ProtectedRoute permission="replacements.read">
                  <ReplacementsPage />
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
            </Route>

            {/* 404 */}
            <Route path="*" element={
              <div style={{
                height: '100vh', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)',
              }}>
                <p style={{ fontSize: 'var(--font-5xl)', fontWeight: 900, color: 'var(--color-primary)', marginBottom: 8 }}>404</p>
                <p style={{ color: 'var(--text-secondary)' }}>Page introuvable</p>
                <a href="/dashboard" className="btn btn-primary" style={{ marginTop: 24 }}>Retour au dashboard</a>
              </div>
            } />
          </Routes>
        </Suspense>
      </BrowserRouter>

      {/* Toast notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: '10px',
            fontSize: '13px',
            fontFamily: 'Inter, sans-serif',
            boxShadow: 'var(--shadow-xl)',
          },
          success: { iconTheme: { primary: '#10B981', secondary: '#fff' } },
          error: { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
        }}
      />
    </QueryClientProvider>
  );
}
