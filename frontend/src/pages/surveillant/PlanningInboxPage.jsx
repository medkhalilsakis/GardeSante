/**
 * « Planning à consulter » — espace indépendant du surveillant de service (point 3).
 *
 * Le surveillant y retrouve les plannings de SES services une fois envoyés par
 * le chef. Il n'y a ni approbation ni refus (point 4) : deux actions seulement,
 * consulter en lecture seule et proposer une modification.
 *
 * Page NEUVE : le dashboard surveillant existant n'est pas modifié. Tout ce qui
 * est affiché ici réutilise des briques déjà livrées :
 *   - `PlanningStateBadge`    → état dérivé (planning_state côté serveur)
 *   - `SchedulePreviewModal`  → consultation lecture seule du tableur
 *   - `SmartSpreadsheet`      → ouverture en mode proposition (le composant
 *                               active `canProposeChanges` pour les surveillants
 *                               dès que le planning est en vigueur ou en cours)
 *   - `ScheduleChangeProposals` → suivi des propositions déjà envoyées
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import { scheduleInboxAPI } from '../../api';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import ContextBadge from '../../components/layout/ContextBadge';
import SchedulePreviewModal from '../replacements/components/SchedulePreviewModal';
import ScheduleChangeProposals from '../schedules/components/ScheduleChangeProposals';
import SmartSpreadsheet from '../schedules/components/SmartSpreadsheet';

const STATE_FILTERS = [
  { id: '',          label: 'Tous' },
  { id: 'soumis',    label: 'En vigueur' },
  { id: 'en_cours',  label: 'En cours' },
  { id: 'termine',   label: 'Terminés' },
];

const fmt = (d) => {
  if (!d) return '—';
  // Les dates arrivent déjà en 'YYYY-MM-DD' (TO_CHAR côté serveur) : on les
  // découpe à la main plutôt que via `new Date()`, qui décale d'un jour.
  const [y, m, day] = String(d).split('-');
  return `${day}/${m}/${y}`;
};

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

const btn = (primary) => ({
  padding: '7px 13px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  border: `1px solid ${primary ? 'var(--color-primary)' : 'var(--border-default)'}`,
  background: primary ? 'var(--color-primary)' : 'var(--bg-elevated)',
  color: primary ? '#fff' : 'var(--text-secondary)',
});

export default function PlanningInboxPage() {
  const { user } = useAuthStore();
  const [state, setState] = useState('');
  const [previewSchedule, setPreviewSchedule] = useState(null);
  const [proposalsFor, setProposalsFor] = useState(null);
  const [editing, setEditing] = useState(null); // { id, departmentId } → tableur

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['schedule-inbox', state],
    queryFn: () => scheduleInboxAPI.getAll(state ? { state } : {}).then((r) => r.data),
  });

  const schedules = data?.data?.schedules || [];
  const forbidden = error?.response?.status === 403;

  const counts = useMemo(() => {
    const c = { soumis: 0, en_cours: 0, termine: 0, proposals: 0 };
    schedules.forEach((s) => {
      if (c[s.state] !== undefined) c[s.state] += 1;
      c.proposals += s.pendingProposals || 0;
    });
    return c;
  }, [schedules]);

  // Le surveillant ne propose que sur un planning en vigueur ou en cours :
  // même règle que la gate du tableur, pour ne pas afficher un bouton mort.
  const canPropose = (s) =>
    ['submitted', 'active'].includes(s.status) &&
    ['service_supervisor', 'general_supervisor'].includes(user?.roleCode);

  // Tableur ouvert en plein écran : on remplace la liste, comme le fait le
  // dashboard du chef de service, et on revient par « Retour ».
  if (editing) {
    return (
      <SmartSpreadsheet
        scheduleId={editing.id}
        departmentId={editing.departmentId}
        onBack={() => setEditing(null)}
        onManageProposals={() => setProposalsFor(editing.id)}
      />
    );
  }

  return (
    <div>
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Planning à consulter</h1>
          <p className="page-subtitle">
            Plannings envoyés par les chefs de service — consultation et propositions de modification
          </p>
        </div>
      </div>

      {forbidden ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          Cet espace est réservé aux surveillants et à la hiérarchie du service.
        </div>
      ) : (
        <>
          {/* Filtres par état dérivé */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {STATE_FILTERS.map((f) => (
              <button
                key={f.id || 'all'}
                onClick={() => setState(f.id)}
                style={{
                  ...btn(state === f.id),
                  padding: '6px 14px',
                }}
              >
                {f.label}
                {f.id && counts[f.id] ? ` (${counts[f.id]})` : ''}
              </button>
            ))}
            {counts.proposals > 0 && (
              <span style={{
                marginLeft: 'auto', alignSelf: 'center', fontSize: 12, fontWeight: 700,
                color: '#92400E', background: '#FEF3C7', border: '1px solid #FDE68A',
                borderRadius: 999, padding: '4px 12px',
              }}>
                {counts.proposals} proposition(s) en attente de décision
              </span>
            )}
          </div>

          {isLoading ? (
            <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Chargement des plannings…
            </div>
          ) : isError ? (
            <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--color-danger)' }}>
              Impossible de charger les plannings à consulter.
            </div>
          ) : schedules.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Aucun planning à consulter pour le moment.
              <div style={{ fontSize: 12, marginTop: 6 }}>
                Les plannings apparaissent ici dès que le chef de service les envoie.
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {schedules.map((s) => (
                <div key={s.id} style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{s.name}</span>
                        <PlanningStateBadge state={s.state} status={s.status} startDate={s.startDate} endDate={s.endDate} size="sm" />
                        {s.pendingProposals > 0 && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, color: '#92400E', background: '#FEF3C7',
                            border: '1px solid #FDE68A', borderRadius: 999, padding: '1px 9px',
                          }}>
                            {s.pendingProposals} en attente
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {s.departmentName || 'Service —'} · {fmt(s.startDate)} → {fmt(s.endDate)}
                        {s.authorName ? ` · envoyé par ${s.authorName}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
                        {s.guardCount} garde(s) · {s.staffCount} agent(s)
                        {s.myProposals > 0 ? ` · ${s.myProposals} proposition(s) de ma part` : ''}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button style={btn(false)} onClick={() => setPreviewSchedule(s)}>
                        👁 Consulter
                      </button>
                      {canPropose(s) && (
                        <button
                          style={btn(true)}
                          onClick={() => setEditing({ id: s.id, departmentId: s.departmentId })}
                        >
                          ✏️ Proposer une modification
                        </button>
                      )}
                      <button style={btn(false)} onClick={() => setProposalsFor(s.id)}>
                        📋 Propositions
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {previewSchedule && (
        <SchedulePreviewModal schedule={previewSchedule} onClose={() => setPreviewSchedule(null)} />
      )}
      {proposalsFor && (
        <ScheduleChangeProposals scheduleId={proposalsFor} onClose={() => setProposalsFor(null)} />
      )}
    </div>
  );
}
