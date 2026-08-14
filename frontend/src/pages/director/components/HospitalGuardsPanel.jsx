/**
 * Gardes de l'hôpital (Lot 6) — consultation par le directeur.
 *
 * Aucun endpoint neuf : les trois surfaces ouvertes à la direction existent déjà
 * et sont réutilisées telles quelles —
 *  · `supervisionAPI.getSchedules`   (Lot 5, `SUPERVISION_ROLES` inclut director)
 *  · `absencesShiftAPI.getAll`       (Lot 1, portée établissement hors chef/surveillant)
 *  · `ReplacementsPanel`             (déjà en lecture seule pour ce rôle :
 *                                     `canCreate` et `canDelete` y sont faux)
 *
 * Les brouillons ne sont jamais listés — `listSchedules` filtre `status <> 'draft'`.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supervisionAPI, absencesShiftAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import SchedulePreviewModal from '../../replacements/components/SchedulePreviewModal';
import ReplacementsPanel from '../../replacements/components/ReplacementsPanel';

const STATES = [
  { value: '',         label: 'Tous les états' },
  { value: 'soumis',   label: 'Soumises' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine',  label: 'Terminées' },
];

const parseLocal = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '').slice(0, 10));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

const fmt = (d) => {
  const dt = parseLocal(d);
  return dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};

/**
 * `kind` vaut toujours 'shift_absence' sur ces lignes : c'est le libellé du type
 * qui distingue un retard d'une absence, exactement comme le fait le serveur au
 * moment d'écrire le journal (`absences-shift.controller.js`).
 */
const isLate = (a) => String(a.type_name || '').toLowerCase().includes('retard');

const Empty = ({ children }) => (
  <div style={{
    padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
    background: 'var(--bg-card)', border: '1px dashed var(--border-default)',
    borderRadius: 'var(--border-radius-lg)',
  }}>
    {children}
  </div>
);

const SectionTitle = ({ children, hint }) => (
  <div style={{ marginBottom: 10 }}>
    <h4 style={{ fontSize: 'var(--font-md)', fontWeight: 700, color: 'var(--text-primary)' }}>{children}</h4>
    {hint && (
      <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>{hint}</p>
    )}
  </div>
);

export default function HospitalGuardsPanel() {
  const [state, setState] = useState('');
  const [preview, setPreview] = useState(null);

  const { data: schedules = [], isLoading, isError } = useQuery({
    queryKey: ['director-schedules', state],
    queryFn: () => supervisionAPI
      .getSchedules(state ? { state } : undefined)
      .then((r) => r.data.data.schedules || []),
  });

  const { data: absences = [] } = useQuery({
    queryKey: ['director-shift-absences'],
    queryFn: () => absencesShiftAPI.getAll({ limit: 30 }).then((r) => r.data.data),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <SectionTitle hint="Tableaux soumis, en cours et terminés de tous les services — consultation seule, aucune modification n'est possible depuis cet écran">
              Gardes de l'hôpital
            </SectionTitle>
          </div>
          <select className="input" style={{ maxWidth: 200 }} value={state}
            onChange={(e) => setState(e.target.value)}>
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {isError ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
            Les gardes n'ont pas pu être chargées.
          </div>
        ) : isLoading ? (
          <Empty>Chargement des gardes…</Empty>
        ) : schedules.length === 0 ? (
          <Empty>Aucune garde {state ? 'dans cet état' : 'soumise pour le moment'}</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 10 }}>
            {schedules.map((sc) => (
              <div key={sc.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 'var(--font-sm)', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {sc.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {sc.departmentName || 'Service non précisé'}
                    </div>
                  </div>
                  <PlanningStateBadge state={sc.state} status={sc.status} size="sm" />
                </div>

                <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                  du {fmt(sc.startDate)} au {fmt(sc.endDate)}
                </div>

                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>🛡️ {sc.guardCount} garde(s)</span>
                  <span>👥 {sc.staffCount} agent(s)</span>
                  {sc.pendingProposals > 0 && (
                    <span style={{ color: '#F59E0B', fontWeight: 600 }}>
                      ⏳ {sc.pendingProposals} proposition(s)
                    </span>
                  )}
                </div>

                <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}
                  onClick={() => setPreview(sc)}>
                  Voir le tableau
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle hint="Signalements faits par les chefs de service, les surveillants et le surveillant général">
          Absences et retards signalés
        </SectionTitle>
        {absences.length === 0 ? (
          <Empty>Aucun signalement enregistré</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {absences.map((a) => (
              <div key={a.id} style={{
                display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                borderLeft: `3px solid ${isLate(a) ? '#F59E0B' : '#DC2626'}`,
                borderRadius: 'var(--border-radius-sm)', padding: '10px 14px',
              }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {a.first_name} {a.last_name}
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginLeft: 8 }}>
                      {isLate(a) ? 'RETARD' : 'ABSENCE'}
                    </span>
                  </div>
                  <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', marginTop: 3 }}>
                    {fmt(a.date)}{a.start_time ? ` · ${String(a.start_time).slice(0, 5)}` : ''}
                    {a.type_name ? ` · ${a.type_name}` : ''}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                    {a.department_name || '—'}
                    {a.reason ? ` · « ${a.reason} »` : ''}
                    {typeof a.is_justified === 'boolean'
                      ? ` · ${a.is_justified ? 'justifiée' : 'non justifiée'}`
                      : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle hint="Couche « remplacements » posée sur les gardes courantes — le tableur validé n'est jamais réécrit">
          Remplacements
        </SectionTitle>
        <ReplacementsPanel />
      </div>

      {preview && (
        <SchedulePreviewModal
          schedule={{ ...preview, start_date: preview.startDate, end_date: preview.endDate }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
