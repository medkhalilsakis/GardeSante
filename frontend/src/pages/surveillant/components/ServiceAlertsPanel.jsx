/**
 * Alertes de service (Lot 4) — personnel absent, garde non couverte,
 * remplacement en attente, urgence.
 *
 * Les alertes ne se créent pas ici : elles naissent des signalements d'absence
 * et des écritures du journal (incident grave, demande de renfort). Ce panneau
 * ne fait que les lire, les prendre en compte et les résoudre.
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCircle2, Eye, GitCompareArrows, RefreshCw, ShieldAlert, Siren, UserPlus, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import { journalAPI } from '../../../api';

// Clés strictement alignées sur la contrainte chk_alert_type (migration 021).
const TYPE_META = {
  staff_absent:        { label: 'Personnel absent',       emoji: '🚫' },
  shift_uncovered:     { label: 'Garde non couverte',     emoji: '🕳️' },
  replacement_pending: { label: 'Remplacement en attente', emoji: '🔄' },
  insufficient_staff:  { label: 'Renfort demandé',        emoji: '🆘' },
  urgent_notification: { label: 'Urgence',                emoji: '🚨' },
  conflict_detected:   { label: 'Conflit détecté',        emoji: '⚔️' },
};

const SEVERITY_META = {
  urgent:   { label: 'Urgent',   color: '#DC2626', bg: 'rgba(220, 38, 38, .10)' },
  critical: { label: 'Critique', color: '#DC2626', bg: 'rgba(220, 38, 38, .08)' },
  error:    { label: 'Grave',    color: '#EF4444', bg: 'rgba(239, 68, 68, .08)' },
  warning:  { label: 'Vigilance', color: '#F59E0B', bg: 'rgba(245, 158, 11, .08)' },
  info:     { label: 'Info',     color: '#6366F1', bg: 'rgba(99, 102, 241, .08)' },
};

const WORKSPACE_TYPE_ICONS = {
  staff_absent: UserX,
  shift_uncovered: ShieldAlert,
  replacement_pending: RefreshCw,
  insufficient_staff: UserPlus,
  urgent_notification: Siren,
  conflict_detected: GitCompareArrows,
};

const VIEWS = [
  { value: 'open',  label: 'Ouvertes',  resolved: 'false' },
  { value: 'done',  label: 'Résolues',  resolved: 'true' },
  { value: 'all',   label: 'Toutes',    resolved: 'all' },
];

export default function ServiceAlertsPanel({ departmentId, canAct = false, title = 'Alertes de service', variant = 'default' }) {
  const qc = useQueryClient();
  const [view, setView] = useState('open');

  const params = useMemo(() => {
    const p = { limit: 100, resolved: VIEWS.find((v) => v.value === view)?.resolved };
    if (departmentId) p.departmentId = departmentId;
    return p;
  }, [view, departmentId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journal-alerts', params],
    queryFn: () => journalAPI.getAlerts(params),
  });

  const act = useMutation({
    mutationFn: ({ id, action }) => journalAPI.updateAlert(id, action),
    onSuccess: (_r, { action }) => {
      toast.success(action === 'resolve' ? 'Alerte résolue' : 'Alerte prise en compte');
      qc.invalidateQueries({ queryKey: ['journal-alerts'] });
      qc.invalidateQueries({ queryKey: ['journal-overview'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Action impossible'),
  });

  const payload = data?.data?.data;
  const alerts = payload?.alerts || [];
  const isForbidden = error?.response?.status === 403;

  const critical = alerts.filter((a) => ['critical', 'urgent'].includes(a.severity)).length;

  const isWorkspace = variant === 'workspace';

  return (
    <div className={`service-alerts-panel${isWorkspace ? ' service-alerts-panel-workspace' : ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="service-alerts-panel-heading" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div className="service-alerts-panel-title-block" style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            {payload?.scopeLabel || 'Portée déduite de votre rôle'}
            {critical > 0 ? ` · ${critical} critique(s)` : ''}
          </p>
        </div>
        <div className="service-alerts-panel-tabs" style={{ display: 'flex', gap: 6 }}>
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={view === v.value ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {isForbidden ? (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Les alertes ne sont pas accessibles avec votre rôle.
        </div>
      ) : isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          Les alertes n'ont pas pu être chargées.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Chargement des alertes…
        </div>
      ) : alerts.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          {view === 'open' ? (isWorkspace ? 'Aucune alerte ouverte' : '✅ Aucune alerte ouverte') : 'Aucune alerte'}
        </div>
      ) : (
        <div className="service-alerts-panel-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {alerts.map((a) => {
            const meta = TYPE_META[a.type] || { label: a.type, emoji: '🔔' };
            const sev = SEVERITY_META[a.severity] || SEVERITY_META.info;
            const TypeIcon = WORKSPACE_TYPE_ICONS[a.type] || BellRing;
            return (
              <div key={a.id} className="service-alerts-panel-item" style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                background: a.resolvedAt ? 'var(--bg-card)' : sev.bg,
                border: '1px solid var(--border-subtle)',
                borderLeft: isWorkspace ? undefined : `3px solid ${a.resolvedAt ? 'var(--border-default)' : sev.color}`,
                borderInlineStart: isWorkspace ? `3px solid ${a.resolvedAt ? 'var(--border-default)' : sev.color}` : undefined,
                borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
                opacity: a.resolvedAt ? 0.75 : 1,
              }}>
                {isWorkspace ? <span className="service-alerts-panel-type-icon" style={{ '--alert-tone': sev.color, '--alert-tone-bg': sev.bg }}><TypeIcon size={15} /></span> : <span style={{ fontSize: 18, lineHeight: 1.1 }}>{meta.emoji}</span>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {a.title}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: sev.color,
                      border: `1px solid ${sev.color}`, borderRadius: 6, padding: '1px 6px',
                    }}>
                      {sev.label}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>
                      {meta.label}
                    </span>
                  </div>
                  {a.message && (
                    <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginTop: 3 }}>
                      {a.message}
                    </p>
                  )}
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                    {a.departmentName || '—'}
                    {a.acknowledgedBy ? ` · pris en compte par ${a.acknowledgedBy}` : ''}
                    {a.resolvedAt ? ' · résolue' : ''}
                  </p>
                </div>
                {canAct && !a.resolvedAt && (
                  <div className="service-alerts-panel-actions" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {!a.acknowledgedAt && (
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: 'acknowledge' })}
                      >
                        {isWorkspace && <Eye size={13} />}
                        Prendre en compte
                      </button>
                    )}
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: a.id, action: 'resolve' })}
                    >
                      {isWorkspace && <CheckCircle2 size={13} />}
                      Résoudre
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
