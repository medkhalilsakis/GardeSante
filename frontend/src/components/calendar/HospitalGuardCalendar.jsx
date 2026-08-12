/**
 * Calendrier des gardes de tout l'hôpital — lecture seule.
 * Toutes les gardes de tous les services, filtrables par service et par état de
 * planning. La portée est déduite du rôle côté serveur : le chef voit son
 * service, le directeur son hôpital, le Super Admin l'hôpital qu'il cible.
 *
 * CODE COULEUR — chaque case porte UNE BARRE HORIZONTALE PAR PLANNING présent
 * ce jour-là, colorée selon son état (en vigueur / en cours / terminé /
 * brouillon). Plusieurs plannings le même jour ⇒ plusieurs barres empilées :
 * c'est ce qui permet de suivre plusieurs gardes simultanées. Le fond de case
 * conserve une intensité de densité, mais teintée par l'état dominant du jour
 * au lieu d'un indigo uniforme.
 *
 * Conventions d'affichage reprises de VisualCalendar.jsx (grille alignée lundi,
 * libellés fr-FR, marquage du week-end et du jour courant).
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { hospitalCalendarAPI } from '../../api';
import PlanningStateBadge from '../planning/PlanningStateBadge';

const DOW_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const STATE_FILTERS = [
  { value: '', label: 'Tous les états' },
  { value: 'soumis', label: 'Soumis' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'termine', label: 'Terminés' },
  { value: 'brouillon', label: 'Brouillons' },
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

/**
 * Palette des états — reprise à l'identique de `PlanningStateBadge.jsx` pour que
 * la barre du calendrier et le badge du planning parlent la même langue.
 * `rgb` sert aux fonds translucides (la densité module l'alpha).
 */
const STATE_COLORS = {
  brouillon: { label: 'Brouillon',  color: '#8B5CF6', rgb: '139, 92, 246' },
  soumis:    { label: 'En vigueur', color: '#3B82F6', rgb: '59, 130, 246' },
  en_cours:  { label: 'En cours',   color: '#10B981', rgb: '16, 185, 129' },
  termine:   { label: 'Terminé',    color: '#6B7280', rgb: '107, 114, 128' },
};
const STATE_ORDER = ['en_cours', 'soumis', 'brouillon', 'termine'];

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
 * Couleur de fond : intensité par densité (comme avant), teinte par l'état
 * dominant du jour — celui qui porte le plus de gardes, `STATE_ORDER` tranchant
 * les égalités.
 */
const dominantSegment = (segments) => (segments || []).reduce((best, s) => {
  if (!best) return s;
  if (s.count !== best.count) return s.count > best.count ? s : best;
  return STATE_ORDER.indexOf(s.state) < STATE_ORDER.indexOf(best.state) ? s : best;
}, null);

const densityStyle = (count, peak, segments) => {
  if (!count) return { background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' };
  const rgb = (STATE_COLORS[dominantSegment(segments)?.state] || STATE_COLORS.brouillon).rgb;
  const ratio = peak > 0 ? count / peak : 0;
  const alpha = 0.10 + ratio * 0.30;
  return {
    background: `rgba(${rgb}, ${alpha.toFixed(2)})`,
    border: `1px solid rgba(${rgb}, 0.45)`,
  };
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
  const summary = payload?.summary || {};

  const byDate = useMemo(() => {
    const m = {};
    days.forEach((d) => { m[d.date] = d; });
    return m;
  }, [days]);

  // Segments (= plannings) de chaque jour, calculés une fois par chargement.
  const segmentsByDate = useMemo(() => {
    const m = {};
    days.forEach((d) => { m[d.date] = daySegments(d); });
    return m;
  }, [days]);

  // États réellement présents dans la fenêtre : la légende ne montre que ceux-là.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Barre de navigation et filtres */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
            Consultation seule — aucune modification depuis cet écran
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => shiftMonth(-1)} className="btn btn-secondary btn-sm" title="Mois précédent">‹</button>
          <span style={{
            minWidth: 150, textAlign: 'center', fontWeight: 700,
            fontSize: 'var(--font-sm)', color: 'var(--text-primary)', textTransform: 'capitalize',
          }}>
            {monthLabel}
          </span>
          <button onClick={() => shiftMonth(1)} className="btn btn-secondary btn-sm" title="Mois suivant">›</button>
        </div>

        <select
          value={deptFilter}
          onChange={(e) => { setDeptFilter(e.target.value); setSelectedDay(null); }}
          className="input"
          style={{ maxWidth: 200, fontSize: 'var(--font-xs)' }}
        >
          <option value="">Tous les services</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name} ({d.guards})</option>
          ))}
        </select>

        <select
          value={stateFilter}
          onChange={(e) => { setStateFilter(e.target.value); setSelectedDay(null); }}
          className="input"
          style={{ maxWidth: 170, fontSize: 'var(--font-xs)' }}
        >
          {STATE_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {/* Indicateurs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        {[
          { label: 'Gardes', value: summary.totalGuards ?? 0 },
          { label: 'Jours couverts', value: summary.daysCovered ?? 0 },
          { label: 'Agents', value: summary.staffCount ?? 0 },
          { label: 'Plannings', value: summary.schedulesCount ?? 0 },
          { label: 'Pic / jour', value: summary.peakPerDay ?? 0 },
        ].map((k) => (
          <div key={k.label} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--border-radius-sm)', padding: '10px 12px',
          }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{k.label}</p>
            <p style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>{k.value}</p>
          </div>
        ))}
      </div>

      {isError ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-danger)', fontSize: 'var(--font-sm)' }}>
          Le calendrier n'a pas pu être chargé.
        </div>
      ) : isLoading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
          Chargement du calendrier…
        </div>
      ) : (
        <>
          {/* Grille du mois */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--border-radius-lg)', padding: 12,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 6 }}>
              {DOW_LABELS.map((d, i) => (
                <div key={d} style={{
                  textAlign: 'center', fontSize: 10, fontWeight: 700,
                  color: i >= 5 ? 'var(--color-danger)' : 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '.04em', padding: '4px 0',
                }}>
                  {d}
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {grid.map((cell, i) => {
                if (!cell) return <div key={`empty-${i}`} />;
                const info = byDate[cell.date];
                const count = info?.guards?.length || 0;
                const segments = segmentsByDate[cell.date] || [];
                const isToday = cell.date === today;
                const isSelected = cell.date === selectedDay;
                // Une ligne par planning : « nom — état · n garde(s) ».
                const title = count
                  ? segments
                      .map((s) => `${s.name}${s.departmentName ? ` (${s.departmentName})` : ''} — ${(STATE_COLORS[s.state] || STATE_COLORS.brouillon).label} · ${s.count} garde(s)`)
                      .join('\n')
                  : 'Aucune garde';
                return (
                  <button
                    key={cell.date}
                    onClick={() => setSelectedDay(count ? (isSelected ? null : cell.date) : null)}
                    title={title}
                    style={{
                      minHeight: 74, padding: 6, textAlign: 'left',
                      borderRadius: 'var(--border-radius-sm)',
                      cursor: count ? 'pointer' : 'default',
                      fontFamily: 'inherit',
                      outline: isSelected ? '2px solid var(--color-primary-light)' : 'none',
                      ...densityStyle(count, peak, segments),
                      ...(isToday ? { borderColor: 'var(--color-primary-light)', borderWidth: 2 } : {}),
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{
                        fontSize: 'var(--font-xs)', fontWeight: isToday ? 800 : 600,
                        color: cell.dow >= 5 ? 'var(--color-danger)' : 'var(--text-primary)',
                      }}>
                        {cell.day}
                      </span>
                      {count > 0 && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: '#fff',
                          background: (STATE_COLORS[dominantSegment(segments)?.state] || STATE_COLORS.brouillon).color,
                          borderRadius: 10, padding: '1px 6px',
                        }}>
                          {count}
                        </span>
                      )}
                    </div>
                    {/* Une barre par planning : deux plannings le même jour ⇒
                        deux barres de couleurs différentes, empilées. */}
                    {count > 0 && (
                      <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {segments.slice(0, 3).map((s) => {
                          const c = STATE_COLORS[s.state] || STATE_COLORS.brouillon;
                          return (
                            <span key={s.key} style={{
                              display: 'flex', alignItems: 'center', gap: 3,
                            }}>
                              <span style={{
                                flex: 1, height: 4, borderRadius: 2,
                                background: c.color, minWidth: 0,
                              }} />
                              <span style={{ fontSize: 8, fontWeight: 700, color: c.color }}>
                                {s.count}
                              </span>
                            </span>
                          );
                        })}
                        {segments.length > 3 && (
                          <span style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600 }}>
                            +{segments.length - 3} planning(s)
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Légende — n'affiche que les états réellement présents. */}
            {statesPresent.length > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle)',
              }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>
                  État des plannings
                </span>
                {statesPresent.map((s) => (
                  <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ width: 18, height: 4, borderRadius: 2, background: STATE_COLORS[s].color }} />
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{STATE_COLORS[s].label}</span>
                  </span>
                ))}
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Une barre par planning · le chiffre indique le nombre de gardes
                </span>
              </div>
            )}
          </div>

          {/* Détail du jour sélectionné */}
          {detail && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-default)',
              borderRadius: 'var(--border-radius-lg)', padding: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ fontSize: 'var(--font-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {detail.guards.length} garde(s) — {detail.date}
                </h4>
                <button onClick={() => setSelectedDay(null)} className="btn btn-secondary btn-sm">Fermer</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detail.guards.map((g, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 10px', background: 'var(--bg-elevated)',
                    borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--border-subtle)',
                  }}>
                    <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-primary)', flex: 1, minWidth: 140 }}>
                      {g.name}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{g.label}</span>
                    {g.scheduleName && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {g.scheduleName}</span>
                    )}
                    {g.roleName && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{g.roleName}</span>
                    )}
                    {g.departmentName && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: 'var(--color-primary-light)',
                        background: 'var(--color-primary-10)', borderRadius: 6, padding: '2px 8px',
                      }}>
                        {g.departmentName}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700 }}>{g.code}</span>
                    {g.state && <PlanningStateBadge state={g.state} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Plannings représentés dans la fenêtre */}
          {schedules.length > 0 && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--border-radius-lg)', padding: 16,
            }}>
              <h4 style={{ fontSize: 'var(--font-sm)', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10 }}>
                Plannings couvrant la période ({schedules.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {schedules.map((s) => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    fontSize: 'var(--font-xs)', color: 'var(--text-secondary)',
                  }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</span>
                    {s.departmentName && <span>· {s.departmentName}</span>}
                    <span>· {s.startDate} → {s.endDate}</span>
                    <PlanningStateBadge state={s.state} />
                    <span style={{ color: 'var(--text-muted)' }}>{s.guards} garde(s)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {days.length === 0 && (
            <div style={{
              padding: 40, textAlign: 'center', color: 'var(--text-muted)',
              fontSize: 'var(--font-sm)', background: 'var(--bg-card)',
              border: '1px dashed var(--border-default)', borderRadius: 'var(--border-radius-lg)',
            }}>
              📅 Aucune garde sur cette période avec les filtres actuels
            </div>
          )}
        </>
      )}
    </div>
  );
}
