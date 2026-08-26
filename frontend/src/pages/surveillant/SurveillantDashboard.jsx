/**
 * Surveillance du service — `/surveillant`
 * ════════════════════════════════════════
 * L'écran du surveillant de service. Il ne remplace ni ne modifie
 * `ChefDeServiceDashboard` : les fonctions déjà livrées y sont rebranchées telles
 * quelles (remplacements, propositions de modification, calendrier hôpital,
 * statistiques par portée, notes, portfolio) ; le journal de service et les
 * alertes lui sont propres.
 *
 * Rappel de la règle métier : le surveillant consulte les remplacements sans
 * pouvoir les confirmer — ce droit reste gaté côté serveur, on ne l'ouvre pas ici.
 *
 * Refonte (phase 3)
 * ─────────────────
 * L'écran n'avait aucun CSS : six cartes de KPI à couleur arbitraire, huit
 * pastilles d'onglets en bleu plein, des cartes de garde qui jetaient les heures
 * pourtant renvoyées par l'API, et des dates au format ISO brut. Il passe sur le
 * kit `components/gs/` :
 *   • les six KPI deviennent un filet de mesure, avec `duty` et `alert` pour
 *     seuls tons — une mesure n'a pas de couleur parce qu'elle est la quatrième ;
 *   • les cartes de garde deviennent une **feuille de service** : un registre
 *     d'une ligne par agent, avec l'horaire et l'astreinte à domicile que
 *     `journal/overview` renvoie déjà (`shiftStart`, `shiftEnd`, `atHome`) et que
 *     l'écran laissait tomber ;
 *   • les huit onglets passent sur la rangée du kit, compteurs sur « Alertes » et
 *     « Remplacements » ;
 *   • plus aucune date ISO : `fullFrenchDate` et `frenchRange`.
 *
 * Les onglets qui délèguent à un composant déjà habillé (personnel,
 * remplacements, calendrier, statistiques, notes) reçoivent un titre nu, sans
 * carte : emboîter une carte dans une carte ajouterait un filet sans rien dire.
 *
 * Deux portées, nommées
 * ─────────────────────
 * Le filet de mesure chiffre **tout le périmètre du rôle** (c'est ce que
 * `journal/overview` calcule), tandis que le journal et les alertes se filtrent
 * sur le service choisi. Les deux nombres peuvent donc différer : chaque panneau
 * nomme le filtre qui lui est appliqué (`scopeNote`), et l'en-tête le répète —
 * deux portées étiquetées valent mieux qu'une contradiction silencieuse.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarOff, ShieldAlert, TriangleAlert, UserX } from 'lucide-react';
import { useAuthStore } from '../../store';
import { departmentsAPI, journalAPI, portfolioAPI } from '../../api';
import ServiceJournalPanel from './components/ServiceJournalPanel';
import ServiceAlertsPanel from './components/ServiceAlertsPanel';
import ShiftAbsenceModal from './components/ShiftAbsenceModal';
import ReplacementsPanel from '../replacements/components/ReplacementsPanel';
import ScheduleChangeProposals from '../schedules/components/ScheduleChangeProposals';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ScopedStatsPanel from '../../components/statistics/ScopedStatsPanel';
import NotesFeed from '../../components/notes/NotesFeed';
import PortfolioGrid from '../../components/portfolio/PortfolioGrid';
import StaffPortfolioModal from '../../components/portfolio/StaffPortfolioModal';
import ContextBadge from '../../components/layout/ContextBadge';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import {
  GsPageHeader, GsPanel, GsPanelHeader, GsStat, GsStatRail, GsTabRail,
  GsTable, GsBadge, GsFilterBar, GsEmpty, GsSkeleton,
} from '../../components/gs';
import { frenchRange, fullFrenchDate } from '../../utils/frenchDates';
import { planningScreen } from '../../utils/notificationTarget';
import './surveillant.css';

const TABS = [
  { id: 'overview',      label: 'Vue d\'ensemble' },
  { id: 'journal',       label: 'Journal de service' },
  { id: 'alertes',       label: 'Alertes' },
  { id: 'equipe',        label: 'Personnel' },
  { id: 'remplacements', label: 'Remplacements' },
  { id: 'calendrier',    label: 'Calendrier hôpital' },
  { id: 'stats',         label: 'Statistiques' },
  { id: 'notes',         label: 'Notes' },
];

/** `08:00:00` → `08:00`. L'heure d'une garde se lit à la minute. */
const hhmm = (v) => (v ? String(v).slice(0, 5) : null);

export default function SurveillantDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [reporting, setReporting] = useState(false);
  const [proposalScheduleId, setProposalScheduleId] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [search, setSearch] = useState('');
  const [myDepartmentId, setMyDepartmentId] = useState('');

  // Le surveillant de service écrit au journal et traite les alertes.
  const canWrite = ['service_supervisor', 'department_head', 'general_supervisor'].includes(user?.roleCode);

  // Le profil (`user`) ne porte pas de departmentId : on résout le(s) service(s)
  // du surveillant via l'affectation user_departments, exposée par getDepartments.
  // `supervisor_id` = service_supervisor affecté, `head_id` = chef de service.
  // Le serveur (`assertDepartmentWritable`) applique la même règle : le
  // surveillant général écrit dans tout service de son hôpital, les autres
  // uniquement dans les services dont ils sont membres.
  const { data: deptRes } = useQuery({
    queryKey: ['myDepartments', user?.id, user?.roleCode],
    queryFn: () => departmentsAPI.getAll(),
  });
  const allDepartments = deptRes?.data?.data || deptRes?.data || [];
  const myDepartments = useMemo(() => {
    if (user?.roleCode === 'general_supervisor') return allDepartments;
    const mine = allDepartments.filter((d) => d.supervisor_id === user?.id || d.head_id === user?.id);
    // Repli : affectations déclarées dans le profil (getMe → departments[])
    const seen = new Set(mine.map((d) => d.id));
    for (const d of (user?.departments || [])) {
      const dept = allDepartments.find((x) => x.id === d.id);
      if (dept && !seen.has(dept.id)) { mine.push(dept); seen.add(dept.id); }
    }
    return mine;
  }, [allDepartments, user]);

  useEffect(() => {
    // Premier service par défaut ; le sélecteur reste visible quand plusieurs
    // services correspondent (cas du surveillant général, multi-services).
    if (!myDepartmentId && myDepartments.length) setMyDepartmentId(myDepartments[0].id);
  }, [myDepartments, myDepartmentId]);

  const { data: ovRes, isLoading: loadingOv, error: ovError } = useQuery({
    queryKey: ['journal-overview'],
    queryFn: () => journalAPI.getOverview(),
  });
  const ov = ovRes?.data?.data;
  const s = ov?.summary || {};

  const { data: pfRes, isLoading: loadingPf } = useQuery({
    queryKey: ['portfolio', 'surveillant'],
    queryFn: () => portfolioAPI.getAll(),
    enabled: tab === 'equipe',
  });
  const agents = pfRes?.data?.data?.agents || pfRes?.data?.data || [];

  const filteredAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const name = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
      return name.includes(q)
        || (a.matricule || '').toLowerCase().includes(q)
        || (a.role_name || '').toLowerCase().includes(q);
    });
  }, [agents, search]);

  const forbidden = ovError?.response?.status === 403;

  const guards = ov?.todayGuards || [];
  const schedules = ov?.activeSchedules || [];

  // La colonne « Service » ne s'affiche que si la feuille en mélange plusieurs :
  // une colonne qui répète la même valeur vingt fois n'apprend rien.
  const manyDepartments = new Set(guards.map((g) => g.departmentName || '')).size > 1;

  // Le nom du filtre appliqué au journal et aux alertes, écrit une fois et repris
  // par l'en-tête comme par les deux panneaux.
  const scopeFilterLabel = myDepartmentId
    ? (myDepartments.find((d) => d.id === myDepartmentId)?.name || 'Service sélectionné')
    : 'Tous mes services';

  const journalScopeNote = `Journal filtré sur : ${scopeFilterLabel}. Une entrée consignée n'est jamais modifiable.`;
  const alertsScopeNote = `Alertes filtrées sur : ${scopeFilterLabel}.`;

  const planning = planningScreen(user?.roleCode);

  return (
    <div className="gsu-wrap">
      {/* Appartenance — hôpital et service(s) surveillés. */}
      <ContextBadge variant="header" />

      <GsPageHeader
        eyebrow={ov?.scopeLabel || 'Périmètre déduit de votre rôle'}
        title="Surveillance du service"
        subtitle="Qui est de garde aujourd'hui, ce qui s'est passé depuis ce matin, et ce qui attend une décision."
        meta={[
          ov?.today ? { key: 'day', label: 'Journée du', value: fullFrenchDate(ov.today) } : null,
          { key: 'filter', label: 'Journal et alertes :', value: scopeFilterLabel },
        ]}
        actions={(
          <>
            {myDepartments.length > 1 ? (
              <label className="gsu-pick">
                Service
                <select
                  value={myDepartmentId}
                  onChange={(e) => setMyDepartmentId(e.target.value)}
                >
                  {myDepartments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                  <option value="">Tous mes services</option>
                </select>
              </label>
            ) : null}
            {canWrite ? (
              <button type="button" className="gs-btn is-primary" onClick={() => setReporting(true)}>
                <UserX size={14} strokeWidth={2} aria-hidden="true" />
                Signaler une absence
              </button>
            ) : null}
          </>
        )}
        rail={loadingOv ? <GsSkeleton variant="rail" count={6} /> : (
          <GsStatRail>
            <GsStat
              label="De service aujourd'hui"
              value={s.staffOnDutyToday ?? 0}
              hint={`${s.guardsToday ?? 0} ligne(s) au tableur`}
              tone="duty"
            />
            <GsStat
              label="Journées restantes"
              value={s.guardsRemaining ?? 0}
              hint="Sur les plannings en cours"
            />
            <GsStat
              label="Événements du jour"
              value={s.eventsToday ?? 0}
              hint={`${s.incidentsToday ?? 0} incident(s)`}
            />
            <GsStat
              label="Absences signalées"
              value={s.absencesToday ?? 0}
              hint="Sur une garde courante"
              tone={s.absencesToday > 0 ? 'alert' : undefined}
            />
            <GsStat
              label="Alertes ouvertes"
              value={s.openAlerts ?? 0}
              hint={`${s.criticalAlerts ?? 0} critique(s)`}
              tone={s.openAlerts > 0 ? 'alert' : undefined}
            />
            <GsStat
              label="Remplacements"
              value={s.replacementsConfirmed ?? 0}
              hint={`${s.replacementsPending ?? 0} en attente du chef`}
              tone={s.replacementsPending > 0 ? 'alert' : undefined}
            />
          </GsStatRail>
        )}
      >
        <GsTabRail
          label="Sections de la surveillance"
          value={tab}
          onChange={setTab}
          tabs={TABS.map((t) => ({
            ...t,
            count: t.id === 'alertes' ? s.openAlerts
              : t.id === 'remplacements' ? s.replacementsPending
                : undefined,
          }))}
        />
      </GsPageHeader>

      {forbidden ? (
        <GsEmpty
          icon={<ShieldAlert size={26} strokeWidth={1.6} />}
          title="Écran réservé à la surveillance de service"
          hint="Les surveillants, les chefs de service et la supervision générale y accèdent. Votre rôle donne accès aux autres écrans du menu."
        />
      ) : null}

      {/* ── VUE D'ENSEMBLE ────────────────────────────────────── */}
      {tab === 'overview' && !forbidden && (
        <div className="gsu-tab-body">
          <GsPanel
            title="Feuille de service du jour"
            sub="Lecture du tableur validé — les horaires et les astreintes viennent du planning en cours."
            flush
          >
            {loadingOv ? (
              <div className="gsu-load"><GsSkeleton variant="rows" count={4} /></div>
            ) : (
              <GsTable
                label="Personnel de service aujourd'hui"
                rows={guards}
                rowKey={(g, i) => `${g.userId || 'x'}-${g.scheduleId || i}-${i}`}
                columns={[
                  {
                    key: 'name',
                    label: 'Agent',
                    render: (g) => (
                      <span className="gsu-who">
                        <b>{g.name}</b>
                        <span>{g.roleName || 'Grade non précisé'}</span>
                      </span>
                    ),
                  },
                  {
                    key: 'post',
                    label: 'Poste',
                    render: (g) => (
                      <span className="gsu-post">
                        {g.label || 'De service'}
                        {g.atHome ? <GsBadge tone="quiet" title="Astreinte : l'agent reste joignable depuis son domicile">à domicile</GsBadge> : null}
                      </span>
                    ),
                  },
                  {
                    key: 'hours',
                    label: 'Horaire',
                    num: true,
                    width: '13ch',
                    render: (g) => {
                      const a = hhmm(g.shiftStart);
                      const b = hhmm(g.shiftEnd);
                      return a && b ? `${a} → ${b}` : (a || '—');
                    },
                  },
                  {
                    key: 'departmentName',
                    label: 'Service',
                    hidden: !manyDepartments,
                    render: (g) => g.departmentName || '—',
                  },
                  {
                    key: 'scheduleName',
                    label: 'Planning',
                    render: (g) => (
                      <span className="gsu-sched" title={g.scheduleName || undefined}>
                        {g.scheduleName || '—'}
                      </span>
                    ),
                  },
                ]}
                empty={(
                  <GsEmpty
                    bare
                    icon={<CalendarOff size={26} strokeWidth={1.6} />}
                    title="Aucun agent de service aujourd'hui"
                    hint={schedules.length === 0
                      ? 'Aucun planning n\'est en cours dans votre périmètre : un planning devient « en vigueur » à sa date de début, une fois validé.'
                      : `Les plannings en cours ne portent personne à la date du ${fullFrenchDate(ov?.today)}.`}
                    actions={(
                      <button type="button" className="gs-btn is-quiet" onClick={() => navigate(planning.path)}>
                        Ouvrir les plannings
                      </button>
                    )}
                  />
                )}
              />
            )}
          </GsPanel>

          <div className="gsu-band">
            {/* Le journal du jour : du texte, il lui faut la largeur. */}
            <ServiceJournalPanel
              canWrite={false}
              title="Derniers événements"
              departmentId={myDepartmentId || undefined}
              scopeNote={journalScopeNote}
            />

            <GsPanel
              title="Plannings en cours"
              sub="Ceux qui produisent la feuille de service ci-dessus."
            >
              {schedules.length === 0 ? (
                <GsEmpty
                  bare
                  icon={<CalendarOff size={24} strokeWidth={1.6} />}
                  title="Aucun planning en cours"
                  hint="Un planning validé n'apparaît ici qu'à partir de sa date de début."
                />
              ) : (
                <ul className="gsu-plan">
                  {schedules.map((sc) => (
                    <li key={sc.id}>
                      <div className="gsu-plan-top">
                        <span className="gsu-plan-name" title={sc.name}>{sc.name}</span>
                        <PlanningStateBadge state={sc.state} status={sc.status} size="sm" />
                      </div>
                      <p className="gsu-plan-meta">
                        <span>{frenchRange(sc.startDate, sc.endDate)}</span>
                        {sc.departmentName ? <span className="gsu-plan-dept">{sc.departmentName}</span> : null}
                      </p>
                      <div className="gsu-plan-foot">
                        <button
                          type="button"
                          className="gs-btn is-quiet"
                          onClick={() => setProposalScheduleId(sc.id)}
                        >
                          Propositions de modification
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </GsPanel>
          </div>
        </div>
      )}

      {/* ── JOURNAL DE SERVICE ────────────────────────────────── */}
      {tab === 'journal' && !forbidden && (
        <div className="gsu-tab-body">
          {canWrite && !myDepartmentId ? (
            <p className="gsu-hold">
              <TriangleAlert size={16} strokeWidth={1.9} aria-hidden="true" />
              La lecture couvre tous vos services. Pour consigner une entrée, choisissez
              un service dans l'en-tête : une entrée de journal appartient toujours à un service.
            </p>
          ) : null}
          <ServiceJournalPanel
            canWrite={canWrite && !!myDepartmentId}
            departmentId={myDepartmentId || undefined}
            scopeNote={journalScopeNote}
          />
        </div>
      )}

      {/* ── ALERTES ───────────────────────────────────────────── */}
      {tab === 'alertes' && !forbidden && (
        <div className="gsu-tab-body">
          <ServiceAlertsPanel
            canAct={canWrite}
            departmentId={myDepartmentId || undefined}
            scopeNote={alertsScopeNote}
          />
        </div>
      )}

      {/* ── PERSONNEL / PORTFOLIO ─────────────────────────────── */}
      {tab === 'equipe' && (
        <div className="gsu-section">
          <GsPanelHeader
            bare
            title="Personnel de mon périmètre"
            sub="Une fiche par agent : affectations, gardes tenues, absences et prêts."
          />
          <GsFilterBar
            label="Recherche d'un agent"
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Nom, matricule ou grade',
              label: 'Rechercher un agent',
            }}
            end={<span className="gsu-note">{filteredAgents.length} agent(s)</span>}
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

      {/* ── REMPLACEMENTS (consultation) ──────────────────────── */}
      {tab === 'remplacements' && (
        <div className="gsu-section">
          {/* `ReplacementsPanel` porte déjà son titre : on n'ajoute que la règle
              qui vaut pour ce rôle, et qui n'était écrite nulle part ailleurs. */}
          <p className="gsu-note">
            Consultation et proposition — la confirmation reste au chef de service,
            et le tableur validé n'est jamais réécrit.
          </p>
          <ReplacementsPanel />
        </div>
      )}

      {/* ── CALENDRIER HÔPITAL ────────────────────────────────── */}
      {tab === 'calendrier' && <HospitalGuardCalendar title="Calendrier des gardes — hôpital" />}

      {/* ── STATISTIQUES ──────────────────────────────────────── */}
      {tab === 'stats' && <ScopedStatsPanel title="Statistiques de mon service" />}

      {/* ── NOTES ─────────────────────────────────────────────── */}
      {/* `NotesFeed` porte son propre en-tête : un second titre le répéterait. */}
      {tab === 'notes' && <NotesFeed />}

      {reporting && (
        <ShiftAbsenceModal onClose={() => setReporting(false)} />
      )}
      {proposalScheduleId && (
        <ScheduleChangeProposals
          scheduleId={proposalScheduleId}
          onClose={() => setProposalScheduleId(null)}
        />
      )}
      {selectedAgent && (
        <StaffPortfolioModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}
