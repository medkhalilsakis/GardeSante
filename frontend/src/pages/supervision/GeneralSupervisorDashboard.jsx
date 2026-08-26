/**
 * Supervision générale — `/supervision`
 * ═════════════════════════════════════
 * L'écran du surveillant général, également ouvert à la direction en lecture. Il
 * ne modifie ni `ChefDeServiceDashboard` ni `SurveillantDashboard` : tout ce qui
 * existe y est rebranché tel quel (aperçu tableur, propositions de modification,
 * journal, alertes, calendrier hôpital, statistiques par portée, portfolio,
 * remplacements) ; seules la cohérence inter-services et la transmission d'un
 * rapport lui sont propres.
 *
 * INVARIANT : le surveillant général consulte les remplacements et les prêts
 * sans les confirmer. Ce droit reste gaté côté serveur — cet écran ne l'ouvre pas.
 *
 * Refonte (phase 4)
 * ─────────────────
 * L'écran n'avait aucun CSS : huit cartes de KPI à couleur arbitraire, dix
 * pastilles d'onglets en bleu plein, la couverture en grille de cartes à liseré
 * vert ou ambre, et des dates ISO brutes dans trois listes. Il passe sur le kit
 * `components/gs/` :
 *   • les huit KPI deviennent un filet de mesure, `duty` et `alert` pour seuls
 *     tons — une mesure n'a pas de couleur parce qu'elle est la quatrième ;
 *   • la couverture devient un **registre** : une ligne par service, les
 *     chiffres alignés, les services découverts signalés sur la ligne entière.
 *     On la lit en comparant des colonnes, pas en parcourant des cartes ;
 *   • cinq mesures ouvrent l'onglet qui montre exactement le même ensemble
 *     qu'elles chiffrent — vérifié pour ce rôle, endpoint par endpoint ;
 *   • plus aucune date ISO : `fullFrenchDate`, `frenchRange`, `longFrenchDate`,
 *     et `frenchifyIsoDates` pour les phrases composées côté serveur.
 *
 * Un onglet neuf, sans endpoint neuf
 * ──────────────────────────────────
 * `/api/supervision/conflicts` renvoyait déjà la liste complète des anomalies de
 * cohérence (double affectation, agent affecté pendant un congé, journée
 * découverte) et l'écran n'en affichait que le total : un compteur sans
 * destination. L'onglet « Anomalies » expose la liste que la requête rapportait
 * depuis le début, et branche chaque ligne sur les propositions de modification
 * du planning concerné — la seule voie de correction, puisqu'un tableur validé
 * ne se réécrit pas.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarOff, CalendarX2, GitCompareArrows, Send, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../../store';
import { supervisionAPI, portfolioAPI } from '../../api';
import LiveGuardsPanel from './components/LiveGuardsPanel';
import StaffLoansOverview from './components/StaffLoansOverview';
import SupervisionReportModal from './components/SupervisionReportModal';
import ServiceJournalPanel from '../surveillant/components/ServiceJournalPanel';
import ServiceAlertsPanel from '../surveillant/components/ServiceAlertsPanel';
import ReplacementsPanel from '../replacements/components/ReplacementsPanel';
import SchedulePreviewModal from '../replacements/components/SchedulePreviewModal';
import ScheduleChangeProposals from '../schedules/components/ScheduleChangeProposals';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ScopedStatsPanel from '../../components/statistics/ScopedStatsPanel';
import ContextBadge from '../../components/layout/ContextBadge';
import PortfolioGrid from '../../components/portfolio/PortfolioGrid';
import StaffPortfolioModal from '../../components/portfolio/StaffPortfolioModal';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import {
  GsPageHeader, GsPanel, GsPanelHeader, GsStat, GsStatRail, GsTabRail,
  GsTable, GsBadge, GsFilterBar, GsEmpty, GsSkeleton,
} from '../../components/gs';
import {
  frenchRange, frenchifyIsoDates, fullFrenchDate, longFrenchDate,
} from '../../utils/frenchDates';
import './supervision.css';

const TABS = [
  { id: 'overview',      label: 'Vue d\'ensemble' },
  { id: 'direct',        label: 'Garde en direct' },
  { id: 'plannings',     label: 'Plannings reçus' },
  { id: 'anomalies',     label: 'Anomalies' },
  { id: 'prets',         label: 'Prêts de personnel' },
  { id: 'alertes',       label: 'Alertes' },
  { id: 'journal',       label: 'Journal' },
  { id: 'remplacements', label: 'Remplacements' },
  { id: 'personnel',     label: 'Personnel' },
  { id: 'calendrier',    label: 'Calendrier hôpital' },
  { id: 'stats',         label: 'Statistiques' },
];

/**
 * `all` plutôt qu'une chaîne vide : l'identifiant d'un filtre sert aussi de clé
 * de rendu et de clé de requête, et une chaîne vide fait un mauvais des deux.
 * La traduction en paramètre d'API se fait au seul endroit qui l'appelle.
 */
const STATE_FILTERS = [
  { id: 'all',      label: 'Tous' },
  { id: 'soumis',   label: 'Soumis' },
  { id: 'en_cours', label: 'En cours' },
  { id: 'termine',  label: 'Terminés' },
];

/**
 * Les trois familles d'anomalies que `conflict-rules.js` sait détecter. Le
 * libellé nomme la règle enfreinte, pas le code : « affecté pendant un congé »
 * est la règle I du cahier des charges.
 */
const FLAW_FAMILIES = {
  double_booking: { label: 'Double affectation',   Icon: GitCompareArrows, sum: 'doubleBooking' },
  on_leave:       { label: 'Affecté en congé',     Icon: CalendarX2,       sum: 'onLeave' },
  uncovered_day:  { label: 'Journée découverte',   Icon: ShieldAlert,      sum: 'uncovered' },
};

/**
 * Ce que vaut une gravité dans le registre : `alert` quand une décision est
 * attendue, `watch` pour ce qui se surveille sans bloquer. Mêmes tons que les
 * alertes de service, pour que les deux listes se lisent pareil.
 */
const FLAW_SEVERITY = {
  critical: { label: 'Critique',  tone: 'alert' },
  error:    { label: 'Grave',     tone: 'alert' },
  warning:  { label: 'Vigilance', tone: 'watch' },
  info:     { label: 'Information', tone: null },
};

export default function GeneralSupervisorDashboard() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState('overview');
  const [stateFilter, setStateFilter] = useState('all');
  const [flawFamily, setFlawFamily] = useState('all');
  const [previewSchedule, setPreviewSchedule] = useState(null);
  const [proposalScheduleId, setProposalScheduleId] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [search, setSearch] = useState('');

  // Le surveillant général écrit au journal de tout service de son hôpital
  // (`assertDepartmentWritable`) ; le directeur, lui, reste en lecture.
  const canWrite = user?.roleCode === 'general_supervisor';

  const { data: ovRes, isLoading: loadingOv, error: ovError } = useQuery({
    queryKey: ['supervision-overview'],
    queryFn: () => supervisionAPI.getOverview(),
  });
  const ov = ovRes?.data?.data;
  const s = ov?.summary || {};
  const forbidden = ovError?.response?.status === 403;

  const { data: schedRes, isLoading: loadingSched } = useQuery({
    queryKey: ['supervision-schedules', stateFilter],
    queryFn: () => supervisionAPI.getSchedules(
      stateFilter === 'all' ? undefined : { state: stateFilter }
    ),
  });
  const schedules = schedRes?.data?.data?.schedules || [];

  const { data: cfRes, isLoading: loadingCf } = useQuery({
    queryKey: ['supervision-conflicts'],
    queryFn: () => supervisionAPI.getConflicts(),
  });
  const conflicts = cfRes?.data?.data?.conflicts || [];
  const conflictSummary = cfRes?.data?.data?.summary || {};
  const schedulesAnalyzed = cfRes?.data?.data?.schedulesAnalyzed;

  const shownConflicts = useMemo(
    () => (flawFamily === 'all' ? conflicts : conflicts.filter((c) => c.type === flawFamily)),
    [conflicts, flawFamily]
  );

  const { data: pfRes, isLoading: loadingPf } = useQuery({
    queryKey: ['portfolio', 'supervision'],
    queryFn: () => portfolioAPI.getAll(),
    enabled: tab === 'personnel',
  });
  const agents = pfRes?.data?.data?.agents || pfRes?.data?.data || [];

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const name = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
      // Le service n'est pas une colonne du portefeuille : `portfolio.controller`
      // agrège les affectations dans `departments[]` (`departmentName`). Chercher
      // sur un `department_name` inexistant ne renvoyait jamais rien alors que la
      // fiche affiche le service, et « grade » était promis sans être lu.
      const departments = (a.departments || [])
        .map((d) => d?.departmentName || '')
        .join(' ')
        .toLowerCase();
      return name.includes(q)
        || (a.matricule || '').toLowerCase().includes(q)
        || (a.role_name || '').toLowerCase().includes(q)
        || (a.grade || '').toLowerCase().includes(q)
        || (a.speciality || '').toLowerCase().includes(q)
        || departments.includes(q);
    });
  }, [agents, search]);

  // Brouillon de synthèse pré-rempli : le rapport part de faits déjà mesurés.
  const reportDraft = useMemo(() => {
    if (!ov) return '';
    return [
      `Couverture : ${s.departmentsCovered ?? 0}/${s.departments ?? 0} service(s) couvert(s) le ${longFrenchDate(ov.today)}.`,
      `${s.guardsToday ?? 0} garde(s) du jour, ${s.staffOnDutyToday ?? 0} agent(s) en poste.`,
      `Absentéisme : ${s.shiftAbsencesToday ?? 0} absence(s) signalée(s), ${s.latesToday ?? 0} retard(s), ${s.leavesToday ?? 0} congé(s) en cours.`,
      `Plannings : ${s.schedulesSubmitted ?? 0} soumis, ${s.schedulesActive ?? 0} en cours.`,
      `Anomalies relevées : ${conflictSummary.total ?? 0} dont ${conflictSummary.critical ?? 0} critique(s).`,
      `Remplacements : ${s.replacementsPending ?? 0} en attente. Prêts de personnel : ${s.loansPending ?? 0} en attente.`,
    ].join('\n');
  }, [ov, s, conflictSummary]);

  const requestCorrection = (scheduleId) => {
    setProposalScheduleId(scheduleId);
  };

  /** Une mesure ouvre l'onglet qui montre le même ensemble, sur la même portée. */
  const openTab = (id) => () => setTab(id);

  const openSubmitted = () => {
    setStateFilter('soumis');
    setTab('plannings');
  };

  /**
   * Le nom de l'hôpital, tel que le serveur le renvoie. Il est employé comme
   * apposition et jamais après « de » : « de Hôpital Habib Thameur » serait
   * fautif, et aucune élision automatique ne tient pour « CHU » comme pour
   * « Hôpital ».
   */
  const hospitalLabel = ov?.scopeLabel || 'Tous les services de l\'hôpital';

  return (
    <div className="gsp-wrap">
      {/* Appartenance — hôpital supervisé et service(s) de rattachement. */}
      <ContextBadge variant="header" />

      {/* Le nom de l'hôpital est déjà porté deux fois — par la barre latérale et
          par le cartouche d'appartenance juste au-dessus. Le surtitre dit donc le
          périmètre, pas l'établissement : c'est l'information que ni l'un ni
          l'autre ne donne. */}
      <GsPageHeader
        eyebrow="Tous les services de l'hôpital"
        title="Supervision générale"
        subtitle="Quels services sont couverts aujourd'hui, quels plannings attendent une lecture, et ce qui, ailleurs, réclame une décision."
        meta={[
          ov?.today ? { key: 'day', label: 'Journée du', value: fullFrenchDate(ov.today) } : null,
          s.departments ? { key: 'dept', label: 'Services', value: s.departments } : null,
          schedulesAnalyzed !== undefined
            ? { key: 'analyzed', label: 'Plannings analysés', value: schedulesAnalyzed }
            : null,
        ]}
        actions={!forbidden ? (
          <button type="button" className="gs-btn is-primary" onClick={() => setReporting(true)}>
            <Send size={14} strokeWidth={2} aria-hidden="true" />
            Rapport à la direction
          </button>
        ) : null}
        rail={loadingOv ? <GsSkeleton variant="rail" count={8} /> : (
          <GsStatRail>
            <GsStat
              label="Couverture du jour"
              value={`${s.departmentsCovered ?? 0}/${s.departments ?? 0}`}
              hint="Services portant au moins une garde"
              tone={(s.departments ?? 0) > (s.departmentsCovered ?? 0) ? 'alert' : 'duty'}
            />
            <GsStat
              label="Gardes aujourd'hui"
              value={s.guardsToday ?? 0}
              hint={`${s.staffOnDutyToday ?? 0} agent(s) en poste`}
              tone="duty"
              onClick={openTab('direct')}
              title="Ouvrir la garde en direct — mêmes plannings en cours, agent par agent"
            />
            <GsStat
              label="Plannings soumis"
              value={s.schedulesSubmitted ?? 0}
              hint={`${s.schedulesActive ?? 0} en cours`}
              onClick={openSubmitted}
              title="Ouvrir les plannings soumis"
            />
            <GsStat
              label="Anomalies"
              value={loadingCf ? null : (conflictSummary.total ?? 0)}
              hint={`${conflictSummary.critical ?? 0} critique(s)`}
              tone={(conflictSummary.total ?? 0) > 0 ? 'alert' : undefined}
              onClick={openTab('anomalies')}
              title="Ouvrir la liste des anomalies de cohérence"
            />
            {/* « dont » et non « · » : un retard EST une ligne de signalement
                (`kind = 'shift_absence'` + type `retard`), il est donc déjà
                compté dans la valeur de la mesure — l'ancien séparateur laissait
                croire à deux totaux à additionner. */}
            <GsStat
              label="Absentéisme du jour"
              value={s.shiftAbsencesToday ?? 0}
              hint={`dont ${s.latesToday ?? 0} retard(s) · ${s.leavesToday ?? 0} congé(s) en cours`}
              tone={(s.shiftAbsencesToday ?? 0) > 0 ? 'alert' : undefined}
            />
            <GsStat
              label="Alertes ouvertes"
              value={s.openAlerts ?? 0}
              hint={`${s.criticalAlerts ?? 0} critique(s)`}
              tone={(s.openAlerts ?? 0) > 0 ? 'alert' : undefined}
              onClick={openTab('alertes')}
              title="Ouvrir les alertes non résolues de l'hôpital"
            />
            <GsStat
              label="Remplacements"
              value={s.replacementsConfirmed ?? 0}
              hint={`${s.replacementsPending ?? 0} en attente du chef`}
              tone={(s.replacementsPending ?? 0) > 0 ? 'alert' : undefined}
              onClick={openTab('remplacements')}
              title="Ouvrir les remplacements de l'hôpital"
            />
            <GsStat
              label="Prêts en attente"
              value={s.loansPending ?? 0}
              hint="Décision au chef propriétaire"
              tone={(s.loansPending ?? 0) > 0 ? 'alert' : undefined}
              onClick={openTab('prets')}
              title="Ouvrir les prêts de personnel inter-service"
            />
          </GsStatRail>
        )}
      >
        <GsTabRail
          label="Sections de la supervision"
          value={tab}
          onChange={setTab}
          tabs={TABS.map((t) => ({
            ...t,
            count: t.id === 'anomalies' ? conflictSummary.total
              : t.id === 'alertes' ? s.openAlerts
                : t.id === 'prets' ? s.loansPending
                  : t.id === 'remplacements' ? s.replacementsPending
                    : undefined,
          }))}
        />
      </GsPageHeader>

      {forbidden ? (
        <GsEmpty
          icon={<ShieldAlert size={26} strokeWidth={1.6} />}
          title="Écran réservé à la supervision générale et à la direction"
          hint="Votre rôle donne accès aux autres écrans du menu. La supervision lit tous les services d'un même hôpital."
        />
      ) : null}

      {/* ── VUE D'ENSEMBLE ────────────────────────────────────── */}
      {tab === 'overview' && !forbidden && (
        <div className="gsp-tab-body">
          <GsPanel
            title="Couverture des services aujourd'hui"
            sub="Les gardes sont lues dans le tableur des plannings en cours ; un agent compte une fois par planning, exactement comme au journal de service."
            flush
          >
            {loadingOv ? (
              <div className="gsp-load"><GsSkeleton variant="rows" count={4} /></div>
            ) : (
              <GsTable
                label="Couverture service par service"
                rows={ov?.departments || []}
                rowKey="id"
                caption={`${s.departmentsCovered ?? 0} service(s) couvert(s) sur ${s.departments ?? 0} — un service découvert est signalé sur toute sa ligne.`}
                flagged={(d) => !d.covered}
                columns={[
                  { key: 'name', label: 'Service', strong: true },
                  {
                    key: 'covered',
                    label: 'État',
                    render: (d) => (
                      <GsBadge tone={d.covered ? 'duty' : 'alert'} dot>
                        {d.covered ? 'Couvert' : 'À couvrir'}
                      </GsBadge>
                    ),
                  },
                  { key: 'guardsToday', label: 'Gardes', num: true, width: '9ch' },
                  { key: 'staffCount', label: 'Agents', num: true, width: '9ch' },
                  { key: 'activeSchedules', label: 'Plannings en cours', num: true, width: '11ch' },
                  {
                    key: 'absencesToday',
                    label: 'Absences du jour',
                    num: true,
                    width: '11ch',
                    render: (d) => d.absencesToday || '—',
                  },
                ]}
                empty={(
                  <GsEmpty
                    bare
                    icon={<CalendarOff size={26} strokeWidth={1.6} />}
                    title="Aucun service actif dans cet hôpital"
                    hint="La couverture se calcule sur les services de l'établissement : sans service déclaré, il n'y a rien à couvrir."
                  />
                )}
              />
            )}
          </GsPanel>

          {/* `ServiceAlertsPanel` n'a aucun filtre de sévérité : il liste toutes
              les alertes non résolues de l'hôpital. Le titre annonçait
              « critiques », ce que le contenu contredisait. */}
          <ServiceAlertsPanel
            canAct={canWrite}
            title="Alertes ouvertes de l'hôpital"
            scopeNote={`${hospitalLabel} — toutes les alertes non résolues, tous services confondus.`}
          />
        </div>
      )}

      {/* ── PLANNINGS REÇUS ───────────────────────────────────── */}
      {tab === 'plannings' && !forbidden && (
        <div className="gsp-tab-body">
          <GsPanel
            flush
            header={(
              <>
                <GsPanelHeader
                  title="Plannings soumis à la supervision"
                  sub="Un planning n'arrive ici qu'une fois soumis : les brouillons des chefs de service restent privés."
                />
                <GsFilterBar
                  inset
                  label="État des plannings"
                  filters={STATE_FILTERS}
                  value={stateFilter}
                  onChange={setStateFilter}
                  end={<span className="gsp-note">{schedules.length} planning(s)</span>}
                />
              </>
            )}
          >
            {loadingSched ? (
              <div className="gsp-load"><GsSkeleton variant="rows" count={4} /></div>
            ) : (
              <GsTable
                label="Plannings transmis à la supervision"
                rows={schedules}
                rowKey="id"
                columns={[
                  {
                    key: 'name',
                    label: 'Planning',
                    render: (sc) => (
                      <span className="gsp-name">
                        <b className="gsp-clip" title={sc.name}>{sc.name}</b>
                        <span>
                          {sc.departmentName || 'Service non précisé'}
                          {sc.startDate ? ` · ${frenchRange(sc.startDate, sc.endDate)}` : ''}
                        </span>
                      </span>
                    ),
                  },
                  {
                    key: 'state',
                    label: 'État',
                    render: (sc) => <PlanningStateBadge state={sc.state} status={sc.status} size="sm" />,
                  },
                  { key: 'guardCount', label: 'Gardes', num: true, width: '9ch' },
                  { key: 'staffCount', label: 'Agents', num: true, width: '9ch' },
                  {
                    key: 'pendingProposals',
                    label: 'Propositions',
                    num: true,
                    width: '11ch',
                    render: (sc) => (sc.pendingProposals > 0
                      ? <GsBadge tone="alert" title="Propositions de modification en attente">{sc.pendingProposals}</GsBadge>
                      : '—'),
                  },
                  {
                    key: 'actions',
                    label: 'Lecture',
                    align: 'right',
                    render: (sc) => (
                      <span className="gsp-acts">
                        <button type="button" className="gs-btn is-quiet" onClick={() => setPreviewSchedule(sc)}>
                          Aperçu
                        </button>
                        <button type="button" className="gs-btn is-quiet" onClick={() => requestCorrection(sc.id)}>
                          Corrections
                        </button>
                      </span>
                    ),
                  },
                ]}
                empty={(
                  <GsEmpty
                    bare
                    icon={<CalendarOff size={26} strokeWidth={1.6} />}
                    title={stateFilter === 'all' ? 'Aucun planning transmis' : 'Aucun planning dans cet état'}
                    hint={stateFilter === 'all'
                      ? 'Un chef de service transmet son planning à la supervision en le soumettant : tant qu\'il reste brouillon, il n\'est visible que de lui.'
                      : 'Les autres états portent peut-être des plannings — retirez le filtre pour voir l\'ensemble.'}
                    actions={stateFilter === 'all' ? null : (
                      <button type="button" className="gs-btn is-quiet" onClick={() => setStateFilter('all')}>
                        Voir tous les plannings
                      </button>
                    )}
                  />
                )}
              />
            )}
          </GsPanel>
        </div>
      )}

      {/* ── ANOMALIES DE COHÉRENCE ────────────────────────────── */}
      {tab === 'anomalies' && !forbidden && (
        <div className="gsp-tab-body">
          <GsPanel
            header={(
              <>
                <GsPanelHeader
                  title="Anomalies de cohérence"
                  sub={schedulesAnalyzed !== undefined
                    ? `${schedulesAnalyzed} planning(s) soumis ou en cours analysés, brouillons exclus. Un tableur validé ne se réécrit pas : la correction passe par une proposition de modification.`
                    : 'Un tableur validé ne se réécrit pas : la correction passe par une proposition de modification adressée au chef de service.'}
                />
                <GsFilterBar
                  inset
                  label="Familles d'anomalies"
                  value={flawFamily}
                  onChange={setFlawFamily}
                  filters={[
                    { id: 'all', label: 'Toutes', count: conflictSummary.total ?? 0 },
                    ...Object.entries(FLAW_FAMILIES).map(([id, fam]) => ({
                      id,
                      label: fam.label,
                      count: conflictSummary[fam.sum] ?? 0,
                    })),
                  ]}
                  end={(conflictSummary.critical ?? 0) > 0
                    ? (
                      <GsBadge tone="alert" dot title="Anomalies critiques : double affectation ou agent en congé">
                        {conflictSummary.critical} critique{conflictSummary.critical > 1 ? 's' : ''}
                      </GsBadge>
                    )
                    : null}
                />
              </>
            )}
          >
            {loadingCf ? (
              <GsSkeleton variant="rows" count={3} />
            ) : shownConflicts.length === 0 ? (
              <GsEmpty
                bare
                icon={<ShieldCheck size={26} strokeWidth={1.6} />}
                title={flawFamily === 'all'
                  ? 'Aucune anomalie relevée'
                  : `Aucune anomalie de type « ${FLAW_FAMILIES[flawFamily]?.label} »`}
                hint={flawFamily === 'all'
                  ? 'Aucun agent n\'est affecté deux fois le même jour, aucun ne l\'est pendant un congé, et aucune journée à venir n\'est découverte dans les plannings analysés.'
                  : 'Les autres familles portent peut-être des anomalies — retirez le filtre pour voir l\'ensemble.'}
                actions={flawFamily === 'all' ? null : (
                  <button type="button" className="gs-btn is-quiet" onClick={() => setFlawFamily('all')}>
                    Voir toutes les anomalies
                  </button>
                )}
              />
            ) : (
              <ul className="gsp-flaws">
                {shownConflicts.map((c, i) => {
                  const fam = FLAW_FAMILIES[c.type] || { label: c.type, Icon: ShieldAlert };
                  const sev = FLAW_SEVERITY[c.severity] || FLAW_SEVERITY.info;
                  const FlawIcon = fam.Icon;
                  const scheduleId = c.schedules?.[0];
                  return (
                    <li
                      key={`${c.type}-${c.userId || scheduleId || 'x'}-${c.date || i}`}
                      data-tone={sev.tone || undefined}
                    >
                      <span
                        className="gsp-mark"
                        data-tone={sev.tone === 'alert' ? 'alert' : undefined}
                        title={fam.label}
                      >
                        <FlawIcon size={14} strokeWidth={1.9} aria-hidden="true" />
                      </span>
                      <div className="gsp-main">
                        <div className="gsp-body">
                          <div className="gsp-top">
                            <span className="gsp-title">{c.title}</span>
                            {sev.tone ? <GsBadge tone={sev.tone === 'alert' ? 'alert' : 'quiet'}>{sev.label}</GsBadge> : null}
                            <span className="gsp-kind">{fam.label}</span>
                          </div>
                          {/* Le détail est composé côté serveur par un module pur
                              partagé avec la vue du chef de service : ses dates
                              sont mises en français à la lecture, pas à la
                              source. */}
                          {c.detail ? <p className="gsp-desc">{frenchifyIsoDates(c.detail)}</p> : null}
                          <p className="gsp-meta">
                            {c.staffName ? <span>{c.staffName}</span> : null}
                            {c.dayCount > 0 ? <span><b className="gs-num">{c.dayCount}</b> journée(s)</span> : null}
                            {c.date ? <span>à partir du {longFrenchDate(c.date)}</span> : null}
                            {c.schedules?.length > 1
                              ? <span><b className="gs-num">{c.schedules.length}</b> plannings concernés</span>
                              : null}
                          </p>
                        </div>
                        <div className="gsp-side">
                          <button
                            type="button"
                            className="gs-btn is-quiet"
                            disabled={!scheduleId}
                            title={scheduleId
                              ? 'Ouvrir les propositions de modification du planning concerné'
                              : 'Aucun planning rattaché à cette anomalie'}
                            onClick={() => requestCorrection(scheduleId)}
                          >
                            Corrections
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </GsPanel>
        </div>
      )}

      {/* ── GARDE EN DIRECT ───────────────────────────────────── */}
      {tab === 'direct' && !forbidden && <LiveGuardsPanel />}

      {/* ── PRÊTS DE PERSONNEL ────────────────────────────────── */}
      {tab === 'prets' && !forbidden && <StaffLoansOverview />}

      {/* ── ALERTES ───────────────────────────────────────────── */}
      {tab === 'alertes' && (
        <div className="gsp-tab-body">
          <ServiceAlertsPanel
            canAct={canWrite}
            title="Alertes — tous les services"
            scopeNote={`${hospitalLabel} — toutes les alertes non résolues, tous services confondus.`}
          />
        </div>
      )}

      {/* ── JOURNAL ───────────────────────────────────────────── */}
      {tab === 'journal' && (
        <div className="gsp-tab-body">
          <ServiceJournalPanel
            canWrite={false}
            title="Journal de tous les services"
            scopeNote={`${hospitalLabel} — lecture de tous les services. Pour consigner une entrée, passez par « Surveillance du service » : une entrée de journal appartient toujours à un service.`}
          />
        </div>
      )}

      {/* ── REMPLACEMENTS (consultation) ──────────────────────── */}
      {tab === 'remplacements' && (
        <div className="gsp-section">
          {/* `ReplacementsPanel` porte déjà son titre : on n'ajoute que la règle
              qui vaut pour ce rôle. Pas de « consultation » ici — le panneau
              ouvre « Nouveau remplacement » au surveillant général (son
              `canCreate` couvre les deux surveillants) et le ferme au
              directeur ; ce qui est vrai des deux, c'est que la confirmation
              leur échappe. */}
          <p className="gsp-note">
            Le tableur validé n'est jamais réécrit : un remplacement vit à côté de
            lui, et sa confirmation revient au chef du service concerné.
          </p>
          <ReplacementsPanel />
        </div>
      )}

      {/* ── PERSONNEL / PORTFOLIO ─────────────────────────────── */}
      {tab === 'personnel' && (
        <div className="gsp-section">
          <GsPanelHeader
            bare
            title="Personnel de l'hôpital"
            sub="Une fiche par agent : affectations, gardes tenues, absences et prêts."
          />
          <GsFilterBar
            label="Recherche d'un agent"
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Nom, matricule, grade ou service',
              label: 'Rechercher un agent',
            }}
            end={<span className="gsp-note">{filteredAgents.length} agent(s)</span>}
          />
          {loadingPf ? (
            <GsSkeleton variant="block" count={3} />
          ) : (
            <PortfolioGrid
              agents={filteredAgents}
              onCardClick={setSelectedAgent}
              emptyMessage={search ? 'Aucun agent ne correspond à cette recherche.' : 'Aucun personnel dans votre périmètre.'}
            />
          )}
        </div>
      )}

      {/* ── CALENDRIER HÔPITAL ────────────────────────────────── */}
      {tab === 'calendrier' && <HospitalGuardCalendar title="Calendrier des gardes — hôpital" />}

      {/* ── STATISTIQUES ──────────────────────────────────────── */}
      {tab === 'stats' && <ScopedStatsPanel title="Statistiques de l'hôpital" />}

      {previewSchedule && (
        <SchedulePreviewModal
          schedule={{ ...previewSchedule, start_date: previewSchedule.startDate, end_date: previewSchedule.endDate }}
          onClose={() => setPreviewSchedule(null)}
        />
      )}
      {proposalScheduleId && (
        <ScheduleChangeProposals
          scheduleId={proposalScheduleId}
          onClose={() => setProposalScheduleId(null)}
        />
      )}
      {reporting && (
        <SupervisionReportModal
          schedules={schedules}
          defaultSummary={reportDraft}
          onClose={() => setReporting(false)}
        />
      )}
      {selectedAgent && (
        <StaffPortfolioModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}
