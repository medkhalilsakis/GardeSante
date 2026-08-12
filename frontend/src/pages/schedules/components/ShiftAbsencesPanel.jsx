/**
 * Absences déclarées à l'appel du jour, vues depuis « Planning des gardes » (point 8).
 *
 * L'onglet « Absences » du planning n'affichait jusqu'ici que les *congés en
 * attente d'approbation* (`absencesAPI.getAll({ status:'pending' })`) — jamais ce
 * qui est signalé pendant l'appel. Ce panneau lit la bonne source,
 * `GET /api/absences-shift` (`kind = 'shift_absence'`), et la restitue selon les
 * quatre regroupements demandés : par garde, par jour, par période et par année.
 *
 * Composant neuf, strictement en lecture : il n'ajoute aucun endpoint, ne
 * remplace pas le bloc des congés en attente (qui reste monté en dessous) et
 * n'écrit rien. Le serveur borne déjà la réponse au périmètre de l'appelant —
 * son service pour un chef ou un surveillant de service, l'hôpital entier pour un
 * surveillant général ou un directeur.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { absencesShiftAPI } from '../../../api';

// Plafond de sécurité : `listShiftAbsences` applique le LIMIT qu'on lui envoie
// sans le borner lui-même. On demande donc une tranche explicite et on prévient
// quand elle est pleine, plutôt que de laisser croire à une liste exhaustive.
const MAX_ROWS = 500;

const GROUPINGS = [
  { key: 'schedule', label: 'Par garde',   hint: 'une section par planning de garde' },
  { key: 'day',      label: 'Par jour',    hint: 'une section par journée' },
  { key: 'month',    label: 'Par période', hint: 'une section par mois de l’intervalle' },
  { key: 'year',     label: 'Par année',   hint: 'une section par année' },
];

// ── Dates ────────────────────────────────────────────────────────────────────
// Jamais `toISOString()` : il bascule d'un jour sur un fuseau à l'est de UTC.
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const atNoon = (ymd) => new Date(`${ymd}T12:00:00`);

const LONG_DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

const PRESETS = () => {
  const now = new Date();
  const today = dayKey(now);
  const monthStart = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = dayKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const thirtyAgo = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
  return [
    { key: 'month',  label: 'Ce mois',      from: monthStart, to: monthEnd },
    { key: 'd30',    label: '30 jours',     from: thirtyAgo,  to: today },
    { key: 'year',   label: 'Cette année',  from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` },
    { key: 'all',    label: 'Tout',         from: '',         to: '' },
  ];
};

// ── Libellés ─────────────────────────────────────────────────────────────────
const ROLE_LABELS = {
  department_head:    'Chef de service',
  service_supervisor: 'Surveillant de service',
  general_supervisor: 'Surveillant général',
  director:           'Directeur',
  super_admin:        'Super administrateur',
};

/** Un retard se reconnaît au type, jamais à la présence d'une durée. */
const isLate = (row) => String(row.type_code || '').toLowerCase() === 'retard'
  || String(row.type_name || '').toLowerCase().includes('retard');

const lateMinutesOf = (row) => {
  const n = Number.parseInt(row.late_minutes, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const durationLabel = (minutes) => {
  if (minutes === null) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`;
};

const fullName = (first, last) => `${first || ''} ${last || ''}`.trim();

// ── Briques d'affichage ──────────────────────────────────────────────────────
const KPI = ({ label, value, hint, color }) => (
  <div style={{
    background: 'var(--bg-card)', border: '1px solid var(--border-default)',
    borderTop: `3px solid ${color}`, borderRadius: 10, padding: '12px 14px', minWidth: 0,
  }}>
    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
      {label}
    </p>
    <p style={{ margin: '3px 0 0', fontSize: 23, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.15 }}>{value}</p>
    {hint && <p style={{ margin: '2px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>{hint}</p>}
  </div>
);

const Chip = ({ active, onClick, children, title }) => (
  <button type="button" onClick={onClick} title={title}
    style={{
      padding: '6px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
      border: `1px solid ${active ? 'transparent' : 'var(--border-default)'}`,
      background: active ? 'var(--color-primary)' : 'var(--bg-card)',
      color: active ? '#fff' : 'var(--text-muted)',
    }}>
    {children}
  </button>
);

const TypeChip = ({ row }) => {
  const color = row.type_color || (isLate(row) ? '#F97316' : '#EF4444');
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: `${color}1A`, color, border: `1px solid ${color}40`, whiteSpace: 'nowrap',
    }}>
      {row.type_name || 'Absence'}
    </span>
  );
};

const th = { padding: '7px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', fontSize: 12.5, color: 'var(--text-primary)', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'middle' };

export default function ShiftAbsencesPanel({ departmentId }) {
  const preset = useMemo(PRESETS, []);
  const [range, setRange] = useState(() => {
    const month = preset[0];
    return { key: month.key, from: month.from, to: month.to };
  });
  const [groupBy, setGroupBy] = useState('schedule');
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState({});

  // Une seule requête : les quatre regroupements et tous les filtres se
  // calculent ensuite en mémoire, ce qui évite un aller-retour par bascule.
  const { data: res, isLoading, isFetching, error } = useQuery({
    queryKey: ['absences-shift', 'panel', range.from, range.to],
    queryFn: () => absencesShiftAPI.getAll({
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
      limit: MAX_ROWS,
    }),
  });

  const all = useMemo(() => {
    const rows = res?.data?.data || res?.data || [];
    return Array.isArray(rows) ? rows : [];
  }, [res]);

  // Périmètre : le serveur borne déjà un chef à son service. Pour un surveillant
  // général, qui voit tout l'hôpital, on suit le service sélectionné au-dessus.
  const scoped = useMemo(() => {
    if (!departmentId) return all;
    // `department_id` n'est renvoyé que par les versions récentes de l'endpoint ;
    // sans lui on ne filtre pas plutôt que de vider la liste à tort.
    if (!all.some((r) => r.department_id)) return all;
    return all.filter((r) => !r.department_id || r.department_id === departmentId);
  }, [all, departmentId]);

  const schedules = useMemo(() => {
    const map = new Map();
    scoped.forEach((r) => {
      if (!r.schedule_id) return;
      if (!map.has(r.schedule_id)) map.set(r.schedule_id, r.schedule_name || 'Garde sans nom');
    });
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  }, [scoped]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped.filter((r) => {
      if (scheduleFilter && r.schedule_id !== scheduleFilter) return false;
      if (!q) return true;
      return fullName(r.first_name, r.last_name).toLowerCase().includes(q)
        || (r.type_name || '').toLowerCase().includes(q)
        || (r.schedule_name || '').toLowerCase().includes(q)
        || fullName(r.reporter_first_name, r.reporter_last_name).toLowerCase().includes(q);
    });
  }, [scoped, scheduleFilter, search]);

  const stats = useMemo(() => {
    const agents = new Set();
    const gardes = new Set();
    let lates = 0;
    let lateTotal = 0;
    rows.forEach((r) => {
      if (r.user_id) agents.add(r.user_id);
      if (r.schedule_id) gardes.add(r.schedule_id);
      if (isLate(r)) {
        lates += 1;
        lateTotal += lateMinutesOf(r) || 0;
      }
    });
    return { total: rows.length, agents: agents.size, gardes: gardes.size, lates, lateTotal };
  }, [rows]);

  // Un regroupement = une clé de tri + un libellé. La même mécanique sert aux
  // quatre axes, ce qui garantit que les totaux concordent d'une vue à l'autre.
  const groups = useMemo(() => {
    const bucket = new Map();
    rows.forEach((r) => {
      let id;
      let label;
      let sub = '';
      if (groupBy === 'schedule') {
        id = r.schedule_id || '—';
        label = r.schedule_name || 'Hors garde';
        sub = r.department_name || '';
      } else if (groupBy === 'day') {
        id = r.date || '—';
        label = r.date ? LONG_DATE.format(atNoon(r.date)) : 'Date inconnue';
      } else if (groupBy === 'month') {
        id = (r.date || '').slice(0, 7) || '—';
        label = id === '—' ? 'Période inconnue' : MONTH_LABEL.format(atNoon(`${id}-01`));
      } else {
        id = (r.date || '').slice(0, 4) || '—';
        label = id === '—' ? 'Année inconnue' : id;
      }
      if (!bucket.has(id)) bucket.set(id, { id, label, sub, items: [] });
      bucket.get(id).items.push(r);
    });

    const list = [...bucket.values()];
    // Chronologique décroissant pour les axes de temps (le plus récent d'abord),
    // alphabétique pour les gardes.
    list.sort((a, b) => (groupBy === 'schedule'
      ? a.label.localeCompare(b.label, 'fr')
      : String(b.id).localeCompare(String(a.id))));
    return list;
  }, [rows, groupBy]);

  const truncated = all.length >= MAX_ROWS;
  const isFiltering = Boolean(scheduleFilter || search.trim());

  const card = {
    background: 'var(--bg-card)', border: '1px solid var(--border-default)',
    borderRadius: 12, padding: '16px 18px',
  };

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Absences signalées à l'appel du jour</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Absences et retards déclarés pendant les gardes — par garde, par jour, par période et par année
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {preset.map((p) => (
            <Chip key={p.key} active={range.key === p.key}
              onClick={() => setRange({ key: p.key, from: p.from, to: p.to })}>
              {p.label}
            </Chip>
          ))}
        </div>
      </div>

      {error ? (
        <div style={{ ...card, borderLeft: '4px solid #DC2626' }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Impossible de charger les signalements</p>
          <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
            {error?.response?.data?.message || 'Réessayez dans un instant.'}
          </p>
        </div>
      ) : (
        <>
          {/* Synthèse de l'intervalle et des filtres en cours. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 14 }}>
            <KPI label="Signalements" value={stats.total} hint="absences et retards" color="#EF4444" />
            <KPI label="Dont retards" value={stats.lates}
              hint={stats.lateTotal > 0 ? `${durationLabel(stats.lateTotal)} cumulées` : 'aucune durée saisie'} color="#F97316" />
            <KPI label="Agents concernés" value={stats.agents} hint="personnes distinctes" color="#0EA5E9" />
            <KPI label="Gardes concernées" value={stats.gardes} hint="plannings distincts" color="var(--color-primary)" />
          </div>

          {/* Barre de filtres : regroupement, garde, intervalle libre, recherche. */}
          <div style={{ ...card, padding: '12px 14px', marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {GROUPINGS.map((g) => (
                <Chip key={g.key} active={groupBy === g.key} title={g.hint}
                  onClick={() => { setGroupBy(g.key); setCollapsed({}); }}>
                  {g.label}
                </Chip>
              ))}
            </div>

            <div style={{ flex: 1, minWidth: 8 }} />

            {schedules.length > 1 && (
              <select className="input" style={{ maxWidth: 230, fontSize: 12, padding: '6px 8px' }}
                value={scheduleFilter} onChange={(e) => setScheduleFilter(e.target.value)}>
                <option value="">Toutes les gardes</option>
                {schedules.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input type="date" className="input" style={{ fontSize: 12, padding: '6px 8px', maxWidth: 150 }}
                value={range.from} max={range.to || undefined}
                onChange={(e) => setRange({ key: 'custom', from: e.target.value, to: range.to })} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
              <input type="date" className="input" style={{ fontSize: 12, padding: '6px 8px', maxWidth: 150 }}
                value={range.to} min={range.from || undefined}
                onChange={(e) => setRange({ key: 'custom', from: range.from, to: e.target.value })} />
            </div>

            <input className="input" style={{ maxWidth: 200, fontSize: 12, padding: '6px 8px' }}
              placeholder="Agent, type, déclarant…"
              value={search} onChange={(e) => setSearch(e.target.value)} />

            {isFiltering && (
              <button type="button" className="btn btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
                onClick={() => { setScheduleFilter(''); setSearch(''); }}>
                Réinitialiser
              </button>
            )}
          </div>

          {truncated && (
            <div style={{
              background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8,
              padding: '8px 12px', marginBottom: 12, fontSize: 11.5, color: '#92400E',
            }}>
              Seuls les {MAX_ROWS} signalements les plus récents de l'intervalle sont affichés. Resserrez
              l'intervalle pour voir les plus anciens.
            </div>
          )}

          {isLoading ? (
            <div style={{ ...card, textAlign: 'center', padding: '36px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
              Chargement des signalements…
            </div>
          ) : groups.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: '36px 20px' }}>
              <div style={{ fontSize: 30, marginBottom: 8 }}>✅</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                {isFiltering ? 'Aucun signalement pour ces filtres' : 'Aucune absence signalée sur cet intervalle'}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
                {isFiltering
                  ? 'Élargissez la recherche ou changez de garde.'
                  : 'Les absences et retards déclarés à l’appel du jour apparaîtront ici.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: isFetching ? 0.7 : 1 }}>
              {groups.map((g) => {
                const shut = collapsed[g.id] === true;
                const lates = g.items.filter(isLate).length;
                return (
                  <div key={g.id} style={{ ...card, padding: 0, overflow: 'hidden' }}>
                    <button type="button"
                      onClick={() => setCollapsed((prev) => ({ ...prev, [g.id]: !shut }))}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px',
                        background: 'var(--bg-subtle, transparent)', border: 'none', cursor: 'pointer', textAlign: 'left',
                      }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, width: 10 }}>{shut ? '▶' : '▼'}</span>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)', textTransform: groupBy === 'day' ? 'capitalize' : 'none' }}>
                        {g.label}
                      </span>
                      {g.sub && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {g.sub}</span>}
                      <span style={{ flex: 1 }} />
                      {lates > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#C2410C', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 999, padding: '2px 8px' }}>
                          {lates} retard{lates > 1 ? 's' : ''}
                        </span>
                      )}
                      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)' }}>
                        {g.items.length} signalement{g.items.length > 1 ? 's' : ''}
                      </span>
                    </button>

                    {!shut && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead>
                            <tr>
                              <th style={th}>Personnel concerné</th>
                              <th style={th}>Type</th>
                              <th style={th}>Durée du retard</th>
                              <th style={th}>{groupBy === 'schedule' ? 'Date de la garde' : 'Garde'}</th>
                              <th style={th}>Déclaré par</th>
                              <th style={th}>Déclaré le</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.items.map((r) => {
                              const minutes = lateMinutesOf(r);
                              return (
                                <tr key={r.id}>
                                  <td style={{ ...td, fontWeight: 700 }}>
                                    {fullName(r.first_name, r.last_name) || '—'}
                                    {r.reason && (
                                      <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                        {r.reason}
                                      </div>
                                    )}
                                  </td>
                                  <td style={td}><TypeChip row={r} /></td>
                                  <td style={{ ...td, fontWeight: 700, color: minutes !== null ? '#C2410C' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                    {minutes !== null
                                      ? durationLabel(minutes)
                                      : (isLate(r) ? 'non précisée' : '—')}
                                  </td>
                                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                                    {groupBy === 'schedule'
                                      ? (r.date ? SHORT_DATE.format(atNoon(r.date)) : '—')
                                      : (r.schedule_name || 'Hors garde')}
                                  </td>
                                  <td style={td}>
                                    {fullName(r.reporter_first_name, r.reporter_last_name) || '—'}
                                    {r.reported_by_role && (
                                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 2 }}>
                                        {ROLE_LABELS[r.reported_by_role] || r.reported_by_role}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ ...td, color: 'var(--text-muted)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
                                    {r.declared_date ? SHORT_DATE.format(atNoon(r.declared_date)) : '—'}
                                    {r.declared_hour ? ` · ${r.declared_hour}` : ''}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
