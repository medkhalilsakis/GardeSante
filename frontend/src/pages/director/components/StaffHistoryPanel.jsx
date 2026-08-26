/**
 * Historique du personnel — consultation seule
 * ═══════════════════════════════════════════
 * « Tous les acteurs ont un historique constant ne peuvent pas le modifier,
 * permet la traçabilité de toute action le fait l'acteur » : aucun bouton
 * d'édition ni de suppression n'existe ici, et il n'en existe pas côté serveur.
 * Cette contrainte est la raison d'être de l'écran, elle est donc écrite en tête
 * du panneau et non enfouie dans un commentaire.
 *
 * La portée est bornée par le backend à l'établissement du directeur —
 * `/history/all` et `/history/users` filtrent sur `establishment_id`.
 *
 * Ce que la refonte change :
 *   • le code d'action redevient un identifiant en chasse fixe, sans couleur :
 *     les quatre teintes de gravité codées en dur peignaient l'action alors que
 *     c'est la gravité qui les portait ;
 *   • la gravité devient une colonne : muette pour `info`, marquée pour tout ce
 *     qui est au-dessus, et une erreur ou une trace critique signale sa ligne ;
 *   • le tableau devient un registre du kit, avec ses filets horizontaux et son
 *     défilement interne — la page ne s'élargit plus sur une description longue.
 *
 * Aucun filtre de gravité n'est proposé : la liste est paginée côté serveur
 * (40 par page) et le serveur ne sait pas filtrer sur `severity`. Un filtre
 * client donnerait un compte faux sur une page.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, RotateCcw, Lock } from 'lucide-react';
import { historyAPI } from '../../../api';
import { GsPanel, GsTable, GsBadge, GsEmpty, GsSkeleton } from '../../../components/gs';
import './director-panels.css';

const PAGE_SIZE = 40;

/** `info` est le cas courant : il ne se signale pas. */
const SEVERITY_LABEL = { warning: 'Avertissement', error: 'Erreur', critical: 'Critique' };

const fmtDateTime = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

export default function StaffHistoryPanel() {
  const [userId, setUserId] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data: staff = [] } = useQuery({
    queryKey: ['history-users'],
    queryFn: () => historyAPI.getUsersList().then((r) => r.data.data),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['history-categories', 'establishment'],
    queryFn: () => historyAPI
      .getCategories({ scope: 'establishment' })
      .then((r) => r.data.data),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['history-staff', userId, category, search, page],
    queryFn: () => historyAPI.getAll({
      page,
      limit: PAGE_SIZE,
      userId: userId || undefined,
      category: category || undefined,
      search: search || undefined,
    }).then((r) => r.data),
  });

  const rows = data?.data || [];
  const total = data?.pagination?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const forbidden = error?.response?.status === 403;
  const criteriaActive = Boolean(userId || category || search);

  // Changer un critère renvoie à la première page : rester en page 4 d'un
  // ensemble qui n'en compte plus qu'une affichait une liste vide.
  const reset = (fn) => (value) => { fn(value); setPage(1); };

  const columns = [
    {
      key: 'when', label: 'Date', width: 132,
      render: (r) => <span className="gsdp-code">{fmtDateTime(r.created_at)}</span>,
    },
    {
      key: 'who', label: 'Acteur',
      render: (r) => (
        <div className="gsdp-name">
          <b>{r.first_name} {r.last_name}</b>
          <span>{r.role_name || 'Rôle non renseigné'}</span>
        </div>
      ),
    },
    {
      key: 'action', label: 'Action',
      render: (r) => <span className="gsdp-code">{r.action}</span>,
    },
    {
      key: 'category', label: 'Catégorie',
      render: (r) => (r.category
        ? <span className="gsdp-word">{r.category}</span>
        : <span className="gsdp-word is-void">—</span>),
    },
    {
      key: 'severity', label: 'Gravité', width: 116,
      render: (r) => (SEVERITY_LABEL[r.severity] ? (
        <GsBadge tone="alert" dot>{SEVERITY_LABEL[r.severity]}</GsBadge>
      ) : (
        <span className="gsdp-word is-void">—</span>
      )),
    },
    {
      key: 'desc', label: 'Description',
      render: (r) => (r.description
        ? <span className="gsdp-desc">{r.description}</span>
        : <span className="gsdp-desc is-void">Aucune description</span>),
    },
  ];

  return (
    <div className="gsdp-stack">
      <GsPanel
        flush
        icon={<History size={14} strokeWidth={2} />}
        title="Historique du personnel"
        sub="Chaque action de chaque acteur de l'hôpital y est tracée. La consultation est le seul geste possible : aucune trace ne peut être modifiée ni supprimée, ici comme côté serveur."
        tools={<GsBadge tone="seal" icon={<Lock size={11} strokeWidth={2.4} />}>Registre immuable</GsBadge>}
      >
        <div className="gsdp-filters">
          <label className="gsdp-field">
            <span>Acteur</span>
            <select className="form-control" value={userId} onChange={(e) => reset(setUserId)(e.target.value)}>
              <option value="">Tous les agents</option>
              {staff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.last_name} {u.first_name}{u.role_name ? ` · ${u.role_name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="gsdp-field">
            <span>Catégorie</span>
            <select className="form-control" value={category} onChange={(e) => reset(setCategory)(e.target.value)}>
              <option value="">Toutes les catégories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="gsdp-field">
            <span>Recherche</span>
            <input
              type="search"
              className="form-control"
              placeholder="Nom de l'agent…"
              value={search}
              onChange={(e) => reset(setSearch)(e.target.value)}
            />
          </label>
          <div className="gsdp-filters-reset">
            <button
              type="button"
              className="gs-btn is-quiet"
              disabled={!criteriaActive}
              onClick={() => { setUserId(''); setCategory(''); setSearch(''); setPage(1); }}
            >
              <RotateCcw size={13} strokeWidth={2} /> Réinitialiser
            </button>
          </div>
        </div>

        {forbidden ? (
          <div className="gsdp-pad">
            <GsEmpty
              icon={<Lock size={24} strokeWidth={1.6} />}
              title="Historique non accessible avec votre rôle"
              hint="Seule la direction de l'établissement consulte l'historique de tout son personnel."
            />
          </div>
        ) : error ? (
          <div className="gsdp-pad">
            <GsEmpty
              title="L'historique n'a pas pu être chargé"
              hint="La liste n'a pas répondu. Rien n'est perdu : l'historique est conservé côté serveur."
            />
          </div>
        ) : isLoading ? (
          <div className="gsdp-pad"><GsSkeleton variant="rows" count={6} /></div>
        ) : (
          <>
            <GsTable
              label="Actions tracées dans l'établissement"
              columns={columns}
              rows={rows}
              rowKey="id"
              // Une erreur ou une trace critique se repère au balayage ; un
              // avertissement porte son badge sans marquer toute la ligne.
              flagged={(r) => r.severity === 'error' || r.severity === 'critical'}
              caption={total
                ? `${total} action(s) tracée(s) · ${PAGE_SIZE} par page · page ${page} sur ${pages}`
                : undefined}
              empty={(
                <div className="gsdp-pad">
                  <GsEmpty
                    icon={<History size={24} strokeWidth={1.6} />}
                    title={criteriaActive ? 'Aucune action ne correspond' : 'Aucune action tracée'}
                    hint={criteriaActive
                      ? "Élargissez les critères : l'historique conserve tout, il ne supprime rien."
                      : "L'historique se remplit dès la première action d'un acteur de l'hôpital."}
                    actions={criteriaActive ? (
                      <button
                        type="button"
                        className="gs-btn is-quiet"
                        onClick={() => { setUserId(''); setCategory(''); setSearch(''); setPage(1); }}
                      >
                        <RotateCcw size={13} strokeWidth={2} /> Réinitialiser les critères
                      </button>
                    ) : undefined}
                  />
                </div>
              )}
            />

            {pages > 1 && (
              <div className="gsdp-pager">
                <button
                  type="button"
                  className="gs-btn is-quiet"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Précédent
                </button>
                <span>Page {page} / {pages}</span>
                <button
                  type="button"
                  className="gs-btn is-quiet"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  Suivant
                </button>
              </div>
            )}
          </>
        )}
      </GsPanel>
    </div>
  );
}
