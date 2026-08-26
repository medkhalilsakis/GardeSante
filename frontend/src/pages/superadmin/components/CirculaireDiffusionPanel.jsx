/**
 * Suivi de diffusion des circulaires nationales (Lot X5).
 *
 * Le Super Admin publiait déjà vers tous les directeurs et voyait « Lu par
 * N/M ». Il ne pouvait pas répondre à la seule question qui compte ensuite :
 * *lesquels* n'ont pas lu, et comment les relancer.
 *
 * Ce panneau nomme les non-lecteurs, distingue ceux qui n'ont jamais été
 * notifiés (directeurs nommés après la publication — jamais en faute), et
 * permet une relance tracée, globale ou individuelle.
 *
 * Composant autonome : aucun composant existant n'est modifié. La lecture d'une
 * circulaire par un directeur n'émet pas d'événement temps réel, donc la
 * diffusion est réinterrogée périodiquement, avec l'heure de synchronisation
 * affichée — même parti pris que le suivi des gardes en direct.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone, MailCheck, MailWarning, BellRing, RefreshCw, ChevronLeft,
  UserCheck, UserX, Building2, Clock3, Info, CircleSlash,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { notesAPI } from '../../../api';
import './CirculaireDiffusionPanel.css';

/** Intervalle du rafraîchissement de la diffusion, en millisecondes. */
const REFRESH_MS = 20000;

const CATEGORY_LABEL = {
  note: 'Note',
  circulaire: 'Circulaire',
  directive: 'Directive',
  info: 'Information',
};

const PRIORITY_LABEL = {
  low: 'Faible',
  normal: 'Normale',
  high: 'Élevée',
  urgent: 'Urgente',
};

const dateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const dayOnly = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const clock = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('fr-FR');
};

/** Palette du taux de lecture : vert dès 80 %, orange au-dessus de 40 %. */
const rateTone = (rate) => (rate >= 80 ? 'ok' : rate >= 40 ? 'warn' : 'bad');

const Note = ({ tone = 'info', icon: IconCmp = Info, children }) => (
  <p className={`cd-note cd-note-${tone}`}>
    <IconCmp size={15} />
    <span>{children}</span>
  </p>
);

export default function CirculaireDiffusionPanel() {
  const [selectedId, setSelectedId] = useState(null);
  const queryClient = useQueryClient();

  // Les circulaires plateforme, dans la même clé de préfixe que le fil : une
  // publication invalide `['notes']` et rafraîchit donc aussi cette liste.
  const listQuery = useQuery({
    queryKey: ['notes', { scope: 'platform_directors', diffusion: true }],
    queryFn: () => notesAPI.getAll({ scope: 'platform_directors', limit: 50 }),
  });
  const circulars = listQuery.data?.data?.data || [];

  const diffusionQuery = useQuery({
    queryKey: ['note-diffusion', selectedId],
    queryFn: () => notesAPI.getDiffusion(selectedId),
    enabled: Boolean(selectedId),
    refetchInterval: selectedId ? REFRESH_MS : false,
  });
  const diffusion = diffusionQuery.data?.data?.data || null;

  const remind = useMutation({
    mutationFn: ({ id, userIds }) => notesAPI.remind(id, userIds),
    onSuccess: (res) => {
      const payload = res?.data;
      if (payload?.data?.reminded === 0) toast(payload.message);
      else toast.success(payload?.message || 'Relance envoyée');
      queryClient.invalidateQueries({ queryKey: ['note-diffusion'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Relance impossible'),
  });

  // Repli de titre le temps que la diffusion se charge : un `find` sur 50
  // éléments n'a rien à mémoriser, et `circulars` change d'identité à chaque
  // rendu tant que la requête n'a pas abouti.
  const selected = circulars.find((c) => c.id === selectedId) || null;

  // ── Liste des circulaires ────────────────────────────────────
  if (!selectedId) {
    const totalRecipients = circulars.reduce((s, c) => s + (c.recipientsCount || 0), 0);
    const totalRead = circulars.reduce((s, c) => s + (c.readCount || 0), 0);
    const globalRate = totalRecipients ? Math.round((totalRead / totalRecipients) * 100) : 0;
    const unreadCirculars = circulars.filter(
      (c) => (c.recipientsCount || 0) > (c.readCount || 0)
    ).length;

    return (
      <div className="cd-wrap">
        <div className="cd-head">
          <div>
            <h3 className="cd-title"><Megaphone size={18} /> Diffusion des circulaires nationales</h3>
            <p className="cd-sub">
              Qui a lu, qui n'a pas lu, et relance des directeurs restés silencieux.
            </p>
          </div>
          <button
            className="cd-btn cd-btn-ghost"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <RefreshCw size={14} className={listQuery.isFetching ? 'cd-spin' : ''} /> Actualiser
          </button>
        </div>

        <div className="cd-cards">
          <div className="cd-card">
            <span className="cd-card-label">Circulaires publiées</span>
            <strong className="cd-card-value">{circulars.length}</strong>
            <span className="cd-card-foot">portée plateforme</span>
          </div>
          <div className="cd-card">
            <span className="cd-card-label">Accusés de lecture</span>
            <strong className="cd-card-value">{totalRead}<span className="cd-card-of">/{totalRecipients}</span></strong>
            <span className={`cd-card-foot cd-tone-${rateTone(globalRate)}`}>{globalRate} % cumulés</span>
          </div>
          <div className="cd-card">
            <span className="cd-card-label">Diffusions incomplètes</span>
            <strong className="cd-card-value">{unreadCirculars}</strong>
            <span className="cd-card-foot">
              {unreadCirculars === 0 ? 'toutes lues intégralement' : 'au moins un non-lecteur'}
            </span>
          </div>
        </div>

        {listQuery.isLoading ? (
          <p className="cd-empty">Chargement des circulaires…</p>
        ) : circulars.length === 0 ? (
          <p className="cd-empty">
            Aucune circulaire nationale publiée pour l'instant. Utilisez le compositeur ci-dessus :
            elle partira à tous les directeurs de la plateforme.
          </p>
        ) : (
          <div className="cd-list">
            {circulars.map((c) => {
              const recipients = c.recipientsCount || 0;
              const read = c.readCount || 0;
              const rate = recipients ? Math.round((read / recipients) * 100) : 0;
              const missing = Math.max(0, recipients - read);
              return (
                <button key={c.id} className="cd-row" onClick={() => setSelectedId(c.id)}>
                  <span className={`cd-row-bar cd-bar-${rateTone(rate)}`} />
                  <div className="cd-row-main">
                    <div className="cd-row-title">
                      {c.isPinned && <span className="cd-pin" title="Épinglée">📌</span>}
                      {c.title}
                    </div>
                    <div className="cd-row-meta">
                      <span>{CATEGORY_LABEL[c.category] || c.category}</span>
                      <span className="cd-dot">·</span>
                      <span>Priorité {PRIORITY_LABEL[c.priority] || c.priority}</span>
                      <span className="cd-dot">·</span>
                      <span>{dayOnly(c.publishedAt)}</span>
                      {c.attachmentsCount > 0 && (
                        <>
                          <span className="cd-dot">·</span>
                          <span>📎 {c.attachmentsCount}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="cd-row-stat">
                    <span className={`cd-rate cd-tone-${rateTone(rate)}`}>{rate} %</span>
                    <span className="cd-row-count">{read}/{recipients} lu</span>
                    {missing > 0 && <span className="cd-row-missing">{missing} en attente</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <Note tone="info">
          Le taux affiché ici compare l'audience enregistrée au moment de l'envoi. Ouvrez une
          circulaire pour connaître l'audience du jour et le nom de chaque non-lecteur.
        </Note>
      </div>
    );
  }

  // ── Détail de diffusion d'une circulaire ─────────────────────
  const s = diffusion?.summary;
  const unread = diffusion?.unread || [];
  const read = diffusion?.read || [];
  const remindAllPending = remind.isPending && !remind.variables?.userIds;

  return (
    <div className="cd-wrap">
      <div className="cd-head">
        <div>
          <button className="cd-back" onClick={() => setSelectedId(null)}>
            <ChevronLeft size={15} /> Toutes les circulaires
          </button>
          <h3 className="cd-title cd-title-tight">
            {diffusion?.note?.title || selected?.title || 'Circulaire'}
          </h3>
          <p className="cd-sub">
            Publiée le {dateTime(diffusion?.note?.publishedAt || selected?.publishedAt)}
            {diffusion?.note?.author ? ` par ${diffusion.note.author}` : ''}
            {diffusion?.note ? ` · ${CATEGORY_LABEL[diffusion.note.category] || diffusion.note.category}` : ''}
          </p>
        </div>
        <div className="cd-head-actions">
          <span className="cd-sync">
            <span className="cd-live-dot" />
            Synchronisé à {clock(diffusionQuery.dataUpdatedAt)}
          </span>
          <button
            className="cd-btn cd-btn-ghost"
            onClick={() => diffusionQuery.refetch()}
            disabled={diffusionQuery.isFetching}
          >
            <RefreshCw size={14} className={diffusionQuery.isFetching ? 'cd-spin' : ''} /> Actualiser
          </button>
        </div>
      </div>

      {diffusionQuery.isLoading ? (
        <p className="cd-empty">Calcul de la diffusion…</p>
      ) : !diffusion ? (
        <p className="cd-empty">Diffusion indisponible pour cette circulaire.</p>
      ) : (
        <>
          <div className="cd-cards">
            <div className="cd-card">
              <span className="cd-card-label">Audience aujourd'hui</span>
              <strong className="cd-card-value">{s.audience}</strong>
              <span className="cd-card-foot">
                {s.audience === diffusion.note.recipientsAtPublish
                  ? 'inchangée depuis l\'envoi'
                  : `${diffusion.note.recipientsAtPublish} au moment de l'envoi`}
              </span>
            </div>
            <div className="cd-card">
              <span className="cd-card-label">Ont lu</span>
              <strong className="cd-card-value cd-tone-ok">{s.read}</strong>
              <span className={`cd-card-foot cd-tone-${rateTone(s.rate)}`}>{s.rate} % de l'audience</span>
            </div>
            <div className="cd-card">
              <span className="cd-card-label">N'ont pas lu</span>
              <strong className={`cd-card-value ${s.unread ? 'cd-tone-bad' : 'cd-tone-ok'}`}>{s.unread}</strong>
              <span className="cd-card-foot">
                {s.neverNotified > 0 ? `dont ${s.neverNotified} jamais notifié(s)` : 'tous ont été notifiés'}
              </span>
            </div>
            <div className="cd-card">
              <span className="cd-card-label">Relances envoyées</span>
              <strong className="cd-card-value">{s.remindersTotal}</strong>
              <span className="cd-card-foot">
                {s.lastReminderAt ? `dernière le ${dateTime(s.lastReminderAt)}` : 'aucune à ce jour'}
              </span>
            </div>
          </div>

          <div className="cd-progress" title={`${s.read} lecteur(s) sur ${s.audience}`}>
            <div className={`cd-progress-fill cd-bar-${rateTone(s.rate)}`} style={{ width: `${s.rate}%` }} />
          </div>

          {s.neverNotified > 0 && (
            <Note tone="warn" icon={CircleSlash}>
              {s.neverNotified} destinataire(s) ne figuraient pas dans l'audience au moment de la
              publication — nommés depuis, ils n'ont jamais reçu la circulaire. La relance les
              inclut et vaut, pour eux, un premier envoi.
            </Note>
          )}
          {s.readOutsideAudience > 0 && (
            <Note tone="info">
              {s.readOutsideAudience} accusé(s) de lecture provien(nen)t de comptes qui ne font plus
              partie de l'audience (mutation ou désactivation depuis l'envoi) : ils ne sont pas
              comptés dans le taux ci-dessus.
            </Note>
          )}

          {/* ── Non-lecteurs ── */}
          <div className="cd-section">
            <div className="cd-section-head">
              <h4 className="cd-section-title">
                <MailWarning size={16} /> N'ont pas lu ({unread.length})
              </h4>
              {unread.length > 0 && (
                <button
                  className="cd-btn cd-btn-primary"
                  onClick={() => remind.mutate({ id: selectedId })}
                  disabled={remind.isPending}
                >
                  <BellRing size={14} /> {remindAllPending ? 'Envoi…' : `Relancer les ${unread.length} non-lecteurs`}
                </button>
              )}
            </div>

            {unread.length === 0 ? (
              <p className="cd-ok-line">
                <UserCheck size={15} /> Toute l'audience a accusé réception de cette circulaire.
              </p>
            ) : (
              <div className="cd-table-scroll">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th>Destinataire</th>
                      <th>Établissement</th>
                      <th>Notifié le</th>
                      <th>Relances</th>
                      <th className="cd-th-action">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unread.map((p) => (
                      <tr key={p.userId}>
                        <td>
                          <span className="cd-person">
                            <UserX size={14} className="cd-ico-bad" />
                            <span>
                              <strong>{p.name}</strong>
                              {p.roleName && <span className="cd-role">{p.roleName}</span>}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="cd-est">
                            <Building2 size={13} />
                            {p.establishmentName || 'Sans établissement'}
                            {p.establishmentCode && <span className="cd-code">{p.establishmentCode}</span>}
                          </span>
                        </td>
                        <td>
                          {p.neverNotified
                            ? <span className="cd-tag cd-tag-warn">jamais notifié</span>
                            : dateTime(p.notifiedAt)}
                        </td>
                        <td>
                          {p.remindersSent > 0 ? (
                            <span className="cd-tag cd-tag-info" title={`Dernière : ${dateTime(p.lastReminderAt)}`}>
                              {p.remindersSent} relance{p.remindersSent > 1 ? 's' : ''}
                            </span>
                          ) : <span className="cd-muted">—</span>}
                        </td>
                        <td className="cd-th-action">
                          <button
                            className="cd-btn cd-btn-mini"
                            onClick={() => remind.mutate({ id: selectedId, userIds: [p.userId] })}
                            disabled={remind.isPending}
                          >
                            <BellRing size={12} /> Relancer
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Note tone="info" icon={Clock3}>
              Une relance au plus toutes les {diffusion.cooldownMinutes} minutes par circulaire.
              Chaque envoi est inscrit à l'historique : destinataires, auteur de la relance et
              horodatage.
            </Note>
          </div>

          {/* ── Lecteurs ── */}
          <div className="cd-section">
            <h4 className="cd-section-title">
              <MailCheck size={16} /> Ont lu ({read.length})
            </h4>
            {read.length === 0 ? (
              <p className="cd-empty cd-empty-tight">Aucun accusé de lecture pour l'instant.</p>
            ) : (
              <div className="cd-table-scroll">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th>Destinataire</th>
                      <th>Établissement</th>
                      <th>Lu le</th>
                      <th>Relancé avant lecture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {read.map((p) => (
                      <tr key={p.userId}>
                        <td>
                          <span className="cd-person">
                            <UserCheck size={14} className="cd-ico-ok" />
                            <span>
                              <strong>{p.name}</strong>
                              {p.roleName && <span className="cd-role">{p.roleName}</span>}
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className="cd-est">
                            <Building2 size={13} />
                            {p.establishmentName || 'Sans établissement'}
                            {p.establishmentCode && <span className="cd-code">{p.establishmentCode}</span>}
                          </span>
                        </td>
                        <td>{dateTime(p.readAt)}</td>
                        <td>
                          {p.remindersSent > 0
                            ? <span className="cd-tag cd-tag-info">{p.remindersSent}</span>
                            : <span className="cd-muted">non</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
