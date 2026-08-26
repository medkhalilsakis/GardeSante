/**
 * Vue d'ensemble du chef de service — pilotage d'un service (Lot Z4).
 *
 * ── Ce que cet écran remplace ─────────────────────────────────
 * L'ancienne « Vue d'ensemble » affichait quatre compteurs dont deux faux :
 * « Gardes aujourd'hui » venait de `/shifts/today`, qui lit la table `shifts`
 * que le flux tableur n'alimente pas — il valait donc 0 en permanence — et
 * « Personnel présent » se déduisait de `member_count`, sans filtre `is_active`.
 * Une carte « Gardes du jour » était conditionnée à ce même tableau vide : elle
 * ne s'affichait jamais. Rien n'était dit des plannings du chef, de ses files
 * d'attente, des congés qui heurtent une garde, ni de l'équité de la charge.
 *
 * ── Ce que ce panneau montre, dans l'ordre où un chef le lit ──
 *   1. Bandeau service — service, hôpital, encadrement, date serveur, synchro ;
 *   2. Cinq compteurs — garde du jour, agents de service, appel, signalements,
 *      alertes ouvertes ;
 *   3. À traiter — une ligne par file d'attente NON vide, avec sa destination ;
 *   4. Mes plannings — les quatre états, les plannings en cours détaillés, et
 *      les brouillons mis en avant : personne d'autre ne les relancera ;
 *   5. Effectif du service — actifs, en congé, disponibles, accès plateforme,
 *      répartition par catégorie et par fonction ;
 *   6. Points de vigilance — congé heurté, double affectation, journée sans
 *      personne. Lecture seule : le tableur validé n'est jamais réécrit ici ;
 *   7. Équité de la charge — classement du mois, écart, moyenne ;
 *   8. Effectif de garde du jour — une ligne par agent avec son statut d'appel ;
 *   9. Accès rapides.
 *
 * ── Concordance ───────────────────────────────────────────────
 * Tous les chiffres viennent d'un seul appel (`/chef/overview`) qui lit le
 * tableur comme le fait l'appel du jour (`rosterOnDate`, dédoublonnage
 * `planning|agent`) et applique la règle d'appel de `AppelDuJourPage` (le
 * pointage le plus récent gagne). « 8 gardes · 7 agents » ici, c'est « 8 gardes ·
 * 7 agents » dans le journal du surveillant et dans la supervision hôpital.
 *
 * Un même agent peut apparaître deux fois dans l'effectif de garde s'il est de
 * service dans DEUX plannings en cours : c'est le dédoublonnage voulu, partagé
 * avec le journal. Chaque ligne porte donc le nom de son planning, sinon le
 * doublon se lit comme un défaut.
 *
 * ── Étanchéité ────────────────────────────────────────────────
 * Fichier neuf. Classes préfixées `.cop-`. Aucune écriture, aucune mutation :
 * les actions ouvrent les onglets et les écrans qui existent déjà, via les
 * rappels passés en props par `ChefDeServiceDashboard`.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, UserX, UserPlus, KeyRound, CalendarDays, CalendarClock,
  CalendarPlus, ClipboardList, ClipboardCheck, Inbox, RefreshCw, ArrowRight,
  AlertTriangle, AlertOctagon, BellRing, CheckCircle2, Clock3, Home,
  Hospital, Scale, Handshake, FileWarning, Stethoscope, Info, PenLine,
  ListChecks, Plane,
} from 'lucide-react';
import { chefOverviewAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import './ChefOverviewPanel.css';

// ══════════════════════════════════════════════════════════════
// Libellés — jamais un code technique à l'écran
// ══════════════════════════════════════════════════════════════

const DEPT_TYPE_LABELS = {
  emergency: 'Urgences', surgery: 'Chirurgie', icu: 'Réanimation',
  internal: 'Médecine interne', pediatrics: 'Pédiatrie',
  radiology: 'Radiologie', other: 'Autre',
};

const APPEL_LABELS = {
  present: 'Présent', late: 'En retard', absent: 'Absent', pending: 'Non pointé',
};

const APPEL_TONE = {
  present: 'cop-pill-ok', late: 'cop-pill-warn',
  absent: 'cop-pill-bad', pending: 'cop-pill-muted',
};

const EVENT_LABELS = {
  incident: 'Incident', absence: 'Absence', late: 'Retard',
  reinforcement: 'Renfort', remark: 'Remarque', handover: 'Passation',
};

const ACTIVITY_TONE = {
  auth: 'cop-tone-neutral', profile: 'cop-tone-info', admin: 'cop-tone-warn',
  schedule: 'cop-tone-primary', absence: 'cop-tone-warn',
  general: 'cop-tone-neutral',
};

const ACTIVITY_LABELS = {
  login: 'Connexion', logout: 'Déconnexion', profile_update: 'Profil modifié',
  password_change: 'Mot de passe changé', user_created: 'Compte créé',
  user_updated: 'Compte modifié', user_deactivated: 'Compte clôturé',
  user_activated: 'Compte réactivé',
};

const VIGILANCE_ICON = {
  on_leave: Plane, double_booking: AlertOctagon, uncovered_day: CalendarClock,
};

// ══════════════════════════════════════════════════════════════
// Dates — aucune `new Date()` sur une chaîne DATE du serveur
// ══════════════════════════════════════════════════════════════

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 2026-08-19 » → « 19 août 2026 ». */
const fmtDay = (key) => {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

/** « 2026-08-19 » → « 19 août » (dans une phrase où l'année est déjà connue). */
const fmtShort = (key) => {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
};

const fmtStamp = (value) => {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} · ${m[4]}h${m[5]}`;
};

const fmtHour = (value) => String(value || '').slice(0, 5) || '—';

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const initials = (name) => String(name || '?')
  .split(/\s+/).filter(Boolean).slice(0, 2)
  .map((w) => w[0].toUpperCase()).join('') || '?';

// ══════════════════════════════════════════════════════════════
// Briques d'affichage
// ══════════════════════════════════════════════════════════════

const Kpi = ({ icon: Ico, label, value, sub, tone = '', onClick, title, bar }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`cop-kpi ${tone} ${onClick ? 'cop-kpi-click' : ''}`}
      onClick={onClick}
      title={title || (onClick ? 'Ouvrir la liste correspondante' : undefined)}
      type={onClick ? 'button' : undefined}
    >
      <span className="cop-kpi-ico"><Ico size={17} /></span>
      <span className="cop-kpi-body">
        <b>{value}</b>
        <span>{label}</span>
        {sub ? <em>{sub}</em> : null}
        {bar ? <span className="cop-bar"><span className={`cop-bar-fill ${bar.tone || ''}`} style={{ width: `${pct(bar.value, bar.total)}%` }} /></span> : null}
      </span>
      {onClick ? <ArrowRight size={13} className="cop-kpi-go" /> : null}
    </Tag>
  );
};

const Section = ({ icon: Ico, title, hint, action, children }) => (
  <section className="cop-sect">
    <header className="cop-sect-head">
      <h3><Ico size={15} /> {title}</h3>
      {action}
    </header>
    {hint ? <p className="cop-sect-hint">{hint}</p> : null}
    {children}
  </section>
);

/** Ligne d'une file d'attente : un chiffre, ce qu'il est, et où il mène. */
const Queue = ({ icon: Ico, count, label, detail, cta, onClick, tone = '' }) => (
  <li className={`cop-queue ${tone}`}>
    <span className="cop-queue-num"><Ico size={15} /> {count}</span>
    <span className="cop-queue-txt">
      <b>{label}</b>
      {detail ? <span>{detail}</span> : null}
    </span>
    <button type="button" className="cop-act" onClick={onClick}>
      {cta} <ArrowRight size={12} />
    </button>
  </li>
);

const Quant = ({ icon: Ico, label, value, total, onClick, tone }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      className={`cop-quant ${onClick ? '' : 'cop-quant-static'}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
    >
      <span className="cop-quant-label">{Ico ? <Ico size={13} /> : null} {label}</span>
      <span className="cop-quant-val">{value}</span>
      <span className="cop-bar"><span className={`cop-bar-fill ${tone || ''}`} style={{ width: `${pct(value, total)}%` }} /></span>
    </Tag>
  );
};

// ══════════════════════════════════════════════════════════════
// Panneau
// ══════════════════════════════════════════════════════════════

/**
 * @param {object}   props
 * @param {string}   props.departmentId  service sélectionné dans le tableau de bord
 * @param {Function} props.onGoTo        bascule vers un onglet (`schedules`, `absences`…)
 * @param {Function} props.onNewSchedule ouvre la création de planning
 * @param {Function} props.onOpenSchedule ouvre un planning dans le tableur
 * @param {Function} props.onImport      ouvre la modale d'import Excel/CSV
 * @param {boolean}  props.canManage     l'appelant peut-il agir (chef) ou seulement lire (SG) ?
 */
const ChefOverviewPanel = ({
  departmentId, onGoTo, onNewSchedule, onOpenSchedule, onImport, canManage = true,
}) => {
  const navigate = useNavigate();

  const {
    data, isLoading, isError, error, refetch, isFetching, dataUpdatedAt,
  } = useQuery({
    queryKey: ['chef-overview', departmentId || null],
    queryFn: () => chefOverviewAPI
      .get(departmentId ? { departmentId } : undefined)
      .then((r) => r.data?.data),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const syncedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  // Les files d'attente, réduites à celles qui ont réellement quelque chose.
  // Une liste de sept lignes à zéro ne dit rien ; « Rien à arbitrer » dit tout.
  const queues = useMemo(() => {
    if (!data) return [];
    const q = data.aTraiter;
    const rows = [
      {
        key: 'propositions', icon: PenLine, count: q.propositions,
        label: 'Proposition(s) de modification',
        detail: 'Un surveillant demande un changement sur un planning envoyé.',
        cta: 'Ouvrir les plannings', tone: 'cop-queue-warn',
        go: () => onGoTo?.('schedules'),
      },
      {
        key: 'remplacements', icon: RefreshCw, count: q.remplacements,
        label: 'Remplacement(s) à confirmer',
        detail: 'Vous êtes le seul à pouvoir les confirmer.',
        cta: 'Ouvrir les remplacements', tone: 'cop-queue-warn',
        go: () => onGoTo?.('remplacements'),
      },
      {
        key: 'absences', icon: FileWarning, count: q.absencesNonJustifiees,
        label: 'Signalement(s) sans justificatif',
        detail: 'Absences et retards des 30 derniers jours, non justifiés.',
        cta: 'Ouvrir les absences', tone: '',
        go: () => onGoTo?.('absences'),
      },
      {
        key: 'conges', icon: Plane, count: q.congesPending,
        label: 'Demande(s) de congé en attente',
        detail: 'À arbitrer avant de bâtir le prochain tableur.',
        cta: 'Ouvrir les congés', tone: '',
        go: () => navigate('/absences'),
      },
      {
        key: 'pretsEntrants', icon: Handshake, count: q.pretsEntrants,
        label: 'Prêt(s) de personnel à accorder',
        detail: 'Un autre service demande un de vos agents.',
        cta: canManage ? 'Ouvrir les prêts' : 'Voir les statistiques',
        tone: 'cop-queue-warn',
        // Un surveillant général n'est ni `owner_chief_id` ni
        // `requesting_chief_id` : `/staff-loans` lui renverrait une liste vide.
        // On l'envoie donc sur l'onglet de statistiques, qui lui répond.
        go: () => (canManage ? navigate('/staff-loans') : onGoTo?.('loan-stats')),
      },
      {
        key: 'pretsSortants', icon: Handshake, count: q.pretsSortants,
        label: 'Demande(s) de prêt en cours',
        detail: 'Vos demandes vers d\'autres services, encore sans réponse.',
        cta: canManage ? 'Ouvrir les prêts' : 'Voir les statistiques', tone: '',
        go: () => (canManage ? navigate('/staff-loans') : onGoTo?.('loan-stats')),
      },
    ];
    return rows.filter((r) => r.count > 0);
  }, [data, canManage, navigate, onGoTo]);

  if (isLoading) {
    return <div className="cop-state">Chargement de la vue d'ensemble du service…</div>;
  }

  if (isError) {
    const status = error?.response?.status;
    return (
      <div className="cop-state cop-state-bad">
        {status === 403
          ? (error?.response?.data?.message
            || "Vous n'avez pas accès au pilotage de ce service.")
          : (error?.response?.data?.message
            || "La vue d'ensemble du service n'a pas pu être chargée.")}
        {status !== 403 && (
          <button type="button" className="cop-refresh" onClick={() => refetch()}>
            <RefreshCw size={13} /> Réessayer
          </button>
        )}
      </div>
    );
  }

  if (!data) return <div className="cop-state">Aucune donnée disponible.</div>;

  const {
    department: dept, effectif, gardeDuJour: garde, plannings,
    vigilance, charge, alertes, journal, activite,
  } = data;

  const hasPlanning = plannings.total > 0;
  const sousEffectif = dept.minGuardCount > 0 && garde.agents < dept.minGuardCount;

  return (
    <div className="cop-wrap">

      {/* ── Bandeau service ─────────────────────────────────── */}
      <header className="cop-head">
        <div>
          <h2 className="cop-head-title">
            <Hospital size={17} /> {dept.name}
            {dept.code ? <em className="cop-code">{dept.code}</em> : null}
          </h2>
          <p className="cop-head-sub">
            {dept.establishmentName}
            {dept.departmentType ? ` · ${DEPT_TYPE_LABELS[dept.departmentType] || dept.departmentType}` : ''}
            {dept.floor ? ` · étage ${dept.floor}` : ''}
            {dept.wing ? ` · aile ${dept.wing}` : ''}
            {dept.bedCount ? ` · ${dept.bedCount} lits` : ''}
            {' — '}
            {fmtDay(data.today)}.
          </p>
          <p className="cop-head-sub">
            Chef : <b>{dept.headName || 'non désigné'}</b>
            {' · '}
            Surveillant(s) : <b>{dept.supervisorNames || 'aucun'}</b>
            {dept.minGuardCount ? ` · effectif minimum de garde : ${dept.minGuardCount}` : ''}
          </p>
        </div>
        <div className="cop-head-actions">
          {syncedAt ? <span className="cop-synced">Synchronisé à {syncedAt}</span> : null}
          <button type="button" className="cop-refresh" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={isFetching ? 'cop-spin' : ''} /> Actualiser
          </button>
        </div>
      </header>

      {/* ── 5 compteurs ─────────────────────────────────────── */}
      <div className="cop-kpis">
        <Kpi
          icon={CalendarDays} label="Gardes aujourd'hui" value={garde.total}
          sub={garde.total
            ? `sur ${plannings.enCours} planning(s) en cours`
            : (plannings.enCours ? 'aucun agent de service aujourd\'hui' : 'aucun planning en cours')}
          tone={garde.total ? 'cop-ok' : 'cop-muted'}
          onClick={() => navigate('/appel-du-jour')}
          title="Ouvrir l'appel du jour"
        />
        <Kpi
          icon={Users} label="Agents de service" value={garde.agents}
          sub={[
            garde.aDomicile ? `${garde.aDomicile} à domicile` : null,
            dept.minGuardCount ? `minimum requis ${dept.minGuardCount}` : null,
          ].filter(Boolean).join(' · ') || 'agents distincts de garde'}
          tone={sousEffectif ? 'cop-bad' : (garde.agents ? 'cop-ok' : 'cop-muted')}
          onClick={() => navigate('/appel-du-jour')}
        />
        <Kpi
          icon={ClipboardCheck} label="Appel du jour"
          value={`${garde.pointes}/${garde.total}`}
          sub={garde.total
            ? `${garde.presents} présent(s) · ${garde.retards} retard(s) · ${garde.absents} absent(s)`
            : 'rien à pointer'}
          tone={garde.total && garde.pointes === garde.total ? 'cop-ok' : (garde.total ? 'cop-warn' : 'cop-muted')}
          bar={{ value: garde.pointes, total: garde.total || 1 }}
          onClick={() => navigate('/appel-du-jour')}
        />
        <Kpi
          icon={FileWarning} label="Signalements du jour" value={journal.signalementsJour}
          sub={journal.signalementsJour
            ? `dont ${journal.retardsJour} retard(s)`
            : 'aucune absence ni retard déclaré'}
          tone={journal.signalementsJour ? 'cop-warn' : 'cop-ok'}
          onClick={() => onGoTo?.('absences')}
        />
        <Kpi
          icon={BellRing} label="Alertes ouvertes" value={alertes.ouvertes}
          sub={alertes.ouvertes
            ? `${alertes.critiques} critique(s) · ${alertes.nonAcquittees} non acquittée(s)`
            : 'aucune alerte en cours'}
          tone={alertes.critiques ? 'cop-bad' : (alertes.ouvertes ? 'cop-warn' : 'cop-ok')}
          onClick={() => navigate('/incidents')}
        />
      </div>

      {sousEffectif && (
        <p className="cop-note cop-note-bad">
          <AlertTriangle size={13} />
          Effectif de garde sous le minimum du service : {garde.agents} agent(s) de
          service pour {dept.minGuardCount} requis. Un remplacement ou un prêt de
          personnel comble ce trou sans réécrire le tableur validé.
        </p>
      )}

      {/* ── À traiter ───────────────────────────────────────── */}
      <Section
        icon={Inbox}
        title="À traiter"
        hint="Les seules files qui vous attendent. Un planning envoyé ne se réécrit pas : les changements passent par un remplacement ou une proposition."
      >
        {queues.length ? (
          <ul className="cop-queues">
            {queues.map((q) => (
              <Queue
                key={q.key} icon={q.icon} count={q.count} label={q.label}
                detail={q.detail} cta={q.cta} onClick={q.go} tone={q.tone}
              />
            ))}
          </ul>
        ) : (
          <p className="cop-good">
            <CheckCircle2 size={14} />
            Rien à arbitrer : aucune proposition, aucun remplacement à confirmer,
            aucune demande de congé ni de prêt en attente, aucun signalement sans
            justificatif.
          </p>
        )}
        {data.aTraiter.remplacementsActifs > 0 && (
          <p className="cop-note">
            <Info size={13} />
            {data.aTraiter.remplacementsActifs} remplacement(s) déjà confirmé(s)
            s'appliquent en ce moment par-dessus le tableur, sans le modifier.
            <button type="button" className="cop-link" onClick={() => onGoTo?.('remplacements')}>
              Les consulter
            </button>
          </p>
        )}
      </Section>

      {/* ── Mes plannings ───────────────────────────────────── */}
      <Section
        icon={ClipboardList}
        title="Mes plannings"
        hint="Un brouillon n'est visible que de vous : tant qu'il n'est pas envoyé, ni le surveillant ni la direction ne le voient."
        action={canManage ? (
          <button type="button" className="cop-ghost" onClick={() => onNewSchedule?.()}>
            <CalendarPlus size={12} /> Créer un planning
          </button>
        ) : null}
      >
        <div className="cop-mini">
          <button type="button" className={`cop-mini-cell ${plannings.brouillon ? 'cop-mini-warn' : ''}`} onClick={() => onGoTo?.('schedules')}>
            <b>{plannings.brouillon}</b>
            <span>Brouillon(s) — à finir et envoyer</span>
          </button>
          <button type="button" className="cop-mini-cell" onClick={() => onGoTo?.('schedules')}>
            <b>{plannings.soumis}</b>
            <span>En vigueur — envoyés, pas encore commencés</span>
          </button>
          <button type="button" className={`cop-mini-cell ${plannings.enCours ? 'cop-mini-ok' : ''}`} onClick={() => onGoTo?.('schedules')}>
            <b>{plannings.enCours}</b>
            <span>En cours — la garde du jour en sort</span>
          </button>
          <button type="button" className="cop-mini-cell" onClick={() => onGoTo?.('schedules')}>
            <b>{plannings.termine}</b>
            <span>Terminé(s) — archives du service</span>
          </button>
        </div>

        {!hasPlanning && (
          <p className="cop-empty">
            Ce service n'a encore aucun planning de garde.
            {canManage ? ' Créez-en un pour que la garde du jour, l\'appel et les statistiques aient une source.' : ''}
          </p>
        )}

        {plannings.active.length > 0 && (
          <ul className="cop-rows">
            {plannings.active.map((p) => (
              <li className="cop-row" key={p.id}>
                <span className="cop-row-main">
                  <span className="cop-row-name">
                    {p.name}
                    <PlanningStateBadge state={p.state} size="sm" />
                  </span>
                  <span className="cop-row-sub">
                    Jour {p.dayIndex} sur {p.dayTotal} · du {fmtShort(p.startDate)} au {fmtDay(p.endDate)}
                    {' · '}{p.staffToday} agent(s) de service aujourd'hui
                    {' · '}{p.remainingGuards} garde(s) restante(s)
                  </span>
                  <span className="cop-bar">
                    <span className="cop-bar-fill" style={{ width: `${pct(p.dayIndex, p.dayTotal)}%` }} />
                  </span>
                </span>
                <span className="cop-row-actions">
                  {p.pendingProposals > 0 && (
                    <span className="cop-tag cop-tag-warn">
                      <PenLine size={11} /> {p.pendingProposals} proposition(s)
                    </span>
                  )}
                  {p.pendingReplacements > 0 && (
                    <span className="cop-tag cop-tag-warn">
                      <RefreshCw size={11} /> {p.pendingReplacements} à confirmer
                    </span>
                  )}
                  <button type="button" className="cop-act" onClick={() => onOpenSchedule?.(p.id)}>
                    Ouvrir le tableur <ArrowRight size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {plannings.drafts.length > 0 && (
          <>
            <p className="cop-note cop-note-warn">
              <AlertTriangle size={13} />
              {plannings.drafts.length} brouillon(s) non envoyé(s) : aucune garde
              n'en sort, aucun agent n'en est prévenu, et ils n'apparaissent dans
              aucune statistique.
            </p>
            <ul className="cop-rows cop-rows-tight">
              {plannings.drafts.map((s) => (
                <li className="cop-row" key={s.id}>
                  <span className="cop-row-main">
                    <span className="cop-row-name">
                      {s.name}
                      <PlanningStateBadge state="brouillon" size="sm" />
                    </span>
                    <span className="cop-row-sub">
                      Du {fmtShort(s.startDate)} au {fmtDay(s.endDate)}
                      {s.updatedOn ? ` · modifié le ${fmtDay(s.updatedOn)}` : ''}
                    </span>
                  </span>
                  <span className="cop-row-actions">
                    <button type="button" className="cop-act" onClick={() => onOpenSchedule?.(s.id)}>
                      Reprendre <ArrowRight size={12} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {plannings.read >= plannings.readLimit && (
          <p className="cop-note">
            <Info size={13} />
            Les {plannings.readLimit} plannings les plus récents sont lus en détail :
            l'équité de la charge et les points de vigilance portent sur eux.
          </p>
        )}
      </Section>

      {/* ── Effectif du service ─────────────────────────────── */}
      <Section
        icon={Users}
        title="Effectif du service"
        hint="Un agent sans accès à la plateforme ne voit pas son planning, ne reçoit aucune notification et ne peut être pointé que par un tiers."
        action={(
          <button type="button" className="cop-ghost" onClick={() => navigate('/portfolio')}>
            Ouvrir le portefeuille <ArrowRight size={12} />
          </button>
        )}
      >
        <div className="cop-mini">
          <div className="cop-mini-cell">
            <b>{effectif.actifs}</b>
            <span>Agent(s) en activité{effectif.suspendus ? ` · ${effectif.suspendus} clôturé(s)` : ''}</span>
          </div>
          <div className={`cop-mini-cell ${effectif.enCongeAujourdhui ? 'cop-mini-warn' : ''}`}>
            <b>{effectif.enCongeAujourdhui}</b>
            <span>En congé aujourd'hui</span>
          </div>
          <div className="cop-mini-cell cop-mini-ok">
            <b>{effectif.disponibles}</b>
            <span>Disponibles pour une garde</span>
          </div>
          <div className={`cop-mini-cell ${effectif.sansAcces ? 'cop-mini-bad' : 'cop-mini-ok'}`}>
            <b>{effectif.sansAcces}</b>
            <span>Sans accès à la plateforme</span>
          </div>
        </div>

        {effectif.sansAcces > 0 && (
          <p className="cop-note cop-note-bad">
            <KeyRound size={13} />
            {effectif.sansAcces} agent(s) sur {effectif.actifs} n'ont pas de compte
            actif : ils ne consultent pas leur garde et ne sont pas notifiés.
            <button type="button" className="cop-link" onClick={() => navigate('/portfolio')}>
              Voir qui
            </button>
          </p>
        )}

        <div className="cop-split">
          <div className="cop-block">
            <h4><Stethoscope size={12} /> Par catégorie</h4>
            {effectif.byCategory.length ? (
              <div className="cop-quants">
                {effectif.byCategory.map((c) => (
                  <Quant key={c.label} label={c.label} value={c.total} total={effectif.total} />
                ))}
              </div>
            ) : <p className="cop-empty">Aucune catégorie renseignée.</p>}
          </div>
          <div className="cop-block">
            <h4><UserCheck size={12} /> Par fonction</h4>
            {effectif.byRole.length ? (
              <div className="cop-quants">
                {effectif.byRole.map((r) => (
                  <Quant key={r.code} label={r.name} value={r.total} total={effectif.total} tone="cop-bar-alt" />
                ))}
              </div>
            ) : <p className="cop-empty">Aucune fonction renseignée.</p>}
          </div>
        </div>

        {effectif.congesAujourdhui.length > 0 && (
          <ul className="cop-rows cop-rows-tight">
            {effectif.congesAujourdhui.map((c) => (
              <li className="cop-row" key={`${c.userId}-${c.startDate}`}>
                <span className="cop-row-main">
                  <span className="cop-row-name">
                    <UserX size={13} /> {c.name}
                    <em className="cop-code">{c.typeName}</em>
                  </span>
                  <span className="cop-row-sub">
                    Absent du {fmtShort(c.startDate)} au {fmtDay(c.endDate)}
                    {c.status && c.status !== 'approved' ? ' · demande non validée' : ''}
                  </span>
                </span>
                <span className="cop-row-actions">
                  <button type="button" className="cop-act" onClick={() => navigate('/absences')}>
                    Ouvrir le congé <ArrowRight size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── Points de vigilance ─────────────────────────────── */}
      <Section
        icon={vigilance.total ? AlertTriangle : CheckCircle2}
        title="Points de vigilance"
        hint="Mêmes règles que la supervision de l'hôpital : un chef et un surveillant général ne doivent pas lire deux vérités différentes. Lecture seule."
      >
        {vigilance.total ? (
          <>
            <div className="cop-mini">
              <div className={`cop-mini-cell ${vigilance.onLeave ? 'cop-mini-bad' : ''}`}>
                <b>{vigilance.onLeave}</b>
                <span>Garde posée sur un agent en congé</span>
              </div>
              <div className={`cop-mini-cell ${vigilance.doubleBooking ? 'cop-mini-bad' : ''}`}>
                <b>{vigilance.doubleBooking}</b>
                <span>Agent affecté dans deux services le même jour</span>
              </div>
              <div className={`cop-mini-cell ${vigilance.uncovered ? 'cop-mini-warn' : ''}`}>
                <b>{vigilance.uncovered}</b>
                <span>Planning avec des journées à venir sans personne</span>
              </div>
            </div>
            <ul className="cop-rows">
              {vigilance.list.map((v, i) => {
                const Ico = VIGILANCE_ICON[v.type] || AlertTriangle;
                return (
                  <li className={`cop-row cop-row-${v.severity}`} key={`${v.type}-${v.date}-${v.userId || i}`}>
                    <span className="cop-row-main">
                      <span className="cop-row-name">
                        <Ico size={13} /> {v.title}
                        {v.staffName ? <em className="cop-code">{v.staffName}</em> : null}
                      </span>
                      <span className="cop-row-sub">{v.detail}</span>
                    </span>
                    <span className="cop-row-actions">
                      {v.dayCount > 0 && (
                        <span className="cop-tag cop-tag-warn">{v.dayCount} journée(s)</span>
                      )}
                      {v.schedules?.[0] && (
                        <button type="button" className="cop-act" onClick={() => onOpenSchedule?.(v.schedules[0])}>
                          Voir le tableur <ArrowRight size={12} />
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {vigilance.total > vigilance.list.length && (
              <p className="cop-note">
                <Info size={13} />
                {vigilance.total - vigilance.list.length} autre(s) point(s) non
                affiché(s) : les plus graves sont en tête de liste.
              </p>
            )}
          </>
        ) : (
          <p className="cop-good">
            <CheckCircle2 size={14} />
            Aucun conflit détecté sur vos plannings envoyés ou en cours : aucun
            agent de garde pendant un congé, aucune double affectation, aucune
            journée à venir sans personne.
          </p>
        )}
      </Section>

      {/* ── Équité de la charge ─────────────────────────────── */}
      <Section
        icon={Scale}
        title="Équité de la charge"
        hint={`Gardes comptées sur les plannings envoyés et en cours, du ${fmtShort(charge.period.from)} au ${fmtDay(charge.period.to)}. C'est le chiffre à regarder au moment de répartir le mois suivant.`}
        action={(
          <button type="button" className="cop-ghost" onClick={() => onGoTo?.('stats')}>
            Statistiques détaillées <ArrowRight size={12} />
          </button>
        )}
      >
        {charge.staffCount ? (
          <>
            <div className="cop-mini">
              <div className="cop-mini-cell">
                <b>{charge.totalGuards}</b>
                <span>Garde(s) réparties sur le mois</span>
              </div>
              <div className="cop-mini-cell">
                <b>{charge.averagePerStaff}</b>
                <span>Moyenne par agent ({charge.staffCount} agents)</span>
              </div>
              <div className={`cop-mini-cell ${charge.loadGap > charge.averagePerStaff ? 'cop-mini-warn' : 'cop-mini-ok'}`}>
                <b>{charge.loadGap}</b>
                <span>Écart entre le plus et le moins sollicité</span>
              </div>
            </div>
            <ul className="cop-load">
              {charge.list.map((s) => (
                <li key={s.userId}>
                  <span className="cop-load-name">
                    <i className="cop-ava">{initials(s.name)}</i>
                    <span>
                      <b>{s.name}</b>
                      {s.roleName ? <em>{s.roleName}</em> : null}
                    </span>
                  </span>
                  <span className="cop-bar">
                    <span
                      className={`cop-bar-fill ${s.guards === charge.maxLoad ? 'cop-bar-warn' : (s.guards === charge.minLoad ? 'cop-bar-alt' : '')}`}
                      style={{ width: `${pct(s.guards, charge.maxLoad || 1)}%` }}
                    />
                  </span>
                  <span className="cop-load-val">{s.guards}</span>
                </li>
              ))}
            </ul>
            {charge.listTruncated && (
              <p className="cop-note">
                <Info size={13} />
                Les {charge.list.length} agents les plus sollicités sont affichés.
              </p>
            )}
          </>
        ) : (
          <p className="cop-empty">
            Aucune garde répartie sur ce mois dans les plannings envoyés ou en cours.
          </p>
        )}
      </Section>

      {/* ── Effectif de garde du jour ───────────────────────── */}
      <Section
        icon={ListChecks}
        title={`Effectif de garde — ${fmtDay(data.today)}`}
        hint="Lu directement dans les tableurs en cours, comme l'appel du jour. Un agent de service dans deux plannings apparaît une fois par planning."
        action={(
          <button type="button" className="cop-ghost" onClick={() => navigate('/appel-du-jour')}>
            Faire l'appel <ArrowRight size={12} />
          </button>
        )}
      >
        {garde.list.length ? (
          <ul className="cop-duty">
            {garde.list.map((g, i) => (
              <li key={`${g.scheduleId}-${g.userId || i}`}>
                <i className="cop-ava">{initials(g.name)}</i>
                <span className="cop-duty-who">
                  <b>{g.name}</b>
                  <em>{g.roleName || 'Fonction non renseignée'}{g.matricule ? ` · ${g.matricule}` : ''}</em>
                  <span className="cop-duty-sched">{g.scheduleName}</span>
                </span>
                <span className="cop-duty-when">
                  <span className="cop-tag">{g.label || 'De service'}</span>
                  <em>{fmtHour(g.shiftStart)} → {fmtHour(g.shiftEnd)}</em>
                </span>
                <span className="cop-duty-flags">
                  {g.atHome
                    ? <span className="cop-pill cop-pill-info"><Home size={11} /> À domicile</span>
                    : <span className="cop-pill cop-pill-muted"><Hospital size={11} /> Sur place</span>}
                  <span className={`cop-pill ${APPEL_TONE[g.appel]}`}>
                    {g.appel === 'present' ? <UserCheck size={11} /> : null}
                    {g.appel === 'late' ? <Clock3 size={11} /> : null}
                    {g.appel === 'absent' ? <UserX size={11} /> : null}
                    {g.appel === 'pending' ? <Clock3 size={11} /> : null}
                    {APPEL_LABELS[g.appel]}
                    {g.appelHour ? ` · ${fmtHour(g.appelHour)}` : ''}
                  </span>
                  {g.appelReporter ? <em className="cop-duty-by">par {g.appelReporter}</em> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cop-empty">
            {plannings.enCours
              ? "Aucun agent n'est de service aujourd'hui dans les plannings en cours."
              : "Aucun planning en cours : la garde du jour n'a pas de source."}
          </p>
        )}
      </Section>

      {/* ── Journal du jour ────────────────────────────────── */}
      {journal.list.length > 0 && (
        <Section
          icon={ClipboardCheck}
          title="Journal du service — aujourd'hui"
          hint="Événements saisis par le surveillant de service depuis minuit."
          action={(
            <button type="button" className="cop-ghost" onClick={() => navigate('/incidents')}>
              Ouvrir le journal <ArrowRight size={12} />
            </button>
          )}
        >
          <ul className="cop-feed">
            {journal.list.map((e) => (
              <li key={e.id} className={e.severity === 'critical' || e.severity === 'urgent' ? 'cop-tone-warn' : 'cop-tone-neutral'}>
                <span className="cop-feed-when">{fmtHour(e.hour)}</span>
                <span className="cop-feed-what">
                  <b>{EVENT_LABELS[e.type] || e.type}</b>
                  {e.title ? <span>{e.title}</span> : null}
                  {e.staffName ? <em>{e.staffName}</em> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ── Accès rapides ──────────────────────────────────── */}
      <Section icon={ArrowRight} title="Accès rapides">
        <div className="cop-quick">
          {canManage && (
            <button type="button" className="cop-quick-btn" onClick={() => onNewSchedule?.()}>
              <CalendarPlus size={15} /> Créer un planning <ArrowRight size={12} />
            </button>
          )}
          {canManage && (
            <button type="button" className="cop-quick-btn" onClick={() => onImport?.()}>
              <ClipboardList size={15} /> Importer Excel / CSV <ArrowRight size={12} />
            </button>
          )}
          <button type="button" className="cop-quick-btn" onClick={() => onGoTo?.('team')}>
            <Users size={15} /> Équipe du service <ArrowRight size={12} />
          </button>
          <button type="button" className="cop-quick-btn" onClick={() => navigate('/portfolio')}>
            <UserPlus size={15} /> Portefeuille du personnel <ArrowRight size={12} />
          </button>
          <button type="button" className="cop-quick-btn" onClick={() => navigate('/appel-du-jour')}>
            <ClipboardCheck size={15} /> Appel du jour <ArrowRight size={12} />
          </button>
          <button type="button" className="cop-quick-btn" onClick={() => onGoTo?.('absences')}>
            <FileWarning size={15} /> Absences et retards <ArrowRight size={12} />
          </button>
          <button type="button" className="cop-quick-btn" onClick={() => onGoTo?.('remplacements')}>
            <RefreshCw size={15} /> Remplacements <ArrowRight size={12} />
          </button>
          <button
            type="button" className="cop-quick-btn"
            onClick={() => (canManage ? navigate('/staff-loans') : onGoTo?.('loan-stats'))}
          >
            <Handshake size={15} /> Prêts de personnel <ArrowRight size={12} />
          </button>
        </div>
      </Section>

      {/* ── Activité récente ───────────────────────────────── */}
      {activite.length > 0 && (
        <Section
          icon={Clock3}
          title="Activité récente du service"
          hint="Traces des actions faites par les membres du service. L'historique est constant : personne ne peut le modifier."
        >
          <ul className="cop-feed">
            {activite.map((a) => (
              <li key={a.id} className={ACTIVITY_TONE[a.category] || 'cop-tone-neutral'}>
                <span className="cop-feed-when">{fmtStamp(a.at)}</span>
                <span className="cop-feed-what">
                  <b>{ACTIVITY_LABELS[a.action] || a.action}</b>
                  <em>{a.actorName || '—'}{a.roleName ? ` · ${a.roleName}` : ''}</em>
                  {a.description ? <span>{a.description}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
};

export default ChefOverviewPanel;
