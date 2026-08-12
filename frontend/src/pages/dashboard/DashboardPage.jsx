import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { statisticsAPI, shiftsAPI, schedulesAPI, replacementsAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, getStatusBadgeClass, exportToPDF, exportToExcel } from '../../utils/helpers';
import ContextBadge from '../../components/layout/ContextBadge';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts';
import toast from 'react-hot-toast';

// ============================================================
// COMPOSANT COMMUN: KPI Card
// ============================================================
export const KpiCard = ({ icon, label, value, sublabel, color = 'var(--color-primary)', trend, loading }) => (
  <div className="kpi-card" style={{ '--kpi-color': color, '--kpi-color-10': `${color}18` }}>
    <div className="kpi-icon">{icon}</div>
    {loading ? (
      <div className="skeleton" style={{ height: 36, width: 80, marginBottom: 8 }} />
    ) : (
      <div className="kpi-value">{value}</div>
    )}
    <div className="kpi-label">{label}</div>
    {sublabel && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 4 }}>{sublabel}</div>}
    {trend !== undefined && (
      <div className={`kpi-change ${trend >= 0 ? 'up' : 'down'}`}>
        {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
      </div>
    )}
  </div>
);

// ============================================================
// TOOLTIP PERSONNALISÉ pour Recharts
// ============================================================
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-default)',
      borderRadius: 8, padding: '10px 14px', fontSize: 'var(--font-xs)',
    }}>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

// ============================================================
// DASHBOARD PRINCIPAL
// ============================================================
export default function DashboardPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isManagement   = ['super_admin', 'hospital_admin', 'director', 'general_supervisor'].includes(user?.roleCode);
  const isDepartmentHead = user?.roleCode === 'department_head';
  const isDoctor       = ['senior_doctor', 'resident'].includes(user?.roleCode);

  // ── Redirections par rôle ──────────────────────────────────
  useEffect(() => {
    if (user?.roleCode === 'super_admin') navigate('/admin', { replace: true });
    else if (user?.roleCode === 'director') navigate('/director', { replace: true });
  }, [user?.roleCode]);

  // ── Eviter de charger si on va être redirigé ──────────────
  const willRedirect = user?.roleCode === 'super_admin' || user?.roleCode === 'director';


  // KPIs
  const { data: dashData, isLoading: loadingDash } = useQuery({
    queryKey: ['dashboard', user?.establishmentId],
    queryFn: () => statisticsAPI.getDashboard().then(r => r.data.data),
    refetchInterval: 30000,
    enabled: !willRedirect,
  });

  // Gardes du jour
  const { data: todayShifts = [], isLoading: loadingShifts } = useQuery({
    queryKey: ['today-shifts'],
    queryFn: () => shiftsAPI.getToday().then(r => r.data.data),
    refetchInterval: 60000,
    enabled: !willRedirect,
  });

  // Plannings en attente (pour les validateurs)
  const { data: pendingSchedules = [] } = useQuery({
    queryKey: ['pending-schedules'],
    queryFn: () => schedulesAPI.getAll({ status: 'submitted', limit: 5 }).then(r => r.data.data),
    enabled: isManagement,
  });

  // Remplacements urgents
  const { data: urgentReplacements = [] } = useQuery({
    queryKey: ['urgent-replacements'],
    queryFn: () => replacementsAPI.getAll({ urgency: 'critical', status: 'pending', limit: 5 }).then(r => r.data.data),
    refetchInterval: 30000,
  });

  // Stats de couverture pour graphique
  const { data: coverageData = [] } = useQuery({
    queryKey: ['coverage'],
    queryFn: () => statisticsAPI.getCoverage().then(r => r.data.data),
    enabled: isManagement || isDepartmentHead,
  });

  // Stats gardes pour graphique
  const { data: shiftStats = [] } = useQuery({
    queryKey: ['shift-stats'],
    queryFn: () => statisticsAPI.getShiftStats().then(r => r.data.data),
    enabled: isManagement || isDepartmentHead,
  });

  const stats = dashData || {};

  // Données graphique gardes du mois (simulé depuis les stats)
  const chartData = shiftStats.slice(0, 8).map(s => ({
    name: `${s.first_name?.[0]}. ${s.last_name}`,
    gardes: parseInt(s.total_shifts) || 0,
    heures: parseFloat(s.total_hours) || 0,
    absences: parseInt(s.absent) || 0,
  }));

  const pieData = coverageData.slice(0, 5).map(d => ({
    name: d.name,
    value: parseFloat(d.coverage_rate) || 0,
  }));

  const COLORS = ['#1B4FCA', '#10B981', '#F59E0B', '#6366F1', '#EC4899'];

  return (
    <div>
      {/* Appartenance — hôpital et service(s). Rien pour le Super Admin. */}
      <ContextBadge variant="header" />

      {/* En-tête */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('dashboard.overview')}</h1>
          <p className="page-subtitle">
            {formatDate(new Date(), 'fr', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}{user?.establishmentName}
          </p>
        </div>
        <div className="quick-actions">
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid mb-6">
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>}
          label={t('dashboard.today_shifts')}
          value={stats.today?.shifts?.total || '—'}
          sublabel={`${stats.today?.shifts?.confirmed || 0} confirmé(s) · ${stats.today?.shifts?.absent || 0} absent(s)`}
          color="var(--color-primary)"
          loading={loadingDash}
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>}
          label={t('dashboard.coverage_rate')}
          value={`${stats.coverage?.coverage_rate || '—'}%`}
          sublabel={`sur les 30 derniers jours`}
          color={
            (stats.coverage?.coverage_rate || 0) >= 90 ? 'var(--color-success)' :
            (stats.coverage?.coverage_rate || 0) >= 70 ? 'var(--color-warning)' :
            'var(--color-danger)'
          }
          loading={loadingDash}
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
          label={t('dashboard.pending_schedules')}
          value={stats.pendingSchedules ?? '—'}
          sublabel="En attente de validation"
          color="var(--color-warning)"
          loading={loadingDash}
        />
        <KpiCard
          icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>}
          label={t('dashboard.open_replacements')}
          value={stats.openReplacements ?? '—'}
          sublabel="Remplaçants recherchés"
          color="var(--color-danger)"
          loading={loadingDash}
        />
        {isManagement && (
          <>
            <KpiCard
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>}
              label={t('dashboard.total_staff')}
              value={stats.staff?.active_staff ?? '—'}
              sublabel={`${stats.staff?.on_leave || 0} en congé`}
              color="var(--color-info)"
              loading={loadingDash}
            />
            <KpiCard
              icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>}
              label="Absences ce mois"
              value={stats.monthAbsences?.total ?? '—'}
              sublabel={`${stats.monthAbsences?.pending || 0} en attente`}
              color="#EC4899"
              loading={loadingDash}
            />
          </>
        )}
      </div>

      {/* Alertes critiques */}
      {urgentReplacements.length > 0 && (
        <div className="alert alert-danger mb-6 animate-in" style={{ flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {urgentReplacements.length} remplacement(s) CRITIQUE(S) nécessaire(s) immédiatement !
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {urgentReplacements.map(r => (
              <a key={r.id} href="/replacements" style={{
                background: 'var(--color-danger-20)', border: '1px solid var(--color-danger)',
                borderRadius: 6, padding: '4px 12px', fontSize: 'var(--font-xs)',
                color: 'var(--color-danger)', fontWeight: 600, textDecoration: 'none',
              }}>
                Dr. {r.absent_last} — {r.department_name} · {formatDate(r.shift_date)}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Contenu principal 2 colonnes */}
      <div style={{ display: 'grid', gridTemplateColumns: isManagement ? '1fr 1fr' : '1fr', gap: 'var(--space-6)', marginBottom: 'var(--space-6)' }}>

        {/* Gardes du jour */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
              Gardes du jour — {formatDate(new Date())}
            </h3>
            <a href="/shifts" style={{ fontSize: 'var(--font-xs)', color: 'var(--color-primary-light)' }}>{t('common.view_all')}</a>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {loadingShifts ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 12 }}>
                  <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ height: 14, width: '60%', marginBottom: 6 }} />
                    <div className="skeleton" style={{ height: 12, width: '40%' }} />
                  </div>
                </div>
              ))
            ) : todayShifts.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                Aucune garde planifiée aujourd'hui
              </div>
            ) : (
              todayShifts.map((shift) => (
                <div key={shift.id} style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'background var(--transition-fast)',
                  cursor: 'default',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div className="avatar avatar-sm" style={{ background: `${shift.shift_color}20`, color: shift.shift_color, flexShrink: 0 }}>
                    {shift.first_name?.[0]}{shift.last_name?.[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      Dr. {shift.first_name} {shift.last_name}
                    </p>
                    <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                      {shift.department_name} · {shift.shift_type_name} · {shift.start_time?.substring(0,5)}–{shift.end_time?.substring(0,5)}
                    </p>
                  </div>
                  <span className={`badge ${getStatusBadgeClass(shift.status)}`}>{t(`status.${shift.status}`)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Graphique gardes par médecin */}
        {(isManagement || isDepartmentHead) && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Répartition des gardes
              </h3>
            </div>
            <div className="card-body" style={{ paddingTop: 0 }}>
              {chartData.length === 0 ? (
                <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                  Pas de données disponibles
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="gardes" fill="var(--color-primary)" radius={[4, 4, 0, 0]} name="Gardes" />
                    <Bar dataKey="absences" fill="var(--color-danger)" radius={[4, 4, 0, 0]} name="Absences" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2ème rangée */}
      <div style={{ display: 'grid', gridTemplateColumns: isManagement ? '1fr 1fr' : '1fr', gap: 'var(--space-6)' }}>

        {/* Plannings en attente */}
        {isManagement && pendingSchedules.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>
                Plannings à valider
              </h3>
              <span className="badge badge-pending">{pendingSchedules.length}</span>
            </div>
            <div>
              {pendingSchedules.map(s => (
                <a key={s.id} href={`/schedules/${s.id}`} style={{ textDecoration: 'none' }}>
                  <div style={{
                    padding: '12px 20px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex', alignItems: 'center', gap: 12,
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</p>
                      <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                        {s.department_name} · {formatDate(s.start_date)} → {formatDate(s.end_date)}
                      </p>
                    </div>
                    <span className={`badge ${getStatusBadgeClass(s.status)}`}>{t(`status.${s.status}`)}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Couverture par service */}
        {(isManagement || isDepartmentHead) && coverageData.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>
                Couverture par service
              </h3>
            </div>
            <div className="card-body">
              {coverageData.map((d, i) => (
                <div key={d.name} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', fontWeight: 500 }}>{d.name}</span>
                    <span style={{
                      fontSize: 'var(--font-xs)', fontWeight: 700,
                      color: (d.coverage_rate || 0) >= 90 ? 'var(--color-success)' :
                             (d.coverage_rate || 0) >= 70 ? 'var(--color-warning)' : 'var(--color-danger)',
                    }}>
                      {d.coverage_rate || 0}%
                    </span>
                  </div>
                  <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(d.coverage_rate || 0, 100)}%`,
                      background: (d.coverage_rate || 0) >= 90 ? 'var(--color-success)' :
                                  (d.coverage_rate || 0) >= 70 ? 'var(--color-warning)' : 'var(--color-danger)',
                      borderRadius: 3,
                      transition: 'width 1s ease',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
