import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Filter,
  History,
  LayoutList,
  RotateCcw,
  Search,
  SearchX,
  Timer,
  UserRound,
  UserX,
  UsersRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { absencesAPI, absencesShiftAPI, journalAPI } from '../../../api';
import { JustificationBadge } from '../../../components/common/JustificationChoice';
import HistoryCatchupModal from './HistoryCatchupModal';
import './AppelHistoryPanel.css';

/** Le serveur plafonne `limit` à 300 : on le demande explicitement. */
const MAX_EVENTS = 300;

const MARKS = {
  presence: { label: 'Présent', tone: 'success', icon: CheckCircle2 },
  late: { label: 'Retard', tone: 'warning', icon: Clock3 },
  absence: { label: 'Absent', tone: 'danger', icon: UserX },
  pending: { label: 'Non pointé', tone: 'pending', icon: AlertTriangle },
};

/** Date locale en `YYYY-MM-DD` : jamais `toISOString`, qui peut décaler d'un jour. */
const dayKey = (date) => {
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const shiftDays = (number) => {
  const date = new Date();
  date.setDate(date.getDate() + number);
  return dayKey(date);
};

const LONG_DATE = (iso) => {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

const SHORT_DATE = (iso) => {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

/** Durée du retard : `metadata` d'abord, titre en repli. */
const lateMinutesOf = (event) => {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
  const parsed = Number.parseInt(metadata?.lateMinutes, 10);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  const titleMatch = /(\d+)\s*min/i.exec(String(event.title || ''));
  return titleMatch ? Number.parseInt(titleMatch[1], 10) : null;
};

const justificationOf = (event) => {
  if (typeof event.isJustified === 'boolean') return event.isJustified;
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
  return typeof metadata?.isJustified === 'boolean' ? metadata.isJustified : null;
};

const durationLabel = (minutes) => {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} h ${String(remainder).padStart(2, '0')}` : `${hours} h`;
};

const PRESETS = [
  { key: 'today', label: "Aujourd'hui", from: () => dayKey(new Date()), to: () => dayKey(new Date()) },
  { key: '7', label: '7 derniers jours', from: () => shiftDays(-6), to: () => dayKey(new Date()) },
  { key: '30', label: '30 derniers jours', from: () => shiftDays(-29), to: () => dayKey(new Date()) },
  { key: 'custom', label: 'Intervalle', from: null, to: null },
];

function PresetButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`appel-history-preset ${active ? 'is-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function StatusCount({ mark, count, compact = false }) {
  const metadata = MARKS[mark];
  const Icon = metadata.icon;
  return (
    <span
      className={`appel-history-count is-${metadata.tone} ${compact ? 'is-compact' : ''}`}
      title={compact ? `${count} ${metadata.label.toLowerCase()}${count > 1 ? 's' : ''}` : undefined}
    >
      <Icon size={compact ? 13 : 15} aria-hidden="true" />
      <strong>{count}</strong>
      {!compact && <span>{metadata.label}</span>}
    </span>
  );
}

function StatusBadge({ mark }) {
  const metadata = MARKS[mark];
  const Icon = metadata.icon;
  return (
    <span className={`appel-history-status is-${metadata.tone}`}>
      <Icon size={14} aria-hidden="true" />
      {metadata.label}
    </span>
  );
}

function ResultState({ tone = 'neutral', icon: Icon, title, children, action }) {
  return (
    <div className={`appel-history-state is-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="appel-history-state-icon"><Icon size={22} aria-hidden="true" /></span>
      <strong>{title}</strong>
      <p>{children}</p>
      {action}
    </div>
  );
}

export default function AppelHistoryPanel() {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState('7');
  const [customFrom, setCustomFrom] = useState(shiftDays(-6));
  const [customTo, setCustomTo] = useState(dayKey(new Date()));
  const [groupBy, setGroupBy] = useState('schedule');
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [markFilter, setMarkFilter] = useState('');
  const [search, setSearch] = useState('');
  const [pendingAction, setPendingAction] = useState(null);

  const activePreset = PRESETS.find((item) => item.key === preset) || PRESETS[1];
  const from = activePreset.from ? activePreset.from() : customFrom;
  const to = activePreset.to ? activePreset.to() : customTo;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journal', 'appel-history', from, to],
    queryFn: () => journalAPI.getEvents({
      type: 'presence,absence,late',
      from,
      to,
      limit: MAX_EVENTS,
    }),
  });

  const { data: callsData, isLoading: callsLoading, isError: callsError } = useQuery({
    queryKey: ['journal', 'appel-calls', from, to],
    queryFn: () => journalAPI.getCalls({ from, to }),
  });

  const { data: typesResponse } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => absencesAPI.getTypes(),
  });

  const events = useMemo(() => data?.data?.data?.events || [], [data]);
  const scopeLabel = data?.data?.data?.scopeLabel;
  const truncated = events.length >= MAX_EVENTS;
  const callInfo = useMemo(() => callsData?.data?.data || {}, [callsData]);
  const serverToday = callInfo.today || dayKey(new Date());
  const missing = useMemo(() => (callInfo.calls || [])
    .filter((call) => call.date < serverToday && !call.isDeclared)
    .map((call) => ({
      ...call,
      id: `pending:${call.key}`,
      type: 'pending',
      reporterName: null,
    })), [callInfo, serverToday]);
  const absenceTypes = (typesResponse?.data?.data || []).filter((type) => !type.is_leave);
  const lateType = absenceTypes.find((type) => type.code === 'retard' || /retard/i.test(type.name || ''));
  const absentType = absenceTypes.find((type) => type.code === 'absence_injustifiee')
    || absenceTypes.find((type) => !/retard/i.test(type.name || ''));

  const schedules = useMemo(() => {
    const scheduleMap = new Map();
    [...events, ...missing].forEach((event) => {
      const id = event.scheduleId || '__none__';
      if (!scheduleMap.has(id)) scheduleMap.set(id, event.scheduleName || 'Hors planning');
    });
    return [...scheduleMap.entries()].sort((first, second) => first[1].localeCompare(second[1], 'fr'));
  }, [events, missing]);

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return [...events, ...missing]
      .filter((event) => MARKS[event.type])
      .filter((event) => !scheduleFilter || (event.scheduleId || '__none__') === scheduleFilter)
      .filter((event) => !markFilter || event.type === markFilter)
      .filter((event) => {
        if (!normalizedSearch) return true;
        return (event.userName || '').toLowerCase().includes(normalizedSearch)
          || (event.reporterName || '').toLowerCase().includes(normalizedSearch)
          || (event.scheduleName || '').toLowerCase().includes(normalizedSearch)
          || (event.departmentName || '').toLowerCase().includes(normalizedSearch);
      })
      .map((event) => ({
        ...event,
        lateMinutes: event.type === 'late' ? lateMinutesOf(event) : null,
        isJustified: ['late', 'absence'].includes(event.type) ? justificationOf(event) : null,
      }));
  }, [events, missing, scheduleFilter, markFilter, search]);

  const totals = useMemo(() => {
    const values = { presence: 0, late: 0, absence: 0, pending: 0 };
    rows.forEach((row) => { values[row.type] += 1; });
    return values;
  }, [rows]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['journal', 'appel-history'] });
    queryClient.invalidateQueries({ queryKey: ['journal', 'appel-calls'] });
    queryClient.invalidateQueries({ queryKey: ['journal-overview'] });
    queryClient.invalidateQueries({ queryKey: ['journal-alerts'] });
    queryClient.invalidateQueries({ queryKey: ['shift-absences'] });
  };

  const catchup = useMutation({
    mutationFn: async ({ call, mark, details = {} }) => {
      if (mark === 'presence') {
        return journalAPI.addEvent({
          departmentId: call.departmentId,
          scheduleId: call.scheduleId,
          eventType: 'presence',
          userId: call.userId,
          dutyDate: call.date,
          severity: 'info',
          title: `Présence rattrapée — ${call.userName}`,
          description: `Déclaration tardive pour la garde du ${SHORT_DATE(call.date)}`,
        });
      }
      const type = mark === 'late' ? lateType : absentType;
      return absencesShiftAPI.report({
        userId: call.userId,
        scheduleId: call.scheduleId,
        date: call.date,
        absenceTypeId: type?.id,
        absenceKind: mark === 'late' ? 'late' : 'absence',
        reason: details.reason || undefined,
        isJustified: details.isJustified,
        severity: mark === 'late' ? 'info' : 'warning',
        lateMinutes: mark === 'late' && details.lateMinutes !== '' ? Number(details.lateMinutes) : undefined,
      });
    },
    onSuccess: (_response, variables) => {
      toast.success(`${MARKS[variables.mark].label} enregistré(e) pour le ${SHORT_DATE(variables.call.date)}`);
      setPendingAction(null);
      refresh();
    },
    onError: (mutationError) => toast.error(mutationError?.response?.data?.message || 'Rattrapage impossible'),
  });

  const startCatchup = (call, mark) => {
    if (mark === 'presence') {
      catchup.mutate({ call, mark });
    } else {
      setPendingAction({ call, mark });
    }
  };

  const groups = useMemo(() => {
    const groupMap = new Map();
    rows.forEach((row) => {
      const key = groupBy === 'day' ? (row.date || '—') : (row.scheduleId || '__none__');
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          title: groupBy === 'day' ? LONG_DATE(row.date) : (row.scheduleName || 'Hors planning'),
          subtitle: groupBy === 'day' ? null : (row.departmentName || null),
          items: [],
        });
      }
      groupMap.get(key).items.push(row);
    });
    const values = [...groupMap.values()];
    return groupBy === 'day'
      ? values.sort((first, second) => String(second.key).localeCompare(String(first.key)))
      : values.sort((first, second) => first.title.localeCompare(second.title, 'fr'));
  }, [rows, groupBy]);

  const filtersActive = Boolean(scheduleFilter || markFilter || search.trim());
  const resetFilters = () => {
    setScheduleFilter('');
    setMarkFilter('');
    setSearch('');
  };

  return (
    <div className="appel-history-panel">
      <section className="appel-history-command" aria-labelledby="appel-history-controls-title">
        <header className="appel-history-command-header">
          <span className="appel-history-command-icon"><Filter size={18} aria-hidden="true" /></span>
          <div>
            <span>Exploration de l'historique</span>
            <h3 id="appel-history-controls-title">Affiner les déclarations</h3>
            <p>Choisissez une période, puis croisez garde, état et personnel.</p>
          </div>
          <span className="appel-history-range"><CalendarRange size={14} />{SHORT_DATE(from)}<ArrowRight size={12} />{SHORT_DATE(to)}</span>
        </header>

        <div className="appel-history-period-row">
          <div className="appel-history-control-label">
            <CalendarDays size={15} aria-hidden="true" />
            <span>Période</span>
          </div>
          <div className="appel-history-presets" role="group" aria-label="Période de l'historique">
            {PRESETS.map((item) => (
              <PresetButton key={item.key} active={preset === item.key} onClick={() => setPreset(item.key)}>
                {item.label}
              </PresetButton>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="appel-history-custom-range">
              <label>
                <span>Du</span>
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={(event) => setCustomFrom(event.target.value)}
                />
              </label>
              <ArrowRight size={14} aria-hidden="true" />
              <label>
                <span>Au</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  onChange={(event) => setCustomTo(event.target.value)}
                />
              </label>
            </div>
          )}
        </div>

        <div className="appel-history-filter-grid">
          <label className="appel-history-field appel-history-search">
            <span className="appel-history-visually-hidden">Rechercher dans l'historique</span>
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              placeholder="Agent, déclarant, service…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <label className="appel-history-field">
            <span className="appel-history-visually-hidden">Filtrer par garde</span>
            <ClipboardCheck size={16} aria-hidden="true" />
            <select value={scheduleFilter} onChange={(event) => setScheduleFilter(event.target.value)}>
              <option value="">Toutes les gardes</option>
              {schedules.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>

          <label className="appel-history-field">
            <span className="appel-history-visually-hidden">Filtrer par état</span>
            <Filter size={16} aria-hidden="true" />
            <select value={markFilter} onChange={(event) => setMarkFilter(event.target.value)}>
              <option value="">Tous les états</option>
              {Object.entries(MARKS).map(([key, metadata]) => (
                <option key={key} value={key}>{metadata.label}</option>
              ))}
            </select>
          </label>

          {filtersActive && (
            <button type="button" className="appel-history-reset" onClick={resetFilters}>
              <RotateCcw size={14} aria-hidden="true" />Réinitialiser
            </button>
          )}
        </div>

        <div className="appel-history-group-row">
          <div className="appel-history-control-label">
            <LayoutList size={15} aria-hidden="true" />
            <span>Regrouper</span>
          </div>
          <div className="appel-history-segmented" role="group" aria-label="Regrouper les résultats">
            <button
              type="button"
              className={groupBy === 'schedule' ? 'is-active' : ''}
              aria-pressed={groupBy === 'schedule'}
              onClick={() => setGroupBy('schedule')}
            >
              <ClipboardCheck size={14} />Par garde
            </button>
            <button
              type="button"
              className={groupBy === 'day' ? 'is-active' : ''}
              aria-pressed={groupBy === 'day'}
              onClick={() => setGroupBy('day')}
            >
              <CalendarDays size={14} />Par jour
            </button>
          </div>
          <span className="appel-history-scope">
            <Building2 size={13} aria-hidden="true" />{scopeLabel || 'Périmètre autorisé'}
          </span>
        </div>

        <div className="appel-history-summary" aria-label="Synthèse des résultats filtrés">
          <div className="appel-history-total">
            <UsersRound size={17} aria-hidden="true" />
            <div><strong>{rows.length}</strong><span>déclaration{rows.length > 1 ? 's' : ''} dans la vue</span></div>
          </div>
          <StatusCount mark="presence" count={totals.presence} />
          <StatusCount mark="late" count={totals.late} />
          <StatusCount mark="absence" count={totals.absence} />
          <StatusCount mark="pending" count={totals.pending} />
        </div>

        {truncated && (
          <div className="appel-history-limit-alert" role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <p>Affichage limité aux {MAX_EVENTS} déclarations les plus récentes. Resserrez la période pour tout consulter.</p>
          </div>
        )}
      </section>

      {(isError || callsError) ? (
        <ResultState
          tone="danger"
          icon={UserX}
          title="Historique indisponible"
          action={<button type="button" onClick={refresh}><RotateCcw size={14} />Réessayer</button>}
        >
          {error?.response?.status === 403
            ? "Votre rôle ne donne pas accès à l'historique des appels."
            : "L'historique des appels n'a pas pu être chargé."}
        </ResultState>
      ) : (isLoading || callsLoading) ? (
        <div className="appel-history-loading" role="status" aria-label="Chargement de l'historique">
          {[1, 2, 3].map((item) => <span key={item} />)}
        </div>
      ) : !groups.length ? (
        <ResultState
          icon={SearchX}
          title={filtersActive ? 'Aucun résultat pour ces filtres' : 'Aucun appel sur cette période'}
          action={filtersActive ? <button type="button" onClick={resetFilters}><RotateCcw size={14} />Effacer les filtres</button> : null}
        >
          {filtersActive
            ? 'Modifiez les critères pour retrouver une déclaration ou un jour à rattraper.'
            : "Les pointages faits depuis l'onglet Appel d'aujourd'hui apparaissent ici immédiatement."}
        </ResultState>
      ) : (
        <div className="appel-history-groups">
          {groups.map((group, groupIndex) => {
            const groupTotals = { presence: 0, late: 0, absence: 0, pending: 0 };
            group.items.forEach((item) => { groupTotals[item.type] += 1; });
            const GroupIcon = groupBy === 'day' ? CalendarDays : ClipboardCheck;
            const titleId = `appel-history-group-${groupIndex}`;

            return (
              <section className="appel-history-group" key={group.key} aria-labelledby={titleId}>
                <header className="appel-history-group-header">
                  <span className="appel-history-group-icon"><GroupIcon size={17} aria-hidden="true" /></span>
                  <div className="appel-history-group-copy">
                    <h3 id={titleId}>{group.title}</h3>
                    <p>{group.subtitle || `${group.items.length} entrée${group.items.length > 1 ? 's' : ''}`}</p>
                  </div>
                  <div className="appel-history-group-counts" aria-label="Répartition du groupe">
                    <StatusCount mark="presence" count={groupTotals.presence} compact />
                    <StatusCount mark="late" count={groupTotals.late} compact />
                    <StatusCount mark="absence" count={groupTotals.absence} compact />
                    <StatusCount mark="pending" count={groupTotals.pending} compact />
                  </div>
                </header>

                <div className="appel-history-table-wrap">
                  <table className="appel-history-table">
                    <caption className="appel-history-visually-hidden">Déclarations pour {group.title}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Personnel concerné</th>
                        <th scope="col">État déclaré</th>
                        <th scope="col">{groupBy === 'day' ? 'Garde' : 'Date'}</th>
                        <th scope="col">Déclaré par</th>
                        <th scope="col">Horodatage / action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((event) => {
                        const markMetadata = MARKS[event.type];
                        return (
                          <tr className={`is-${markMetadata.tone}`} key={event.id}>
                            <td data-label="Personnel concerné">
                              <div className="appel-history-person">
                                <span><UserRound size={16} aria-hidden="true" /></span>
                                <div>
                                  <strong>{event.userName || '—'}</strong>
                                  {event.departmentName && groupBy === 'day' && <small><Building2 size={11} />{event.departmentName}</small>}
                                </div>
                              </div>
                            </td>
                            <td data-label="État déclaré">
                              <div className="appel-history-status-stack">
                                <div>
                                  <StatusBadge mark={event.type} />
                                  {event.type === 'late' && (
                                    <span className="appel-history-duration"><Timer size={12} />{durationLabel(event.lateMinutes) || 'Durée non précisée'}</span>
                                  )}
                                  {['late', 'absence'].includes(event.type) && typeof event.isJustified === 'boolean' && (
                                    <span className="appel-history-justification"><JustificationBadge value={event.isJustified} /></span>
                                  )}
                                </div>
                                {event.type === 'pending' && <small className="appel-history-pending-copy">Aucune déclaration enregistrée</small>}
                                {event.description && <p>{event.description}</p>}
                              </div>
                            </td>
                            <td data-label={groupBy === 'day' ? 'Garde' : 'Date'}>
                              <span className="appel-history-cell-detail">
                                {groupBy === 'day' ? <ClipboardCheck size={14} /> : <CalendarDays size={14} />}
                                {groupBy === 'day' ? (event.scheduleName || 'Hors planning') : SHORT_DATE(event.date)}
                              </span>
                            </td>
                            <td data-label="Déclaré par">
                              <span className="appel-history-cell-detail">
                                <UserRound size={14} />
                                {event.reporterName || (event.type === 'pending' ? 'À rattraper' : '—')}
                              </span>
                            </td>
                            <td data-label="Horodatage / action">
                              {event.type === 'pending' ? (
                                <div className="appel-history-catchup-actions">
                                  <button
                                    type="button"
                                    className="is-success"
                                    disabled={catchup.isPending}
                                    onClick={() => startCatchup(event, 'presence')}
                                    aria-label={`Rattraper la présence de ${event.userName} le ${SHORT_DATE(event.date)}`}
                                  >
                                    <CheckCircle2 size={14} />Présent
                                  </button>
                                  <button
                                    type="button"
                                    className="is-warning"
                                    disabled={catchup.isPending}
                                    onClick={() => startCatchup(event, 'late')}
                                    aria-label={`Rattraper le retard de ${event.userName} le ${SHORT_DATE(event.date)}`}
                                  >
                                    <Clock3 size={14} />Retard
                                  </button>
                                  <button
                                    type="button"
                                    className="is-danger"
                                    disabled={catchup.isPending}
                                    onClick={() => startCatchup(event, 'absence')}
                                    aria-label={`Rattraper l'absence de ${event.userName} le ${SHORT_DATE(event.date)}`}
                                  >
                                    <UserX size={14} />Absent
                                  </button>
                                </div>
                              ) : (
                                <span className="appel-history-timestamp">
                                  <History size={13} />
                                  {event.declaredDate && event.declaredDate !== event.date
                                    ? `Garde ${SHORT_DATE(event.date)} · saisi ${SHORT_DATE(event.declaredDate)}`
                                    : SHORT_DATE(event.date)}
                                  {event.hour ? ` · ${event.hour}` : ''}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="appel-history-footnote">
        <History size={15} aria-hidden="true" />
        <p>Les déclarations existantes restent en lecture seule. Seules les gardes passées sans pointage peuvent recevoir leur première déclaration depuis cet historique.</p>
      </div>

      {pendingAction && (
        <HistoryCatchupModal
          call={pendingAction.call}
          mark={pendingAction.mark}
          busy={catchup.isPending}
          onClose={() => !catchup.isPending && setPendingAction(null)}
          onConfirm={(details) => catchup.mutate({ ...pendingAction, details })}
        />
      )}
    </div>
  );
}
