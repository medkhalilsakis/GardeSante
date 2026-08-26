/**
 * « Ma journée » — l'écran d'atterrissage (`/dashboard`)
 * ═════════════════════════════════════════════════════
 * Premier lien du menu, et la route d'accueil du chef de service, du surveillant
 * de service et du surveillant général. Il lisait quatre sources bâties sur la
 * table `shifts`, que plus rien n'alimente depuis la suppression des codes de
 * garde : « 0 garde du jour » quand le journal en voyait huit, un histogramme de
 * barres nulles, trois barres de couverture à 0 %, et un « taux de couverture :
 * 100 % » calculé sur six lignes héritées — pire que du vide, une fausse
 * assurance. (Défaut D4 de l'audit.)
 *
 * Il ne cherche plus à être un second tableau de bord métier : celui de chaque
 * rôle reste à un clic, en tête d'écran. Il répond à une seule question — « qu'est-ce
 * que je fais maintenant ? » — dans cet ordre : ce qui attend ma décision, qui est
 * de service, ce qui cloche, mes plannings, les consignes, la charge du mois.
 *
 * Toutes les sources tiennent réellement des données, et **aucune ne lit
 * `shifts`** :
 *   • `/api/journal/overview` — la garde du jour, les plannings en cours, les
 *     compteurs de la portée (le serveur décide de la portée, pas le client) ;
 *   • `/api/journal/calls`    — l'appel du jour, pour distinguer « pointé » de
 *     « à pointer » ; même vérité que l'écran « Appel du jour » ;
 *   • `/api/chef/overview`    — les files d'attente et la vigilance d'un service.
 *     Appelé pour le chef et le surveillant de service **seulement** : sans
 *     `?departmentId`, ce contrôleur retourne au directeur et au surveillant
 *     général le premier service par ordre alphabétique, ce qui serait faux ici ;
 *   • `/api/supervision/conflicts` — la même vigilance à l'échelle de l'hôpital,
 *     réservée à la supervision et à la direction (403 pour un chef) ;
 *   • `/api/journal/alerts`, `/api/notes`, `/api/staff-loans`,
 *     `/api/statistics/scoped` — alertes ouvertes, consignes, prêts, charge.
 *
 * Les clés react-query sont celles que `hooks/useRealtime.js` invalide déjà
 * (`journal-overview`, `journal`, `journal-alerts`, `chef-overview`,
 * `supervision-conflicts`, `staff-loans`, `notes`) : l'écran est temps réel sans
 * une ligne ajoutée à ce hook.
 */

import React, { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardCheck, Users, TriangleAlert, BellRing, FileText,
  Scale, CalendarOff, Inbox, ArrowRight,
} from 'lucide-react';
import {
  journalAPI, chefOverviewAPI, supervisionAPI,
  staffLoansAPI, notesAPI, scopedStatsAPI,
} from '../../api';
import { useAuthStore } from '../../store';
import { planningScreen } from '../../utils/notificationTarget';
import { fullFrenchDate, frenchRange, shortFrenchDate } from '../../utils/frenchDates';
import ContextBadge from '../../components/layout/ContextBadge';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import {
  GsPageHeader, GsPanel, GsStat, GsStatRail,
  GsTable, GsBadge, GsEmpty, GsSkeleton,
} from '../../components/gs';
import './dashboard.css';

// ── Vocabulaire ────────────────────────────────────────────────────────────

const ROLE_LABEL = {
  department_head: 'Chef de service',
  service_supervisor: 'Surveillant de service',
  general_supervisor: 'Surveillant général',
  hospital_admin: 'Administration de l’hôpital',
  director: 'Directeur',
  super_admin: 'Super administrateur',
};

/** L'écran métier du rôle : « Ma journée » y renvoie, il ne le duplique pas. */
const HOME_SCREEN = {
  department_head: { path: '/chef-de-service', label: 'Planning des gardes' },
  service_supervisor: { path: '/surveillant', label: 'Journal de service' },
  general_supervisor: { path: '/supervision', label: 'Supervision de l’hôpital' },
  hospital_admin: { path: '/supervision', label: 'Supervision de l’hôpital' },
};

const SEVERITY_ORDER = { urgent: 0, critical: 0, error: 1, warning: 2, info: 3 };

const SEVERITY_LABEL = {
  urgent: 'Urgent',
  critical: 'Critique',
  error: 'À corriger',
  warning: 'À surveiller',
  info: 'Pour information',
};

/** Les trois règles de `conflict-rules.js`, nommées pour un lecteur. */
const CONFLICT_LABEL = {
  double_booking: 'Double affectation',
  on_leave: 'Agent en congé',
  uncovered_day: 'Journée découverte',
};

const NOTE_CATEGORY = {
  note: 'Note',
  circulaire: 'Circulaire',
  directive: 'Directive',
  info: 'Information',
};

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** `HH:MM:SS` comme `HH:MM` : une heure de garde se lit à la minute. */
const hour = (v) => (v ? String(v).slice(0, 5) : null);

/** Un horodatage `timestamptz` réduit à sa clé de date, sans construire de `Date`. */
const dayOf = (v) => (v ? String(v).slice(0, 10) : '');

const toneOfSeverity = (severity) =>
  (severity === 'critical' || severity === 'urgent' || severity === 'error' ? 'alert' : undefined);

/**
 * Ce qui attend passe devant ce qui est réglé. L'ordre nommé est conservé à
 * l'intérieur de chaque groupe (`sort` est stable) : les files gardent leur
 * place les unes par rapport aux autres, une file vide descend simplement.
 */
const byPending = (rows) => [...rows].sort(
  (a, b) => (Number(b.count) > 0 ? 1 : 0) - (Number(a.count) > 0 ? 1 : 0)
);

// ── Écran ──────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, hasPermission } = useAuthStore();
  const navigate = useNavigate();
  const role = user?.roleCode;

  // Redirections par rôle — conservées telles quelles : le Super Admin et le
  // directeur ont leur propre écran d'accueil.
  useEffect(() => {
    if (role === 'super_admin') navigate('/admin', { replace: true });
    else if (role === 'director') navigate('/director', { replace: true });
  }, [role, navigate]);

  const willRedirect = role === 'super_admin' || role === 'director';

  // Deux portées, deux sources de vigilance et de files d'attente. Le serveur
  // borne les deux ; ce partage évite seulement d'appeler un contrôleur qui
  // répondrait à côté (ou 403) pour le rôle en question.
  const isChefScope = role === 'department_head' || role === 'service_supervisor';
  const isWatcher = role === 'general_supervisor' || role === 'hospital_admin';

  const screen = planningScreen(role);
  const replacementsPath = screen.deepLink ? `${screen.path}?tab=remplacements` : screen.path;
  const home = HOME_SCREEN[role];

  // ── La garde du jour, pour les quatre rôles ──────────────────────────────
  const overviewQ = useQuery({
    queryKey: ['journal-overview'],
    queryFn: () => journalAPI.getOverview().then((r) => r.data.data),
    enabled: !willRedirect,
    refetchInterval: 60000,
  });
  const overview = overviewQ.data;
  const today = overview?.today || '';
  const summary = overview?.summary || {};
  const activeSchedules = overview?.activeSchedules || [];

  // ── L'appel du jour : « pointé » ou « à pointer » ────────────────────────
  const callsQ = useQuery({
    queryKey: ['journal', 'calls', today],
    queryFn: () => journalAPI.getCalls().then((r) => r.data.data),
    enabled: !willRedirect && !!today,
    refetchInterval: 60000,
  });

  // ── Files d'attente et vigilance, selon la portée ────────────────────────
  const chefQ = useQuery({
    queryKey: ['chef-overview', null],
    queryFn: () => chefOverviewAPI.get().then((r) => r.data.data),
    enabled: !willRedirect && isChefScope,
  });
  const chef = chefQ.data;

  const conflictsQ = useQuery({
    queryKey: ['supervision-conflicts'],
    queryFn: () => supervisionAPI.getConflicts().then((r) => r.data.data),
    enabled: !willRedirect && isWatcher,
  });
  const conflicts = conflictsQ.data;

  const loansQ = useQuery({
    queryKey: ['staff-loans', 'journee-pending'],
    queryFn: () => staffLoansAPI.getAll({ status: 'pending' }).then((r) => r.data.data || []),
    enabled: !willRedirect && isWatcher,
  });

  // ── Alertes ouvertes, consignes, charge du mois ──────────────────────────
  const alertsQ = useQuery({
    queryKey: ['journal-alerts', 'journee'],
    queryFn: () => journalAPI.getAlerts({ limit: 8 }).then((r) => r.data.data),
    enabled: !willRedirect,
  });

  const notesQ = useQuery({
    queryKey: ['notes', { journee: true }],
    queryFn: () => notesAPI.getAll({ limit: 4 }).then((r) => r.data.data || []),
    enabled: !willRedirect,
  });

  const monthStart = today ? `${today.slice(0, 7)}-01` : '';
  const statsQ = useQuery({
    queryKey: ['scoped-stats', { journee: true, from: monthStart, to: today }],
    queryFn: () => scopedStatsAPI.get({ from: monthStart, to: today }).then((r) => r.data.data),
    // Le chef et le surveillant de service ont déjà leur charge de service dans
    // `/api/chef/overview` : un second appel donnerait deux chiffres à comparer
    // pour la même mesure.
    enabled: !willRedirect && isWatcher && !!monthStart,
    refetchInterval: 120000,
  });

  // ── Qui est de service, et où en est son appel ───────────────────────────
  const declared = useMemo(() => {
    const map = new Map();
    (callsQ.data?.calls || []).forEach((c) => map.set(c.key, c.isDeclared === true));
    return map;
  }, [callsQ.data]);

  const guards = useMemo(() => {
    const rows = (overview?.todayGuards || []).map((g) => {
      const key = `${today}|${g.scheduleId}|${g.userId}`;
      return { ...g, key, declared: declared.get(key) === true };
    });
    return rows.sort((a, b) =>
      (a.departmentName || '').localeCompare(b.departmentName || '', 'fr')
      || (a.name || '').localeCompare(b.name || '', 'fr'));
  }, [overview, declared, today]);

  const callsReady = callsQ.isSuccess;
  const pointed = guards.filter((g) => g.declared).length;
  const toPoint = guards.length - pointed;

  // ── Ce qui attend une décision ───────────────────────────────────────────
  const queue = useMemo(() => {
    if (isChefScope) {
      const a = chef?.aTraiter;
      if (!a) return [];
      return byPending([
        { key: 'proposals', label: 'Propositions de modification', count: a.propositions,
          hint: 'À accepter ou à refuser sur vos plannings', to: screen.path },
        { key: 'replacements', label: 'Remplacements à confirmer', count: a.remplacements,
          hint: 'Le tableur validé reste intact : le remplacement vit à côté', to: replacementsPath },
        { key: 'loans-in', label: 'Prêts de personnel entrants', count: a.pretsEntrants,
          hint: 'Un autre service demande un de vos agents', to: '/staff-loans' },
        { key: 'loans-out', label: 'Prêts de personnel sortants', count: a.pretsSortants,
          hint: 'Vos demandes en attente de réponse', to: '/staff-loans' },
        { key: 'leaves', label: 'Congés à décider', count: a.congesPending,
          hint: 'Un agent en congé ne peut pas être affecté à une garde', to: '/absences' },
        { key: 'absences', label: 'Absences à justifier', count: a.absencesNonJustifiees,
          hint: 'Signalées à l’appel, sans justificatif déposé', to: '/absences' },
      ]);
    }
    if (isWatcher) {
      // Les alertes ouvertes ne figurent pas ici : elles sont listées, avec
      // leur gravité et leur détail, dans « Points de vigilance » juste à
      // côté. Une file ne vaut que si elle ouvre l'écran qui la traite.
      return byPending([
        { key: 'replacements', label: 'Remplacements en attente', count: summary.replacementsPending,
          hint: 'Sur l’ensemble des services de l’hôpital', to: replacementsPath },
        { key: 'loans', label: 'Prêts de personnel en attente', count: loansQ.data?.length,
          hint: 'La décision revient au service prêteur', to: '/staff-loans' },
      ]);
    }
    return [];
  }, [isChefScope, isWatcher, chef, summary.replacementsPending, loansQ.data,
    screen.path, replacementsPath]);

  const queueTotal = queue.reduce((n, q) => n + (Number(q.count) || 0), 0);

  // ── Ce qui cloche : anomalies de planning et alertes ouvertes, un seul fil ─
  // Les deux répondent à la même question et se lisent ensemble ; l'origine de
  // chaque ligne reste nommée, pour savoir où aller la corriger.
  const vigilance = useMemo(() => {
    const rows = [];
    const detected = isChefScope ? (chef?.vigilance?.list || []) : (conflicts?.conflicts || []);
    detected.forEach((v, i) => {
      const days = Array.isArray(v.days) ? v.days : [];
      rows.push({
        id: `plan-${i}`,
        severity: v.severity,
        origin: CONFLICT_LABEL[v.type] || 'Planning',
        title: v.title || CONFLICT_LABEL[v.type] || 'Anomalie de planning',
        detail: v.detail,
        when: v.date || days[0] || null,
        span: v.dayCount > 1 ? `${v.dayCount} jours` : null,
      });
    });
    (alertsQ.data?.alerts || []).forEach((a) => {
      rows.push({
        id: `alert-${a.id}`,
        severity: a.severity,
        origin: a.departmentName ? `Alerte · ${a.departmentName}` : 'Alerte de service',
        title: a.title,
        detail: a.message,
        when: dayOf(a.createdAt),
        span: a.acknowledgedAt ? 'Acquittée' : null,
      });
    });
    rows.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
    return rows;
  }, [isChefScope, chef, conflicts, alertsQ.data]);

  const vigilanceCritical = vigilance.filter((v) => toneOfSeverity(v.severity) === 'alert').length;

  // ── La charge du mois, depuis la source déjà chargée pour le rôle ─────────
  const load = useMemo(() => {
    if (isChefScope && chef?.charge) {
      return {
        from: chef.charge.period?.from,
        to: chef.charge.period?.to,
        totalGuards: chef.charge.totalGuards,
        staffCount: chef.charge.staffCount,
        averagePerStaff: chef.charge.averagePerStaff,
        loadGap: chef.charge.loadGap,
        list: chef.charge.list || [],
        note: chef.department?.name ? `Service ${chef.department.name}` : null,
      };
    }
    if (isWatcher && statsQ.data) {
      const s = statsQ.data.summary || {};
      return {
        from: statsQ.data.period?.from,
        to: statsQ.data.period?.to,
        totalGuards: s.totalGuards,
        staffCount: s.staffCount,
        averagePerStaff: s.averagePerStaff,
        loadGap: s.loadGap,
        list: statsQ.data.topStaff || [],
        note: s.departmentsCount ? `${s.departmentsCount} service(s) au tableur` : null,
      };
    }
    return null;
  }, [isChefScope, isWatcher, chef, statsQ.data]);

  const loadMax = load?.list?.length ? Math.max(...load.list.map((s) => Number(s.guards) || 0)) : 0;

  // ── Rendu ────────────────────────────────────────────────────────────────

  if (willRedirect) {
    return <p className="gsj-hold">Ouverture de votre tableau de bord…</p>;
  }

  const showDept = overview?.scope === 'establishment';
  const loading = overviewQ.isLoading;

  const guardColumns = [
    {
      key: 'name',
      label: 'Agent',
      strong: true,
      render: (g) => (
        <span className="gsj-who">
          <b>{g.name}</b>
          {g.roleName ? <span>{g.roleName}</span> : null}
        </span>
      ),
    },
    {
      key: 'label',
      label: 'Poste',
      render: (g) => (
        <span className="gsj-post">
          {g.label || '—'}
          {g.atHome ? <GsBadge tone="quiet">À domicile</GsBadge> : null}
        </span>
      ),
    },
    {
      key: 'hours',
      label: 'Horaire',
      num: true,
      width: 118,
      render: (g) => (hour(g.shiftStart) && hour(g.shiftEnd)
        ? `${hour(g.shiftStart)} → ${hour(g.shiftEnd)}`
        : '—'),
    },
    {
      key: 'dept',
      label: 'Service',
      hidden: !showDept,
      render: (g) => g.departmentName || '—',
    },
    {
      key: 'call',
      label: 'Appel',
      width: 116,
      render: (g) => {
        if (!callsReady) return <span className="gsj-wait">…</span>;
        return g.declared
          ? <GsBadge tone="duty" dot>Pointé</GsBadge>
          : <GsBadge dot>À pointer</GsBadge>;
      },
    },
  ];

  return (
    <div className="gsj-wrap">
      {/* Appartenance — hôpital et service(s). Rien pour le Super Admin. */}
      <ContextBadge variant="header" />

      <GsPageHeader
        eyebrow={ROLE_LABEL[role] || 'Espace personnel'}
        title="Ma journée"
        subtitle={today
          ? `${cap(fullFrenchDate(today))} — ce qui se joue aujourd’hui dans votre périmètre, et ce qui attend votre décision.`
          : 'Ce qui se joue aujourd’hui dans votre périmètre, et ce qui attend votre décision.'}
        meta={[
          overview?.scopeLabel ? { label: 'Périmètre', value: overview.scopeLabel } : null,
          { label: 'Plannings en cours', value: activeSchedules.length },
        ]}
        actions={home ? (
          <>
            <Link to="/appel-du-jour" className="gs-btn">
              <ClipboardCheck size={14} strokeWidth={1.8} />
              Appel du jour
            </Link>
            <Link to={home.path} className="gs-btn is-primary">
              {home.label}
              <ArrowRight size={14} strokeWidth={1.8} />
            </Link>
          </>
        ) : null}
        rail={loading ? <GsSkeleton variant="rail" count={4} /> : (
          <GsStatRail>
            <GsStat
              label="De service aujourd’hui"
              value={summary.staffOnDutyToday}
              tone="duty"
              hint={`${summary.guardsToday || 0} affectation(s) au tableur`}
              onClick={() => navigate('/appel-du-jour')}
              title="Ouvrir l’appel du jour"
            />
            <GsStat
              label="Reste à pointer"
              value={callsReady ? toPoint : null}
              tone={callsReady && toPoint > 0 ? 'alert' : undefined}
              hint={callsReady ? `${pointed} pointé(s) sur ${guards.length}` : 'Lecture de l’appel…'}
              onClick={() => navigate('/appel-du-jour')}
              title="Ouvrir l’appel du jour"
            />
            <GsStat
              label="Points de vigilance"
              value={vigilance.length}
              tone={vigilanceCritical > 0 ? 'alert' : undefined}
              hint={vigilanceCritical > 0 ? `${vigilanceCritical} à traiter en premier` : 'Anomalies et alertes ouvertes'}
            />
            <GsStat
              label="En attente de décision"
              value={queue.length ? queueTotal : null}
              tone="seal"
              hint={isChefScope ? 'Propositions, remplacements, prêts, congés' : 'Remplacements et prêts de personnel'}
            />
          </GsStatRail>
        )}
      />

      {overviewQ.isError ? (
        <GsPanel>
          <GsEmpty
            icon={<TriangleAlert size={26} strokeWidth={1.6} />}
            title="La vue du jour n’a pas pu être chargée"
            hint="Le service n’a pas répondu. Rien n’est perdu : la lecture peut être relancée."
            actions={<button type="button" className="gs-btn is-primary" onClick={() => overviewQ.refetch()}>Réessayer</button>}
          />
        </GsPanel>
      ) : (
        <div className="gsj-grid">
          {/* ── Colonne principale ─────────────────────────────────────── */}
          <div className="gsj-col">
            <GsPanel
              icon={<Inbox size={15} strokeWidth={1.7} />}
              title="Ce qui m’attend"
              sub="Les files où votre décision est attendue. Chaque ligne ouvre l’écran qui la traite."
            >
              {(isChefScope && chefQ.isLoading) || (isWatcher && loansQ.isLoading)
                ? <GsSkeleton variant="rows" count={4} />
                : queue.length === 0 ? (
                  <GsEmpty
                    bare
                    title="Aucune file de décision pour votre rôle"
                    hint="Les demandes qui vous concernent apparaissent ici dès qu’elles sont déposées."
                  />
                ) : (
                  <ul className="gsj-queue">
                    {queue.map((q) => {
                      const n = Number(q.count) || 0;
                      return (
                        <li key={q.key} data-idle={n === 0 ? 'true' : 'false'}>
                          <span className="gsj-queue-label">
                            {q.to ? <Link to={q.to}>{q.label}</Link> : q.label}
                            <span className="gsj-queue-hint">{q.hint}</span>
                          </span>
                          <span className="gsj-queue-count gs-num">{n}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
            </GsPanel>

            <GsPanel
              icon={<Users size={15} strokeWidth={1.7} />}
              title="Qui est de service aujourd’hui"
              sub={showDept
                ? 'Tous les services de l’hôpital, tels que les tableurs en cours les déclarent.'
                : 'Votre service, tel que le tableur en cours le déclare.'}
              tools={<Link to="/appel-du-jour" className="gs-btn is-quiet">Pointer l’appel</Link>}
              flush
            >
              {loading ? <GsSkeleton variant="rows" count={5} /> : (
                <GsTable
                  label="Personnels de garde aujourd’hui"
                  columns={guardColumns}
                  rows={guards}
                  rowKey="key"
                  empty={(
                    <GsEmpty
                      bare
                      icon={<CalendarOff size={26} strokeWidth={1.6} />}
                      title="Personne n’est de service aujourd’hui"
                      hint={activeSchedules.length
                        ? `${activeSchedules.length} planning(s) sont en cours dans votre périmètre, mais aucun n’affecte d’agent à cette date.`
                        : 'Aucun planning n’est en cours dans votre périmètre : un tableur soumis et couvrant la date du jour alimente cette liste.'}
                      actions={home ? <Link to={home.path} className="gs-btn is-primary">{home.label}</Link> : null}
                    />
                  )}
                />
              )}
            </GsPanel>
          </div>

          {/* ── Colonne latérale ───────────────────────────────────────── */}
          <div className="gsj-col">
            <GsPanel
              tone={vigilanceCritical > 0 ? 'alert' : undefined}
              icon={<TriangleAlert size={15} strokeWidth={1.7} />}
              title="Points de vigilance"
              sub="Anomalies détectées sur les plannings et alertes de service encore ouvertes."
              scroll
              maxHeight={340}
            >
              {(isChefScope && chefQ.isLoading) || (isWatcher && conflictsQ.isLoading) || alertsQ.isLoading
                ? <GsSkeleton variant="rows" count={3} />
                : vigilance.length === 0 ? (
                  <GsEmpty
                    bare
                    title="Rien à signaler dans votre périmètre"
                    hint="Aucun agent en congé affecté à une garde, aucune double affectation, aucune journée découverte, aucune alerte ouverte."
                  />
                ) : (
                  <ul className="gsj-vig">
                    {vigilance.map((v) => (
                      <li key={v.id}>
                        <span className="gsj-vig-top">
                          <GsBadge tone={toneOfSeverity(v.severity)} dot>
                            {SEVERITY_LABEL[v.severity] || v.severity}
                          </GsBadge>
                          <span className="gsj-vig-origin">{v.origin}</span>
                        </span>
                        <strong className="gsj-vig-title">{v.title}</strong>
                        {v.detail ? <p className="gsj-vig-detail" title={v.detail}>{v.detail}</p> : null}
                        {(v.when || v.span) ? (
                          <span className="gsj-vig-when gs-num">
                            {v.when ? shortFrenchDate(v.when, true) : null}
                            {v.when && v.span ? ' · ' : null}
                            {v.span}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
            </GsPanel>

            <GsPanel
              icon={<Scale size={15} strokeWidth={1.7} />}
              title="Mes plannings en cours"
              sub="Ceux qui couvrent la date du jour. Les brouillons et les plannings terminés ne sont pas ici."
            >
              {loading ? <GsSkeleton variant="rows" count={2} /> : activeSchedules.length === 0 ? (
                <GsEmpty
                  bare
                  title="Aucun planning en cours"
                  hint="Un planning devient « en cours » le jour où sa période commence, une fois soumis."
                  actions={home ? <Link to={home.path} className="gs-btn">{home.label}</Link> : null}
                />
              ) : (
                <ul className="gsj-plan">
                  {activeSchedules.map((s) => (
                    <li key={s.id}>
                      <span className="gsj-plan-top">
                        <Link to={screen.deepLink ? `${screen.path}?scheduleId=${s.id}` : screen.path} className="gsj-plan-name">
                          {s.name}
                        </Link>
                        <PlanningStateBadge state={s.state} status={s.status} startDate={s.startDate} endDate={s.endDate} size="sm" />
                      </span>
                      <span className="gsj-plan-meta gs-num">
                        {frenchRange(s.startDate, s.endDate)}
                        {showDept && s.departmentName ? <span className="gsj-plan-dept">{s.departmentName}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GsPanel>

            <GsPanel
              icon={<FileText size={15} strokeWidth={1.7} />}
              title="Notes et circulaires"
              sub="Les dernières consignes qui vous sont destinées."
              tools={<Link to="/notes" className="gs-btn is-quiet">Tout lire</Link>}
            >
              {notesQ.isLoading ? <GsSkeleton variant="text" count={3} /> : (notesQ.data || []).length === 0 ? (
                <GsEmpty
                  bare
                  icon={<BellRing size={24} strokeWidth={1.6} />}
                  title="Aucune consigne publiée"
                  hint="Les notes de votre hôpital et les circulaires nationales arrivent ici dès leur publication."
                />
              ) : (
                <ul className="gsj-notes">
                  {(notesQ.data || []).map((n) => (
                    <li key={n.id} data-unread={n.isRead ? 'false' : 'true'}>
                      <span className="gsj-note-top">
                        <Link to="/notes" className="gsj-note-title">{n.title}</Link>
                        {n.priority === 'urgent' || n.priority === 'high'
                          ? <GsBadge tone="alert" dot>{n.priority === 'urgent' ? 'Urgente' : 'Élevée'}</GsBadge>
                          : null}
                      </span>
                      <span className="gsj-note-meta">
                        {NOTE_CATEGORY[n.category] || cap(n.category || 'Note')}
                        {n.publishedAt ? <span className="gs-num">{shortFrenchDate(dayOf(n.publishedAt), true)}</span> : null}
                        {n.isRead ? null : <span className="gsj-note-flag">Non lue</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </GsPanel>
          </div>

          {/* ── Charge du mois, sur toute la largeur ───────────────────── */}
          <GsPanel
            className="gsj-span"
            icon={<Scale size={15} strokeWidth={1.7} />}
            title="Charge du mois"
            sub={load?.from
              ? `Gardes comptées au tableur, ${frenchRange(load.from, load.to)}.`
              : 'Gardes comptées au tableur depuis le début du mois.'}
            tools={hasPermission?.('stats.read')
              ? <Link to="/statistics" className="gs-btn is-quiet">Ouvrir l’analytique</Link>
              : null}
          >
            {(isChefScope && chefQ.isLoading) || (isWatcher && statsQ.isLoading) ? (
              <GsSkeleton variant="rows" count={4} />
            ) : !load || !load.list.length ? (
              <GsEmpty
                bare
                title="Aucune garde comptée ce mois-ci"
                hint="La charge se calcule sur les tableurs soumis ou en cours de la période. Aucun n’en porte pour l’instant."
              />
            ) : (
              <div className="gsj-load">
                <GsStatRail compact>
                  <GsStat label="Gardes au total" value={load.totalGuards} />
                  <GsStat label="Agents concernés" value={load.staffCount} />
                  <GsStat label="Moyenne par agent" value={load.averagePerStaff} unit="gardes" />
                  <GsStat
                    label="Écart max — min"
                    value={load.loadGap}
                    tone={load.loadGap > 2 ? 'alert' : undefined}
                    hint={load.loadGap > 2 ? 'La répartition mérite un arbitrage' : 'Répartition resserrée'}
                  />
                </GsStatRail>

                <ul className="gsj-bars">
                  {load.list.slice(0, 6).map((s) => {
                    const n = Number(s.guards) || 0;
                    const pct = loadMax > 0 ? Math.round((n / loadMax) * 100) : 0;
                    return (
                      <li key={s.userId || s.name}>
                        <span className="gsj-bars-name">
                          {s.name}
                          {s.roleName || s.departmentName
                            ? <span>{s.departmentName || s.roleName}</span>
                            : null}
                        </span>
                        <span className="gsj-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                        <span className="gsj-bars-count gs-num">{n}</span>
                      </li>
                    );
                  })}
                </ul>

                {load.note ? <p className="gsj-load-note">{load.note}</p> : null}
              </div>
            )}
          </GsPanel>
        </div>
      )}
    </div>
  );
}
