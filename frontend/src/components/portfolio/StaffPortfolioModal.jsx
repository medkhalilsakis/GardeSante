import React, { useEffect, useState } from 'react';
import { ClipboardClock, FileClock, Palmtree, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { portfolioAPI } from '../../api';
import { GsBadge, GsEmpty, GsSkeleton } from '../gs';
import Avatar from '../common/Avatar';
import { longFrenchDate } from '../../utils/frenchDates';

const TABS = [
  { key: 'situation', label: 'Situation' },
  { key: 'leaves', label: 'Congés' },
  { key: 'absences', label: 'Absences' },
  { key: 'history', label: 'Historique' },
];

const nameOf = (agent) => `${agent?.first_name || ''} ${agent?.last_name || ''}`.trim() || 'Personnel sans nom';
const dateTime = (value) => value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) : 'Date non renseignée';

export default function StaffPortfolioModal({ agent, onClose }) {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('situation');

  useEffect(() => {
    if (!agent?.id) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await portfolioAPI.getUserDetails(agent.id);
        if (!cancelled) setDetails(response.data.data);
      } catch {
        if (!cancelled) setError('Impossible de charger les détails de ce personnel.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [agent?.id]);

  if (!agent) return null;

  const leaves = details?.leaves || [];
  const absences = details?.shiftAbsences || [];
  const history = details?.recentHistory || [];
  const shiftsStats = details?.shiftsStats || {};
  return (
    <div className="gsport-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="gsport-modal" role="dialog" aria-modal="true" aria-labelledby="gsport-modal-title">
        <header className="gsport-modal-head">
          <Avatar avatarUrl={agent.avatar_url} firstName={agent.first_name} lastName={agent.last_name} size="xl" />
          <div className="gsport-modal-head-copy">
            <strong id="gsport-modal-title">{nameOf(agent)}</strong>
            <small>{[agent.role_name, agent.job_title, agent.grade, agent.speciality].filter(Boolean).join(' · ') || 'Fonction non renseignée'}</small>
            <small>{[agent.email, agent.phone, agent.matricule ? `Matricule ${agent.matricule}` : ''].filter(Boolean).join(' · ') || 'Coordonnées non renseignées'}</small>
          </div>
          <button type="button" className="gsport-modal-close" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </header>

        <div className="gsport-modal-body">
          <nav className="gsport-modal-tabs" aria-label="Détail du personnel">
            {TABS.map((item) => <button key={item.key} type="button" className="gsport-modal-tab" aria-current={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</button>)}
          </nav>

          {loading ? <GsSkeleton variant="rows" count={5} /> : null}
          {error ? <GsEmpty bare icon={<TriangleAlert size={25} />} title="Détails indisponibles" hint={error} /> : null}
          {!loading && !error && details ? (
            <>
              {tab === 'situation' ? (
                <div className="gsport-situation">
                  <div className="gsport-situation-copy">
                    <strong>Situation administrative</strong>
                    <p>Vue synthétique des affectations enregistrées dans le Tableur et des signalements associés.</p>
                  </div>
                  <div className="gsport-duty-stats" aria-label="Statistiques de gardes">
                    <div><span>Total gardes</span><strong>{Number(shiftsStats.total_shifts || 0).toLocaleString('fr-FR')}</strong></div>
                    <div><span>Derniers 30 jours</span><strong>{Number(shiftsStats.shifts_last_month || 0).toLocaleString('fr-FR')}</strong></div>
                    <div><span>Plannings concernés</span><strong>{Number(agent.schedules_count || 0).toLocaleString('fr-FR')}</strong></div>
                  </div>
                  <div className="gsport-status-row">
                    <GsBadge tone="seal" icon={<ShieldCheck size={12} />}>{Number(agent.total_shifts || shiftsStats.total_shifts || 0)} garde(s) au registre</GsBadge>
                    <GsBadge tone={leaves.length ? 'alert' : 'duty'} dot>{leaves.length ? `${leaves.length} congé(s) actif(s) ou à venir` : 'Aucun congé actif'}</GsBadge>
                    <GsBadge tone={absences.length ? 'alert' : 'duty'} dot>{absences.length ? `${absences.length} absence(s) signalée(s)` : 'Aucune absence signalée'}</GsBadge>
                  </div>
                </div>
              ) : null}

              {tab === 'leaves' ? <DetailList items={leaves} emptyIcon={<Palmtree size={25} />} emptyTitle="Aucun congé actif ou à venir" render={(leave) => <article className="gsport-detail-item" key={leave.id} data-tone="duty"><strong>{leave.type_name || 'Congé'}</strong><p>Du {longFrenchDate(String(leave.start_date || '').slice(0, 10))} au {longFrenchDate(String(leave.end_date || '').slice(0, 10))}</p><GsBadge tone="quiet">{leave.status || 'Statut non renseigné'}</GsBadge></article>} /> : null}

              {tab === 'absences' ? <DetailList items={absences} emptyIcon={<TriangleAlert size={25} />} emptyTitle="Aucune absence signalée" render={(absence) => <article className="gsport-detail-item" key={absence.id} data-tone="alert"><div className="gsport-detail-top"><strong>{absence.type_name || 'Absence'}</strong><GsBadge tone={absence.is_justified ? 'duty' : 'alert'} dot>{absence.is_justified ? 'Justifiée' : 'Non justifiée'}</GsBadge></div><p>{longFrenchDate(String(absence.start_date || '').slice(0, 10))}{absence.start_time ? ` · ${String(absence.start_time).slice(0, 5)}` : ''}{absence.end_time ? ` à ${String(absence.end_time).slice(0, 5)}` : ''}</p>{absence.reason ? <p>{absence.reason}</p> : null}</article>} /> : null}

              {tab === 'history' ? <DetailList items={history} emptyIcon={<FileClock size={25} />} emptyTitle="Aucune action enregistrée" render={(entry, index) => <article className="gsport-detail-item" key={`${entry.created_at || 'entry'}-${index}`}><strong>{entry.action || 'Action'}</strong>{entry.description ? <p>{entry.description}</p> : null}<p>{dateTime(entry.created_at)} · {entry.category || 'catégorie non renseignée'}</p></article>} /> : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function DetailList({ items, render, emptyIcon, emptyTitle }) {
  if (!items.length) return <GsEmpty bare icon={emptyIcon || <ClipboardClock size={25} />} title={emptyTitle} hint="Aucune donnée n’est enregistrée dans cette rubrique." />;
  return <div className="gsport-detail-list">{items.map(render)}</div>;
}
