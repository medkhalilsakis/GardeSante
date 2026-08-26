/**
 * Conformité des établissements — Super Admin (Lot X6, C1).
 *
 * Le tableau de bord savait dire *combien* d'établissements existent, jamais
 * *lesquels sont réellement exploitables*. Un hôpital sans directeur actif, sans
 * service, ou dont les types de garde standards manquent est créé mais inerte :
 * personne ne peut y produire un planning, et rien ne le signalait. Ce panneau
 * répond à la seule question qui compte avant une mise en service : « cet
 * établissement peut-il travailler, et si non, que manque-t-il ? »
 *
 * ── Deux verdicts, volontairement distincts ───────────────────
 * L'onglet « Référentiels » (Lot X4) porte déjà une sous-section « Conformité »,
 * bornée aux référentiels de garde et d'absence. Pour qu'aucun écran ne
 * contredise l'autre, le serveur renvoie ici les deux prédicats :
 *   • `operational`        — aucun contrôle **bloquant** en échec (verdict de cet écran) ;
 *   • `referentielsReady`  — le prédicat **exact** de l'onglet Référentiels,
 *                            réaffiché tel quel et nommé comme tel.
 * Les deux sont montrés côte à côte dans la fiche : le lecteur voit d'où vient
 * chaque couleur.
 *
 * ── Actions ───────────────────────────────────────────────────
 * Une ligne rouge est soit **réparable en un clic** (référentiels, catalogue de
 * fonctions : aucun arbitrage métier), soit **renvoyée à l'endroit qui la
 * corrige** via `onNavigate({ establishmentId, tab })` — jamais un cul-de-sac.
 * Nommer un directeur ou créer un service reste une décision de la direction :
 * ce panneau y conduit, il ne la prend pas.
 *
 * Fichier NEUF, en lecture seule hors les deux réparations documentées. Aucun
 * écran existant n'est modifié.
 */
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowLeft, Building2, CalendarCheck, CheckCircle2, ChevronRight,
  ExternalLink, Layers, MapPin, RefreshCw, Search, ShieldAlert, ShieldCheck,
  Stethoscope, UserCog, Users, Wrench, XCircle,
} from 'lucide-react';
import { adminAPI } from '../../../api';
import './ConformitePanel.css';

// Le Super Admin n'est abonné à aucune salle socket d'établissement : aucun
// événement temps réel ne lui parvient. Un intervalle propre au panneau évite de
// toucher au hook partagé `useRealtime`.
const REFRESH_MS = 60000;

const FILTERS = [
  { id: 'all',      label: 'Tous' },
  { id: 'blocked',  label: 'Bloqués' },
  { id: 'partial',  label: 'À compléter' },
  { id: 'complete', label: 'Dossiers complets' },
];

/** Libellés courts des statuts de planning affichés dans la fiche. */
const STATUS_LABELS = {
  draft: 'Brouillon',
  submitted: 'Soumis',
  under_review: 'En révision',
  approved: 'Approuvé',
  active: 'En cours',
  rejected: 'Rejeté',
  archived: 'Archivé',
};

const nf = (n) => Number(n || 0).toLocaleString('fr-FR');

const shortDate = (day) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '—';
  return `${m[3]}/${m[2]}`;
};

/** Pastille de verdict : trois états, jamais deux (bloqué / incomplet / complet). */
const Verdict = ({ fiche, size = 'md' }) => {
  const [Icon, label, tone] = fiche.complete
    ? [ShieldCheck, 'Dossier complet', 'ok']
    : fiche.operational
      ? [ShieldAlert, 'Exploitable, à compléter', 'warn']
      : [XCircle, 'Bloqué', 'bad'];
  return (
    <span className={`cf-verdict cf-verdict-${tone} cf-verdict-${size}`}>
      <Icon size={size === 'sm' ? 12 : 14} aria-hidden="true" />
      {label}
    </span>
  );
};

/** Jauge « n / 8 contrôles au vert ». */
const Score = ({ score, blocking }) => {
  const pct = score.total > 0 ? Math.round((score.passed / score.total) * 100) : 0;
  const tone = blocking > 0 ? 'bad' : pct === 100 ? 'ok' : 'warn';
  return (
    <div className="cf-score">
      <div className="cf-score-head">
        <span>{score.passed} / {score.total} contrôles</span>
        <span className="cf-score-pct">{pct}%</span>
      </div>
      <div className="cf-score-bar">
        <div className={`cf-score-fill cf-fill-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// Liste du réseau
// ══════════════════════════════════════════════════════════════
const NetworkList = ({ data, isFetching, refetch, onOpen }) => {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const { establishments, summary } = data;

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return establishments.filter((e) => {
      if (filter === 'blocked' && e.operational) return false;
      if (filter === 'complete' && !e.complete) return false;
      if (filter === 'partial' && (!e.operational || e.complete)) return false;
      if (!term) return true;
      return [e.name, e.code, e.governorate, e.city]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(term));
    });
  }, [establishments, filter, search]);

  const counts = useMemo(() => ({
    all: establishments.length,
    blocked: summary.blocked,
    complete: summary.complete,
    partial: establishments.filter((e) => e.operational && !e.complete).length,
  }), [establishments, summary.blocked, summary.complete]);

  return (
    <div className="cf-wrap">
      {/* ── En-tête ────────────────────────────────────────── */}
      <div className="cf-head">
        <div>
          <h2 className="cf-head-title">Conformité des établissements</h2>
          <p className="cf-head-sub">
            Huit contrôles par établissement, calculés sur les données réelles du réseau.
            Un établissement « bloqué » ne peut produire aucun planning tant qu'une ligne
            rouge bloquante subsiste.
          </p>
        </div>
        <button type="button" className="cf-refresh" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={13} className={isFetching ? 'cf-spin' : undefined} aria-hidden="true" />
          {isFetching ? 'Actualisation…' : 'Actualiser'}
        </button>
      </div>

      {/* ── Bandeau de synthèse ────────────────────────────── */}
      <div className="cf-kpis">
        <div className="cf-kpi">
          <Building2 size={15} aria-hidden="true" />
          <div>
            <b>{nf(summary.establishments)}</b>
            <span>établissement(s)</span>
          </div>
        </div>
        <div className="cf-kpi cf-kpi-ok">
          <ShieldCheck size={15} aria-hidden="true" />
          <div>
            <b>{nf(summary.operational)}</b>
            <span>exploitable(s)</span>
          </div>
        </div>
        <div className="cf-kpi cf-kpi-bad">
          <XCircle size={15} aria-hidden="true" />
          <div>
            <b>{nf(summary.blocked)}</b>
            <span>bloqué(s)</span>
          </div>
        </div>
        <div className="cf-kpi cf-kpi-warn">
          <CheckCircle2 size={15} aria-hidden="true" />
          <div>
            <b>{nf(summary.complete)}</b>
            <span>dossier(s) complet(s)</span>
          </div>
        </div>
      </div>

      {/* ── Où le réseau faiblit ───────────────────────────── */}
      {summary.checks?.some((c) => c.failing > 0) && (
        <section className="cf-block">
          <h3 className="cf-block-title">
            <Layers size={14} aria-hidden="true" />
            Où le réseau faiblit
          </h3>
          <p className="cf-block-note">
            Nombre d'établissements en défaut sur chaque contrôle — c'est ce qui dit
            <em> où</em> agir, plutôt qu'un simple total.
          </p>
          <div className="cf-checkbars">
            {summary.checks.filter((c) => c.failing > 0).map((c) => {
              const pct = summary.establishments > 0
                ? Math.round((c.failing / summary.establishments) * 100) : 0;
              return (
                <div key={c.key} className="cf-checkbar">
                  <div className="cf-checkbar-head">
                    <span className="cf-checkbar-label">
                      {c.label}
                      <em className={`cf-sev cf-sev-${c.severity}`}>
                        {c.severity === 'blocking' ? 'bloquant' : 'mineur'}
                      </em>
                    </span>
                    <span className="cf-checkbar-value">
                      {nf(c.failing)} <span>/ {nf(summary.establishments)}</span>
                    </span>
                  </div>
                  <div className="cf-score-bar">
                    <div
                      className={`cf-score-fill ${c.severity === 'blocking' ? 'cf-fill-bad' : 'cf-fill-warn'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Filtres ────────────────────────────────────────── */}
      <div className="cf-toolbar">
        <div className="cf-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`cf-filter${filter === f.id ? ' cf-filter-on' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <em>{nf(counts[f.id])}</em>
            </button>
          ))}
        </div>
        <div className="cf-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Nom, code, gouvernorat…"
            aria-label="Rechercher un établissement"
          />
        </div>
      </div>

      {/* ── Cartes ─────────────────────────────────────────── */}
      {shown.length === 0 ? (
        <div className="cf-state">
          Aucun établissement ne correspond à ce filtre.
        </div>
      ) : (
        <div className="cf-grid">
          {shown.map((e) => (
            <button key={e.id} type="button" className="cf-card" onClick={() => onOpen(e.id)}>
              <div className="cf-card-top">
                <div className="cf-card-ident">
                  <span className="cf-card-name">{e.name}</span>
                  <span className="cf-card-meta">
                    {e.code}
                    {e.governorate ? ` · ${e.governorate}` : ''}
                    {!e.isActive && <em className="cf-off">désactivé</em>}
                  </span>
                </div>
                <ChevronRight size={16} className="cf-card-chevron" aria-hidden="true" />
              </div>

              <Verdict fiche={e} size="sm" />
              <Score score={e.score} blocking={e.blocking} />

              <div className="cf-card-foot">
                <span><Users size={12} aria-hidden="true" /> {nf(e.staff)} agent(s)</span>
                <span><Stethoscope size={12} aria-hidden="true" /> {nf(e.departments)} service(s)</span>
                {e.blocking > 0 && (
                  <span className="cf-tag cf-tag-bad">{e.blocking} bloquant(s)</span>
                )}
                {e.warnings > 0 && (
                  <span className="cf-tag cf-tag-warn">{e.warnings} mineur(s)</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// Fiche d'un établissement
// ══════════════════════════════════════════════════════════════
const Fiche = ({ establishmentId, onBack, onNavigate }) => {
  const qc = useQueryClient();

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['admin-conformite', establishmentId],
    queryFn: () => adminAPI.getConformiteDetail(establishmentId).then((r) => r.data.data),
    enabled: Boolean(establishmentId),
    staleTime: 10000,
  });

  const repair = useMutation({
    mutationFn: (targets) => adminAPI.repairConformite(establishmentId, { targets }),
    onSuccess: (res) => {
      toast.success(res?.data?.message || 'Réparation effectuée');
      // Préfixe volontaire : la fiche **et** la liste du réseau se recalculent,
      // sinon le compteur « bloqués » resterait figé après une réparation.
      qc.invalidateQueries({ queryKey: ['admin-conformite'] });
      // L'onglet « Référentiels » (Lot X4) lit les mêmes types de garde et types
      // d'absence : ses trois clés sont invalidées pour que sa vue reflète la
      // réparation sans rechargement de page.
      qc.invalidateQueries({ queryKey: ['admin-referentiels'] });
      qc.invalidateQueries({ queryKey: ['admin-shift-types'] });
      qc.invalidateQueries({ queryKey: ['admin-absence-types'] });
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || 'La réparation a échoué');
    },
  });

  if (isLoading) return <div className="cf-state">Chargement de la fiche…</div>;
  if (isError || !data) {
    return (
      <div className="cf-state">
        La fiche n'a pas pu être chargée.
        <button type="button" className="cf-back" onClick={onBack}>
          <ArrowLeft size={13} aria-hidden="true" /> Retour au réseau
        </button>
      </div>
    );
  }

  const { detail } = data;
  const repairable = data.checks.filter((c) => !c.ok && c.fix?.kind === 'repair');
  const repairTargets = [...new Set(repairable.map((c) => c.fix.target))];
  const busy = repair.isPending;

  return (
    <div className="cf-wrap">
      {/* ── Fil d'Ariane ───────────────────────────────────── */}
      <div className="cf-crumb">
        <button type="button" className="cf-back" onClick={onBack}>
          <ArrowLeft size={13} aria-hidden="true" /> Conformité du réseau
        </button>
        <ChevronRight size={13} aria-hidden="true" />
        <span>{data.name}</span>
      </div>

      {/* ── En-tête de la fiche ────────────────────────────── */}
      <div className="cf-fiche-head">
        <div>
          <h2 className="cf-head-title">{data.name}</h2>
          <p className="cf-head-sub">
            {data.code}
            {data.city ? ` · ${data.city}` : ''}
            {data.governorate ? ` (${data.governorate})` : ''}
            {' · '}{nf(data.staff)} agent(s) · {nf(data.departments)} service(s)
            {!data.isActive && ' · établissement désactivé'}
          </p>
        </div>
        <div className="cf-fiche-head-right">
          <Verdict fiche={data} />
          <button type="button" className="cf-refresh" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? 'cf-spin' : undefined} aria-hidden="true" />
            {isFetching ? 'Actualisation…' : 'Actualiser'}
          </button>
        </div>
      </div>

      {/* ── Les deux verdicts, nommés ──────────────────────── */}
      <div className="cf-verdicts">
        <div className={`cf-verdict-card ${data.operational ? 'cf-vc-ok' : 'cf-vc-bad'}`}>
          <span className="cf-vc-label">Exploitation</span>
          <strong>{data.operational ? 'Possible' : 'Impossible'}</strong>
          <span className="cf-vc-note">
            {data.operational
              ? 'Aucun contrôle bloquant en échec.'
              : `${data.blocking} contrôle(s) bloquant(s) à lever.`}
          </span>
        </div>
        <div className={`cf-verdict-card ${data.referentielsReady ? 'cf-vc-ok' : 'cf-vc-bad'}`}>
          <span className="cf-vc-label">Référentiels prêts</span>
          <strong>{data.referentielsReady ? 'Oui' : 'Non'}</strong>
          <span className="cf-vc-note">
            Verdict de l'onglet « Référentiels » : types de garde et types d'absence.
          </span>
        </div>
        <div className="cf-verdict-card">
          <span className="cf-vc-label">Dossier</span>
          <strong>{data.score.passed} / {data.score.total}</strong>
          <span className="cf-vc-note">
            {data.warnings > 0
              ? `${data.warnings} point(s) mineur(s) restant(s).`
              : 'Aucun point mineur en attente.'}
          </span>
        </div>
      </div>

      {/* ── Réparation groupée ─────────────────────────────── */}
      {repairTargets.length > 0 && (
        <div className="cf-repair-all">
          <Wrench size={15} aria-hidden="true" />
          <span>
            {repairable.length} ligne(s) réparable(s) sans aucune décision métier
            (référentiels, catalogue de fonctions).
          </span>
          <button
            type="button"
            className="cf-btn cf-btn-primary"
            onClick={() => repair.mutate(repairTargets)}
            disabled={busy}
          >
            {busy ? 'Réparation…' : 'Tout réparer'}
          </button>
        </div>
      )}

      {/* ── Les huit contrôles ─────────────────────────────── */}
      <section className="cf-block">
        <h3 className="cf-block-title">
          <ShieldCheck size={14} aria-hidden="true" />
          Contrôles
        </h3>
        <ul className="cf-checks">
          {data.checks.map((c) => (
            <li key={c.key} className={`cf-check ${c.ok ? 'cf-check-ok' : `cf-check-${c.severity}`}`}>
              <span className="cf-check-icon" aria-hidden="true">
                {c.ok
                  ? <CheckCircle2 size={16} />
                  : c.severity === 'blocking' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
              </span>
              <div className="cf-check-body">
                <div className="cf-check-label">
                  {c.label}
                  {!c.ok && (
                    <em className={`cf-sev cf-sev-${c.severity}`}>
                      {c.severity === 'blocking' ? 'bloquant' : 'mineur'}
                    </em>
                  )}
                </div>
                <div className="cf-check-detail">{c.detail}</div>
                {!c.ok && c.hint && <div className="cf-check-hint">{c.hint}</div>}
              </div>
              {!c.ok && c.fix?.kind === 'repair' && (
                <button
                  type="button"
                  className="cf-btn cf-btn-fix"
                  onClick={() => repair.mutate([c.fix.target])}
                  disabled={busy}
                >
                  <Wrench size={12} aria-hidden="true" />
                  {busy ? '…' : 'Réparer'}
                </button>
              )}
              {!c.ok && c.fix?.kind === 'tab' && (
                <button
                  type="button"
                  className="cf-btn cf-btn-go"
                  onClick={() => onNavigate?.({ establishmentId: data.id, tab: c.fix.estTab || 'overview' })}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Corriger
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Direction ──────────────────────────────────────── */}
      <section className="cf-block">
        <h3 className="cf-block-title">
          <UserCog size={14} aria-hidden="true" />
          Direction
        </h3>
        {detail.directors.length === 0 ? (
          <p className="cf-empty">
            Aucun compte de direction. Un établissement sans directeur actif ne peut ni
            créer de service, ni valider un planning.
          </p>
        ) : (
          <ul className="cf-rows">
            {detail.directors.map((d) => (
              <li key={d.id} className="cf-row">
                <div className="cf-row-main">
                  <span className="cf-row-name">{d.name}</span>
                  <span className="cf-row-sub">{d.roleName} · {d.email}</span>
                </div>
                <div className="cf-row-tags">
                  <span className={`cf-tag ${d.isActive ? 'cf-tag-ok' : 'cf-tag-bad'}`}>
                    {d.isActive ? 'actif' : 'désactivé'}
                  </span>
                  {!d.canLogin && <span className="cf-tag cf-tag-warn">sans accès</span>}
                  <span className="cf-row-login">
                    {d.lastLogin ? `dernière connexion ${d.lastLogin}` : 'jamais connecté'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Services et chefs ──────────────────────────────── */}
      <section className="cf-block">
        <h3 className="cf-block-title">
          <Stethoscope size={14} aria-hidden="true" />
          Services et chefs
        </h3>
        {detail.departments.length === 0 ? (
          <p className="cf-empty">
            Aucun service actif. Les services sont créés par le directeur de
            l'établissement, depuis « Gestion des services ».
          </p>
        ) : (
          <ul className="cf-rows">
            {detail.departments.map((d) => (
              <li key={d.id} className="cf-row">
                <div className="cf-row-main">
                  <span className="cf-row-name">{d.name}</span>
                  <span className="cf-row-sub">
                    {d.code || '—'} · {nf(d.staffCount)} agent(s)
                  </span>
                </div>
                {d.headName
                  ? <span className="cf-tag cf-tag-ok">chef : {d.headName}</span>
                  : <span className="cf-tag cf-tag-warn">sans chef actif</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Plannings du mois ──────────────────────────────── */}
      <section className="cf-block">
        <h3 className="cf-block-title">
          <CalendarCheck size={14} aria-hidden="true" />
          Plannings du mois en cours
        </h3>
        {detail.schedulesThisMonth.length === 0 ? (
          <p className="cf-empty">
            Aucun planning pour le mois en cours. Cela relève des chefs de service :
            aucune action n'est possible depuis cet écran.
          </p>
        ) : (
          <ul className="cf-rows">
            {detail.schedulesThisMonth.map((s) => (
              <li key={s.id} className="cf-row">
                <div className="cf-row-main">
                  <span className="cf-row-name">{s.name}</span>
                  <span className="cf-row-sub">
                    {s.departmentName || 'Service supprimé'} · {shortDate(s.startDate)} → {shortDate(s.endDate)}
                  </span>
                </div>
                <span className={`cf-tag ${s.submitted ? 'cf-tag-ok' : 'cf-tag-warn'}`}>
                  {STATUS_LABELS[s.status] || s.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Localisation ───────────────────────────────────── */}
      <p className="cf-foot">
        <MapPin size={12} aria-hidden="true" />
        Les coordonnées GPS conditionnent l'affichage de l'établissement sur la carte du
        réseau. Elles se saisissent depuis l'onglet « Établissements » → Modifier.
      </p>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
export default function ConformitePanel({ onNavigate }) {
  const [selectedId, setSelectedId] = useState(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['admin-conformite', 'network'],
    queryFn: () => adminAPI.getConformite().then((r) => r.data.data),
    refetchInterval: REFRESH_MS,
    staleTime: 15000,
  });

  if (selectedId) {
    return (
      <Fiche
        establishmentId={selectedId}
        onBack={() => setSelectedId(null)}
        onNavigate={onNavigate}
      />
    );
  }

  if (isLoading) return <div className="cf-state">Analyse de la conformité du réseau…</div>;
  if (isError || !data) {
    return (
      <div className="cf-state">
        La conformité n'a pas pu être calculée.
        <p className="cf-empty-hint">Réessayez dans un instant — aucune donnée n'a été modifiée.</p>
      </div>
    );
  }

  if (data.establishments.length === 0) {
    return (
      <div className="cf-state">
        Aucun établissement à contrôler.
        <p className="cf-empty-hint">
          Créez un établissement depuis l'onglet « Établissements » : sa fiche de conformité
          apparaîtra ici aussitôt.
        </p>
      </div>
    );
  }

  return (
    <NetworkList
      data={data}
      isFetching={isFetching}
      refetch={refetch}
      onOpen={setSelectedId}
    />
  );
}
