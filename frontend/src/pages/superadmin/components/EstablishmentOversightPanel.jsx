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
import { CalendarDays, Eye, LockKeyhole, Repeat2, ShieldCheck, UserRoundX, Users } from 'lucide-react';
import { adminOversightAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import SchedulePreviewModal from '../../replacements/components/SchedulePreviewModal';
import './EstablishmentOversightPanel.css';

const STATES = [
  { value: '',         label: 'Tous les états' },
  { value: 'soumis',   label: 'Soumises' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine',  label: 'Terminées' },
];

const VIEWS = [
  { id: 'schedules',    label: 'Gardes', icon: ShieldCheck },
  { id: 'absences',     label: 'Absences et congés', icon: UserRoundX },
  { id: 'replacements', label: 'Remplacements', icon: Repeat2 },
];

const KIND_LABEL = {
  leave:          { text: 'CONGÉ', tone: 'seal' },
  shift_absence:  { text: 'ABSENCE', tone: 'alert' },
  late:           { text: 'RETARD', tone: 'alert' },
};

const parseLocal = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '').slice(0, 10));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

const fmt = (d) => {
  const dt = parseLocal(d);
  return dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};

const Empty = ({ children }) => <div className="gsa-oversight-empty">{children}</div>;

const Row = ({ tone = 'quiet', children }) => <div className={`gsa-oversight-row is-${tone}`}>{children}</div>;

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
    <div className="gsa-oversight">
      <div className="gsa-oversight-toolbar">
        <div className="gsa-oversight-tabs" role="tablist" aria-label="Périmètre de consultation">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>
              <v.icon size={13} aria-hidden="true" />
              {v.label}
            </button>
          ))}
        </div>
        {view === 'schedules' && (
          <select className="gsa-oversight-state" value={state} onChange={(e) => setState(e.target.value)} aria-label="État du planning">
            {STATES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <span className="gsa-oversight-readonly">
          <LockKeyhole size={12} aria-hidden="true" />
          Consultation uniquement — aucune modification n'est possible ici
        </span>
      </div>

      {active.isError ? (
        <div className="gsa-oversight-error">
          Le chargement a échoué.
        </div>
      ) : active.isLoading ? (
        <Empty>Chargement…</Empty>
      ) : view === 'schedules' ? (
        !schedules.data?.length ? (
          <Empty>Aucune garde {state ? 'dans cet état' : 'soumise'} pour {establishmentName || 'cet hôpital'}</Empty>
        ) : (
          <div className="gsa-oversight-schedules">
            {schedules.data.map((sc) => (
              <article key={sc.id} className="gsa-oversight-schedule">
                <div className="gsa-oversight-schedule-head">
                  <div>
                    <strong>{sc.name}</strong>
                    <span>{sc.departmentName || 'Service non précisé'}</span>
                  </div>
                  <PlanningStateBadge state={sc.state} status={sc.status} size="sm" />
                </div>
                <div className="gsa-oversight-period">
                  <CalendarDays size={13} aria-hidden="true" />
                  du {fmt(sc.startDate)} au {fmt(sc.endDate)}
                </div>
                <div className="gsa-oversight-counts">
                  <span><ShieldCheck size={12} /> {sc.guardCount} garde(s)</span>
                  <span><Users size={12} /> {sc.staffCount} agent(s)</span>
                </div>
                <button type="button" className="gs-btn" onClick={() => setPreview(sc)}>
                  <Eye size={13} /> Voir le tableau
                </button>
              </article>
            ))}
          </div>
        )
      ) : view === 'absences' ? (
        !absences.data?.length ? (
          <Empty>Aucune absence ni congé enregistré</Empty>
        ) : (
          <div className="gsa-oversight-list">
            {absences.data.map((a) => {
              const k = KIND_LABEL[a.kind] || { text: String(a.kind || '').toUpperCase(), tone: 'quiet' };
              return (
                <Row key={a.id} tone={k.tone}>
                  <div className="gsa-oversight-row-main">
                    <div className="gsa-oversight-row-title">
                      {a.firstName} {a.lastName}
                      <span>{k.text}</span>
                    </div>
                    <p>
                      {a.typeName || '—'} · du {fmt(a.startDate)} au {fmt(a.endDate)}
                      {a.startTime ? ` · ${a.startTime}` : ''}
                    </p>
                    <small>
                      {a.departmentName || '—'}{a.reason ? ` · « ${a.reason} »` : ''}
                    </small>
                  </div>
                </Row>
              );
            })}
          </div>
        )
      ) : !replacements.data?.length ? (
        <Empty>Aucun remplacement enregistré</Empty>
      ) : (
        <div className="gsa-oversight-list">
          {replacements.data.map((r) => (
            <Row key={r.id} tone={r.confirmationStatus === 'confirmed' ? 'duty' : 'alert'}>
              <div className="gsa-oversight-row-main">
                <div className="gsa-oversight-row-title">
                  {r.scheduleName || 'Garde'}
                  <span>
                    {r.confirmationStatus === 'confirmed' ? 'CONFIRMÉ' : 'NON CONFIRMÉ'}
                  </span>
                </div>
                {(r.items || []).map((it, i) => (
                  <p key={i}>
                    {it.absentName} → {it.replacementName}
                    {it.isCrossDepartment ? ' · inter-service' : ''}
                  </p>
                ))}
                <small>
                  {r.departmentName || '—'} · du {fmt(r.startDate)} au {fmt(r.endDate)}
                  {r.reason ? ` · « ${r.reason} »` : ''}
                </small>
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
