/**
 * Coordination des prêts de personnel inter-service (Lot 5) — lecture seule.
 *
 * La DÉCISION reste au chef du service propriétaire (règle II, Lot 1) : ce
 * panneau ne fait que rendre visible au surveillant général ce qui circule
 * entre les services de son hôpital. Aucun bouton d'acceptation ici, à dessein.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supervisionAPI } from '../../../api';

const STATUS_META = {
  pending:       { label: 'En attente', color: '#F59E0B' },
  approved:      { label: 'Accordé',    color: '#10B981' },
  auto_approved: { label: 'Auto-accordé', color: '#059669' },
  rejected:      { label: 'Refusé',     color: '#DC2626' },
};

const FILTERS = [
  { value: '',        label: 'Tous' },
  { value: 'pending', label: 'En attente' },
  { value: 'approved', label: 'Accordés' },
  { value: 'rejected', label: 'Refusés' },
];

export default function StaffLoansOverview() {
  const [status, setStatus] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['supervision-loans', status],
    queryFn: () => supervisionAPI.getLoans(status ? { status } : undefined),
  });

  const payload = data?.data?.data;
  const loans = payload?.loans || [];
  const summary = payload?.summary || {};
  const isForbidden = error?.response?.status === 403;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
            Prêts de personnel inter-service
          </h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            {summary.total != null
              ? `${summary.total} demande(s) · ${summary.pending || 0} en attente de décision`
              : 'Règle II — la décision revient au chef du service propriétaire'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              onClick={() => setStatus(f.value)}
              className={status === f.value ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {isForbidden ? (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Les prêts de personnel ne sont pas accessibles avec votre rôle.
        </div>
      ) : isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          Les prêts n'ont pas pu être chargés.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Chargement des prêts…
        </div>
      ) : loans.length === 0 ? (
        <div style={{
          padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
        }}>
          Aucun prêt de personnel {status ? 'dans ce statut' : 'enregistré'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loans.map((l) => {
            const meta = STATUS_META[l.status] || { label: l.status, color: '#6366F1' };
            return (
              <div key={l.id} style={{
                display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderLeft: `3px solid ${meta.color}`,
                borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
              }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {l.staffName}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, color: meta.color,
                      border: `1px solid ${meta.color}`, borderRadius: 6, padding: '1px 6px',
                    }}>
                      {meta.label}
                    </span>
                  </div>
                  <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginTop: 3 }}>
                    {l.ownerDepartment} → {l.requestingDepartment}
                    {l.shiftDate ? ` · garde du ${l.shiftDate}` : ''}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                    {l.scheduleName || '—'}
                    {l.requesterName ? ` · demandé par ${l.requesterName}` : ''}
                    {l.ownerName ? ` · propriétaire ${l.ownerName}` : ''}
                  </p>
                  {l.responseReason && (
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>
                      « {l.responseReason} »
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
