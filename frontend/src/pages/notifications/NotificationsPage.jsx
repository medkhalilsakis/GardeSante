import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Bell, CheckCheck, ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore, useNotificationStore } from '../../store';
import { notificationsAPI } from '../../api';
import { resolveNotificationTarget } from '../../utils/notificationTarget';
import ContextBadge from '../../components/layout/ContextBadge';
import { GsBadge, GsEmpty, GsFilterBar, GsPageHeader, GsPanel, GsSkeleton, GsStat, GsStatRail } from '../../components/gs';
import './notifications.css';

const TYPE_LABELS = {
  schedule_submitted: 'Planning envoyé', schedule_submission_cancelled: 'Envoi annulé', schedule_change_proposed: 'Modification proposée', schedule_change_accepted: 'Modification acceptée', schedule_change_rejected: 'Modification refusée', schedule_shared_sg: 'Planning partagé', staff_loan_requested: 'Prêt de personnel demandé', staff_loan_decided: 'Prêt de personnel traité', leave_created: 'Congé enregistré', leave_cancelled: 'Congé annulé', absence_reported: 'Absence signalée', reinforcement_requested: 'Renfort demandé', replacement_created: 'Remplacement créé', replacement_pending_confirmation: 'Remplacement à confirmer', replacement_confirmed: 'Remplacement confirmé', replacement_rejected: 'Remplacement refusé', note: 'Note ou circulaire', supervision_report: 'Rapport de supervision',
};
const typeLabel = (value) => TYPE_LABELS[value] || String(value || '').replace(/_/g, ' ');
const priorityLabel = (value) => ({ urgent: 'Urgente', high: 'Haute', normal: 'Normale', low: 'Basse' }[value] || 'Normale');
const priorityTone = (value) => value === 'urgent' || value === 'high' ? 'alert' : value === 'normal' ? 'seal' : 'quiet';
const stamp = (value) => value ? new Date(value).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export default function NotificationsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setStoreNotifications = useNotificationStore((state) => state.setNotifications);
  const [page, setPage] = useState(1);
  const [read, setRead] = useState('');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
  const [confirmPurge, setConfirmPurge] = useState(false);
  const LIMIT = 20;
  const params = { page, limit: LIMIT, ...(read ? { read } : {}), ...(type ? { type } : {}), ...(priority ? { priority } : {}) };
  const { data, isLoading, isFetching } = useQuery({ queryKey: ['notifications', 'page', page, read, type, priority], queryFn: () => notificationsAPI.getAll(params).then((response) => response.data), placeholderData: keepPreviousData, refetchInterval: 60000 });
  const rows = data?.data || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const unreadCount = data?.unreadCount ?? 0;
  const availableTypes = data?.types || [];
  const availablePriorities = data?.priorities || [];
  const hasFilter = Boolean(read || type || priority);
  const refreshBadge = async () => { try { const response = await notificationsAPI.getAll({ unreadOnly: true, limit: 5 }); setStoreNotifications(response.data.data, response.data.unreadCount); } catch { /* polling de la coque */ } };
  const afterMutation = async () => { await qc.invalidateQueries({ queryKey: ['notifications'] }); await refreshBadge(); };
  const markRead = useMutation({ mutationFn: (id) => notificationsAPI.markRead(id), onSuccess: afterMutation, onError: () => toast.error('Impossible de marquer cette notification') });
  const markAll = useMutation({ mutationFn: () => notificationsAPI.markAllRead(), onSuccess: async () => { toast.success('Toutes les notifications sont marquées lues'); await afterMutation(); }, onError: () => toast.error('Échec du marquage') });
  const remove = useMutation({ mutationFn: (id) => notificationsAPI.remove(id), onSuccess: async () => { toast.success('Notification supprimée'); if (rows.length === 1 && page > 1) setPage((current) => current - 1); await afterMutation(); }, onError: (error) => toast.error(error?.response?.data?.message || 'Suppression impossible') });
  const purge = useMutation({ mutationFn: () => notificationsAPI.clearRead(), onSuccess: async (response) => { toast.success(response?.data?.message || 'Notifications lues supprimées'); setConfirmPurge(false); setPage(1); await afterMutation(); }, onError: () => toast.error('Purge impossible') });
  const openAction = async (notification) => { if (!notification.is_read) { try { await notificationsAPI.markRead(notification.id); } catch { /* l'action reste navigable */ } await afterMutation(); } const target = resolveNotificationTarget(notification, user?.roleCode); if (target) navigate(target.path); else toast('Cette notification ne possède pas encore d’action associée.'); };
  const resetFilters = () => { setRead(''); setType(''); setPriority(''); setPage(1); };

  return (
    <div className="gsnfp-wrap">
      <ContextBadge variant="header" />
      <GsPageHeader eyebrow="Centre de suivi" title="Notifications" subtitle="Toutes vos notifications, filtrables et actionnables depuis un seul écran." actions={<><button className="gs-btn" type="button" onClick={() => markAll.mutate()} disabled={markAll.isPending || unreadCount === 0}><CheckCheck size={15} /> Tout marquer lu</button><button className="gs-btn is-danger" type="button" onClick={() => setConfirmPurge(true)} disabled={purge.isPending}><Trash2 size={15} /> Vider les lues</button></>} rail={<GsStatRail><GsStat label="Non lues" value={unreadCount} tone="alert" hint="À traiter" /><GsStat label={hasFilter ? 'Résultats filtrés' : 'Total'} value={total} tone="seal" hint={isFetching ? 'Actualisation…' : 'Selon les critères'} /><GsStat label="Types reçus" value={availableTypes.length} /></GsStatRail>} />
      {confirmPurge ? <GsPanel tone="alert" title="Confirmer la purge" sub="Cette action est irréversible et ne concerne que vos notifications lues." tools={<button className="gs-btn is-quiet" type="button" onClick={() => setConfirmPurge(false)}><X size={14} /> Annuler</button>}><div className="gsnfp-confirm"><p>Supprimer définitivement toutes les notifications déjà lues ? Les notifications non lues seront conservées.</p><button className="gs-btn is-danger" type="button" onClick={() => purge.mutate()} disabled={purge.isPending}>{purge.isPending ? 'Suppression…' : 'Confirmer la purge'}</button></div></GsPanel> : null}
      <GsPanel title="Filtres" sub="Les listes de types et de priorités proviennent du serveur." flush><GsFilterBar value="" onChange={() => {}} search={undefined} end={hasFilter ? <button className="gs-btn is-quiet" type="button" onClick={resetFilters}><X size={14} /> Réinitialiser</button> : null}><label className="gsnf-field"><span>État</span><select className="form-control" value={read} onChange={(event) => { setRead(event.target.value); setPage(1); }}><option value="">Toutes</option><option value="false">Non lues</option><option value="true">Lues</option></select></label><label className="gsnf-field"><span>Type</span><select className="form-control" value={type} onChange={(event) => { setType(event.target.value); setPage(1); }}><option value="">Tous les types</option>{availableTypes.map((item) => <option key={item} value={item}>{typeLabel(item)}</option>)}</select></label><label className="gsnf-field"><span>Priorité</span><select className="form-control" value={priority} onChange={(event) => { setPriority(event.target.value); setPage(1); }}><option value="">Toutes les priorités</option>{availablePriorities.map((item) => <option key={item} value={item}>{priorityLabel(item)}</option>)}</select></label></GsFilterBar></GsPanel>
      <GsPanel title="Fil des notifications" sub={`${total} notification${total > 1 ? 's' : ''}`}>
        {isLoading ? <GsSkeleton variant="block" count={5} /> : rows.length ? <div className="gsnfp-list">{rows.map((notification) => { const target = resolveNotificationTarget(notification, user?.roleCode); return <article key={notification.id} className={`gsnfp-item${notification.is_read ? '' : ' is-unread'}`}><div className="gsnfp-item-body"><div className="gsnfp-item-head">{!notification.is_read ? <span className="gsnfp-unread-dot" aria-label="Non lue" /> : null}<h3>{notification.title}</h3><GsBadge tone="quiet">{typeLabel(notification.type)}</GsBadge>{notification.priority === 'urgent' || notification.priority === 'high' ? <GsBadge tone={priorityTone(notification.priority)}>{priorityLabel(notification.priority)}</GsBadge> : null}</div><p>{notification.message}</p><small>{stamp(notification.created_at)}</small></div><div className="gsnfp-actions">{target ? <button className="gs-btn is-primary" type="button" onClick={() => openAction(notification)}>{target.label}</button> : null}{!notification.is_read ? <button className="gs-btn" type="button" onClick={() => markRead.mutate(notification.id)} disabled={markRead.isPending}>Marquer lu</button> : null}<button className="gs-btn is-danger" type="button" onClick={() => remove.mutate(notification.id)} disabled={remove.isPending}><Trash2 size={14} /> Supprimer</button></div></article>; })}</div> : <GsEmpty icon={<Bell size={28} />} title={hasFilter ? 'Aucune notification pour ces filtres' : 'Aucune notification'} hint="Les nouvelles informations apparaîtront ici automatiquement." />}
        {totalPages > 1 ? <nav className="gsnfp-pagination" aria-label="Pagination des notifications"><button className="gsnfp-page" type="button" onClick={() => setPage((current) => current - 1)} disabled={page <= 1}><ChevronLeft size={15} /></button><span>Page <b className="gs-num">{page}</b> / <b className="gs-num">{totalPages}</b></span><button className="gsnfp-page" type="button" onClick={() => setPage((current) => current + 1)} disabled={page >= totalPages}><ChevronRight size={15} /></button></nav> : null}
      </GsPanel>
    </div>
  );
}
