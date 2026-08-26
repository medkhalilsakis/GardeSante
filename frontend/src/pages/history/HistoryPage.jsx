import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, Clock3, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import { historyAPI } from '../../api';
import { useAuthStore } from '../../store';
import Avatar from '../../components/common/Avatar';
import { GsBadge, GsEmpty, GsFilterBar, GsPageHeader, GsPanel, GsSkeleton, GsTabRail } from '../../components/gs';
import './history.css';

const ACTION_LABELS = {
  login: 'Connexion', logout: 'Déconnexion', profile_update: 'Profil modifié',
  profile_approved: 'Profil approuvé', profile_rejected: 'Profil refusé',
  password_change: 'Mot de passe changé', avatar_upload: 'Photo mise à jour',
  avatar_delete: 'Photo supprimée', absence_create: 'Absence créée',
  absence_approve: 'Absence approuvée', shift_create: 'Garde créée',
  schedule_publish: 'Planning publié', account_created: 'Compte créé',
  account_deactivated: 'Compte clôturé',
};
// Les catégories réellement présentes en base couvrent le singulier et le
// pluriel selon le module d'origine (`schedule` et `schedules`, `absence` et
// `absences`) : les deux formes sont traduites, sinon le filtre affiche la clé
// technique telle quelle.
const CATEGORY_LABELS = { auth: 'Authentification', profile: 'Profil', schedule: 'Planning', schedules: 'Plannings', absence: 'Absences', absences: 'Absences', shift: 'Gardes', replacement: 'Remplacements', notes: 'Notes de service', admin: 'Administration', general: 'Général' };
const actionLabel = (action) => ACTION_LABELS[action] || String(action || '').replace(/_/g, ' ');
const categoryLabel = (category) => CATEGORY_LABELS[category] || category || 'Général';
const stamp = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

function severityTone(severity) {
  return severity && severity !== 'info' ? 'alert' : 'quiet';
}

function LogRow({ entry, showUser }) {
  const [open, setOpen] = useState(false);
  const hasExtra = entry.metadata && Object.keys(entry.metadata).length > 0;
  return (
    <article className={`gsh-row${hasExtra ? ' is-expandable' : ''}`}>
      <button type="button" className="gsh-row-main" onClick={() => hasExtra && setOpen((value) => !value)} disabled={!hasExtra} aria-expanded={hasExtra ? open : undefined}>
        <span className="gsh-row-mark" aria-hidden="true"><Clock3 size={16} /></span>
        <span className="gsh-row-content">
          <span className="gsh-row-heading">
            {showUser && entry.first_name ? <b>{entry.first_name} {entry.last_name}</b> : null}
            <GsBadge tone={severityTone(entry.severity)}>{actionLabel(entry.action)}</GsBadge>
            <span className="gsh-taxonomy">{categoryLabel(entry.category)}</span>
            {entry.severity && entry.severity !== 'info' ? <GsBadge tone="alert">{entry.severity}</GsBadge> : null}
          </span>
          {entry.description ? <span className="gsh-description">{entry.description}</span> : null}
          <span className="gsh-meta">
            <span>{stamp(entry.created_at)}</span>
            {entry.ip_address ? <span>{entry.ip_address}</span> : null}
            {showUser && entry.establishment_name ? <span>{entry.establishment_name}</span> : null}
            {hasExtra ? <span className="gsh-expand">{open ? 'Masquer les détails' : 'Voir les détails'} <ChevronDown size={13} className={open ? 'is-open' : ''} /></span> : null}
          </span>
        </span>
      </button>
      {open && hasExtra ? <pre className="gsh-json">{JSON.stringify(entry.metadata, null, 2)}</pre> : null}
    </article>
  );
}

function HistoryFilters({ filters, onChange, categories, showUserSearch, users, selectedUser, onUserChange }) {
  const reset = () => { onChange({}); onUserChange?.(''); };
  return (
    <GsFilterBar
      label="Filtres de l’historique"
      search={showUserSearch ? { value: '', onChange: () => {}, placeholder: 'Utilisez le sélecteur utilisateur' } : undefined}
      end={<button className="gs-btn is-quiet" type="button" onClick={reset}><RotateCcw size={14} /> Réinitialiser</button>}
    >
      {showUserSearch ? <label className="gsh-filter-field"><span>Utilisateur</span><select className="form-control" value={selectedUser} onChange={(event) => onUserChange(event.target.value)}><option value="">Tous les utilisateurs</option>{users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name} — {u.role_name}</option>)}</select></label> : null}
      <label className="gsh-filter-field"><span>Catégorie</span><select className="form-control" value={filters.category || ''} onChange={(event) => onChange({ ...filters, category: event.target.value })}><option value="">Toutes les catégories</option>{categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}</select></label>
      <label className="gsh-filter-field"><span>Depuis</span><input className="form-control" type="date" value={filters.from || ''} onChange={(event) => onChange({ ...filters, from: event.target.value })} /></label>
      <label className="gsh-filter-field"><span>Jusqu’au</span><input className="form-control" type="date" value={filters.to || ''} onChange={(event) => onChange({ ...filters, to: event.target.value })} /></label>
    </GsFilterBar>
  );
}

export default function HistoryPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.roleCode === 'super_admin';
  const canViewEstablishmentHistory = ['super_admin', 'director', 'hospital_admin'].includes(user?.roleCode);
  const isEstablishmentScope = canViewEstablishmentHistory && !isSuperAdmin;
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({});
  const [selectedUser, setSelectedUser] = useState('');
  const [tab, setTab] = useState('mine');
  const categoryScope = tab === 'all' && isEstablishmentScope ? 'establishment' : 'mine';
  const { data: cats = [] } = useQuery({
    queryKey: ['history-cats', categoryScope],
    queryFn: () => historyAPI.getCategories(categoryScope === 'establishment' ? { scope: 'establishment' } : undefined).then((r) => r.data.data),
  });
  const { data: usersList = [] } = useQuery({
    queryKey: ['history-users-list', isEstablishmentScope ? 'establishment' : 'platform'],
    queryFn: () => historyAPI.getUsersList().then((r) => r.data.data),
    enabled: canViewEstablishmentHistory,
  });
  const { data: myData, isLoading: myLoading } = useQuery({ queryKey: ['history-mine', page, filters], queryFn: () => historyAPI.getMine({ page, limit: 30, ...filters }).then((r) => r.data), enabled: tab === 'mine' });
  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ['history-all', page, filters, selectedUser, isEstablishmentScope ? 'establishment' : 'platform'],
    queryFn: () => historyAPI.getAll({ page, limit: 40, userId: selectedUser || undefined, ...filters }).then((r) => r.data),
    enabled: tab === 'all' && canViewEstablishmentHistory,
  });
  const result = tab === 'mine' ? myData : allData;
  const logs = result?.data || [];
  const total = result?.pagination?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / (tab === 'mine' ? 30 : 40)));
  const isLoading = tab === 'mine' ? myLoading : allLoading;
  const selected = useMemo(() => usersList.find((u) => u.id === selectedUser), [usersList, selectedUser]);
  const tabs = canViewEstablishmentHistory ? [{ id: 'mine', label: 'Mon historique' }, { id: 'all', label: 'Tous les utilisateurs' }] : [];
  const changeFilters = (next) => { setFilters(next); setPage(1); };

  return (
    <div className="gsh-wrap">
      <GsPageHeader eyebrow="Traçabilité" title="Historique des activités" subtitle={`Journal complet en lecture seule · ${total} entrée${total > 1 ? 's' : ''}`} meta={[{ label: 'Portée', value: tab === 'mine' ? 'Mon compte' : (isSuperAdmin ? 'Plateforme' : 'Établissement') }]} actions={<GsBadge tone="seal" icon={<ShieldCheck size={13} />}>Immuable</GsBadge>}>
        {tabs.length ? <GsTabRail tabs={tabs} value={tab} onChange={(value) => { setTab(value); setPage(1); setFilters({}); }} label="Portée de l’historique" /> : null}
      </GsPageHeader>
      {tab === 'all' && selected ? <GsPanel flat className="gsh-selected"><Avatar avatarUrl={selected.avatar_url} firstName={selected.first_name} lastName={selected.last_name} size="md" /><span><b>{selected.first_name} {selected.last_name}</b><small>{selected.role_name} · {selected.establishment_name}</small></span></GsPanel> : null}
      <GsPanel title="Filtrer le journal" sub="Les filtres restreignent la lecture sans modifier les événements enregistrés." flush><HistoryFilters filters={filters} onChange={changeFilters} categories={cats} showUserSearch={tab === 'all' && canViewEstablishmentHistory} users={usersList} selectedUser={selectedUser} onUserChange={(id) => { setSelectedUser(id); setPage(1); }} /></GsPanel>
      <GsPanel title="Événements" sub="Chaque entrée est conservée telle qu’elle a été enregistrée." flush>
        <div className="gsh-readonly"><Info size={14} /><span><b>Lecture seule.</b> L’historique ne peut être ni modifié ni supprimé.</span></div>
        {isLoading ? <div className="gsh-loading"><GsSkeleton variant="rows" count={6} /></div> : logs.length ? <div className="gsh-list">{logs.map((entry) => <LogRow key={entry.id} entry={entry} showUser={tab === 'all'} />)}</div> : <GsEmpty icon={<Clock3 size={28} />} title="Aucune activité enregistrée" hint={Object.values(filters).some(Boolean) ? 'Aucun résultat pour ces filtres.' : 'Les événements apparaîtront ici au fil de l’utilisation de la plateforme.'} />}
        {totalPages > 1 ? <nav className="gsh-pagination" aria-label="Pagination historique"><button className="gsh-page" type="button" onClick={() => setPage((p) => p - 1)} disabled={page === 1}><ChevronLeft size={15} /></button><span>Page <b className="gs-num">{page}</b> / <b className="gs-num">{totalPages}</b></span><button className="gsh-page" type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}><ChevronRight size={15} /></button></nav> : null}
      </GsPanel>
    </div>
  );
}
