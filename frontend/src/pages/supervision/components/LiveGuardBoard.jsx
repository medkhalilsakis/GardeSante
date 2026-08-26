/**
 * « Garde en direct » — tableau de bord direct d'une garde en cours.
 *
 * Écran de CONSULTATION : aucune écriture, aucun bouton de pointage. Le
 * pointage reste exclusivement dans « Appel du jour », seul écran d'écriture de
 * la chaîne absences / shift_events / alertes / notifications.
 *
 * L'effectif du jour (`guards`) et la date du jour (`today`) sont fournis par le
 * parent, qui les tient déjà de `journal/overview` : une seule requête sert la
 * liste et le tableau de bord. La dérivation du statut d'appel reproduit
 * exactement celle d'`AppelDuJourPage` pour que les deux écrans annoncent
 * toujours les mêmes chiffres.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ChevronRight, Users, CalendarDays, Building2, Bell, History,
  Home, AlertTriangle, Repeat, ArrowLeftRight, RefreshCw, Stethoscope,
  CheckCircle2, Clock3, UserX, CircleDashed, ListChecks,
} from 'lucide-react';

import { journalAPI, absencesShiftAPI, replacementsAPI, supervisionAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import { JustificationBadge } from '../../../components/common/JustificationChoice';
// Les messages d'alerte et les descriptions d'événement sont composés par le
// serveur au moment de l'écriture, dates ISO comprises. L'historique est
// immuable : on les met en français à la lecture.
import { frenchifyIsoDates } from '../../../utils/frenchDates';
import './LiveGuardBoard.css';

/** Même cadence que « Appel du jour » : le socket fait le travail, l'intervalle est la ceinture. */
const LIVE_REFRESH_INTERVAL = 15000;

/* Palette de statut d'appel, redéfinie localement : `AppelDuJourPage` n'exporte
   que sa page et n'est pas modifié pour exposer une constante.

   Trois tons seulement, comme partout ailleurs : le service, l'alerte, le sceau.
   « Retard » et « Absent » appartiennent tous deux à l'alerte et se distinguent
   par l'intensité — l'absence tire vers l'encre, donc plus sombre en thème clair
   et plus vive en thème sombre, dans les deux cas plus marquée que le retard.
   « À pointer » n'est pas un état de l'agent mais l'absence d'information : il
   reste neutre plutôt que de porter une couleur qui alerterait à tort. */
const SEVERE = 'var(--gs-alert-strong)';

const MARKS = {
  present: { label: 'Présent', color: 'var(--gs-duty)',  soft: 'var(--gs-duty-wash)',  Icon: CheckCircle2 },
  late:    { label: 'Retard',  color: 'var(--gs-alert)', soft: 'var(--gs-alert-wash)', Icon: Clock3 },
  absent:  {
    label: 'Absent',
    color: SEVERE,
    soft: 'color-mix(in srgb, var(--gs-alert) 16%, transparent)',
    Icon: UserX,
  },
};
const PENDING = {
  label: 'À pointer',
  color: 'var(--gs-ink-soft)',
  soft: 'var(--gs-paper-alt)',
  Icon: CircleDashed,
};

// Une seule nature de service depuis la suppression des codes de garde : une
// couleur ne distinguerait plus rien, le libellé se lit donc à l'encre.
const SHIFT_COLOR = 'var(--gs-ink)';

const SEVERITY_COLORS = {
  critical: SEVERE, danger: SEVERE, error: SEVERE,
  warning: 'var(--gs-alert)', info: 'var(--gs-seal)', low: 'var(--gs-ink-faint)',
};

const CONFIRMATION_LABELS = {
  pending:   { label: 'En attente de confirmation', color: 'var(--gs-alert)' },
  confirmed: { label: 'Confirmé',                   color: 'var(--gs-duty)' },
  rejected:  { label: 'Refusé',                     color: SEVERE },
};

const LOAN_LABELS = {
  pending:  { label: 'En attente', color: 'var(--gs-alert)' },
  approved: { label: 'Accordé',    color: 'var(--gs-duty)' },
  rejected: { label: 'Refusé',     color: SEVERE },
};

/* ── Dates : jamais de `toISOString()`, les clés de jour restent des chaînes ── */

const dayNumber = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d);
};

const dayDiff = (from, to) => {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86400000);
};

const LONG_DATE = (iso) => {
  if (!iso) return '—';
  // Midi local : aucune bascule de jour possible quel que soit le fuseau.
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

const SHORT_DATE = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const DAY_LABEL = (iso) => {
  if (!iso) return 'Date inconnue';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};

const formatSyncTime = (timestamp) => {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

/** Même clé que « Appel du jour » : un agent peut être de garde sur deux plannings. */
const guardKey = (guard) => `${guard.userId || '—'}|${guard.scheduleId || '—'}`;

const fullName = (first, last) => [first, last].filter(Boolean).join(' ').trim() || '—';

/* ── Briques de présentation ── */

function Section({ icon: Icon, title, count, children }) {
  return (
    <section className="lgb-section">
      <header className="lgb-section-head">
        <Icon size={15} />
        <h3>{title}</h3>
        {count !== undefined && count !== null && <small>{count}</small>}
      </header>
      <div className="lgb-section-body">{children}</div>
    </section>
  );
}

function Metric({ label, value, hint, tone }) {
  return (
    <div className="lgb-metric" style={tone ? { '--lgb-tone': tone } : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function MarkBadge({ mark }) {
  const tone = MARKS[mark] || PENDING;
  const { Icon } = tone;
  return (
    <span className="lgb-mark" style={{ '--lgb-mark-color': tone.color, '--lgb-mark-soft': tone.soft }}>
      <Icon size={11} />
      {tone.label}
    </span>
  );
}

function Tag({ children, color, icon: Icon }) {
  return (
    <span className="lgb-tag" style={color ? { color } : undefined}>
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
}

export default function LiveGuardBoard({ schedule, guards = [], today, onBack }) {
  const scheduleId = schedule?.id;
  const departmentId = schedule?.departmentId;
  const enabled = Boolean(scheduleId);

  /* 1. L'appel du jour — la seule requête cadencée du tableau de bord. */
  const appelRes = useQuery({
    queryKey: ['journal', 'garde-direct', scheduleId, today],
    queryFn: () => journalAPI.getEvents({
      scheduleId,
      type: 'presence,absence,late',
      from: today,
      to: today,
      limit: 300,
    }),
    enabled: enabled && Boolean(today),
    refetchInterval: LIVE_REFRESH_INTERVAL,
    refetchIntervalInBackground: true,
  });

  /* 2. L'historique complet de la garde — rafraîchi par socket (`journal:event`). */
  const historyRes = useQuery({
    queryKey: ['journal', 'garde-historique', scheduleId],
    queryFn: () => journalAPI.getEvents({ scheduleId, limit: 100 }),
    enabled,
  });

  /* 3. Les signalements du jour (durée du retard, justification, déclarant). */
  const absencesRes = useQuery({
    queryKey: ['absences', 'garde-direct', scheduleId, today],
    queryFn: () => absencesShiftAPI.getAll({ scheduleId, from: today, to: today, limit: 100 }),
    enabled: enabled && Boolean(today),
  });

  /* 4. Les alertes ouvertes du service (par défaut côté serveur). */
  const alertsRes = useQuery({
    queryKey: ['journal-alerts', 'garde-direct', departmentId],
    queryFn: () => journalAPI.getAlerts({ departmentId, limit: 200 }),
    enabled: Boolean(departmentId),
  });

  /* 5. Les remplacements en surcouche : le tableur validé n'est jamais réécrit. */
  const overlayRes = useQuery({
    queryKey: ['replacements', 'garde-direct', scheduleId],
    queryFn: () => replacementsAPI.getOverlay({ scheduleId }),
    enabled,
  });

  /* 6. Les prêts de personnel. Clé alignée sur `StaffLoansOverview` (`['supervision-loans', '']`)
        pour partager le cache au lieu de rouvrir une seconde requête identique. */
  const loansRes = useQuery({
    queryKey: ['supervision-loans', ''],
    queryFn: () => supervisionAPI.getLoans(),
    enabled,
  });

  /* ── Dérivations ── */

  const roster = useMemo(
    () => (guards || []).filter((g) => g.scheduleId === scheduleId),
    [guards, scheduleId],
  );

  // Dérivation identique à `AppelDuJourPage` : premier événement gagnant.
  const declared = useMemo(() => {
    const map = {};
    const byType = { presence: 'present', late: 'late', absence: 'absent' };
    for (const event of appelRes.data?.data?.data?.events || []) {
      const mark = byType[event.type];
      if (!mark || !event.userId) continue;
      const key = `${event.userId || '—'}|${event.scheduleId || '—'}`;
      if (!map[key]) {
        const meta = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
        map[key] = {
          mark,
          hour: event.hour,
          reporter: event.reporterName,
          id: event.id,
          isJustified: typeof event.isJustified === 'boolean' ? event.isJustified : meta?.isJustified,
          lateMinutes: meta?.lateMinutes,
          typeName: meta?.typeName,
        };
      }
    }
    return map;
  }, [appelRes.data]);

  const counts = useMemo(() => {
    const acc = { present: 0, late: 0, absent: 0, pending: 0 };
    for (const guard of roster) {
      const mark = declared[guardKey(guard)]?.mark;
      if (mark === 'present') acc.present += 1;
      else if (mark === 'late') acc.late += 1;
      else if (mark === 'absent') acc.absent += 1;
      else acc.pending += 1;
    }
    return acc;
  }, [roster, declared]);

  const doneRatio = roster.length
    ? Math.round(((roster.length - counts.pending) / roster.length) * 100)
    : 0;

  const position = useMemo(() => {
    const total = dayDiff(schedule?.startDate, schedule?.endDate);
    const index = dayDiff(schedule?.startDate, today);
    const remaining = dayDiff(today, schedule?.endDate);
    return {
      total: total === null ? null : total + 1,
      index: index === null ? null : index + 1,
      remaining,
    };
  }, [schedule?.startDate, schedule?.endDate, today]);

  const absences = absencesRes.data?.data?.data || [];

  const alerts = useMemo(() => alertsRes.data?.data?.data?.alerts || [], [alertsRes.data]);
  const alertsOfGuard = useMemo(
    () => alerts.filter((a) => a.scheduleId === scheduleId),
    [alerts, scheduleId],
  );
  const alertsOfDepartment = useMemo(
    () => alerts.filter((a) => !a.scheduleId && a.departmentId === departmentId),
    [alerts, departmentId],
  );

  const overlays = overlayRes.data?.data?.data || [];

  const loans = useMemo(
    () => (loansRes.data?.data?.data?.loans || []).filter((l) => l.scheduleId === scheduleId),
    [loansRes.data, scheduleId],
  );

  const timeline = useMemo(() => {
    const events = historyRes.data?.data?.data?.events || [];
    const groups = [];
    const index = {};
    for (const event of events) {
      const day = String(event.date || '').slice(0, 10) || 'inconnu';
      if (!index[day]) {
        index[day] = { day, events: [] };
        groups.push(index[day]);
      }
      index[day].events.push(event);
    }
    return groups;
  }, [historyRes.data]);

  if (!schedule) return null;

  const guardCount = schedule.guardCount ?? null;
  const staffCount = schedule.staffCount ?? null;

  return (
    <div className="lgb-shell">
      {/* ── Fil d'Ariane ── */}
      <div className="lgb-crumbs">
        <button type="button" className="lgb-back" onClick={onBack}>
          <ArrowLeft size={13} /> Gardes en cours
        </button>
        <ChevronRight size={13} />
        <strong>{schedule.name || 'Garde'}</strong>
      </div>

      {/* ── 1. État et statut de la garde ── */}
      <header className="lgb-header">
        <div className="lgb-header-copy">
          <h2>
            {schedule.name || 'Garde'}
            <PlanningStateBadge
              state={schedule.state}
              status={schedule.status}
              startDate={schedule.startDate}
              endDate={schedule.endDate}
              size="sm"
            />
          </h2>
          <p>
            <Building2 size={12} style={{ verticalAlign: '-2px' }} /> {schedule.departmentName || 'Service inconnu'}
            {' · '}
            <CalendarDays size={12} style={{ verticalAlign: '-2px' }} /> {SHORT_DATE(schedule.startDate)} → {SHORT_DATE(schedule.endDate)}
          </p>
          <div className="lgb-header-facts">
            <span className="lgp-chip is-strong">Aujourd'hui · {LONG_DATE(today)}</span>
            {position.index && position.total && (
              <span className="lgp-chip">Jour {position.index} / {position.total}</span>
            )}
            {position.remaining !== null && (
              <span className="lgp-chip is-muted">
                {position.remaining > 0
                  ? `${position.remaining} jour(s) restant(s)`
                  : 'Dernier jour de la garde'}
              </span>
            )}
            {guardCount !== null && <span className="lgp-chip is-muted">{guardCount} garde(s) planifiée(s)</span>}
            {staffCount !== null && <span className="lgp-chip is-muted">{staffCount} agent(s) au planning</span>}
          </div>
        </div>
        <span className="lgp-live is-live" style={{ cursor: 'default' }}>
          <span className="lgp-live-dot" />
          En direct
        </span>
        <span className="lgp-sync">
          <RefreshCw size={11} /> Synchronisé à {formatSyncTime(appelRes.dataUpdatedAt)}
        </span>
      </header>

      {/* ── 2. Statut de l'appel du jour ── */}
      <div className="lgb-metrics">
        <Metric label="Effectif du jour" value={roster.length} hint="agents de garde" tone="var(--gs-seal)" />
        <Metric label={MARKS.present.label} value={counts.present} tone={MARKS.present.color} />
        <Metric label={MARKS.late.label} value={counts.late} tone={MARKS.late.color} />
        <Metric label={MARKS.absent.label} value={counts.absent} tone={MARKS.absent.color} />
        <Metric label={PENDING.label} value={counts.pending} tone={PENDING.color} />
      </div>

      <Section icon={ListChecks} title="Avancement de l'appel du jour" count={`${doneRatio} %`}>
        {roster.length === 0 ? (
          <p className="lgb-section-empty">Aucun agent de garde aujourd'hui sur ce planning.</p>
        ) : (
          <>
            <div
              className="lgp-progress"
              style={{
                '--lgp-progress': `${doneRatio}%`,
                '--lgp-accent': counts.pending === 0 ? 'var(--gs-duty)' : 'var(--gs-seal)',
              }}
            >
              <span />
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--gs-ink-faint)' }}>
              {roster.length - counts.pending} agent(s) pointé(s) sur {roster.length}.
              {counts.pending > 0 && ` ${counts.pending} reste(nt) à pointer par le service.`}
              {' '}Le pointage se fait dans « Appel du jour » : cet écran est en lecture seule.
            </p>
          </>
        )}
      </Section>

      {/* ── 3. Effectif de garde ── */}
      <Section icon={Users} title="Effectif de garde aujourd'hui" count={roster.length}>
        {roster.length === 0 ? (
          <p className="lgb-section-empty">
            Aucun agent n'est de garde aujourd'hui sur ce planning — vérifiez le tableur du service.
          </p>
        ) : (
          <div className="lgb-rows">
            {roster.map((guard) => {
              const state = declared[guardKey(guard)];
              const tone = state ? (MARKS[state.mark] || PENDING) : PENDING;
              const shiftColor = SHIFT_COLOR;
              return (
                <div key={guardKey(guard)} className="lgb-row" style={{ '--lgb-tone': tone.color }}>
                  <div className="lgb-row-identity">
                    <strong>{guard.name || '—'}</strong>
                    <small>{guard.roleName || 'Fonction non renseignée'}</small>
                  </div>
                  <div className="lgb-row-slot">
                    <span style={{ color: shiftColor, fontWeight: 700 }}>
                      {guard.label || 'De service'}
                    </span>
                    <em>
                      {guard.shiftStart || '—'} → {guard.shiftEnd || '—'}
                    </em>
                  </div>
                  <div className="lgb-row-side">
                    {/* Où l'agent est de garde n'est pas un état à surveiller :
                        l'étiquette et l'icône le disent, l'encre suffit. */}
                    {guard.atHome && <Tag color="var(--gs-ink-soft)" icon={Home}>Garde à domicile</Tag>}
                    <MarkBadge mark={state?.mark} />
                    {state?.lateMinutes !== undefined && state?.lateMinutes !== null && (
                      <Tag color={MARKS.late.color} icon={Clock3}>{state.lateMinutes} min</Tag>
                    )}
                    {state && state.mark !== 'present' && (
                      <JustificationBadge value={state.isJustified} emptyLabel="Justification non renseignée" />
                    )}
                    {state?.hour && (
                      <span style={{ fontSize: 10, color: 'var(--gs-ink-faint)' }}>
                        {state.hour}
                        {state.reporter ? ` · ${state.reporter}` : ''}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 4. Absences et retards déclarés aujourd'hui ── */}
      <Section icon={Stethoscope} title="Absences et retards déclarés aujourd'hui" count={absences.length}>
        {absences.length === 0 ? (
          <p className="lgb-section-empty">Aucun signalement pour aujourd'hui.</p>
        ) : (
          <div className="lgb-rows">
            {absences.map((row) => (
              <div key={row.id} className="lgb-row" style={{ '--lgb-tone': row.type_color || MARKS.absent.color }}>
                <div className="lgb-row-identity">
                  <strong>{fullName(row.first_name, row.last_name)}</strong>
                  <small>
                    Déclaré par {fullName(row.reporter_first_name, row.reporter_last_name)}
                    {row.declared_hour ? ` à ${row.declared_hour}` : ''}
                    {row.declared_date && row.declared_date !== row.date ? ` (le ${SHORT_DATE(row.declared_date)})` : ''}
                  </small>
                </div>
                <div className="lgb-row-slot">
                  <span style={{ color: row.type_color || 'var(--gs-ink)', fontWeight: 700 }}>
                    {row.type_name || 'Signalement'}
                  </span>
                  {(row.start_time || row.end_time) && (
                    <em>{row.start_time || '—'} → {row.end_time || '—'}</em>
                  )}
                </div>
                <div className="lgb-row-side">
                  {row.late_minutes !== null && row.late_minutes !== undefined && (
                    <Tag color={MARKS.late.color} icon={Clock3}>{row.late_minutes} min de retard</Tag>
                  )}
                  <JustificationBadge value={row.is_justified} emptyLabel="Justification non renseignée" />
                  {row.reason && (
                    <span style={{ fontSize: 10, color: 'var(--gs-ink-soft)', maxWidth: 260 }}>{row.reason}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 5. Alertes ouvertes ── */}
      <Section
        icon={Bell}
        title="Alertes ouvertes"
        count={alertsOfGuard.length + alertsOfDepartment.length}
      >
        {alertsOfGuard.length === 0 && alertsOfDepartment.length === 0 ? (
          <p className="lgb-section-empty">Aucune alerte ouverte pour cette garde ni pour ce service.</p>
        ) : (
          <>
            {alertsOfGuard.length > 0 && (
              <div className="lgb-group">
                <p className="lgb-group-label">Cette garde</p>
                <div className="lgb-rows">
                  {alertsOfGuard.map((alert) => (
                    <div
                      key={alert.id}
                      className="lgb-row"
                      style={{ '--lgb-tone': SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.info }}
                    >
                      <div className="lgb-row-identity">
                        <strong>{alert.title || alert.type}</strong>
                        <small>{frenchifyIsoDates(alert.message) || '—'}</small>
                      </div>
                      <div className="lgb-row-side">
                        <Tag color={SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.info} icon={AlertTriangle}>
                          {alert.severity || 'info'}
                        </Tag>
                        <span style={{ fontSize: 10, color: 'var(--gs-ink-faint)' }}>
                          {SHORT_DATE(alert.createdAt)}
                          {alert.acknowledgedAt ? ' · accusée' : ''}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {alertsOfDepartment.length > 0 && (
              <div className="lgb-group">
                <p className="lgb-group-label">Ce service, hors planning</p>
                <div className="lgb-rows">
                  {alertsOfDepartment.map((alert) => (
                    <div
                      key={alert.id}
                      className="lgb-row"
                      style={{ '--lgb-tone': SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.info }}
                    >
                      <div className="lgb-row-identity">
                        <strong>{alert.title || alert.type}</strong>
                        <small>{frenchifyIsoDates(alert.message) || '—'}</small>
                      </div>
                      <div className="lgb-row-side">
                        <Tag color={SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.info} icon={AlertTriangle}>
                          {alert.severity || 'info'}
                        </Tag>
                        <span style={{ fontSize: 10, color: 'var(--gs-ink-faint)' }}>{SHORT_DATE(alert.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── 6. Remplacements en vigueur (surcouche) ── */}
      <Section icon={Repeat} title="Remplacements sur cette garde" count={overlays.length}>
        {overlays.length === 0 ? (
          <p className="lgb-section-empty">Aucun remplacement déclaré sur cette garde.</p>
        ) : (
          <div className="lgb-rows">
            {overlays.map((overlay) => {
              const confirmation = CONFIRMATION_LABELS[overlay.confirmation_status] || CONFIRMATION_LABELS.pending;
              return (
                <div key={overlay.id} className="lgb-row" style={{ '--lgb-tone': confirmation.color }}>
                  <div className="lgb-row-identity">
                    <strong>
                      {(overlay.items || []).length
                        ? (overlay.items || []).map((item) => (
                            `${fullName(item.absentFirstName, item.absentLastName)} → ${fullName(item.replacementFirstName, item.replacementLastName)}`
                          )).join(' · ')
                        : 'Remplacement'}
                    </strong>
                    <small>
                      Demandé par {overlay.requested_by || fullName(overlay.requested_by_first, overlay.requested_by_last)}
                      {overlay.requested_by_role_name ? ` (${overlay.requested_by_role_name})` : ''}
                      {overlay.reason ? ` — ${overlay.reason}` : ''}
                    </small>
                  </div>
                  <div className="lgb-row-slot">
                    <span>{SHORT_DATE(overlay.start_date)} → {SHORT_DATE(overlay.end_date)}</span>
                    {(overlay.start_time || overlay.end_time) && (
                      <em>{overlay.start_time || '—'} → {overlay.end_time || '—'}</em>
                    )}
                  </div>
                  <div className="lgb-row-side">
                    {/* Un remplacement venu d'un autre service engage deux chefs :
                        c'est un fait d'organisation, il porte le sceau. */}
                    {(overlay.items || []).some((item) => item.isCrossDepartment) && (
                      <Tag color="var(--gs-seal)" icon={ArrowLeftRight}>Inter-services</Tag>
                    )}
                    <Tag color={confirmation.color}>{confirmation.label}</Tag>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 7. Historique de la garde (traçabilité, non modifiable) ── */}
      <Section
        icon={History}
        title="Historique de la garde"
        count={(historyRes.data?.data?.data?.events || []).length}
      >
        {timeline.length === 0 ? (
          <p className="lgb-section-empty">Aucun événement enregistré sur cette garde.</p>
        ) : (
          <div className="lgb-timeline">
            {timeline.map((group) => (
              <div key={group.day} className="lgb-day">
                <p className="lgb-day-label">
                  {DAY_LABEL(group.day)}
                  {group.day === today ? ' · aujourd\'hui' : ''}
                </p>
                {group.events.map((event) => (
                  <article
                    key={event.id}
                    className="lgb-event"
                    style={{ '--lgb-tone': SEVERITY_COLORS[event.severity] || SEVERITY_COLORS.info }}
                  >
                    <span className="lgb-event-hour">{event.hour || '—'}</span>
                    <div className="lgb-event-body">
                      <div className="lgb-event-title">
                        <strong>{event.title || event.typeLabel || event.type}</strong>
                        <Tag color={SEVERITY_COLORS[event.severity] || SEVERITY_COLORS.info}>
                          {event.typeLabel || event.type}
                        </Tag>
                        {event.userName && <span className="lgp-chip is-muted">{event.userName}</span>}
                      </div>
                      {event.description && <p>{frenchifyIsoDates(event.description)}</p>}
                      <footer>
                        {event.reporterName ? `Déclaré par ${event.reporterName}` : 'Déclarant non renseigné'}
                        {event.declaredDate && event.declaredDate !== event.date
                          ? ` · saisi le ${SHORT_DATE(event.declaredDate)}`
                          : ''}
                      </footer>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>
        )}

        {loans.length > 0 && (
          <div className="lgb-inset">
            <h4>Prêts de personnel liés à cette garde</h4>
            <div className="lgb-rows">
              {loans.map((loan) => {
                const state = LOAN_LABELS[loan.status] || LOAN_LABELS.pending;
                return (
                  <div key={loan.id} className="lgb-row" style={{ '--lgb-tone': state.color }}>
                    <div className="lgb-row-identity">
                      <strong>{loan.staffName || '—'}</strong>
                      <small>
                        {loan.ownerDepartment || '—'} → {loan.requestingDepartment || '—'}
                        {loan.requesterName ? ` · demandé par ${loan.requesterName}` : ''}
                      </small>
                    </div>
                    <div className="lgb-row-slot">
                      <span>{SHORT_DATE(loan.shiftDate)}</span>
                      {loan.responseReason && <em>{loan.responseReason}</em>}
                    </div>
                    <div className="lgb-row-side">
                      <Tag color={state.color} icon={ArrowLeftRight}>{state.label}</Tag>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
