import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarClock, CheckCircle2, ChevronDown, ChevronUp,
  Clock3, Download, FileInput, Filter, History, RefreshCw, Search,
  Send, ShieldCheck, Table2, UserMinus, UserPlus, Users, XCircle,
} from 'lucide-react';
import { scheduleBuilderAPI } from '../../../api';
import './ScheduleHistoryPanel.css';

const ACTIONS = {
  schedule_created: { label: 'Tableur créé', group: 'edits', tone: 'blue', icon: Table2 },
  schedule_draft_update: { label: 'Brouillon enregistré', group: 'edits', tone: 'blue', icon: Table2 },
  schedule_live_update: { label: 'Tableur en cours modifié', group: 'edits', tone: 'teal', icon: Table2 },
  schedule_import_create: { label: 'Tableur importé', group: 'edits', tone: 'violet', icon: FileInput },
  schedule_import_update: { label: 'Import appliqué', group: 'edits', tone: 'violet', icon: FileInput },
  schedule_generate: { label: 'Planning généré', group: 'edits', tone: 'violet', icon: Table2 },
  schedule_assistant_generate: { label: 'Généré par l’assistant', group: 'edits', tone: 'violet', icon: Table2 },
  schedule_assistant_v2_generate: { label: 'Généré par l’assistant', group: 'edits', tone: 'violet', icon: Table2 },
  schedule_change_proposed: { label: 'Proposition envoyée', group: 'proposals', tone: 'amber', icon: Send },
  schedule_change_accepted: { label: 'Proposition acceptée', group: 'proposals', tone: 'green', icon: CheckCircle2 },
  schedule_change_rejected: { label: 'Proposition refusée', group: 'proposals', tone: 'red', icon: XCircle },
  schedule_submit: { label: 'Planning envoyé', group: 'workflow', tone: 'green', icon: Send },
  submitted: { label: 'Planning envoyé', group: 'workflow', tone: 'green', icon: Send },
  submission_cancelled: { label: 'Envoi annulé', group: 'workflow', tone: 'red', icon: XCircle },
  schedule_submission_cancelled: { label: 'Envoi annulé', group: 'workflow', tone: 'red', icon: XCircle },
  schedule_shared_sg: { label: 'Transmis au surveillant général', group: 'workflow', tone: 'blue', icon: ShieldCheck },
  schedule_export_excel: { label: 'Export Excel', group: 'exports', tone: 'slate', icon: Download },
  schedule_export_csv: { label: 'Export CSV', group: 'exports', tone: 'slate', icon: Download },
  schedule_export_pdf: { label: 'Export PDF', group: 'exports', tone: 'slate', icon: Download },
  schedule_export_detailed_calendar_pdf: { label: 'Export calendrier PDF', group: 'exports', tone: 'slate', icon: Download },
};

const GROUPS = [
  { id: 'all', label: 'Toutes les actions' },
  { id: 'edits', label: 'Modifications' },
  { id: 'proposals', label: 'Propositions' },
  { id: 'workflow', label: 'Envois et décisions' },
  { id: 'exports', label: 'Exports' },
];

const fmtDateTime = (value) => new Date(value).toLocaleString('fr-FR', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const actorName = (actor) => `${actor?.firstName || ''} ${actor?.lastName || ''}`.trim() || 'Système';
const initials = (actor) => `${actor?.firstName?.[0] || ''}${actor?.lastName?.[0] || ''}` || 'S';

function ChangeSummary({ summary }) {
  if (!summary) return null;
  const hasDetails = summary.modeChanged || summary.added?.length || summary.removed?.length
    || summary.changedPersonnel?.length || summary.fixedRosterChanged
    || summary.customColumnsChanged || summary.weekOrganizationChanged;
  if (!hasDetails) return <div className="schedule-history-no-change">Enregistrement sans différence structurelle détectée.</div>;
  return (
    <div className="schedule-history-changes">
      {summary.modeChanged && <div className="schedule-history-mode"><Table2 size={15} /><span>Mode du tableur</span><strong>{summary.previousMode === 'fixed' ? 'Tableur fixe' : 'Tableur'} <ArrowRight size={13} /> {summary.nextMode === 'fixed' ? 'Tableur fixe' : 'Tableur'}</strong></div>}
      {!!summary.added?.length && <div className="schedule-history-change-block is-added"><div><UserPlus size={15} /><strong>{summary.added.length} personnel{summary.added.length > 1 ? 's' : ''} ajouté{summary.added.length > 1 ? 's' : ''}</strong></div><p>{summary.added.map((person) => person.name).join(', ')}</p></div>}
      {!!summary.removed?.length && <div className="schedule-history-change-block is-removed"><div><UserMinus size={15} /><strong>{summary.removed.length} personnel{summary.removed.length > 1 ? 's' : ''} retiré{summary.removed.length > 1 ? 's' : ''}</strong></div><p>{summary.removed.map((person) => person.name).join(', ')}</p></div>}
      {!!summary.changedPersonnel?.length && <div className="schedule-history-change-block is-changed"><div><Users size={15} /><strong>{summary.changedPersonnel.length} ligne{summary.changedPersonnel.length > 1 ? 's' : ''} modifiée{summary.changedPersonnel.length > 1 ? 's' : ''}</strong></div><div className="schedule-history-person-list">{summary.changedPersonnel.map((person) => <span key={person.userId}><b>{person.name}</b><small>{person.fields.join(', ')}</small></span>)}</div></div>}
      <div className="schedule-history-flags">
        {summary.fixedRosterChanged && <span>Configuration du Tableur fixe modifiée</span>}
        {summary.customColumnsChanged && <span>Colonnes personnalisées modifiées</span>}
        {summary.weekOrganizationChanged && <span>Organisation temporelle modifiée</span>}
      </div>
    </div>
  );
}

function HistoryEvent({ event }) {
  const [expanded, setExpanded] = useState(false);
  const config = ACTIONS[event.action] || { label: event.title || event.action?.replaceAll('_', ' '), group: 'workflow', tone: 'slate', icon: History };
  const Icon = config.icon;
  const summary = event.metadata?.changeSummary;
  const hasDetails = summary || event.description || Object.keys(event.metadata || {}).length > 0;
  return (
    <article className={`schedule-history-event tone-${config.tone}`}>
      <div className="schedule-history-event__rail"><span><Icon size={16} /></span></div>
      <div className="schedule-history-event__content">
        <div className="schedule-history-event__top">
          <div><h4>{event.title || config.label}</h4><span className={`schedule-history-status is-${event.status || 'completed'}`}>{event.status === 'pending' ? 'En attente' : event.status === 'accepted' ? 'Acceptée' : event.status === 'rejected' ? 'Refusée' : 'Enregistrée'}</span></div>
          <time><Clock3 size={13} />{fmtDateTime(event.occurredAt)}</time>
        </div>
        <div className="schedule-history-actor"><span className="schedule-history-avatar">{initials(event.actor)}</span><span><strong>{actorName(event.actor)}</strong><small>{event.actor?.roleName || 'Action système'}</small></span></div>
        {event.description && <p className="schedule-history-description">{event.description}</p>}
        {hasDetails && <button className="schedule-history-detail-toggle" type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{expanded ? 'Masquer les détails' : 'Voir les détails'}</button>}
        {expanded && <div className="schedule-history-details"><ChangeSummary summary={summary} />{event.metadata?.proposer && <div className="schedule-history-proposer">Proposition initiale de <strong>{actorName(event.metadata.proposer)}</strong></div>}{event.metadata?.spreadsheetMode && <div className="schedule-history-data-row"><span>Mode</span><strong>{event.metadata.spreadsheetMode === 'fixed' ? 'Tableur fixe' : 'Tableur normal'}</strong></div>}{event.metadata?.staffCount !== undefined && <div className="schedule-history-data-row"><span>Personnel après l’action</span><strong>{event.metadata.staffCount}</strong></div>}</div>}
      </div>
    </article>
  );
}

export default function ScheduleHistoryPanel({ scheduleId }) {
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [actorId, setActorId] = useState('all');
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['schedule-internal-history', scheduleId],
    queryFn: () => scheduleBuilderAPI.getHistory(scheduleId).then((response) => response.data.data),
    enabled: !!scheduleId,
  });
  const events = useMemo(() => data?.events || [], [data?.events]);
  const actors = useMemo(() => {
    const map = new Map();
    events.forEach((event) => { if (event.actor?.id) map.set(event.actor.id, event.actor); });
    return [...map.values()].sort((a, b) => actorName(a).localeCompare(actorName(b)));
  }, [events]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return events.filter((event) => {
      const config = ACTIONS[event.action] || { group: 'workflow', label: event.title || event.action };
      if (group !== 'all' && config.group !== group) return false;
      if (actorId !== 'all' && event.actor?.id !== actorId) return false;
      if (!needle) return true;
      return `${config.label} ${event.title || ''} ${event.description || ''} ${actorName(event.actor)} ${event.actor?.roleName || ''}`.toLowerCase().includes(needle);
    });
  }, [events, group, search, actorId]);

  if (isLoading) return <div className="schedule-history-state"><RefreshCw className="schedule-history-spin" size={24} /><strong>Chargement de l’historique interne</strong></div>;
  if (isError) return <div className="schedule-history-state is-error"><XCircle size={26} /><strong>Impossible de charger l’historique du tableur.</strong><button onClick={() => refetch()}>Réessayer</button></div>;
  return (
    <section className="schedule-history-panel">
      <header className="schedule-history-header"><div><span><History size={16} /> Traçabilité interne</span><h3>Historique du tableur</h3><p>Actions et propositions liées uniquement à « {data?.schedule?.name} ».</p></div><button className="schedule-history-refresh" type="button" onClick={() => refetch()} disabled={isFetching} title="Actualiser"><RefreshCw className={isFetching ? 'schedule-history-spin' : ''} size={17} /></button></header>
      <div className="schedule-history-stats"><div><History size={18} /><span><strong>{data?.stats?.total || 0}</strong>actions tracées</span></div><div><Users size={18} /><span><strong>{data?.stats?.actors || 0}</strong>intervenants</span></div><div><Send size={18} /><span><strong>{data?.stats?.proposals || 0}</strong>propositions</span></div><div><CheckCircle2 size={18} /><span><strong>{data?.stats?.acceptedProposals || 0}</strong>acceptées</span></div></div>
      <div className="schedule-history-filters"><label className="schedule-history-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher une action ou un intervenant" /></label><label><Filter size={15} /><select value={group} onChange={(event) => setGroup(event.target.value)}>{GROUPS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label><Users size={15} /><select value={actorId} onChange={(event) => setActorId(event.target.value)}><option value="all">Tous les intervenants</option>{actors.map((actor) => <option key={actor.id} value={actor.id}>{actorName(actor)} · {actor.roleName}</option>)}</select></label></div>
      <div className="schedule-history-period"><CalendarClock size={16} /><span>Du {data?.schedule?.startDate} au {data?.schedule?.endDate}</span><b>{data?.schedule?.spreadsheetMode === 'fixed' ? 'Tableur fixe' : 'Tableur normal'}</b></div>
      <div className="schedule-history-timeline">{filtered.map((event) => <HistoryEvent key={event.id} event={event} />)}{!filtered.length && <div className="schedule-history-empty"><History size={28} /><strong>Aucune action ne correspond aux filtres.</strong><span>L’historique complet reste conservé.</span></div>}</div>
    </section>
  );
}
