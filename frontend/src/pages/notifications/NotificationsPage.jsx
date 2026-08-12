/**
 * Gestion des notifications — interface dédiée (point 6).
 *
 * Route `/notifications`, ouverte à TOUS les rôles, Super Admin inclus. Le menu
 * latéral rendait déjà un badge pour cette route (`Sidebar.jsx`) sans qu'aucune
 * page n'existe : cet écran l'allume enfin, sans modifier ce rendu.
 *
 * Le menu déroulant du `Header` reste ce qu'il est — les 10 dernières, sans
 * filtre. Ici : pagination, filtres (état / type / priorité), marquage lu,
 * suppression unitaire, purge des lues, et l'action associée de chaque
 * notification via `resolveNotificationTarget` (partagé avec le `Header`).
 *
 * Cohérence du badge : après chaque mutation on rejoue exactement l'appel
 * d'`AppLayout` (`unreadOnly: true, limit: 5`) et on réécrit le store. Le
 * compteur du menu et celui de la cloche ne peuvent donc pas diverger de la page.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore, useNotificationStore } from '../../store';
import { notificationsAPI } from '../../api';
import { resolveNotificationTarget } from '../../utils/notificationTarget';
import ContextBadge from '../../components/layout/ContextBadge';

/** Libellés lisibles des `type` réellement produits par le backend. */
const TYPE_LABELS = {
  schedule_submitted: 'Planning envoyé',
  schedule_submission_cancelled: 'Envoi annulé',
  schedule_change_proposed: 'Modification proposée',
  schedule_change_accepted: 'Modification acceptée',
  schedule_change_rejected: 'Modification refusée',
  schedule_shared_sg: 'Planning partagé',
  staff_loan_requested: 'Prêt de personnel demandé',
  staff_loan_decided: 'Prêt de personnel traité',
  leave_created: 'Congé enregistré',
  leave_cancelled: 'Congé annulé',
  absence_reported: 'Absence signalée',
  reinforcement_requested: 'Renfort demandé',
  replacement_created: 'Remplacement créé',
  replacement_pending_confirmation: 'Remplacement à confirmer',
  replacement_confirmed: 'Remplacement confirmé',
  replacement_rejected: 'Remplacement refusé',
  note: 'Note ou circulaire',
  supervision_report: 'Rapport de supervision',
};
const typeLabel = (t) => TYPE_LABELS[t] || String(t || '').replace(/_/g, ' ');

const PRIORITY_META = {
  urgent: { label: 'Urgent',   color: '#EF4444' },
  high:   { label: 'Haute',    color: '#F59E0B' },
  normal: { label: 'Normale',  color: '#6366F1' },
  low:    { label: 'Basse',    color: '#8BA3C7' },
};
const prioMeta = (p) => PRIORITY_META[p] || PRIORITY_META.normal;

const stamp = (d) =>
  d ? new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : '—';

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
};

const selectStyle = {
  padding: '7px 10px', borderRadius: 9, fontSize: 12, fontFamily: 'inherit',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-card)', color: 'var(--text-primary)',
};

const btn = (bg, fg, border = 'none') => ({
  padding: '6px 12px', borderRadius: 9, border, cursor: 'pointer',
  fontSize: 12, fontWeight: 700, fontFamily: 'inherit', background: bg, color: fg,
});

const KPI = ({ label, value, color }) => (
  <div style={{ ...card, borderTop: `3px solid ${color}`, padding: '14px 16px' }}>
    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
      {label}
    </p>
    <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, marginTop: 4 }}>
      {value}
    </p>
  </div>
);

export default function NotificationsPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const setStoreNotifications = useNotificationStore((s) => s.setNotifications);

  const [page, setPage] = useState(1);
  const [read, setRead] = useState('');      // '' | 'false' | 'true'
  const [type, setType] = useState('');
  const [priority, setPriority] = useState('');
  const [confirmPurge, setConfirmPurge] = useState(false);

  const LIMIT = 20;
  const params = {
    page, limit: LIMIT,
    ...(read ? { read } : {}),
    ...(type ? { type } : {}),
    ...(priority ? { priority } : {}),
  };

  // Clé DISTINCTE de celles du Header et d'AppLayout : deux `queryFn`
  // différentes sur une même clé react-query se marchent dessus.
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['notifications', 'page', page, read, type, priority],
    queryFn: () => notificationsAPI.getAll(params).then((r) => r.data),
    // react-query v5 : `keepPreviousData: true` n'existe plus, c'est un
    // `placeholderData` fonctionnel. Évite le vide clignotant en pagination.
    placeholderData: keepPreviousData,
    refetchInterval: 60000,
  });

  const rows = data?.data || [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const unreadCount = data?.unreadCount ?? 0;
  const availableTypes = data?.types || [];
  const availablePriorities = data?.priorities || [];

  /** Resynchronise le badge du menu et la cloche sur l'état réel du serveur. */
  const refreshBadge = async () => {
    try {
      const res = await notificationsAPI.getAll({ unreadOnly: true, limit: 5 });
      setStoreNotifications(res.data.data, res.data.unreadCount);
    } catch { /* le polling d'AppLayout rattrapera dans les 60 s */ }
  };

  const afterMutation = async () => {
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    await refreshBadge();
  };

  const markRead = useMutation({
    mutationFn: (id) => notificationsAPI.markRead(id),
    onSuccess: afterMutation,
    onError: () => toast.error('Impossible de marquer cette notification'),
  });

  const markAll = useMutation({
    mutationFn: () => notificationsAPI.markAllRead(),
    onSuccess: async () => { toast.success('Toutes les notifications sont marquées lues'); await afterMutation(); },
    onError: () => toast.error('Échec du marquage'),
  });

  const remove = useMutation({
    mutationFn: (id) => notificationsAPI.remove(id),
    onSuccess: async () => {
      toast.success('Notification supprimée');
      // Dernier élément d'une page au-delà de la première : on recule d'une page
      // pour ne pas laisser l'utilisateur sur un écran vide.
      if (rows.length === 1 && page > 1) setPage((p) => p - 1);
      await afterMutation();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Suppression impossible'),
  });

  const purge = useMutation({
    mutationFn: () => notificationsAPI.clearRead(),
    onSuccess: async (res) => {
      toast.success(res?.data?.message || 'Notifications lues supprimées');
      setConfirmPurge(false);
      setPage(1);
      await afterMutation();
    },
    onError: () => toast.error('Purge impossible'),
  });

  /** Ouvre l'action associée — même résolveur que le menu déroulant du Header. */
  const openAction = async (notif) => {
    if (!notif.is_read) {
      try { await notificationsAPI.markRead(notif.id); } catch {}
      await afterMutation();
    }
    const target = resolveNotificationTarget(notif, user?.roleCode);
    if (target) { navigate(target.path); return; }
    toast('Cette notification ne possède pas encore d’action associée.');
  };

  const resetFilters = () => { setRead(''); setType(''); setPriority(''); setPage(1); };
  const onFilter = (setter) => (e) => { setter(e.target.value); setPage(1); };
  const hasFilter = !!(read || type || priority);

  return (
    <div>
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-subtitle">
            Toutes vos notifications, filtrables et actionnables depuis un seul écran
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || unreadCount === 0}
            style={{ ...btn(unreadCount === 0 ? 'var(--bg-elevated)' : 'var(--color-primary)', unreadCount === 0 ? 'var(--text-muted)' : '#fff'), padding: '8px 14px', cursor: unreadCount === 0 ? 'default' : 'pointer' }}>
            Tout marquer lu
          </button>
          <button
            onClick={() => setConfirmPurge(true)}
            disabled={purge.isPending}
            style={{ ...btn('transparent', '#B91C1C', '1px solid #FECACA'), padding: '8px 14px' }}>
            Vider les lues
          </button>
        </div>
      </div>

      {confirmPurge && (
        <div style={{
          ...card, padding: '12px 14px', marginBottom: 14,
          background: 'rgba(239, 68, 68, .06)', border: '1px solid rgba(239, 68, 68, .35)',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Supprimer définitivement toutes vos notifications <strong>déjà lues</strong> ?
            Les non lues sont conservées. Cette action est irréversible et ne concerne que vous.
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmPurge(false)}
              style={btn('transparent', 'var(--text-secondary)', '1px solid var(--border-subtle)')}>
              Annuler
            </button>
            <button onClick={() => purge.mutate()} disabled={purge.isPending}
              style={btn('#EF4444', '#fff')}>
              {purge.isPending ? 'Suppression…' : 'Confirmer'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
        <KPI label="Non lues" value={unreadCount} color="#EF4444" />
        <KPI label={hasFilter ? 'Résultats filtrés' : 'Total'} value={total} color="#3B82F6" />
        <KPI label="Types reçus" value={availableTypes.length} color="#10B981" />
      </div>

      {/* Filtres */}
      <div style={{ ...card, padding: 12, marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={read} onChange={onFilter(setRead)} style={selectStyle}>
          <option value="">Toutes</option>
          <option value="false">Non lues</option>
          <option value="true">Lues</option>
        </select>

        {/* Les listes viennent du serveur : on ne propose que des filtres
            qui donneront un résultat chez cet utilisateur. */}
        <select value={type} onChange={onFilter(setType)} style={selectStyle}>
          <option value="">Tous les types</option>
          {availableTypes.map((tp) => (
            <option key={tp} value={tp}>{typeLabel(tp)}</option>
          ))}
        </select>

        <select value={priority} onChange={onFilter(setPriority)} style={selectStyle}>
          <option value="">Toutes priorités</option>
          {availablePriorities.map((p) => (
            <option key={p} value={p}>{prioMeta(p).label}</option>
          ))}
        </select>

        {hasFilter && (
          <button onClick={resetFilters}
            style={btn('transparent', 'var(--color-primary)', '1px solid var(--border-subtle)')}>
            Réinitialiser
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          {isFetching ? 'Actualisation…' : `${total} notification${total > 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Chargement…
        </div>
      ) : rows.length === 0 ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {hasFilter ? 'Aucune notification ne correspond à ces filtres.' : 'Aucune notification.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((n) => {
            const meta = prioMeta(n.priority);
            const target = resolveNotificationTarget(n, user?.roleCode);
            return (
              <div key={n.id} style={{
                ...card,
                padding: '12px 14px',
                borderLeft: `3px solid ${meta.color}`,
                background: n.is_read ? 'var(--bg-card)' : 'var(--color-primary-10)',
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
                      {!n.is_read && (
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      )}
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{n.title}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 20,
                        background: 'var(--bg-elevated)', color: 'var(--text-secondary)', whiteSpace: 'nowrap',
                      }}>
                        {typeLabel(n.type)}
                      </span>
                      {(n.priority === 'urgent' || n.priority === 'high') && (
                        <span style={{
                          fontSize: 10, fontWeight: 800, padding: '1px 8px', borderRadius: 20,
                          background: `${meta.color}1F`, color: meta.color, whiteSpace: 'nowrap',
                        }}>
                          {meta.label}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>{n.message}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{stamp(n.created_at)}</div>
                  </div>

                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {target && (
                      <button onClick={() => openAction(n)} style={btn('var(--color-primary)', '#fff')}>
                        {target.label}
                      </button>
                    )}
                    {!n.is_read && (
                      <button
                        onClick={() => markRead.mutate(n.id)}
                        disabled={markRead.isPending}
                        style={btn('transparent', 'var(--text-secondary)', '1px solid var(--border-subtle)')}>
                        Marquer lu
                      </button>
                    )}
                    <button
                      onClick={() => remove.mutate(n.id)}
                      disabled={remove.isPending}
                      title="Supprimer cette notification"
                      style={btn('transparent', '#B91C1C', '1px solid #FECACA')}>
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 16 }}>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{ ...btn('transparent', page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', '1px solid var(--border-subtle)'), cursor: page <= 1 ? 'default' : 'pointer' }}>
            ← Précédent
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{ ...btn('transparent', page >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)', '1px solid var(--border-subtle)'), cursor: page >= totalPages ? 'default' : 'pointer' }}>
            Suivant →
          </button>
        </div>
      )}
    </div>
  );
}
