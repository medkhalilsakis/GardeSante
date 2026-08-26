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
import { CalendarDays, Eye, FileClock, Pencil, ShieldCheck } from 'lucide-react';
import { GsBadge, GsEmpty, GsFilterBar, GsPageHeader, GsPanel, GsSkeleton, GsStat, GsStatRail } from '../../components/gs';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import ContextBadge from '../../components/layout/ContextBadge';
import SchedulePreviewModal from '../replacements/components/SchedulePreviewModal';
import ScheduleChangeProposals from '../schedules/components/ScheduleChangeProposals';
import SmartSpreadsheet from '../schedules/components/SmartSpreadsheet';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import './PlanningInboxPage.css';

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
      <ErrorBoundary label="Tableur de garde" onBack={() => setEditing(null)}>
        <SmartSpreadsheet
          scheduleId={editing.id}
          departmentId={editing.departmentId}
          onBack={() => setEditing(null)}
          onManageProposals={() => setProposalsFor(editing.id)}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="gsin-page">
      <ContextBadge variant="header" />

      <GsPageHeader
        eyebrow="Registre des plannings"
        title="Planning à consulter"
        subtitle="Plannings envoyés par les chefs de service — consultation et propositions de modification."
        rail={(
          <GsStatRail>
            <GsStat label="En vigueur" value={counts.soumis} tone="seal" />
            <GsStat label="En cours" value={counts.en_cours} tone="duty" />
            <GsStat label="Terminés" value={counts.termine} />
            <GsStat label="Propositions" value={counts.proposals} tone={counts.proposals ? 'alert' : undefined} />
          </GsStatRail>
        )}
      />

      {forbidden ? (
        <GsPanel tone="alert">
          <GsEmpty icon={<ShieldCheck size={27} />} title="Accès réservé" hint="Cet espace est réservé aux surveillants et à la hiérarchie du service." />
        </GsPanel>
      ) : (
        <>
          <GsFilterBar
            inset
            filters={STATE_FILTERS.map((filter) => ({
              id: filter.id,
              label: filter.label,
              count: filter.id ? counts[filter.id] : schedules.length,
              tone: filter.id && counts[filter.id] ? 'alert' : undefined,
            }))}
            value={state}
            onChange={setState}
            end={counts.proposals > 0 ? <GsBadge tone="alert" icon={<FileClock size={12} />}>{counts.proposals} proposition{counts.proposals > 1 ? 's' : ''} en attente</GsBadge> : null}
          />

          {isLoading ? (
            <GsPanel><GsSkeleton variant="rows" count={5} /></GsPanel>
          ) : isError ? (
            <GsPanel tone="alert"><GsEmpty icon={<CalendarDays size={27} />} title="Chargement impossible" hint="Impossible de charger les plannings à consulter. Réessayez dans quelques instants." /></GsPanel>
          ) : schedules.length === 0 ? (
            <GsPanel><GsEmpty icon={<CalendarDays size={27} />} title="Aucun planning à consulter" hint="Les plannings apparaissent ici dès que le chef de service les envoie." /></GsPanel>
          ) : (
            <GsPanel flush title={`Plannings disponibles (${schedules.length})`} icon={<CalendarDays size={14} />}>
              <div className="gsin-list">
                {schedules.map((s) => (
                  <article key={s.id} className="gsin-item">
                    <div className="gsin-item-main">
                      <div className="gsin-item-heading">
                        <div className="gsin-item-title"><span>{s.name}</span>
                        <PlanningStateBadge state={s.state} status={s.status} startDate={s.startDate} endDate={s.endDate} size="sm" />
                        {s.pendingProposals > 0 ? <GsBadge tone="alert">{s.pendingProposals} en attente</GsBadge> : null}
                        </div>
                        <p className="gsin-item-meta">{s.departmentName || 'Service non précisé'} · {fmt(s.startDate)} → {fmt(s.endDate)}{s.authorName ? ` · envoyé par ${s.authorName}` : ''}</p>
                        <p className="gsin-item-stats"><span><ShieldCheck size={13} /> {s.guardCount} garde{s.guardCount === 1 ? '' : 's'}</span><span><CalendarDays size={13} /> {s.staffCount} agent{s.staffCount === 1 ? '' : 's'}</span>{s.myProposals > 0 ? <span><Pencil size={13} /> {s.myProposals} proposition{s.myProposals === 1 ? '' : 's'} de ma part</span> : null}</p>
                      </div>
                    </div>

                    <div className="gsin-item-actions">
                      <button type="button" className="gs-btn" onClick={() => setPreviewSchedule(s)}>
                        <Eye size={14} /> Consulter
                      </button>
                      {canPropose(s) && (
                        <button type="button" className="gs-btn is-primary" onClick={() => setEditing({ id: s.id, departmentId: s.departmentId })}>
                          <Pencil size={14} /> Proposer une modification
                        </button>
                      )}
                      <button type="button" className="gs-btn" onClick={() => setProposalsFor(s.id)}>
                        <FileClock size={14} /> Propositions
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </GsPanel>
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
