/**
 * Dashboard Surveillant de service (Lot 4) — route /surveillant.
 *
 * Écran nouveau : il ne remplace ni ne modifie ChefDeServiceDashboard. Les
 * fonctions déjà livrées sont rebranchées telles quelles (remplacements,
 * propositions de modification, calendrier hôpital, statistiques par portée,
 * notes, portfolio) ; seuls le journal de service et les alertes sont neufs.
 *
 * Rappel de la règle métier : le surveillant consulte les remplacements sans
 * pouvoir les confirmer — ce droit reste gaté côté serveur, on ne l'ouvre pas ici.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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

const TABS = [
  { id: 'overview',   label: 'Vue d\'ensemble' },
  { id: 'journal',    label: 'Journal de service' },
  { id: 'alertes',    label: 'Alertes' },
  { id: 'equipe',     label: 'Personnel' },
  { id: 'remplacements', label: 'Remplacements' },
  { id: 'calendrier', label: 'Calendrier hôpital' },
  { id: 'stats',      label: 'Statistiques' },
  { id: 'notes',      label: 'Notes' },
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

export default function SurveillantDashboard() {
  const { user } = useAuthStore();
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

  return (
    <div>
      {/* Appartenance — hôpital et service(s) surveillés. */}
      <ContextBadge variant="header" />

      <div className="page-header">
        <div>
          <h1 className="page-title">Surveillance du service</h1>
          <p className="page-subtitle">
            {ov?.scopeLabel || 'Suivi des gardes courantes'}
            {ov?.today ? ` · ${ov.today}` : ''}
          </p>
        </div>
        {canWrite && (
          <div className="quick-actions">
            <button className="btn btn-primary" onClick={() => setReporting(true)}>
              🚫 Signaler une absence
            </button>
          </div>
        )}
      </div>

      {/* Onglets */}
      {myDepartments.length > 1 && (
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Service
          </label>
          <select
            className="input"
            style={{ maxWidth: 320, fontSize: 'var(--font-xs)' }}
            value={myDepartmentId}
            onChange={(e) => setMyDepartmentId(e.target.value)}
          >
            {myDepartments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Journal et alertes sont filtrés sur ce service.
          </span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {TABS.map((t) => (
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
            {t.id === 'alertes' && s.openAlerts > 0 && (
              <span style={{
                marginLeft: 6, background: tab === t.id ? 'rgba(255,255,255,.25)' : 'var(--color-danger)',
                color: '#fff', borderRadius: 8, padding: '1px 6px', fontSize: 10, fontWeight: 700,
              }}>
                {s.openAlerts}
              </span>
            )}
          </button>
        ))}
      </div>

      {forbidden && (
        <div style={{
          padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)',
          borderRadius: 'var(--border-radius-lg)', marginBottom: 20,
        }}>
          Cet écran est réservé aux surveillants, chefs de service et à la supervision générale.
        </div>
      )}

      {/* ── VUE D'ENSEMBLE ────────────────────────────────────── */}
      {tab === 'overview' && !forbidden && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            <KPI label="Gardes aujourd'hui" value={loadingOv ? '…' : (s.guardsToday ?? 0)}
                 hint={`${s.staffOnDutyToday ?? 0} agent(s) en poste`} color="#1B4FCA" />
            <KPI label="Gardes restantes" value={loadingOv ? '…' : (s.guardsRemaining ?? 0)}
                 hint="Sur les plannings en cours" color="#10B981" />
            <KPI label="Événements du jour" value={loadingOv ? '…' : (s.eventsToday ?? 0)}
                 hint={`${s.incidentsToday ?? 0} incident(s)`} color="#6366F1" />
            <KPI label="Absences du jour" value={loadingOv ? '…' : (s.absencesToday ?? 0)}
                 hint="Signalées en garde" color="#F59E0B" />
            <KPI label="Alertes ouvertes" value={loadingOv ? '…' : (s.openAlerts ?? 0)}
                 hint={`${s.criticalAlerts ?? 0} critique(s)`} color="#DC2626" />
            <KPI label="Remplacements" value={loadingOv ? '…' : (s.replacementsConfirmed ?? 0)}
                 hint={`${s.replacementsPending ?? 0} en attente`} color="#EC4899" />
          </div>

          {/* Gardes du jour, lues depuis le tableur (jamais depuis shifts) */}
          <div>
            <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, marginBottom: 4 }}>Personnel en garde aujourd'hui</h3>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 10 }}>
              Repos exclus — lecture du tableur validé
            </p>
            {loadingOv ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                Chargement…
              </div>
            ) : (ov?.todayGuards || []).length === 0 ? (
              <div style={{
                padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
                background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
              }}>
                Aucune garde enregistrée aujourd'hui
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                {ov.todayGuards.map((g, i) => (
                  <div key={`${g.userId || 'x'}-${i}`} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--border-radius-sm)', padding: '10px 12px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {g.name}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 800, color: 'var(--color-primary)',
                        border: '1px solid var(--color-primary)', borderRadius: 6, padding: '1px 6px',
                      }}>
                        {/* Le code journalier est facultatif dans le tableur : sans
                            lui, la garde vient de la période de l'agent et porte
                            le libellé « De service » plutôt qu'une lettre. */}
                        {g.code || g.label || '—'}
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
                      {g.roleName || '—'}{g.departmentName ? ` · ${g.departmentName}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Plannings en cours reçus */}
          <div>
            <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, marginBottom: 10 }}>Plannings en cours</h3>
            {(ov?.activeSchedules || []).length === 0 ? (
              <div style={{
                padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
                background: 'var(--bg-card)', border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
              }}>
                Aucun planning en cours
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ov.activeSchedules.map((sc) => (
                  <div key={sc.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--border-radius-sm)', padding: '12px 14px',
                  }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <p style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{sc.name}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {sc.departmentName || '—'} · {sc.startDate} → {sc.endDate}
                      </p>
                    </div>
                    <PlanningStateBadge state={sc.state} status={sc.status} size="sm" />
                    <button className="btn btn-secondary btn-sm" onClick={() => setProposalScheduleId(sc.id)}>
                      Propositions
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Journal récent, en lecture seule ici */}
          <ServiceJournalPanel canWrite={false} title="Derniers événements" />
        </div>
      )}

      {/* ── JOURNAL DE SERVICE ────────────────────────────────── */}
      {tab === 'journal' && (
        <>
          {canWrite && !myDepartmentId && (
            <div style={{
              padding: '10px 14px', marginBottom: 12, borderRadius: 'var(--border-radius-sm)',
              background: 'rgba(245, 158, 11, .08)', border: '1px solid rgba(245, 158, 11, .35)',
              color: 'var(--text-secondary)', fontSize: 'var(--font-xs)',
            }}>
              Aucun service ne vous est rattaché : la lecture reste possible, mais la saisie
              d'une entrée demande une affectation à un service.
            </div>
          )}
          <ServiceJournalPanel
            canWrite={canWrite && !!myDepartmentId}
            departmentId={myDepartmentId || undefined}
          />
        </>
      )}

      {/* ── ALERTES ───────────────────────────────────────────── */}
      {tab === 'alertes' && (
        <ServiceAlertsPanel canAct={canWrite} departmentId={myDepartmentId || undefined} />
      )}

      {/* ── PERSONNEL / PORTFOLIO ─────────────────────────────── */}
      {tab === 'equipe' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Personnel du service</h3>
              <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
                {filteredAgents.length} agent(s) — cliquez une carte pour le détail
              </p>
            </div>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Rechercher un agent…"
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

      {/* ── REMPLACEMENTS (consultation) ──────────────────────── */}
      {tab === 'remplacements' && (
        <div>
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Remplacements</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Consultation et ajout — la confirmation reste au chef de service
            </p>
          </div>
          <ReplacementsPanel />
        </div>
      )}

      {/* ── CALENDRIER HÔPITAL ────────────────────────────────── */}
      {tab === 'calendrier' && <HospitalGuardCalendar title="Calendrier des gardes — hôpital" />}

      {/* ── STATISTIQUES ──────────────────────────────────────── */}
      {tab === 'stats' && <ScopedStatsPanel title="Statistiques de mon service" />}

      {/* ── NOTES ─────────────────────────────────────────────── */}
      {tab === 'notes' && (
        <div>
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Notes et circulaires</h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Publications de la direction et du service
            </p>
          </div>
          <NotesFeed />
        </div>
      )}

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
