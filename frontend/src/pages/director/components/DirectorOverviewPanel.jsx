/**
 * Vue d'ensemble du directeur — pilotage de l'établissement (Lot Y2).
 *
 * ── Ce que cet écran n'est pas ────────────────────────────────
 * Le directeur dispose déjà de « Supervision Hôpital » (/supervision) pour la
 * conduite du jour : couverture, appel, alertes, remplacements. Répéter ces
 * chiffres ici n'apporterait rien et créerait deux sources pour la même
 * question. Cette vue d'ensemble répond à l'autre question, celle qui n'avait
 * pas d'écran : **l'état administratif de l'hôpital**.
 *
 * Cinq blocs, dans l'ordre où un directeur les lit :
 *   1. Effectif et encadrement — les manques nommés, avec l'action pour y
 *      remédier (un service sans chef est un risque, pas une statistique) ;
 *   2. Ce qui attend un arbitrage — plannings à valider, prêts, demandes de
 *      modification de profil, congés en attente ;
 *   3. Composition de l'effectif — par catégorie de personnel et par fonction,
 *      chaque ligne cliquable vers l'onglet Personnel déjà filtré ;
 *   4. Accès à la plateforme — comptes sans accès, jamais connectés, actifs ;
 *   5. Activité récente — les dernières actions tracées de l'établissement.
 *
 * ── Concordance ───────────────────────────────────────────────
 * Tous les chiffres viennent d'un seul appel serveur (`/director/overview`) qui
 * réutilise les mêmes expressions SQL que l'onglet Personnel et les mêmes
 * lectures de tableur que l'appel du jour. Cliquer sur « Personnel médical : 8 »
 * ouvre donc une liste de 8 lignes, pas de 7.
 *
 * ── Étanchéité ────────────────────────────────────────────────
 * Fichier neuf. Toutes les classes CSS sont préfixées `.dov-`. Les actions
 * n'inventent rien : elles ouvrent les onglets et les modales qui existent déjà,
 * via les rappels passés en props par `DirectorDashboard`.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, Users, ShieldCheck, ShieldAlert, UserPlus, UserCog,
  KeyRound, KeySquare, Clock3, CalendarDays, CalendarCheck2, Inbox,
  FileCheck2, Handshake, IdCard, Activity, RefreshCw, ArrowRight,
  AlertTriangle, CheckCircle2, Home, Stethoscope, TrendingUp, Info,
} from 'lucide-react';
import { directorOverviewAPI } from '../../../api';
import './DirectorOverviewPanel.css';

/** Libellés des types de service — miroir de ceux du tableau des services. */
const DEPT_TYPE_LABELS = {
  emergency: 'Urgences', surgery: 'Chirurgie', icu: 'Réanimation',
  internal: 'Médecine interne', pediatrics: 'Pédiatrie',
  radiology: 'Radiologie', other: 'Autre',
};

/** Libellés de fonction, pour ne pas afficher un code technique au directeur. */
const ROLE_LABELS = {
  director: 'Directeur', hospital_admin: 'Administrateur hôpital',
  general_supervisor: 'Surveillant général', department_head: 'Chef de service',
  service_supervisor: 'Surveillant de service', senior_doctor: 'Médecin senior',
  resident: 'Résident', observer: 'Observateur', super_admin: 'Super Admin',
};

/** Catégories de personnel filtrables dans l'onglet Personnel. */
const CATEGORY_ICONS = {
  medical: Stethoscope, paramedical: Users,
  administrative: UserCog, technical: UserCog,
};

/** Familles d'actions tracées, pour colorer la frise d'activité. */
const ACTIVITY_TONE = {
  auth: 'dov-tone-neutral', profile: 'dov-tone-info', admin: 'dov-tone-warn',
  schedule: 'dov-tone-primary', absence: 'dov-tone-warn', general: 'dov-tone-neutral',
};

const ACTIVITY_LABELS = {
  login: 'Connexion', logout: 'Déconnexion', profile_update: 'Profil modifié',
  password_change: 'Mot de passe changé', user_created: 'Compte créé',
  user_updated: 'Compte modifié', user_deactivated: 'Compte clôturé',
  user_activated: 'Compte réactivé',
};

/** Format « 19 août » sans jamais passer par `new Date(chaîne DATE)`. */
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const fmtDay = (key) => {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

const fmtStamp = (value) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} · ${m[4]}h${m[5]}`;
};

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ══════════════════════════════════════════════════════════════
// Briques d'affichage
// ══════════════════════════════════════════════════════════════

const Kpi = ({ icon: Ico, label, value, sub, tone = '', onClick, title }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`dov-kpi ${tone} ${onClick ? 'dov-kpi-click' : ''}`}
      onClick={onClick}
      title={title || (onClick ? 'Ouvrir la liste correspondante' : undefined)}
      type={onClick ? 'button' : undefined}
    >
      <span className="dov-kpi-ico"><Ico size={17} /></span>
      <span className="dov-kpi-body">
        <b>{value}</b>
        <span>{label}</span>
        {sub ? <em>{sub}</em> : null}
      </span>
      {onClick ? <ArrowRight size={13} className="dov-kpi-go" /> : null}
    </Tag>
  );
};

const Bar = ({ value, total, tone = '' }) => (
  <div className="dov-bar" role="presentation">
    <span className={`dov-bar-fill ${tone}`} style={{ width: `${pct(value, total)}%` }} />
  </div>
);

const Section = ({ icon: Ico, title, hint, action, children }) => (
  <section className="dov-sect">
    <header className="dov-sect-head">
      <h3><Ico size={15} /> {title}</h3>
      {action}
    </header>
    {hint ? <p className="dov-sect-hint">{hint}</p> : null}
    {children}
  </section>
);

// ══════════════════════════════════════════════════════════════
// Panneau
// ══════════════════════════════════════════════════════════════

/**
 * @param {object}   props
 * @param {Function} props.onGoTo          navigation vers un onglet du tableau de bord
 * @param {Function} props.onOpenStaff     onglet Personnel avec un filtre pré-appliqué
 * @param {Function} props.onDesignateHead ouvre la modale « désigner un chef »
 * @param {Function} props.onDesignateSuperv ouvre la modale « désigner un surveillant »
 */
const DirectorOverviewPanel = ({
  onGoTo, onOpenStaff, onDesignateHead, onDesignateSuperv,
}) => {
  const { data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['director-overview'],
    queryFn: () => directorOverviewAPI.get().then((r) => r.data?.data),
    staleTime: 60_000,
  });

  // Les services à traiter d'abord : sans chef, puis sans surveillant, puis
  // vides. Un service complet n'a pas besoin d'apparaître dans les alertes.
  const gaps = useMemo(() => {
    const list = data?.encadrement?.list || [];
    return list
      .filter((d) => !d.hasHead || d.supervisorCount === 0 || d.memberCount === 0)
      .sort((a, b) => {
        const rank = (x) => (x.memberCount === 0 ? 0 : !x.hasHead ? 1 : 2);
        return rank(a) - rank(b) || a.name.localeCompare(b.name, 'fr');
      });
  }, [data]);

  const syncedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  if (isLoading) {
    return <div className="dov-state">Chargement de la vue d'ensemble…</div>;
  }

  if (isError) {
    const forbidden = error?.response?.status === 403;
    return (
      <div className="dov-state dov-state-bad">
        {forbidden
          ? "Cette vue d'ensemble est réservée à la direction de l'établissement."
          : (error?.response?.data?.message || "La vue d'ensemble n'a pas pu être chargée.")}
        {!forbidden && (
          <button type="button" className="dov-refresh" onClick={() => refetch()}>
            <RefreshCw size={13} /> Réessayer
          </button>
        )}
      </div>
    );
  }

  if (!data) return <div className="dov-state">Aucune donnée disponible.</div>;

  const { staff, encadrement, planning, leaves, pending, byCategory, byRole, activity } = data;
  const arbitrages = pending.schedulesToReview + pending.staffLoans
    + pending.profileRequests + pending.leaves;
  const encadrementComplete = encadrement.withoutHead === 0
    && encadrement.withoutSupervisor === 0 && encadrement.empty === 0;

  return (
    <div className="dov-wrap">
      {/* ── En-tête ─────────────────────────────────────────── */}
      <header className="dov-head">
        <div>
          <h2 className="dov-head-title">
            <Building2 size={17} /> {data.establishment.name}
          </h2>
          <p className="dov-head-sub">
            Pilotage administratif de l'établissement au {fmtDay(data.today)}.
            La conduite de la garde du jour — appel, alertes, remplacements — reste
            dans <button type="button" className="dov-link" onClick={() => onGoTo?.('/supervision')}>
              Supervision Hôpital
            </button>.
          </p>
        </div>
        <div className="dov-head-actions">
          {syncedAt ? <span className="dov-synced">Synchronisé à {syncedAt}</span> : null}
          <button type="button" className="dov-refresh" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? 'dov-spin' : ''} /> Actualiser
          </button>
        </div>
      </header>

      {/* ── 1. Effectif et couverture du jour ───────────────── */}
      <div className="dov-kpis">
        <Kpi
          icon={Users} label="Personnel de l'hôpital" value={staff.total}
          sub={`${staff.active} en activité${staff.suspended ? ` · ${staff.suspended} clôturé(s)` : ''}`}
          onClick={() => onOpenStaff?.({})}
        />
        <Kpi
          icon={Building2} label="Services actifs" value={encadrement.departments}
          sub={`${encadrement.withHead} avec chef · ${encadrement.withSupervisor} avec surveillant`}
          onClick={() => onGoTo?.('/director/services')}
        />
        <Kpi
          icon={ShieldCheck} label="Agents de garde aujourd'hui" value={planning.staffOnDutyToday}
          sub={planning.guardsToday
            ? `${planning.guardsToday} affectation(s)${planning.atHomeToday ? ` · ${planning.atHomeToday} à domicile` : ''}`
            : 'aucune garde en cours'}
          tone={planning.staffOnDutyToday ? 'dov-ok' : 'dov-muted'}
          onClick={() => onGoTo?.('/director/calendrier')}
        />
        <Kpi
          icon={Inbox} label="En attente d'arbitrage" value={arbitrages}
          sub={arbitrages ? 'plannings, prêts, demandes' : 'rien à traiter'}
          tone={arbitrages ? 'dov-warn' : 'dov-ok'}
        />
      </div>

      {/* ── 2. Encadrement des services ─────────────────────── */}
      <Section
        icon={encadrementComplete ? ShieldCheck : ShieldAlert}
        title="Encadrement des services"
        hint="Un service sans chef ne peut ni bâtir ni soumettre de tableur de garde : c'est le premier point de blocage à lever."
        action={(
          <button type="button" className="dov-ghost" onClick={() => onGoTo?.('/director/services')}>
            Gérer les services <ArrowRight size={12} />
          </button>
        )}
      >
        <div className="dov-mini">
          <span className={`dov-mini-cell ${encadrement.withoutHead ? 'dov-mini-bad' : 'dov-mini-ok'}`}>
            <b>{encadrement.withoutHead}</b><span>sans chef de service</span>
          </span>
          <span className={`dov-mini-cell ${encadrement.withoutSupervisor ? 'dov-mini-warn' : 'dov-mini-ok'}`}>
            <b>{encadrement.withoutSupervisor}</b><span>sans surveillant</span>
          </span>
          <span className={`dov-mini-cell ${encadrement.empty ? 'dov-mini-warn' : 'dov-mini-ok'}`}>
            <b>{encadrement.empty}</b><span>sans personnel affecté</span>
          </span>
          <span className="dov-mini-cell">
            <b>{planning.departmentsCoveredToday}/{encadrement.departments}</b>
            <span>de garde aujourd'hui</span>
          </span>
        </div>

        {encadrementComplete ? (
          <p className="dov-good">
            <CheckCircle2 size={14} /> Les {encadrement.departments} services actifs ont un chef,
            au moins un surveillant et du personnel affecté.
          </p>
        ) : (
          <ul className="dov-rows">
            {gaps.map((d) => (
              <li key={d.id} className="dov-row">
                <span className="dov-row-main">
                  <span className="dov-row-name">
                    <em className="dov-code">{d.code}</em> {d.name}
                    <span className="dov-row-type">{DEPT_TYPE_LABELS[d.departmentType] || 'Autre'}</span>
                  </span>
                  <span className="dov-row-sub">
                    {d.memberCount} membre(s) actif(s)
                    {d.hasHead ? ` · chef : ${d.headName}` : ''}
                    {d.supervisorCount ? ` · ${d.supervisorCount} surveillant(s)` : ''}
                    {d.coveredToday ? ' · de garde aujourd\'hui' : ''}
                  </span>
                </span>
                <span className="dov-row-actions">
                  {d.memberCount === 0 && (
                    <span className="dov-tag dov-tag-warn"><AlertTriangle size={11} /> aucun personnel</span>
                  )}
                  {!d.hasHead && (
                    <button
                      type="button" className="dov-act dov-act-bad"
                      onClick={() => onDesignateHead?.(d.id)}
                      disabled={d.memberCount === 0}
                      title={d.memberCount === 0
                        ? 'Affectez d\'abord du personnel à ce service'
                        : 'Désigner le chef de service'}
                    >
                      <UserPlus size={12} /> Désigner un chef
                    </button>
                  )}
                  {d.supervisorCount === 0 && (
                    <button
                      type="button" className="dov-act"
                      onClick={() => onDesignateSuperv?.(d.id)}
                      disabled={d.memberCount === 0}
                      title={d.memberCount === 0
                        ? 'Affectez d\'abord du personnel à ce service'
                        : 'Désigner un surveillant de service'}
                    >
                      <UserCog size={12} /> Désigner un surveillant
                    </button>
                  )}
                  {d.memberCount === 0 && (
                    <button
                      type="button" className="dov-act"
                      onClick={() => onOpenStaff?.({ departmentId: d.id })}
                    >
                      <Users size={12} /> Voir le personnel
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── 3. Ce qui attend un arbitrage ───────────────────── */}
      {/*
        Règle de cette section : un compteur n'y est cliquable que si l'écran
        d'arrivée montre réellement quelque chose AU DIRECTEUR. Deux pièges
        vérifiés en base avant de câbler :

          • `/staff-loans` filtre sur `owner_chief_id = acteur OR
            requesting_chief_id = acteur` (`staff-loans.controller.js:192-197`).
            Un directeur n'est jamais ni l'un ni l'autre : la page lui renvoie
            0 ligne même quand des prêts existent. Le compteur pointe donc
            `/director/prets`, dont la portée est l'établissement
            (`staff-loans-stats.controller.js:64`).
          • Les demandes de modification de profil sont arbitrées par le Super
            Admin seul (`profile.controller.js:273` renvoie 403 au directeur).
            Le chiffre reste affiché — il renseigne le directeur sur son
            personnel — mais hors de la liste cliquable, et sans lien.
      */}
      <Section
        icon={Inbox}
        title="À traiter par la direction"
        hint="Chaque compteur ouvre l'écran où l'arbitrage se fait. Aucun de ces éléments ne se résout tout seul."
      >
        <div className="dov-kpis">
          <Kpi
            icon={FileCheck2} label="Plannings à valider" value={pending.schedulesToReview}
            sub="soumis ou en relecture"
            tone={pending.schedulesToReview ? 'dov-warn' : 'dov-muted'}
            onClick={() => onGoTo?.('/shifts')}
          />
          <Kpi
            icon={Handshake} label="Prêts de personnel en attente" value={pending.staffLoans}
            sub="réponse du service propriétaire"
            tone={pending.staffLoans ? 'dov-warn' : 'dov-muted'}
            onClick={() => onGoTo?.('/director/prets')}
          />
          <Kpi
            icon={CalendarCheck2} label="Congés en attente" value={pending.leaves}
            sub="à confirmer"
            tone={pending.leaves ? 'dov-warn' : 'dov-muted'}
            onClick={() => onGoTo?.('/director/conges')}
          />
        </div>

        {pending.profileRequests > 0 && (
          <p className="dov-note">
            <IdCard size={12} />
            {pending.profileRequests} demande(s) de modification de profil déposée(s) par votre
            personnel. L'arbitrage appartient au Super Admin, pas à la direction de
            l'établissement — le chiffre est ici pour information.
          </p>
        )}

        <div className="dov-split">
          <div className="dov-block">
            <h4><CalendarDays size={13} /> Congés</h4>
            <ul className="dov-list">
              <li><b>{leaves.ongoing}</b> congé(s) en cours aujourd'hui</li>
              <li><b>{leaves.upcoming7d}</b> qui démarrent sous 7 jours</li>
              <li className="dov-list-muted">{leaves.currentAndFuture} en cours ou à venir au total</li>
            </ul>
            <button type="button" className="dov-ghost" onClick={() => onGoTo?.('/director/conges')}>
              Gérer les congés <ArrowRight size={12} />
            </button>
          </div>
          <div className="dov-block">
            <h4><TrendingUp size={13} /> Tableurs de garde</h4>
            <ul className="dov-list">
              <li><b>{planning.enCours}</b> en cours · <b>{planning.soumis}</b> à venir</li>
              <li><b>{planning.brouillon}</b> brouillon(s) chez les chefs</li>
              <li className="dov-list-muted">{planning.termine} planning(s) terminé(s)</li>
            </ul>
            <button type="button" className="dov-ghost" onClick={() => onGoTo?.('/director/statistiques')}>
              Voir les statistiques <ArrowRight size={12} />
            </button>
            {planning.activeRead >= planning.activeReadLimit && (
              <p className="dov-note dov-note-warn">
                <AlertTriangle size={12} />
                Effectif du jour calculé sur les {planning.activeReadLimit} premiers plannings en
                cours : au-delà, le compte serait partiel.
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ── 4. Composition de l'effectif ────────────────────── */}
      <Section
        icon={Users}
        title="Composition de l'effectif"
        hint="Chaque ligne ouvre l'onglet Personnel déjà filtré : les totaux affichés ici et les listes obtenues sont les mêmes."
      >
        <div className="dov-split">
          <div className="dov-block">
            <h4><Stethoscope size={13} /> Par catégorie de personnel</h4>
            {byCategory.length ? (
              <ul className="dov-rows dov-rows-tight">
                {byCategory.map((c) => {
                  const Ico = CATEGORY_ICONS[c.key] || Users;
                  const clickable = c.key && c.key !== 'unknown';
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        className={`dov-quant ${clickable ? '' : 'dov-quant-static'}`}
                        onClick={clickable ? () => onOpenStaff?.({ personnelType: c.key }) : undefined}
                        disabled={!clickable}
                        title={clickable ? 'Filtrer le personnel sur cette catégorie' : 'Aucun poste renseigné'}
                      >
                        <span className="dov-quant-label"><Ico size={13} /> {c.label}</span>
                        <span className="dov-quant-val">{c.total}</span>
                        <Bar value={c.total} total={staff.total} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="dov-empty">Aucune catégorie renseignée.</p>}
          </div>

          <div className="dov-block">
            <h4><UserCog size={13} /> Par fonction</h4>
            {byRole.length ? (
              <ul className="dov-rows dov-rows-tight">
                {byRole.map((r) => (
                  <li key={r.code}>
                    <button
                      type="button" className="dov-quant"
                      onClick={() => onOpenStaff?.({ roleCode: r.code })}
                      title="Filtrer le personnel sur cette fonction"
                    >
                      <span className="dov-quant-label">
                        {ROLE_LABELS[r.code] || r.name || r.code}
                      </span>
                      <span className="dov-quant-val">{r.total}</span>
                      <Bar value={r.total} total={staff.total} tone="dov-bar-alt" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="dov-empty">Aucune fonction renseignée.</p>}
          </div>
        </div>
      </Section>

      {/* ── 5. Accès à la plateforme ────────────────────────── */}
      <Section
        icon={KeyRound}
        title="Accès à la plateforme"
        hint="Un agent peut figurer dans un tableur de garde sans avoir de compte de connexion : les deux notions sont distinctes."
      >
        <div className="dov-kpis dov-kpis-4">
          <Kpi
            icon={KeyRound} label="Comptes avec accès" value={staff.withLogin}
            sub={`${pct(staff.withLogin, staff.total)} % de l'effectif`}
            onClick={() => onOpenStaff?.({ canLogin: 'true' })}
          />
          <Kpi
            icon={KeySquare} label="Sans accès plateforme" value={staff.withoutLogin}
            sub="présents dans les gardes uniquement"
            tone="dov-muted"
            onClick={() => onOpenStaff?.({ canLogin: 'false' })}
          />
          <Kpi
            icon={Clock3} label="Jamais connectés" value={staff.neverConnected}
            sub="accès ouvert, jamais utilisé"
            tone={staff.neverConnected ? 'dov-warn' : 'dov-ok'}
          />
          <Kpi
            icon={Activity} label="Actifs sur 7 jours" value={staff.connected7d}
            sub={`sur ${staff.withLogin} comptes ouverts`}
            tone={staff.connected7d ? 'dov-ok' : 'dov-muted'}
          />
        </div>
        {staff.neverConnected > 0 && (
          <p className="dov-note dov-note-warn">
            <AlertTriangle size={12} />
            {staff.neverConnected} compte(s) avec accès n'ont jamais servi. Un identifiant
            distribué mais jamais utilisé reste un compte ouvert : vérifiez qu'il correspond
            bien à un agent en poste.
          </p>
        )}
        {staff.archived > 0 && (
          <p className="dov-note">
            <Info size={12} />
            {staff.archived} compte(s) archivé(s) par le Super Admin — la connexion leur est
            refusée, mais ils restent comptés dans l'effectif ci-dessus et dans l'onglet
            Personnel, pour que l'historique reste lisible.
          </p>
        )}
      </Section>

      {/* ── 6. Activité récente ─────────────────────────────── */}
      <Section
        icon={Activity}
        title="Activité récente de l'établissement"
        hint="Extrait de l'historique — non modifiable, comme toute action tracée."
        action={(
          <button type="button" className="dov-ghost" onClick={() => onGoTo?.('/director/historique')}>
            Historique complet <ArrowRight size={12} />
          </button>
        )}
      >
        {activity.length ? (
          <ul className="dov-feed">
            {activity.map((a) => (
              <li key={a.id} className={ACTIVITY_TONE[a.category] || 'dov-tone-neutral'}>
                <span className="dov-feed-when">{fmtStamp(a.at)}</span>
                <span className="dov-feed-what">
                  <b>{ACTIVITY_LABELS[a.action] || a.action}</b>
                  <em>{a.userName} · {a.roleName}</em>
                  {a.description ? <span>{a.description}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="dov-empty">Aucune action tracée pour le moment.</p>}
      </Section>

      {/* ── Accès rapides ───────────────────────────────────── */}
      <Section icon={Home} title="Accès rapides">
        <div className="dov-quick">
          {[
            { to: '/director/personnel',    icon: Users,          label: 'Gestion du personnel' },
            { to: '/director/services',     icon: Building2,      label: 'Gestion des services' },
            { to: '/director/conges',       icon: CalendarDays,   label: 'Congés' },
            { to: '/director/calendrier',   icon: CalendarCheck2, label: 'Calendrier des gardes' },
            { to: '/director/statistiques', icon: TrendingUp,     label: 'Statistiques' },
            { to: '/director/prets',        icon: Handshake,      label: 'Prêts de personnel' },
            { to: '/director/historique',   icon: Activity,       label: 'Historique' },
            { to: '/notes',                 icon: Inbox,          label: 'Notes et circulaires' },
          ].map((q) => (
            <button key={q.to} type="button" className="dov-quick-btn" onClick={() => onGoTo?.(q.to)}>
              <q.icon size={15} /> {q.label} <ArrowRight size={12} />
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
};

export default DirectorOverviewPanel;
