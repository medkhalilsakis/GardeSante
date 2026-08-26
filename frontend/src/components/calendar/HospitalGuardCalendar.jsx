/**
 * Calendrier des gardes de tout l'hôpital — lecture seule.
 * Toutes les gardes de tous les services, filtrables par service et par état de
 * planning. La portée est déduite du rôle côté serveur : le chef voit son
 * service, le directeur son hôpital, le Super Admin l'hôpital qu'il cible.
 *
 * CODE COULEUR — chaque case porte UNE BARRE HORIZONTALE PAR PLANNING présent
 * ce jour-là. Le filet gauche de la barre donne l'état du planning (en vigueur
 * / en cours / terminé / brouillon), le corps de la barre donne le service.
 * Plusieurs plannings le même jour ⇒ plusieurs barres empilées : c'est ce qui
 * permet de suivre plusieurs gardes simultanées. Le fond de case porte une
 * intensité de densité, teintée par l'état dominant du jour.
 *
 * Les teintes ne sont plus déclarées ici : les états viennent de
 * `PLANNING_STATE_COLOR` (le badge de planning et cette case doivent parler la
 * même langue, et une palette recopiée finit par diverger), les services de
 * l'échelle d'identité (`--gs-id-1` à `--gs-id-10`). Un service n'est pas un
 * état : il se distingue, il ne signale rien.
 *
 * Conventions d'affichage reprises de VisualCalendar.jsx (grille alignée lundi,
 * libellés fr-FR, marquage du week-end et du jour courant).
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hospitalCalendarAPI } from '../../api';
import PlanningStateBadge, { PLANNING_STATES, PLANNING_STATE_COLOR } from '../planning/PlanningStateBadge';
import { frenchRange, fullFrenchDate } from '../../utils/frenchDates';
import './HospitalGuardCalendar.css';

const DOW_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const STATE_FILTERS = [
  { value: '', label: 'Tous les états' },
  { value: 'soumis', label: 'En vigueur' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'suspendu', label: 'Suspendus' },
];

/** Bornes du mois affiché, en chaînes 'YYYY-MM-DD' (jamais de Date pour les bornes). */
const monthBounds = (year, month) => {
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}` };
};

/** Grille du mois alignée sur lundi, cases vides comprises. */
const buildGrid = (year, month) => {
  const pad = (n) => String(n).padStart(2, '0');
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, date: `${year}-${pad(month + 1)}-${pad(d)}`, dow: (offset + d - 1) % 7 });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
};

/** Ordre de lecture des états : le service en cours d'abord, l'archive en dernier. */
const STATE_ORDER = ['en_cours', 'soumis', 'suspendu', 'brouillon', 'termine'];

const stateLabel = (state) => (PLANNING_STATES[state] || PLANNING_STATES.brouillon).label;
const stateTone = (state) => PLANNING_STATE_COLOR[state] || PLANNING_STATE_COLOR.brouillon;

/**
 * Couleur d'un service, prise sur l'échelle d'identité de la plateforme. Dix
 * teintes conçues pour se distinguer entre elles sans signifier quoi que ce
 * soit : un hôpital qui aligne douze services voit les deux derniers reprendre
 * les premières, ce qui reste préférable à une teinte inventée.
 */
const DEPARTMENT_TONES = [
  'var(--gs-id-1)', 'var(--gs-id-2)', 'var(--gs-id-3)', 'var(--gs-id-4)', 'var(--gs-id-5)',
  'var(--gs-id-6)', 'var(--gs-id-7)', 'var(--gs-id-8)', 'var(--gs-id-9)', 'var(--gs-id-10)',
];
const departmentTone = (id, departments) => {
  const found = departments.findIndex((d) => d.id === id);
  const index = found >= 0 ? found : 0;
  return DEPARTMENT_TONES[index % DEPARTMENT_TONES.length];
};

/**
 * Un segment par planning présent ce jour-là : c'est l'unité d'affichage des
 * barres horizontales. Trié par état (en cours d'abord) puis par nom, pour que
 * l'ordre des barres ne saute pas d'un jour à l'autre.
 */
const daySegments = (info) => {
  const guards = info?.guards || [];
  if (!guards.length) return [];
  const bySchedule = new Map();
  for (const g of guards) {
    const key = g.scheduleId || g.scheduleName || 'planning';
    if (!bySchedule.has(key)) {
      bySchedule.set(key, {
        key,
        name: g.scheduleName || 'Planning',
        state: g.state || 'brouillon',
        departmentName: g.departmentName || null,
        count: 0,
      });
    }
    bySchedule.get(key).count += 1;
  }
  return [...bySchedule.values()].sort((a, b) => {
    const rank = STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state);
    return rank !== 0 ? rank : a.name.localeCompare(b.name, 'fr');
  });
};

/**
 * État dominant du jour — celui qui porte le plus de gardes, `STATE_ORDER`
 * tranchant les égalités. C'est lui qui teinte le fond de la case.
 */
const dominantSegment = (segments) => (segments || []).reduce((best, s) => {
  if (!best) return s;
  if (s.count !== best.count) return s.count > best.count ? s : best;
  return STATE_ORDER.indexOf(s.state) < STATE_ORDER.indexOf(best.state) ? s : best;
}, null);

/**
 * Densité du jour, en pourcentage de teinte à mélanger au papier : 10 % pour un
 * jour à peine occupé, 40 % pour le jour de pic du mois. Le mélange se fait en
 * CSS — ici on ne calcule qu'un nombre.
 */
const densityFill = (count, peak) => {
  if (!count) return 0;
  const ratio = peak > 0 ? count / peak : 0;
  return Math.round(10 + ratio * 30);
};

const todayStr = () => {
  const n = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
};

export default function HospitalGuardCalendar({ establishmentId, title = 'Calendrier des gardes — hôpital' }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [deptFilter, setDeptFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);

  const { from, to } = useMemo(() => monthBounds(year, month), [year, month]);
  const params = useMemo(() => {
    const p = { from, to };
    if (deptFilter) p.departmentId = deptFilter;
    if (stateFilter) p.state = stateFilter;
    if (establishmentId) p.establishmentId = establishmentId;
    return p;
  }, [from, to, deptFilter, stateFilter, establishmentId]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hospital-calendar', params],
    queryFn: () => hospitalCalendarAPI.get(params),
  });

  const payload = data?.data?.data;
  const days = payload?.days || [];
  const departments = payload?.departments || [];
  const schedules = payload?.schedules || [];
  const holidays = payload?.holidays || [];
  const summary = payload?.summary || {};

  const byDate = useMemo(() => {
    const m = {};
    days.forEach((d) => { m[d.date] = d; });
    return m;
  }, [days]);
  const holidaysByDate = useMemo(() => {
    const map = {};
    holidays.forEach((holiday) => {
      const cursor = new Date(`${holiday.start_date}T12:00:00`);
      const end = new Date(`${holiday.end_date}T12:00:00`);
      while (cursor <= end) {
        const key = cursor.toISOString().slice(0, 10);
        map[key] = holiday;
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [holidays]);

  // Segments (= plannings) de chaque jour, calculés une fois par chargement.
  const segmentsByDate = useMemo(() => {
    const m = {};
    days.forEach((d) => { m[d.date] = daySegments(d); });
    return m;
  }, [days]);

  // États réellement présents dans la fenêtre : la légende ne montre que ceux-là.
  // Elle en listait trois en dur, y compris ceux qu'aucune case ne portait — un
  // mois de brouillons annonçait « en vigueur, en cours, suspendu ».
  const statesPresent = useMemo(() => {
    const seen = new Set();
    (schedules || []).forEach((s) => { if (s.state) seen.add(s.state); });
    return STATE_ORDER.filter((s) => seen.has(s));
  }, [schedules]);

  const grid = useMemo(() => buildGrid(year, month), [year, month]);
  const peak = summary.peakPerDay || 0;
  const today = todayStr();
  const monthLabel = new Date(year, month, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const shiftMonth = (delta) => {
    setSelectedDay(null);
    const m = month + delta;
    if (m < 0) { setMonth(11); setYear(year - 1); }
    else if (m > 11) { setMonth(0); setYear(year + 1); }
    else setMonth(m);
  };

  const detail = selectedDay ? byDate[selectedDay] : null;

  return (
    <div className="gsc">
      {/* Barre de navigation et filtres */}
      <div className="gsc-bar">
        <div className="gsc-bar__id">
          <h3 className="gsc-bar__title">{title}</h3>
          <p className="gsc-bar__sub">Consultation seule — aucune modification depuis cet écran</p>
        </div>

        <div className="gsc-nav">
          <button type="button" onClick={() => shiftMonth(-1)} className="gs-btn" title="Mois précédent">‹</button>
          <span className="gsc-nav__month">{monthLabel}</span>
          <button type="button" onClick={() => shiftMonth(1)} className="gs-btn" title="Mois suivant">›</button>
        </div>

        <select
          value={deptFilter}
          onChange={(e) => { setDeptFilter(e.target.value); setSelectedDay(null); }}
          className="gsc-select"
          aria-label="Filtrer par service"
        >
          <option value="">Tous les services</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name} ({d.guards})</option>
          ))}
        </select>

        <select
          value={stateFilter}
          onChange={(e) => { setStateFilter(e.target.value); setSelectedDay(null); }}
          className="gsc-select is-narrow"
          aria-label="Filtrer par état de planning"
        >
          {STATE_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Indicateurs */}
      <div className="gsc-kpis">
        {[
          { label: 'Gardes', value: summary.totalGuards ?? 0 },
          { label: 'Jours couverts', value: summary.daysCovered ?? 0 },
          { label: 'Agents', value: summary.staffCount ?? 0 },
          { label: 'Plannings', value: summary.schedulesCount ?? 0 },
          { label: 'Pic / jour', value: summary.peakPerDay ?? 0 },
        ].map((k) => (
          <div key={k.label} className="gsc-kpi">
            <p className="gsc-kpi__label">{k.label}</p>
            <p className="gsc-kpi__value">{k.value}</p>
          </div>
        ))}
      </div>

      {isError ? (
        <div className="gsc-state is-error">Le calendrier n'a pas pu être chargé.</div>
      ) : isLoading ? (
        <div className="gsc-state">Chargement du calendrier…</div>
      ) : (
        <>
          {/* Grille du mois */}
          <div className="gs-card gsc-panel">
            <div className="gsc-dow">
              {DOW_LABELS.map((d, i) => (
                <div key={d} className={`gsc-dow__cell${i >= 5 ? ' is-weekend' : ''}`}>{d}</div>
              ))}
            </div>
            <div className="gsc-grid">
              {grid.map((cell, i) => {
                if (!cell) return <div key={`empty-${i}`} />;
                const info = byDate[cell.date];
                const count = info?.guards?.length || 0;
                const segments = segmentsByDate[cell.date] || [];
                const isToday = cell.date === today;
                const isSelected = cell.date === selectedDay;
                const isWeekend = cell.dow >= 5;
                const holiday = holidaysByDate[cell.date];
                const dominant = dominantSegment(segments);
                // Une ligne par planning : « nom — état · n garde(s) ».
                const hint = count
                  ? segments
                      .map((s) => `${s.name}${s.departmentName ? ` (${s.departmentName})` : ''} — ${stateLabel(s.state)} · ${s.count} garde(s)`)
                      .join('\n')
                  : 'Aucune garde';
                const cellClass = [
                  'gsc-cell',
                  count ? 'is-filled' : '',
                  isWeekend ? 'is-weekend' : '',
                  holiday ? 'is-holiday' : '',
                  isToday ? 'is-today' : '',
                  isSelected ? 'is-selected' : '',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    type="button"
                    key={cell.date}
                    onClick={() => setSelectedDay(count ? (isSelected ? null : cell.date) : null)}
                    title={hint}
                    className={cellClass}
                    style={{
                      '--gsc-tone': stateTone(dominant?.state),
                      '--gsc-fill': densityFill(count, peak),
                    }}
                  >
                    <div className="gsc-cell__head">
                      <span className={`gsc-cell__day${isWeekend ? ' is-weekend' : ''}${isToday ? ' is-today' : ''}`}>
                        {cell.day}
                      </span>
                      {holiday && <span className="gsc-cell__holiday" title={holiday.name}>Férié</span>}
                      {count > 0 && <span className="gsc-cell__count">{count}</span>}
                    </div>
                    {/* Une barre par planning : deux plannings le même jour ⇒
                        deux barres de couleurs différentes, empilées. */}
                    {count > 0 && (
                      <div className="gsc-bars">
                        {segments.slice(0, 3).map((s) => {
                          const dept = info?.guards?.find((g) => (g.scheduleId || g.scheduleName) === s.key)?.departmentId;
                          const rowTones = {
                            '--gsc-state': stateTone(s.state),
                            '--gsc-id': departmentTone(dept, departments),
                          };
                          return (
                            <span key={s.key} className="gsc-bar-row" style={rowTones}>
                              <span className="gsc-bar-line" />
                              <span className="gsc-bar-count">{s.count}</span>
                            </span>
                          );
                        })}
                        {segments.length > 3 && (
                          <span className="gsc-bar-more">+{segments.length - 3} planning(s)</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Légende — n'affiche que les états réellement présents. */}
            {(statesPresent.length > 0 || departments.length > 0) && (
              <div className="gsc-legend">
                {statesPresent.length > 0 && (
                  <>
                    <span className="gsc-legend__label">État des plannings</span>
                    {statesPresent.map((s) => (
                      <span key={s} className="gsc-legend__item" style={{ '--gsc-tone': stateTone(s) }}>
                        <span className="gsc-legend__bar" />
                        <span className="gsc-legend__text">{stateLabel(s)}</span>
                      </span>
                    ))}
                  </>
                )}
                {statesPresent.length > 0 && departments.length > 0 && <span className="gsc-legend__sep" />}
                {departments.map((d) => (
                  <span key={d.id} className="gsc-legend__item" style={{ '--gsc-id': departmentTone(d.id, departments) }}>
                    <span className="gsc-legend__diamond" />
                    <span className="gsc-legend__text is-small">{d.name}</span>
                  </span>
                ))}
                <span className="gsc-legend__note">Bordure double : jour férié</span>
                <span className="gsc-legend__note">Bordure interrompue : week-end</span>
              </div>
            )}
          </div>

          {/* Détail du jour sélectionné */}
          {detail && (
            <div className="gs-card gsc-detail">
              <div className="gsc-detail__head">
                <h4 className="gsc-detail__title">
                  {/* Le titre affichait la clé du jour telle quelle
                      (« 2026-08-24 ») : c'était la dernière date ISO visible
                      dans cet écran. */}
                  {detail.guards.length} garde(s) — {fullFrenchDate(detail.date)}
                </h4>
                <button type="button" onClick={() => setSelectedDay(null)} className="gs-btn">Fermer</button>
              </div>
              <div className="gsc-list">
                {detail.guards.map((g, i) => (
                  <div key={i} className="gsc-guard">
                    <span className="gsc-guard__name">{g.name}</span>
                    {g.scheduleName && <span className="gsc-guard__meta">· {g.scheduleName}</span>}
                    {g.roleName && <span className="gsc-guard__meta">{g.roleName}</span>}
                    {g.departmentName && (
                      <span className="gsc-guard__dept" style={{ '--gsc-id': departmentTone(g.departmentId, departments) }}>
                        {g.departmentName}
                      </span>
                    )}
                    {/* La ligne affichait `g.label` deux fois — « Selima Selima
                        De service · Planning août 2026 … De service ». Une seule
                        mention subsiste, celle qui porte le repli. */}
                    <span className="gsc-guard__label">{g.label || 'De service'}</span>
                    {g.state && <PlanningStateBadge state={g.state} size="sm" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plannings représentés dans la fenêtre */}
          {schedules.length > 0 && (
            <div className="gs-card gsc-plans">
              <h4 className="gsc-plans__title">Plannings couvrant la période ({schedules.length})</h4>
              <div className="gsc-list">
                {schedules.map((s) => (
                  <div key={s.id} className="gsc-plan">
                    <span className="gsc-plan__name">{s.name}</span>
                    {s.departmentName && <span>· {s.departmentName}</span>}
                    {/* La période était affichée telle qu'elle arrive du serveur
                        (« 2026-08-24 → 2026-08-31 ») : la seule date ISO qui
                        restait visible dans le calendrier. */}
                    <span>· {frenchRange(s.startDate, s.endDate)}</span>
                    <PlanningStateBadge state={s.state} size="sm" />
                    <span className="gsc-plan__count">{s.guards} garde(s)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {days.length === 0 && (
            <div className="gsc-empty">Aucune garde sur cette période avec les filtres actuels</div>
          )}
        </>
      )}
    </div>
  );
}
