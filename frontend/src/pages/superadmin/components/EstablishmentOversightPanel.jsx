/**
 * Supervision d'un hôpital (Lot 6) — Super Admin, CONSULTATION UNIQUEMENT.
 *
 * « Le Super Admin ... permet de voir (consulter uniquement) toutes les gardes de
 * chaque hôpital » : ce panneau ne consomme que `adminOversightAPI`, dont le
 * routeur ne monte aucun verbe autre que GET. Aucun bouton n'écrit quoi que ce
 * soit — le tableau s'ouvre en aperçu, jamais en édition.
 *
 * Les brouillons ne sont pas listés : `admin-oversight.controller.js` filtre
 * `status <> 'draft'` côté serveur.
 */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminOversightAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import SchedulePreviewModal from '../../replacements/components/SchedulePreviewModal';

const STATES = [
  { value: '',         label: 'Tous les états' },
  { value: 'soumis',   label: 'Soumises' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine',  label: 'Terminées' },
];

const VIEWS = [
  { id: 'schedules',    label: '🛡️ Gardes' },
  { id: 'absences',     label: '🤒 Absences et congés' },
  { id: 'replacements', label: '🔄 Remplacements' },
];

const KIND_LABEL = {
  leave:          { text: 'CONGÉ',   color: '#3B82F6' },
  shift_absence:  { text: 'ABSENCE', color: '#DC2626' },
  late:           { text: 'RETARD',  color: '#F59E0B' },
};

const parseLocal = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '').slice(0, 10));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

const fmt = (d) => {
  const dt = parseLocal(d);
  return dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};

const Empty = ({ children }) => (
  <div style={{
    padding: 36, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
    background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 12,
  }}>
    {children}
  </div>
);

const Row = ({ accent, children }) => (
  <div style={{
    display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
    borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: '11px 14px',
  }}>
    {children}
  </div>
);

export default function EstablishmentOversightPanel({ establishmentId, establishmentName }) {
  const [view, setView] = useState('schedules');
  const [state, setState] = useState('');
  const [preview, setPreview] = useState(null);

  const schedules = useQuery({
    queryKey: ['oversight-schedules', establishmentId, state],
    queryFn: () => adminOversightAPI
      .getSchedules({ establishmentId, ...(state ? { state } : {}) })
      .then((r) => r.data.data.schedules || []),
    enabled: !!establishmentId && view === 'schedules',
  });

  const absences = useQuery({
    queryKey: ['oversight-absences', establishmentId],
    queryFn: () => adminOversightAPI
      .getAbsences({ establishmentId, limit: 60 })
      .then((r) => r.data.data.absences || []),
    enabled: !!establishmentId && view === 'absences',
  });

  const replacements = useQuery({
    queryKey: ['oversight-replacements', establishmentId],
    queryFn: () => adminOversightAPI
      .getReplacements({ establishmentId, limit: 60 })
      .then((r) => r.data.data.replacements || []),
    enabled: !!establishmentId && view === 'replacements',
  });

  const active = view === 'schedules' ? schedules : view === 'absences' ? absences : replacements;

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-elevated)', borderRadius: 10, padding: 4 }}>
          {VIEWS.map((v) => (
            <button key={v.id} onClick={() => setView(v.id)} style={{
              padding: '7px 15px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 12, fontFamily: 'inherit',
              background: view === v.id ? 'var(--color-primary)' : 'transparent',
              color: view === v.id ? '#fff' : 'var(--text-muted)', transition: 'all 0.2s',
            }}>
              {v.label}
            </button>
          ))}
        </div>
        {view === 'schedules' && (
          <select value={state} onChange={(e) => setState(e.target.value)} style={{
            padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-default)',
            background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12,
          }}>
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
          Consultation uniquement — aucune modification n'est possible ici
        </span>
      </div>

      {active.isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#DC2626', fontSize: 13 }}>
          Le chargement a échoué.
        </div>
      ) : active.isLoading ? (
        <Empty>Chargement…</Empty>
      ) : view === 'schedules' ? (
        !schedules.data?.length ? (
          <Empty>Aucune garde {state ? 'dans cet état' : 'soumise'} pour {establishmentName || 'cet hôpital'}</Empty>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12 }}>
            {schedules.data.map((sc) => (
              <div key={sc.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{sc.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {sc.departmentName || 'Service non précisé'}
                    </div>
                  </div>
                  <PlanningStateBadge state={sc.state} status={sc.status} size="sm" />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  du {fmt(sc.startDate)} au {fmt(sc.endDate)}
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>🛡️ {sc.guardCount} garde(s)</span>
                  <span>👥 {sc.staffCount} agent(s)</span>
                </div>
                <button onClick={() => setPreview(sc)} style={{
                  alignSelf: 'flex-start', padding: '6px 12px', borderRadius: 7,
                  border: '1px solid var(--border-default)', background: 'transparent',
                  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                }}>
                  Voir le tableau
                </button>
              </div>
            ))}
          </div>
        )
      ) : view === 'absences' ? (
        !absences.data?.length ? (
          <Empty>Aucune absence ni congé enregistré</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {absences.data.map((a) => {
              const k = KIND_LABEL[a.kind] || { text: String(a.kind || '').toUpperCase(), color: '#6366F1' };
              return (
                <Row key={a.id} accent={k.color}>
                  <div style={{ flex: 1, minWidth: 230 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {a.firstName} {a.lastName}
                      <span style={{ fontSize: 9, fontWeight: 800, color: k.color, marginLeft: 8 }}>{k.text}</span>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                      {a.typeName || '—'} · du {fmt(a.startDate)} au {fmt(a.endDate)}
                      {a.startTime ? ` · ${a.startTime}` : ''}
                    </p>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                      {a.departmentName || '—'}{a.reason ? ` · « ${a.reason} »` : ''}
                    </p>
                  </div>
                </Row>
              );
            })}
          </div>
        )
      ) : !replacements.data?.length ? (
        <Empty>Aucun remplacement enregistré</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {replacements.data.map((r) => (
            <Row key={r.id} accent={r.confirmationStatus === 'confirmed' ? '#10B981' : '#F59E0B'}>
              <div style={{ flex: 1, minWidth: 230 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {r.scheduleName || 'Garde'}
                  <span style={{
                    fontSize: 9, fontWeight: 800, marginLeft: 8,
                    color: r.confirmationStatus === 'confirmed' ? '#10B981' : '#F59E0B',
                  }}>
                    {r.confirmationStatus === 'confirmed' ? 'CONFIRMÉ' : 'NON CONFIRMÉ'}
                  </span>
                </div>
                {(r.items || []).map((it, i) => (
                  <p key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>
                    {it.absentName} → {it.replacementName}
                    {it.isCrossDepartment ? ' · inter-service' : ''}
                  </p>
                ))}
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                  {r.departmentName || '—'} · du {fmt(r.startDate)} au {fmt(r.endDate)}
                  {r.reason ? ` · « ${r.reason} »` : ''}
                </p>
              </div>
            </Row>
          ))}
        </div>
      )}

      {preview && (
        <SchedulePreviewModal
          schedule={{ ...preview, start_date: preview.startDate, end_date: preview.endDate }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
