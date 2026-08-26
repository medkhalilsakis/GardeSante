import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Filter,
  History,
  Radio,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  UserX,
  UsersRound,
  WifiOff,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { journalAPI, absencesShiftAPI, absencesAPI } from '../../api';
import { useAuthStore } from '../../store';
import ContextBadge from '../../components/layout/ContextBadge';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import JustificationChoice, { JustificationBadge } from '../../components/common/JustificationChoice';
import AppelHistoryPanel from './components/AppelHistoryPanel';
import './AppelDuJourPage.css';

const CALLER_ROLES = ['department_head', 'service_supervisor', 'general_supervisor', 'director'];
const LIVE_REFRESH_INTERVAL = 15000;

const TABS = [
  { id: 'pointer', label: "Appel d'aujourd'hui", icon: ClipboardCheck },
  { id: 'history', label: 'Historique', icon: History },
];

const handleTabKeyDown = (event, currentId, setTab) => {
  const currentIndex = TABS.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % TABS.length;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
  if (event.key === 'Home') nextIndex = 0;
  if (event.key === 'End') nextIndex = TABS.length - 1;
  if (nextIndex === currentIndex) return;

  event.preventDefault();
  const nextId = TABS[nextIndex].id;
  setTab(nextId);
  window.requestAnimationFrame(() => document.getElementById(`appel-tab-${nextId}`)?.focus());
};

// Chaque marque porte son libellé, son ton et son icône. Le ton nomme la
// classe CSS qui l'habille : la couleur reste dans la feuille de styles.
const MARKS = {
  present: { label: 'Présent', tone: 'success', icon: CheckCircle2 },
  late: { label: 'Retard', tone: 'warning', icon: Clock3 },
  absent: { label: 'Absent', tone: 'danger', icon: UserX },
};

const STATUS_FILTERS = [
  { value: '', label: 'Tous' },
  { value: 'pending', label: 'À pointer' },
  { value: 'present', label: 'Présents' },
  { value: 'late', label: 'Retards' },
  { value: 'absent', label: 'Absents' },
];

const todayKey = () => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const LONG_DATE = (iso) => {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
};

const formatSyncTime = (timestamp) => {
  if (!timestamp) return 'Synchronisation en attente';
  return `Synchronisé à ${new Date(timestamp).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })}`;
};

const guardKey = (guard) => `${guard.userId || '—'}|${guard.scheduleId || '—'}`;

const initialsOf = (name = '') => name
  .trim()
  .split(/\s+/)
  .slice(0, 2)
  .map((part) => part.charAt(0).toUpperCase())
  .join('') || '—';

function LiveControl({ enabled, onToggle, isFetching, lastSyncedAt, arrivals }) {
  return (
    <div className={`appel-live-control ${enabled ? 'is-live' : 'is-paused'}`}>
      <button
        type="button"
        className="appel-live-toggle"
        onClick={onToggle}
        aria-pressed={enabled}
        title={enabled ? 'Mettre les mises à jour automatiques en pause' : 'Activer les mises à jour automatiques'}
      >
        <span className="appel-live-signal" aria-hidden="true"><span /></span>
        <span className="appel-live-copy">
          <strong>{enabled ? 'APPEL EN DIRECT' : 'APPEL EN PAUSE'}</strong>
          <small>{enabled ? 'Actualisation automatique' : 'Actualisation manuelle'}</small>
        </span>
        {enabled ? <Radio size={18} /> : <WifiOff size={18} />}
      </button>
      <div className="appel-live-meta">
        <span className={isFetching ? 'is-syncing' : ''}>
          <RefreshCw size={12} />
          {isFetching ? 'Synchronisation…' : formatSyncTime(lastSyncedAt)}
        </span>
        {arrivals > 0 && <b role="status" aria-live="polite" aria-atomic="true"><Sparkles size={12} />{arrivals} mise{arrivals > 1 ? 's' : ''} à jour live</b>}
      </div>
    </div>
  );
}

function MetricCard({ label, value, detail, tone, icon: Icon, progress }) {
  return (
    <article className={`appel-metric appel-metric-${tone}`}>
      <div className="appel-metric-icon"><Icon size={18} strokeWidth={2.2} /></div>
      <div className="appel-metric-copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {typeof progress === 'number' && (
        <div className="appel-metric-progress" aria-label={`${progress}% complété`}>
          <span style={{ '--appel-progress': `${Math.min(100, Math.max(0, progress))}%` }} />
        </div>
      )}
    </article>
  );
}

function MarkBadge({ declaration }) {
  if (!declaration) {
    return <span className="appel-status-badge appel-status-pending"><span className="appel-status-dot" />À pointer</span>;
  }
  const meta = MARKS[declaration.mark] || MARKS.present;
  const Icon = meta.icon;
  return <span className={`appel-status-badge appel-status-${meta.tone}`}><Icon size={13} />{meta.label}</span>;
}

function GuardCard({ guard, declaration, busy, mutationBusy, isNew, onMark }) {
  const state = declaration?.mark || 'pending';

  return (
    <article className={`appel-guard-card is-${state}${isNew ? ' is-live-arrival' : ''}`}>
      {isNew && <span className="appel-arrival-label"><Sparkles size={12} />Mise à jour live</span>}
      <div className="appel-guard-head">
        <div className="appel-agent-identity">
          <div className="appel-agent-avatar" aria-hidden="true">{initialsOf(guard.name)}</div>
          <div>
            <h3>{guard.name}</h3>
            <p>{guard.roleName || 'Personnel de garde'}</p>
          </div>
        </div>
        <MarkBadge declaration={declaration} />
      </div>

      <div className="appel-guard-details">
        <div>
          <span className="appel-detail-icon appel-detail-service"><Building2 size={15} /></span>
          <div><small>Service</small><strong>{guard.departmentName || 'Non précisé'}</strong></div>
        </div>
        <div>
          <span className="appel-detail-icon appel-detail-shift"><Clock3 size={15} /></span>
          <div>
            <small>Garde</small>
            <strong>{guard.label || 'De service'}</strong>
            {guard.shiftStart && guard.shiftEnd && <em>{guard.shiftStart} → {guard.shiftEnd}</em>}
          </div>
        </div>
        <div>
          <span className="appel-detail-icon appel-detail-planning"><CalendarDays size={15} /></span>
          <div>
            <small>Planning</small>
            <strong>{guard.scheduleName || 'Planning en cours'}</strong>
            <PlanningStateBadge state="en_cours" size="sm" />
          </div>
        </div>
      </div>

      {declaration && (
        <div className={`appel-declaration-summary appel-declaration-${MARKS[declaration.mark]?.tone || 'success'}`}>
          <div>
            <span>Déclaration enregistrée</span>
            <strong>{MARKS[declaration.mark]?.label || 'Pointé'}{declaration.hour ? ` à ${declaration.hour}` : ''}</strong>
          </div>
          {declaration.reporter && <small>Par {declaration.reporter}</small>}
          {declaration.mark !== 'present' && typeof declaration.isJustified === 'boolean' && <JustificationBadge value={declaration.isJustified} />}
        </div>
      )}

      <div className="appel-guard-actions" aria-label={`Pointer ${guard.name}`}>
        {Object.entries(MARKS).map(([mark, meta]) => {
          const Icon = meta.icon;
          const selected = declaration?.mark === mark;
          return (
            <button
              type="button"
              key={mark}
              className={`appel-mark-action appel-mark-${meta.tone}${selected ? ' is-selected' : ''}`}
              onClick={() => onMark(guard, mark)}
              disabled={busy || mutationBusy || Boolean(declaration)}
              title={declaration ? `Déjà pointé ${MARKS[declaration.mark].label.toLowerCase()}` : `Déclarer ${meta.label.toLowerCase()}`}
            >
              <Icon size={16} /><span>{meta.label}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function StatePanel({ tone = 'neutral', icon: Icon, title, children }) {
  return (
    <div className={`appel-state-panel appel-state-${tone}`}>
      <div className="appel-state-icon"><Icon size={22} /></div>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

function ReasonModal({ mark, guard, onClose, onConfirm, busy }) {
  const [reason, setReason] = useState('');
  const [isJustified, setIsJustified] = useState(null);
  const [lateMinutes, setLateMinutes] = useState('');
  const closeButtonRef = useRef(null);
  const previousActiveElementRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const meta = MARKS[mark];
  const Icon = meta.icon;
  const isLate = mark === 'late';

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    previousActiveElementRef.current = document.activeElement;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElementRef.current?.focus?.();
    };
  }, []);

  return (
    <div className="modal-overlay appel-modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal appel-reason-modal appel-reason-${meta.tone}`} role="dialog" aria-modal="true" aria-labelledby="appel-reason-title" aria-describedby="appel-reason-description">
        <div className="appel-reason-header">
          <div className="appel-reason-title-icon"><Icon size={20} /></div>
          <div>
            <span>Déclaration individuelle</span>
            <h2 id="appel-reason-title">Déclarer « {meta.label} »</h2>
            <p id="appel-reason-description">{guard.name} · {guard.departmentName || 'Service'} · {guard.label || 'De service'}</p>
          </div>
          <button ref={closeButtonRef} type="button" className="appel-modal-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); onConfirm({ reason, isJustified, lateMinutes }); }}>
          <div className="appel-reason-body">
            {isLate && (
              <div className="appel-reason-section">
                <div className="appel-field-heading">
                  <div><Clock3 size={15} /><span>Durée du retard</span></div><small>Facultatif</small>
                </div>
                <div className="appel-duration-row">
                  <div className="appel-duration-input">
                    <input type="number" min={0} max={1440} step={5} value={lateMinutes} onChange={(event) => setLateMinutes(event.target.value)} placeholder="25" aria-label="Durée du retard en minutes" />
                    <span>minutes</span>
                  </div>
                  <div className="appel-duration-presets">
                    {[15, 30, 60, 120].map((minutes) => (
                      <button type="button" key={minutes} className={String(minutes) === lateMinutes ? 'is-selected' : ''} onClick={() => setLateMinutes(String(minutes))}>
                        {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="appel-reason-section">
              <label className="appel-field-heading" htmlFor="appel-reason-text">
                <div><ClipboardCheck size={15} /><span>Motif et contexte</span></div><small>Facultatif</small>
              </label>
              <textarea id="appel-reason-text" className="appel-reason-textarea" rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Précisez les faits constatés ou les informations utiles…" />
            </div>

            <div className="appel-justification-shell">
              <JustificationChoice value={isJustified} onChange={setIsJustified} subject={isLate ? 'Retard' : 'Absence'} label={isLate ? 'Qualification du retard' : 'Qualification de l’absence'} required />
            </div>

            <div className="appel-notification-note"><Send size={15} /><span>L’agent sera notifié et la déclaration restera disponible dans le journal et l’historique.</span></div>
          </div>

          <div className="appel-reason-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
            <button type="submit" className={`appel-confirm-button appel-confirm-${meta.tone}`} disabled={busy}><Icon size={16} />{busy ? 'Enregistrement…' : `Confirmer ${meta.label.toLowerCase()}`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AppelDuJourPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const today = todayKey();
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const [tab, setTab] = useState('pointer');
  const [liveMode, setLiveMode] = useState(true);
  const [liveArrivalKeys, setLiveArrivalKeys] = useState(() => new Set());
  const previousGuardKeys = useRef(null);
  const previousDeclaredKeys = useRef(null);
  const arrivalTimers = useRef(new Map());
  const canCall = CALLER_ROLES.includes(user?.roleCode) || user?.roleCode === 'super_admin';
  const liveInterval = liveMode && tab === 'pointer' ? LIVE_REFRESH_INTERVAL : false;

  const { data: overviewRes, isLoading, isError, error, isFetching: overviewFetching, dataUpdatedAt: overviewUpdatedAt } = useQuery({
    queryKey: ['journal-overview'],
    queryFn: () => journalAPI.getOverview(),
    enabled: canCall,
    refetchInterval: liveInterval,
    refetchIntervalInBackground: true,
  });
  const overview = overviewRes?.data?.data;
  const guards = useMemo(() => overview?.todayGuards || [], [overview]);
  const serverToday = overview?.today || today;

  const { data: eventsRes, isFetching: eventsFetching, dataUpdatedAt: eventsUpdatedAt } = useQuery({
    queryKey: ['journal', 'appel', serverToday],
    queryFn: () => journalAPI.getEvents({ from: serverToday, to: serverToday, limit: 300 }),
    enabled: canCall,
    refetchInterval: liveInterval,
    refetchIntervalInBackground: true,
  });

  const declared = useMemo(() => {
    const map = {};
    const byType = { presence: 'present', late: 'late', absence: 'absent' };
    for (const event of eventsRes?.data?.data?.events || []) {
      const mark = byType[event.type];
      if (!mark || !event.userId) continue;
      const key = `${event.userId || '—'}|${event.scheduleId || '—'}`;
      if (!map[key]) {
        const metadataJustification = event.metadata && typeof event.metadata === 'object' ? event.metadata.isJustified : undefined;
        map[key] = { mark, hour: event.hour, reporter: event.reporterName, id: event.id, isJustified: typeof event.isJustified === 'boolean' ? event.isJustified : metadataJustification };
      }
    }
    return map;
  }, [eventsRes]);

  const { data: typesRes } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => absencesAPI.getTypes(),
    enabled: canCall,
  });
  const types = (typesRes?.data?.data || []).filter((type) => !type.is_leave);
  const lateType = types.find((type) => type.code === 'retard' || /retard/i.test(type.name || ''));
  const absentType = types.find((type) => type.code === 'absence_injustifiee') || types.find((type) => !/retard/i.test(type.name || '')) || types[0];

  const services = useMemo(() => {
    const map = new Map();
    guards.forEach((guard) => { if (guard.departmentId) map.set(guard.departmentId, guard.departmentName || 'Service'); });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  }, [guards]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return guards.filter((guard) => {
      const declaration = declared[guardKey(guard)];
      const state = declaration?.mark || 'pending';
      const haystack = `${guard.name || ''} ${guard.roleName || ''} ${guard.departmentName || ''} ${guard.scheduleName || ''}`.toLowerCase();
      return (!deptFilter || guard.departmentId === deptFilter) && (!statusFilter || state === statusFilter) && (!query || haystack.includes(query));
    });
  }, [guards, declared, deptFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const result = { present: 0, late: 0, absent: 0, pending: 0 };
    guards.forEach((guard) => { result[declared[guardKey(guard)]?.mark || 'pending'] += 1; });
    return result;
  }, [guards, declared]);

  const completedCount = counts.present + counts.late + counts.absent;
  const completionPercent = guards.length ? Math.round((completedCount / guards.length) * 100) : 0;
  const lastSyncedAt = Math.max(overviewUpdatedAt || 0, eventsUpdatedAt || 0);
  const isFetching = overviewFetching || eventsFetching;
  const filtersActive = Boolean(deptFilter || statusFilter || search.trim());

  const clearArrivalAnimations = useCallback(() => {
    arrivalTimers.current.forEach((timer) => window.clearTimeout(timer));
    arrivalTimers.current.clear();
    setLiveArrivalKeys(new Set());
  }, []);

  const announceLiveArrivals = useCallback((keys) => {
    if (!liveMode || keys.length === 0) return;

    setLiveArrivalKeys((existing) => new Set([...existing, ...keys]));
    keys.forEach((key) => {
      const existingTimer = arrivalTimers.current.get(key);
      if (existingTimer) window.clearTimeout(existingTimer);

      const timer = window.setTimeout(() => {
        setLiveArrivalKeys((existing) => {
          const next = new Set(existing);
          next.delete(key);
          return next;
        });
        arrivalTimers.current.delete(key);
      }, 2600);
      arrivalTimers.current.set(key, timer);
    });
  }, [liveMode]);

  useEffect(() => () => {
    arrivalTimers.current.forEach((timer) => window.clearTimeout(timer));
    arrivalTimers.current.clear();
  }, []);

  useEffect(() => {
    previousGuardKeys.current = null;
    previousDeclaredKeys.current = null;
    clearArrivalAnimations();
  }, [serverToday, clearArrivalAnimations]);

  useEffect(() => {
    if (!liveMode) clearArrivalAnimations();
  }, [liveMode, clearArrivalAnimations]);

  useEffect(() => {
    if (!overviewRes) return;

    const current = new Set(guards.map(guardKey));
    if (previousGuardKeys.current === null) {
      previousGuardKeys.current = current;
      return;
    }

    const additions = [...current].filter((key) => !previousGuardKeys.current.has(key));
    previousGuardKeys.current = current;
    announceLiveArrivals(additions);
  }, [announceLiveArrivals, guards, overviewRes]);

  useEffect(() => {
    if (!eventsRes) return;

    const current = new Set(Object.keys(declared));
    if (previousDeclaredKeys.current === null) {
      previousDeclaredKeys.current = current;
      return;
    }

    const additions = [...current].filter((key) => !previousDeclaredKeys.current.has(key));
    previousDeclaredKeys.current = current;
    announceLiveArrivals(additions);
  }, [announceLiveArrivals, declared, eventsRes]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['journal-overview'] });
    qc.invalidateQueries({ queryKey: ['journal'] });
    qc.invalidateQueries({ queryKey: ['journal-alerts'] });
    qc.invalidateQueries({ queryKey: ['shift-absences'] });
  };

  const markPresent = useMutation({
    mutationFn: (guard) => journalAPI.addEvent({
      departmentId: guard.departmentId, scheduleId: guard.scheduleId, eventType: 'presence', userId: guard.userId,
      severity: 'info', title: `Présence confirmée — ${guard.name}`,
      description: `Garde ${guard.label || 'De service'} du ${serverToday} · ${guard.scheduleName || ''}`.trim(),
    }),
    onSuccess: () => { toast.success('Présence enregistrée'); refreshAll(); },
    onError: (mutationError) => toast.error(mutationError?.response?.data?.message || 'Enregistrement impossible'),
    onSettled: () => setBusyKey(null),
  });

  const reportAbsence = useMutation({
    mutationFn: ({ guard, mark, reason, isJustified, lateMinutes }) => {
      const type = mark === 'late' ? lateType : absentType;
      return absencesShiftAPI.report({
        userId: guard.userId, scheduleId: guard.scheduleId, absenceTypeId: type?.id,
        absenceKind: mark === 'late' ? 'late' : 'absence', date: serverToday, reason: reason || undefined,
        isJustified, severity: mark === 'late' ? 'info' : 'warning',
        lateMinutes: mark === 'late' && lateMinutes !== '' && lateMinutes !== undefined ? Number(lateMinutes) : undefined,
      });
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.mark === 'late' ? (variables.lateMinutes ? `Retard de ${variables.lateMinutes} min signalé` : 'Retard signalé') : 'Absence signalée');
      setPending(null);
      refreshAll();
    },
    onError: (mutationError) => toast.error(mutationError?.response?.data?.message || 'Signalement impossible'),
    onSettled: () => setBusyKey(null),
  });

  const onMark = (guard, mark) => {
    if (!guard.userId) { toast.error("Cet agent n'est pas rattaché à un compte : pointage impossible"); return; }
    if (mark === 'present') { setBusyKey(guardKey(guard)); markPresent.mutate(guard); return; }
    setPending({ mark, guard });
  };

  const resetFilters = () => { setDeptFilter(''); setStatusFilter(''); setSearch(''); };

  if (!canCall) {
    return (
      <div className="appel-page">
        <ContextBadge variant="header" />
        <StatePanel tone="danger" icon={UserX} title="Accès non autorisé">L'appel du jour est réservé aux chefs de service, surveillants, surveillants généraux et directeurs.</StatePanel>
      </div>
    );
  }

  return (
    <div className="appel-page">
      <section className="appel-command-header">
        <div className="appel-header-content">
          <div className="appel-eyebrow"><span />Poste de contrôle quotidien</div>
          <div className="appel-title-row">
            <div className="appel-title-icon"><ClipboardCheck size={25} /></div>
            <div><h1>Appel du jour</h1><p>{LONG_DATE(serverToday)} · Présence, retard et absence des équipes de garde</p></div>
          </div>
          <ContextBadge variant="header" className="appel-context-badge" />
        </div>
        <LiveControl enabled={liveMode} onToggle={() => setLiveMode((current) => !current)} isFetching={isFetching} lastSyncedAt={lastSyncedAt} arrivals={liveArrivalKeys.size} />
      </section>

      <div className="appel-navigation-bar">
        <div className="appel-tabs" role="tablist" aria-label="Vues de l'appel">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              id={`appel-tab-${id}`}
              role="tab"
              aria-selected={tab === id}
              aria-controls={`appel-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className={tab === id ? 'is-active' : ''}
              onClick={() => setTab(id)}
              onKeyDown={(event) => handleTabKeyDown(event, id, setTab)}
            >
              <Icon size={16} />{label}{id === 'pointer' && <span>{counts.pending}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="appel-refresh-button" onClick={refreshAll} disabled={isFetching}><RefreshCw size={15} className={isFetching ? 'is-spinning' : ''} />Actualiser</button>
      </div>

      {tab === 'history' && (
        <section id="appel-panel-history" className="appel-history-stage" role="tabpanel" aria-labelledby="appel-tab-history" tabIndex={0}>
          <div className="appel-section-heading">
            <div><span className="appel-section-kicker">Traçabilité</span><h2>Historique des appels</h2><p>Retrouvez les déclarations passées et complétez les jours non renseignés.</p></div>
            <div className="appel-heading-icon"><History size={19} /></div>
          </div>
          <AppelHistoryPanel />
        </section>
      )}

      {tab === 'pointer' && (
        <section id="appel-panel-pointer" className="appel-pointer-stage" role="tabpanel" aria-labelledby="appel-tab-pointer" tabIndex={0}>
          <section className="appel-metrics" aria-label="Synthèse de l'appel">
            <MetricCard label="Équipe attendue" value={guards.length} detail={`${services.length || 1} service${services.length > 1 ? 's' : ''} dans le périmètre`} tone="blue" icon={UsersRound} progress={completionPercent} />
            <MetricCard label="Présents" value={counts.present} detail="Présences confirmées" tone="green" icon={CheckCircle2} />
            <MetricCard label="Retards" value={counts.late} detail="Arrivées différées" tone="amber" icon={Clock3} />
            <MetricCard label="Absents" value={counts.absent} detail="Absences déclarées" tone="red" icon={UserX} />
            <MetricCard label="À pointer" value={counts.pending} detail={`${completionPercent}% de l'appel complété`} tone="violet" icon={Activity} />
          </section>

          <section className="appel-live-strip">
            <div><span className={`appel-live-strip-dot ${liveMode ? 'is-active' : ''}`} /><strong>{liveMode ? 'Mode Live actif' : 'Mode Live en pause'}</strong><p>{liveMode ? 'Les nouvelles gardes et déclarations apparaissent automatiquement avec une animation.' : 'Utilisez Actualiser pour charger les nouvelles déclarations.'}</p></div>
            <span>{completedCount}/{guards.length} pointés</span>
          </section>

          <section className="appel-filter-panel">
            <div className="appel-filter-heading"><div><span className="appel-section-kicker">Équipe de garde</span><h2>Personnels à pointer</h2></div><span className="appel-result-count">{visible.length} résultat{visible.length > 1 ? 's' : ''}</span></div>
            <div className="appel-filter-grid">
              <label className="appel-search-control"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un agent, un service ou un planning…" aria-label="Rechercher dans l'équipe de garde" /></label>
              <label className="appel-select-control"><Building2 size={15} /><select value={deptFilter} onChange={(event) => setDeptFilter(event.target.value)} aria-label="Filtrer par service"><option value="">Tous les services</option>{services.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <div className="appel-status-filters" aria-label="Filtrer par état">
                {STATUS_FILTERS.map((filter) => <button type="button" key={filter.value || 'all'} className={statusFilter === filter.value ? 'is-active' : ''} onClick={() => setStatusFilter(filter.value)}>{filter.label}</button>)}
              </div>
              {filtersActive && <button type="button" className="appel-clear-filters" onClick={resetFilters}><X size={14} />Effacer les filtres</button>}
            </div>
          </section>

          {isError ? (
            <StatePanel tone="danger" icon={UserX} title="Impossible de charger l'appel">{error?.response?.status === 403 ? "Votre rôle ne donne pas accès aux gardes du jour." : "Les gardes du jour n'ont pas pu être chargées."}</StatePanel>
          ) : isLoading ? (
            <div className="appel-loading-grid" aria-label="Chargement des gardes">{[1, 2, 3, 4].map((item) => <div className="appel-guard-skeleton" key={item} />)}</div>
          ) : visible.length === 0 ? (
            <StatePanel tone="neutral" icon={Filter} title={filtersActive ? 'Aucun résultat' : "Aucune garde à pointer aujourd'hui"}>{filtersActive ? 'Modifiez ou effacez les filtres pour retrouver les personnels de garde.' : overview?.activeSchedules?.length ? `${overview.activeSchedules.length} planning(s) sont en cours, mais personne n'est de service aujourd'hui.` : "Aucun planning n'est en cours dans votre périmètre."}</StatePanel>
          ) : (
            <div className="appel-guards-grid">
              {visible.map((guard) => {
                const key = guardKey(guard);
                return <GuardCard key={key} guard={guard} declaration={declared[key]} busy={busyKey === key} mutationBusy={markPresent.isPending || reportAbsence.isPending} isNew={liveArrivalKeys.has(key)} onMark={onMark} />;
              })}
            </div>
          )}

          <div className="appel-usage-note"><ClipboardCheck size={16} /><p>Une ligne déjà pointée est verrouillée. Les présences alimentent le journal ; les retards et absences créent également une alerte et une notification pour l’agent.</p></div>
        </section>
      )}

      {pending && <ReasonModal mark={pending.mark} guard={pending.guard} busy={reportAbsence.isPending} onClose={() => !reportAbsence.isPending && setPending(null)} onConfirm={({ reason, isJustified, lateMinutes }) => { setBusyKey(guardKey(pending.guard)); reportAbsence.mutate({ guard: pending.guard, mark: pending.mark, reason, isJustified, lateMinutes }); }} />}
    </div>
  );
}
