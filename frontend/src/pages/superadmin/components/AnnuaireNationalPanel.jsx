/**
 * Annuaire national du personnel — Super Admin (Lot X6, D2).
 *
 * La fiche d'un établissement répond « qui travaille ici ». La question inverse
 * — *« où est cette personne ? »* — n'avait aucune réponse : retrouver un agent
 * obligeait à ouvrir les établissements un par un. Cet écran sert la recherche
 * transverse : un nom, un matricule, un téléphone ou un e-mail, sur tout le
 * réseau, avec les filtres qui comptent (établissement, rôle, état du compte).
 *
 * ── Ce que l'écran ne fait pas ────────────────────────────────
 * Aucune action n'est réimplémentée : suspendre, réactiver et archiver appellent
 * les endpoints déjà en service (`/users/:id/activate|deactivate`,
 * `/user-archive/:id/archive|unarchive`). Le serveur reste l'autorité —
 * un refus est affiché tel quel, jamais masqué.
 *
 * ── Honnêteté des résultats ───────────────────────────────────
 * Un terme d'un seul caractère est ignoré par le serveur (`queryIgnored`) : le
 * panneau le dit explicitement, au lieu de présenter la liste complète comme un
 * résultat de recherche. La pagination affiche toujours le total réel.
 *
 * Fichier NEUF, aucun écran existant modifié.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Archive, ArchiveRestore, ArrowLeft, Building2, ChevronLeft, ChevronRight,
  IdCard, Info, Mail, MapPin, Phone, RefreshCw, Search, ShieldCheck,
  UserCheck, UserPlus, UserX, Users, X,
} from 'lucide-react';
import { adminAPI, userArchiveAPI, usersAPI } from '../../../api';
import Avatar from '../../../components/common/Avatar';
import CreateAccountModal from './CreateAccountModal';
import './AnnuaireNationalPanel.css';

const PAGE_SIZE = 25;

/** Libellés des états de compte — mêmes clés que `STATUS_FILTERS` côté serveur. */
const STATUS_META = {
  active:          { label: 'Actifs',            tone: 'ok' },
  suspended:       { label: 'Suspendus',         tone: 'bad' },
  archived:        { label: 'Archivés',          tone: 'muted' },
  no_login:        { label: 'Sans accès',        tone: 'warn' },
  never_connected: { label: 'Jamais connectés',  tone: 'warn' },
};

const nf = (n) => Number(n || 0).toLocaleString('fr-FR');

/**
 * `YYYY-MM-DD` ou `YYYY-MM-DD HH:MM` → `JJ/MM/AAAA` (+ ` à HH:MM`).
 * Découpage par expression régulière, jamais `new Date(str)` : une colonne DATE
 * passée au constructeur est interprétée en UTC puis réaffichée en heure locale,
 * ce qui recule la date d'un jour sur les fuseaux à l'est de Greenwich.
 */
const frDate = (s) => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s));
  if (!m) return String(s);
  const day = `${m[3]}/${m[2]}/${m[1]}`;
  return m[4] ? `${day} à ${m[4]}:${m[5]}` : day;
};

/** Étiquette d'état d'un compte, dans l'ordre de gravité décroissante. */
const StateTag = ({ person }) => {
  if (person.isArchived) return <span className="an-tag an-tag-muted">archivé</span>;
  if (!person.isActive) return <span className="an-tag an-tag-bad">suspendu</span>;
  if (!person.canLogin) return <span className="an-tag an-tag-warn">sans accès</span>;
  return <span className="an-tag an-tag-ok">actif</span>;
};

// ══════════════════════════════════════════════════════════════
// Fiche d'une personne
// ══════════════════════════════════════════════════════════════
const PersonSheet = ({ personId, onClose }) => {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [askArchive, setAskArchive] = useState(false);

  const { data: p, isLoading, isError } = useQuery({
    queryKey: ['admin-annuaire', 'person', personId],
    queryFn: () => adminAPI.getAnnuairePerson(personId).then((r) => r.data.data),
    enabled: Boolean(personId),
    staleTime: 5000,
  });

  // Toutes les actions partagent le même cycle : le serveur décide, l'annuaire
  // se recalcule, le message du serveur est affiché tel quel.
  const act = useMutation({
    mutationFn: ({ kind }) => {
      if (kind === 'suspend')   return usersAPI.deactivate(personId);
      if (kind === 'reactivate') return usersAPI.activate(personId);
      if (kind === 'archive')   return userArchiveAPI.archive(personId, { reason: reason.trim() || undefined });
      return userArchiveAPI.unarchive(personId);
    },
    onSuccess: (res) => {
      toast.success(res?.data?.message || 'Action effectuée');
      setAskArchive(false);
      setReason('');
      // Préfixe : la fiche, la liste de recherche et les facettes se recalculent.
      qc.invalidateQueries({ queryKey: ['admin-annuaire'] });
      // La conformité compte les directeurs actifs : une suspension peut faire
      // basculer un établissement en « bloqué ».
      qc.invalidateQueries({ queryKey: ['admin-conformite'] });
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || 'Action refusée');
    },
  });

  const busy = act.isPending;

  return (
    <div className="an-overlay" role="presentation" onClick={onClose}>
      <aside
        className="an-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Fiche du personnel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="an-sheet-head">
          <button type="button" className="an-back" onClick={onClose}>
            <ArrowLeft size={13} aria-hidden="true" /> Fermer
          </button>
          <button type="button" className="an-close" onClick={onClose} aria-label="Fermer">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {isLoading && <div className="an-state">Chargement de la fiche…</div>}
        {isError && <div className="an-state">La fiche n'a pas pu être chargée.</div>}

        {p && (
          <div className="an-sheet-body">
            {/* ── Identité ─────────────────────────────────── */}
            <div className="an-ident">
              <Avatar
                avatarUrl={p.avatarUrl}
                firstName={p.firstName}
                lastName={p.lastName}
                size="lg"
              />
              <div>
                <h3>{p.name}</h3>
                {p.nameAr && <p className="an-ident-ar" dir="rtl">{p.nameAr}</p>}
                <p className="an-ident-role">
                  {p.roleName}
                  {p.secondaryRoleName ? ` · ${p.secondaryRoleName}` : ''}
                  {p.jobTitle ? ` · ${p.jobTitle}` : ''}
                </p>
                <div className="an-ident-tags">
                  <StateTag person={p} />
                  {p.isOnLeave && <span className="an-tag an-tag-warn">en congé</span>}
                </div>
              </div>
            </div>

            {p.isArchived && (
              <p className="an-note an-note-warn">
                <Archive size={14} aria-hidden="true" />
                Compte archivé le {frDate(p.archivedAt) || '—'}
                {p.archiveReason ? ` — motif : ${p.archiveReason}` : ''}. L'accès est bloqué
                intégralement, les données restent conservées.
              </p>
            )}

            {/* ── Rattachement ─────────────────────────────── */}
            <section className="an-sect">
              <h4><Building2 size={13} aria-hidden="true" /> Rattachement</h4>
              <dl className="an-dl">
                <div>
                  <dt>Établissement</dt>
                  <dd>{p.establishment.name} ({p.establishment.code})</dd>
                </div>
                <div>
                  <dt>Localisation</dt>
                  <dd>
                    {[p.establishment.city, p.establishment.governorate].filter(Boolean).join(' · ') || '—'}
                  </dd>
                </div>
              </dl>
              {p.departments.length === 0 ? (
                <p className="an-empty">Rattaché à aucun service.</p>
              ) : (
                <ul className="an-rows">
                  {p.departments.map((d) => (
                    <li key={d.id} className="an-row">
                      <div className="an-row-main">
                        <span className="an-row-name">{d.name}</span>
                        <span className="an-row-sub">
                          {d.code || '—'}{d.joinedAt ? ` · depuis le ${frDate(d.joinedAt)}` : ''}
                        </span>
                      </div>
                      <div className="an-row-tags">
                        {d.isHead && <span className="an-tag an-tag-ok">chef de service</span>}
                        {d.isPrimary && <span className="an-tag">service principal</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ── Coordonnées ──────────────────────────────── */}
            <section className="an-sect">
              <h4><Mail size={13} aria-hidden="true" /> Coordonnées et dossier</h4>
              <dl className="an-dl">
                <div><dt>E-mail</dt><dd>{p.email}</dd></div>
                <div><dt>Téléphone</dt><dd>{p.phone || '—'}</dd></div>
                <div><dt>Matricule</dt><dd>{p.matricule || '—'}</dd></div>
                <div><dt>Grade</dt><dd>{p.grade || '—'}</dd></div>
                <div><dt>Spécialité</dt><dd>{p.speciality || '—'}</dd></div>
                <div><dt>Catégorie</dt><dd>{p.jobCategory || '—'}</dd></div>
                <div><dt>Recrutement</dt><dd>{frDate(p.hireDate) || '—'}</dd></div>
                <div><dt>Compte créé le</dt><dd>{frDate(p.createdAt) || '—'}</dd></div>
                <div>
                  <dt>Dernière connexion</dt>
                  <dd>{frDate(p.lastLogin) || (p.canLogin ? 'jamais connecté' : 'sans accès')}</dd>
                </div>
              </dl>
            </section>

            {/* ── Actions ──────────────────────────────────── */}
            <section className="an-sect">
              <h4><ShieldCheck size={13} aria-hidden="true" /> Gestion du compte</h4>

              {p.roleCode === 'super_admin' ? (
                <p className="an-note">
                  <Info size={14} aria-hidden="true" />
                  Un compte Super Admin ne peut être ni suspendu ni archivé depuis l'annuaire.
                </p>
              ) : (
                <>
                  <div className="an-actions">
                    {p.isArchived ? (
                      <button
                        type="button"
                        className="an-btn an-btn-ok"
                        onClick={() => act.mutate({ kind: 'unarchive' })}
                        disabled={busy}
                      >
                        <ArchiveRestore size={13} aria-hidden="true" /> Désarchiver
                      </button>
                    ) : (
                      <>
                        {p.isActive ? (
                          <button
                            type="button"
                            className="an-btn an-btn-warn"
                            onClick={() => act.mutate({ kind: 'suspend' })}
                            disabled={busy}
                          >
                            <UserX size={13} aria-hidden="true" /> Suspendre
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="an-btn an-btn-ok"
                            onClick={() => act.mutate({ kind: 'reactivate' })}
                            disabled={busy}
                          >
                            <UserCheck size={13} aria-hidden="true" /> Réactiver
                          </button>
                        )}
                        <button
                          type="button"
                          className="an-btn an-btn-bad"
                          onClick={() => setAskArchive((v) => !v)}
                          disabled={busy}
                        >
                          <Archive size={13} aria-hidden="true" /> Archiver
                        </button>
                      </>
                    )}
                  </div>

                  {askArchive && !p.isArchived && (
                    <div className="an-archive-box">
                      <p>
                        Archiver bloque l'accès intégralement et conserve toutes les données.
                        L'opération est réversible et tracée dans l'historique.
                      </p>
                      <input
                        className="an-input"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Motif (facultatif, conservé dans l'historique)"
                      />
                      <div className="an-actions">
                        <button
                          type="button"
                          className="an-btn an-btn-ghost"
                          onClick={() => { setAskArchive(false); setReason(''); }}
                          disabled={busy}
                        >
                          Annuler
                        </button>
                        <button
                          type="button"
                          className="an-btn an-btn-bad"
                          onClick={() => act.mutate({ kind: 'archive' })}
                          disabled={busy}
                        >
                          {busy ? 'Archivage…' : 'Confirmer l\'archivage'}
                        </button>
                      </div>
                    </div>
                  )}

                  <p className="an-note">
                    <Info size={14} aria-hidden="true" />
                    Suspendre ferme la session sans toucher au dossier ; archiver bloque le compte
                    et le retire des listes d'affectation. Les deux sont réversibles.
                  </p>
                </>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
export default function AnnuaireNationalPanel() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [establishmentId, setEstablishmentId] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);

  // Frappe amortie : une requête par pause de saisie, pas une par caractère.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 320);
    return () => clearTimeout(t);
  }, [term]);

  // Tout changement de critère ramène à la première page : rester en page 4
  // d'un résultat qui n'en compte qu'une afficherait une liste vide.
  useEffect(() => { setPage(1); }, [debounced, establishmentId, roleCode, status]);

  const { data: facets } = useQuery({
    queryKey: ['admin-annuaire', 'facets'],
    queryFn: () => adminAPI.getAnnuaireFacets().then((r) => r.data.data),
    staleTime: 60000,
  });

  const params = useMemo(() => ({
    q: debounced || undefined,
    establishmentId: establishmentId || undefined,
    roleCode: roleCode || undefined,
    status: status || undefined,
    page,
    pageSize: PAGE_SIZE,
  }), [debounced, establishmentId, roleCode, status, page]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['admin-annuaire', 'search', params],
    queryFn: () => adminAPI.searchStaff(params).then((r) => r.data.data),
    staleTime: 5000,
  });

  const totals = facets?.totals;
  const hasFilter = Boolean(debounced || establishmentId || roleCode || status);

  const reset = () => {
    setTerm(''); setDebounced(''); setEstablishmentId(''); setRoleCode(''); setStatus('');
  };

  return (
    <div className="an-wrap">
      {/* ── En-tête ────────────────────────────────────────── */}
      <div className="an-head">
        <div>
          <h2 className="an-head-title">Annuaire national du personnel</h2>
          <p className="an-head-sub">
            Recherche transverse sur tout le réseau : nom, matricule, téléphone ou e-mail.
            La fiche d'un établissement répond « qui travaille ici » ; l'annuaire répond
            « où est cette personne ».
          </p>
        </div>
        <div className="an-head-actions">
          <button type="button" className="an-btn an-btn-primary" onClick={() => setCreating(true)}>
            <UserPlus size={14} aria-hidden="true" /> Créer un compte
          </button>
          <button type="button" className="an-refresh" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? 'an-spin' : undefined} aria-hidden="true" />
            {isFetching ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </div>

      {/* ── Totaux nationaux ───────────────────────────────── */}
      {totals && (
        <div className="an-kpis">
          <button
            type="button"
            className={`an-kpi${!status ? ' an-kpi-on' : ''}`}
            onClick={() => setStatus('')}
          >
            <Users size={15} aria-hidden="true" />
            <div><b>{nf(totals.total)}</b><span>agents au total</span></div>
          </button>
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <button
              key={key}
              type="button"
              className={`an-kpi an-kpi-${meta.tone}${status === key ? ' an-kpi-on' : ''}`}
              onClick={() => setStatus((s) => (s === key ? '' : key))}
            >
              <div>
                <b>{nf(totals[key])}</b>
                <span>{meta.label.toLowerCase()}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Recherche et filtres ───────────────────────────── */}
      <div className="an-toolbar">
        <div className="an-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Nom, matricule, téléphone, e-mail…"
            aria-label="Rechercher une personne"
          />
        </div>

        <select
          className="an-select"
          value={establishmentId}
          onChange={(e) => setEstablishmentId(e.target.value)}
          aria-label="Filtrer par établissement"
        >
          <option value="">Tous les établissements</option>
          {(facets?.establishments || []).map((e) => (
            <option key={e.id} value={e.id}>{e.name} ({nf(e.staff)})</option>
          ))}
        </select>

        <select
          className="an-select"
          value={roleCode}
          onChange={(e) => setRoleCode(e.target.value)}
          aria-label="Filtrer par rôle"
        >
          <option value="">Tous les rôles</option>
          {(facets?.roles || []).filter((r) => r.staff > 0).map((r) => (
            <option key={r.code} value={r.code}>{r.name} ({nf(r.staff)})</option>
          ))}
        </select>

        {hasFilter && (
          <button type="button" className="an-reset" onClick={reset}>
            <X size={13} aria-hidden="true" /> Réinitialiser
          </button>
        )}
      </div>

      {data?.queryIgnored && (
        <p className="an-note an-note-warn">
          <Info size={14} aria-hidden="true" />
          Terme trop court : la recherche démarre à {data.minQueryLength} caractères. La liste
          ci-dessous n'est donc pas un résultat de recherche.
        </p>
      )}

      {/* ── Résultats ──────────────────────────────────────── */}
      {isLoading ? (
        <div className="an-state">Recherche…</div>
      ) : isError || !data ? (
        <div className="an-state">
          La recherche n'a pas pu aboutir.
          <p className="an-empty-hint">Réessayez dans un instant — aucune donnée n'a été modifiée.</p>
        </div>
      ) : data.people.length === 0 ? (
        <div className="an-state">
          Aucune personne ne correspond.
          <p className="an-empty-hint">
            Élargissez la recherche ou retirez un filtre. La recherche tolère les fautes de
            frappe dans l'ordre d'affichage, mais un nom doit correspondre au moins partiellement.
          </p>
        </div>
      ) : (
        <>
          <p className="an-count">
            {nf(data.total)} personne(s){hasFilter ? ' pour ces critères' : ' au total'}
            {data.pages > 1 ? ` · page ${data.page} sur ${data.pages}` : ''}
          </p>

          <div className="an-list">
            {data.people.map((p) => (
              <button key={p.id} type="button" className="an-item" onClick={() => setOpenId(p.id)}>
                <Avatar
                  avatarUrl={p.avatarUrl}
                  firstName={p.firstName}
                  lastName={p.lastName}
                  size="md"
                />

                <div className="an-item-main">
                  <span className="an-item-name">
                    {p.name}
                    {p.isHead && <em className="an-chip">chef de service</em>}
                  </span>
                  <span className="an-item-sub">
                    {p.roleName}
                    {p.jobTitle ? ` · ${p.jobTitle}` : ''}
                    {p.departments ? ` · ${p.departments}` : ''}
                  </span>
                  <span className="an-item-est">
                    <Building2 size={11} aria-hidden="true" />
                    {p.establishmentName}
                    {p.governorate ? ` · ${p.governorate}` : ''}
                  </span>
                </div>

                <div className="an-item-side">
                  <StateTag person={p} />
                  <span className="an-item-contact">
                    {p.matricule && <em><IdCard size={11} aria-hidden="true" /> {p.matricule}</em>}
                    {p.phone && <em><Phone size={11} aria-hidden="true" /> {p.phone}</em>}
                  </span>
                  <span className="an-item-login">
                    {p.lastLogin ? `vu le ${frDate(p.lastLogin)}` : p.canLogin ? 'jamais connecté' : 'sans accès'}
                  </span>
                </div>
                <ChevronRight size={16} className="an-item-chevron" aria-hidden="true" />
              </button>
            ))}
          </div>

          {data.pages > 1 && (
            <div className="an-pager">
              <button
                type="button"
                className="an-btn an-btn-ghost"
                onClick={() => setPage((n) => Math.max(1, n - 1))}
                disabled={data.page <= 1}
              >
                <ChevronLeft size={13} aria-hidden="true" /> Précédent
              </button>
              <span>Page {data.page} / {data.pages}</span>
              <button
                type="button"
                className="an-btn an-btn-ghost"
                onClick={() => setPage((n) => Math.min(data.pages, n + 1))}
                disabled={data.page >= data.pages}
              >
                Suivant <ChevronRight size={13} aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}

      <p className="an-foot">
        <MapPin size={12} aria-hidden="true" />
        Les comptes du réseau uniquement : l'établissement système et le compte Super Admin
        n'y figurent pas.
      </p>

      {openId && <PersonSheet personId={openId} onClose={() => setOpenId(null)} />}

      <CreateAccountModal
        open={creating}
        onClose={() => setCreating(false)}
        establishmentId={establishmentId || ''}
      />
    </div>
  );
}
