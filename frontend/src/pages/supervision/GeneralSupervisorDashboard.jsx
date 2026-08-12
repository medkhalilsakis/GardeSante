/**
 * Dashboard Surveillant Général (Lot 5) — route /supervision.
 *
 * Écran nouveau : ni ChefDeServiceDashboard ni SurveillantDashboard ne sont
 * modifiés. Tout ce qui existe est rebranché tel quel (aperçu tableur,
 * propositions de modification, journal, alertes, calendrier hôpital,
 * statistiques par portée, portfolio) ; seules la cohérence inter-services et
 * la transmission d'un rapport sont neuves.
 *
 * INVARIANT : le surveillant général consulte les remplacements sans les
 * confirmer. Ce droit reste gaté côté serveur — cet écran ne l'ouvre pas.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store';
import { supervisionAPI, portfolioAPI } from '../../api';
import ConflictsPanel from './components/ConflictsPanel';
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

const TABS = [
  { id: 'overview',      label: 'Vue d\'ensemble' },
  { id: 'plannings',     label: 'Plannings reçus' },
  { id: 'conflits',      label: 'Cohérence' },
  { id: 'prets',         label: 'Prêts de personnel' },
  { id: 'alertes',       label: 'Alertes' },
  { id: 'journal',       label: 'Journal' },
  { id: 'remplacements', label: 'Remplacements' },
  { id: 'personnel',     label: 'Personnel' },
  { id: 'calendrier',    label: 'Calendrier hôpital' },
  { id: 'stats',         label: 'Statistiques' },
];

const STATE_FILTERS = [
  { value: '',         label: 'Tous' },
  { value: 'soumis',   label: 'Soumis' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine',  label: 'Terminés' },
];

const KPI = ({ label, value, hint, color }) => (
  <div style={{
    background: 'var(--bg-card)', border: '1px solid var(--border-default)',
    borderTop: `3px solid ${color}`, borderRadius: 'var(--border-radius-lg)',
    padding: '14px 16px', minWidth: 0,
  }}>
    <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
      {label}
    </p>
    <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15, marginTop: 4 }}>
      {value}
    </p>
    {hint && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</p>}
  </div>
);
export default function GeneralSupervisorDashboard() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState('overview');
  const [stateFilter, setStateFilter] = useState('');
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
    queryFn: () => supervisionAPI.getSchedules(stateFilter ? { state: stateFilter } : undefined),
  });
  const schedules = schedRes?.data?.data?.schedules || [];

  const { data: cfRes } = useQuery({
    queryKey: ['supervision-conflicts'],
    queryFn: () => supervisionAPI.getConflicts(),
  });
  const conflictSummary = cfRes?.data?.data?.summary || {};

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
      return name.includes(q)
        || (a.matricule || '').toLowerCase().includes(q)
        || (a.role_name || '').toLowerCase().includes(q)
        || (a.department_name || '').toLowerCase().includes(q);
    });
  }, [agents, search]);

  // Brouillon de synthèse pré-rempli : le rapport part de faits déjà mesurés.
  const reportDraft = useMemo(() => {
    if (!ov) return '';
    return [
      `Couverture : ${s.departmentsCovered ?? 0}/${s.departments ?? 0} service(s) couvert(s) le ${ov.today}.`,
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

  return (
    <div>
      {/* Appartenance — hôpital supervisé et service(s) de rattachement. */}
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Supervision générale</h1>
          <p className="page-subtitle">
            {ov?.scopeLabel || 'Tous les services de l\'hôpital'}
            {ov?.today ? ` · ${ov.today}` : ''}
          </p>
        </div>
        {!forbidden && (
          <div className="quick-actions">
            <button className="btn btn-primary" onClick={() => setReporting(true)}>
              📤 Rapport à la direction
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {TABS.map((t) => {
          const badge = t.id === 'alertes' ? s.openAlerts
            : t.id === 'conflits' ? conflictSummary.total
            : t.id === 'prets' ? s.loansPending
            : 0;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 14px', borderRadius: 9, border: 'none', cursor: 'pointer',
                background: tab === t.id ? 'var(--color-primary)' : 'transparent',
                color: tab === t.id ? '#fff' : 'var(--text-secondary)',
                fontWeight: 600, fontSize: 13,
              }}
            >
              {t.label}
              {badge > 0 && (
                <span style={{
                  marginLeft: 6, background: tab === t.id ? 'rgba(255,255,255,.25)' : 'var(--color-danger)',
                  color: '#fff', borderRadius: 8, padding: '1px 6px', fontSize: 10, fontWeight: 700,
                }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {forbidden && (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)',
          borderRadius: 'var(--border-radius-lg)', marginBottom: 20,
        }}>
          Cet écran est réservé à la supervision générale et à la direction.
        </div>
      )}

      {/* ── VUE D'ENSEMBLE ────────────────────────────────────── */}
      {tab === 'overview' && !forbidden && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            <KPI label="Couverture du jour"
                 value={loadingOv ? '…' : `${s.departmentsCovered ?? 0}/${s.departments ?? 0}`}
                 hint="Services avec au moins une garde" color="#10B981" />
            <KPI label="Gardes aujourd'hui" value={loadingOv ? '…' : (s.guardsToday ?? 0)}
                 hint={`${s.staffOnDutyToday ?? 0} agent(s) en poste`} color="#1B4FCA" />
            <KPI label="Plannings soumis" value={loadingOv ? '…' : (s.schedulesSubmitted ?? 0)}
                 hint={`${s.schedulesActive ?? 0} en cours`} color="#6366F1" />
            <KPI label="Anomalies" value={conflictSummary.total ?? '…'}
                 hint={`${conflictSummary.critical ?? 0} critique(s)`} color="#DC2626" />
            <KPI label="Absentéisme du jour" value={loadingOv ? '…' : (s.shiftAbsencesToday ?? 0)}
                 hint={`${s.latesToday ?? 0} retard(s) · ${s.leavesToday ?? 0} congé(s)`} color="#F59E0B" />
            <KPI label="Alertes ouvertes" value={loadingOv ? '…' : (s.openAlerts ?? 0)}
                 hint={`${s.criticalAlerts ?? 0} critique(s)`} color="#EF4444" />
            <KPI label="Remplacements" value={loadingOv ? '…' : (s.replacementsConfirmed ?? 0)}
                 hint={`${s.replacementsPending ?? 0} en attente`} color="#EC4899" />
            <KPI label="Prêts en attente" value={loadingOv ? '…' : (s.loansPending ?? 0)}
                 hint="Décision au chef propriétaire" color="#0EA5E9" />
          </div>

          {/* Couverture service par service */}
          <div>
            <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, marginBottom: 4 }}>Couverture par service</h3>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 10 }}>
              Gardes lues depuis le tableur validé, repos exclus
            </p>
            {loadingOv ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                Chargement…
              </div>
            ) : (ov?.departments || []).length === 0 ? (
              <div style={{
                padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
                background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
              }}>
                Aucun service actif dans cet hôpital
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                {ov.departments.map((d) => (
                  <div key={d.id} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    borderLeft: `3px solid ${d.covered ? '#10B981' : '#F59E0B'}`,
                    borderRadius: 'var(--border-radius-sm)', padding: '10px 12px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {d.name}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700, color: d.covered ? '#10B981' : '#F59E0B',
                        border: `1px solid ${d.covered ? '#10B981' : '#F59E0B'}`, borderRadius: 6, padding: '1px 6px',
                      }}>
                        {d.covered ? 'Couvert' : 'À couvrir'}
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                      {d.guardsToday} garde(s) · {d.staffCount} agent(s) · {d.activeSchedules} planning(s) actif(s)
                      {d.absencesToday > 0 ? ` · ${d.absencesToday} absence(s)` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <ServiceAlertsPanel canAct={canWrite} title="Alertes critiques de l'hôpital" />
        </div>
      )}

      {/* ── PLANNINGS REÇUS ───────────────────────────────────── */}
      {tab === 'plannings' && !forbidden && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Plannings soumis à la supervision</h3>
              <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {schedules.length} planning(s) — les brouillons des chefs restent privés
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {STATE_FILTERS.map((f) => (
                <button
                  key={f.value || 'all'}
                  onClick={() => setStateFilter(f.value)}
                  className={stateFilter === f.value ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {loadingSched ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
              Chargement des plannings…
            </div>
          ) : schedules.length === 0 ? (
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
              background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
            }}>
              Aucun planning {stateFilter ? 'dans cet état' : 'transmis'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {schedules.map((sc) => (
                <div key={sc.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {sc.name}
                      </span>
                      {sc.pendingProposals > 0 && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, color: '#F59E0B',
                          border: '1px solid #F59E0B', borderRadius: 6, padding: '1px 6px',
                        }}>
                          {sc.pendingProposals} proposition(s)
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                      {sc.departmentName || '—'} · {sc.startDate} → {sc.endDate}
                      {' · '}{sc.guardCount} garde(s) · {sc.staffCount} agent(s)
                    </p>
                  </div>
                  <PlanningStateBadge state={sc.state} status={sc.status} size="sm" />
                  <button className="btn btn-secondary btn-sm" onClick={() => setPreviewSchedule(sc)}>
                    Aperçu
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => requestCorrection(sc.id)}>
                    Corrections
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── COHÉRENCE INTER-SERVICES ──────────────────────────── */}
      {tab === 'conflits' && !forbidden && (
        <ConflictsPanel onRequestCorrection={requestCorrection} />
      )}

      {/* ── PRÊTS DE PERSONNEL ────────────────────────────────── */}
      {tab === 'prets' && !forbidden && <StaffLoansOverview />}

      {/* ── ALERTES ───────────────────────────────────────────── */}
      {tab === 'alertes' && (
        <ServiceAlertsPanel canAct={canWrite} title="Alertes — tous les services" />
      )}

      {/* ── JOURNAL ───────────────────────────────────────────── */}
      {tab === 'journal' && (
        <ServiceJournalPanel canWrite={false} title="Journal de tous les services" />
      )}

      {/* ── REMPLACEMENTS (consultation) ──────────────────────── */}
      {tab === 'remplacements' && (
        <div>
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Remplacements de l'hôpital</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Consultation — la confirmation reste au chef de service
            </p>
          </div>
          <ReplacementsPanel />
        </div>
      )}

      {/* ── PERSONNEL / PORTFOLIO ─────────────────────────────── */}
      {tab === 'personnel' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Personnel de l'hôpital</h3>
              <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {filteredAgents.length} agent(s) — cliquez une carte pour le détail
              </p>
            </div>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Rechercher un agent, un service…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {loadingPf ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
              Chargement du personnel…
            </div>
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



