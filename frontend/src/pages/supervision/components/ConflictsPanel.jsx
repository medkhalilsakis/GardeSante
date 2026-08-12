/**
 * Cohérence inter-services (Lot 5) — ce que seul le surveillant général voit,
 * un chef n'ayant de visibilité que sur son propre service.
 *
 * Trois familles calculées côté serveur : double affectation, garde posée sur
 * un agent en congé (règle I), journée sans garde. Panneau de lecture : la
 * correction se demande au chef via une proposition de modification.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supervisionAPI } from '../../../api';

const TYPE_META = {
  double_booking: { label: 'Double affectation', emoji: '⚔️' },
  on_leave:       { label: 'Garde pendant un congé', emoji: '🌴' },
  uncovered_day:  { label: 'Journée sans garde', emoji: '🕳️' },
};

const SEVERITY_META = {
  critical: { label: 'Critique',  color: '#DC2626', bg: 'rgba(220, 38, 38, .08)' },
  error:    { label: 'Grave',     color: '#EF4444', bg: 'rgba(239, 68, 68, .07)' },
  warning:  { label: 'Vigilance', color: '#F59E0B', bg: 'rgba(245, 158, 11, .07)' },
  info:     { label: 'Info',      color: '#6366F1', bg: 'rgba(99, 102, 241, .07)' },
};

export default function ConflictsPanel({ onRequestCorrection }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['supervision-conflicts'],
    queryFn: () => supervisionAPI.getConflicts(),
  });

  const payload = data?.data?.data;
  const conflicts = payload?.conflicts || [];
  const summary = payload?.summary || {};
  const isForbidden = error?.response?.status === 403;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
          Cohérence inter-services
        </h3>
        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
          {payload
            ? `${payload.schedulesAnalyzed} planning(s) analysé(s) · ${summary.total || 0} anomalie(s)`
            : 'Analyse des plannings soumis et en cours'}
        </p>
      </div>

      {!!payload && summary.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {[
            { label: 'Critiques', value: summary.critical || 0, color: '#DC2626' },
            { label: 'Doubles affectations', value: summary.doubleBooking || 0, color: '#EF4444' },
            { label: 'Gardes en congé', value: summary.onLeave || 0, color: '#F59E0B' },
            { label: 'Plannings à trous', value: summary.uncovered || 0, color: '#6366F1' },
          ].map((k) => (
            <div key={k.label} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-default)',
              borderTop: `3px solid ${k.color}`, borderRadius: 'var(--border-radius-sm)', padding: '10px 12px',
            }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {k.label}
              </p>
              <p style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>{k.value}</p>
            </div>
          ))}
        </div>
      )}

      {isForbidden ? (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          L'analyse de cohérence est réservée à la supervision générale et à la direction.
        </div>
      ) : isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          L'analyse n'a pas pu être chargée.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Analyse des plannings…
        </div>
      ) : conflicts.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          ✅ Aucune incohérence détectée sur les plannings soumis et en cours
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {conflicts.map((c, i) => {
            const meta = TYPE_META[c.type] || { label: c.type, emoji: '⚠️' };
            const sev = SEVERITY_META[c.severity] || SEVERITY_META.info;
            return (
              <div key={`${c.type}-${c.date}-${c.userId || i}`} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                background: sev.bg, border: '1px solid var(--border-subtle)',
                borderLeft: `3px solid ${sev.color}`,
                borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
              }}>
                <span style={{ fontSize: 18, lineHeight: 1.1 }}>{meta.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {c.title}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: sev.color,
                      border: `1px solid ${sev.color}`, borderRadius: 6, padding: '1px 6px',
                    }}>
                      {sev.label}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{meta.label}</span>
                  </div>
                  <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginTop: 3 }}>
                    {c.detail}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                    {c.date}{c.staffName ? ` · ${c.staffName}` : ''}
                  </p>
                </div>
                {onRequestCorrection && c.schedules?.[0] && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => onRequestCorrection(c.schedules[0])}
                  >
                    Demander correction
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
