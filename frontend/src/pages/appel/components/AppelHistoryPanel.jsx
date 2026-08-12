/**
 * AppelHistoryPanel — historique des appels (point 1).
 *
 * Écran neuf, monté en second onglet de l'appel du jour. Aucun composant
 * existant n'est modifié pour l'accueillir.
 *
 * CE QU'IL MONTRE, tel que demandé : qui a déclaré la présence, l'absence ou le
 * retard · dans quelle garde · pour quel agent · à quelle date — et la durée du
 * retard quand il s'agit d'un retard. Deux regroupements : par garde, par jour.
 *
 * SOURCE : `GET /api/journal?type=presence,absence,late` — le journal de service
 * porte déjà les trois issues d'un pointage avec leur déclarant
 * (`reported_by` → `reporterName`). Rien n'est recalculé ni dupliqué ; la portée
 * (service, hôpital) est celle que le serveur applique au rôle de l'appelant.
 *
 * LA DURÉE DU RETARD arrive dans `metadata.lateMinutes`, écrite par
 * `reportShiftAbsence`. Repli sur le titre de l'événement (« Retard signalé(e)
 * — 25 min ») pour rester lisible quelle que soit la source.
 */

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { journalAPI } from '../../../api';

/** Le serveur plafonne `limit` à 300 : on le demande explicitement. */
const MAX_EVENTS = 300;

const MARKS = {
  presence: { label: 'Présent', emoji: '✅', color: '#10B981', bg: 'rgba(16, 185, 129, .10)' },
  late:     { label: 'Retard',  emoji: '⏰', color: '#F59E0B', bg: 'rgba(245, 158, 11, .10)' },
  absence:  { label: 'Absent',  emoji: '⛔', color: '#EF4444', bg: 'rgba(239, 68, 68, .10)' },
};

const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
};

/** Date locale en 'YYYY-MM-DD' — jamais toISOString, qui décale d'un jour. */
const dayKey = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const shiftDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dayKey(d);
};

const LONG_DATE = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

const SHORT_DATE = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Durée du retard : `metadata` d'abord, titre en repli. */
const lateMinutesOf = (ev) => {
  const meta = ev.metadata && typeof ev.metadata === 'object' ? ev.metadata : null;
  const raw = meta?.lateMinutes;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  const m = /(\d+)\s*min/i.exec(String(ev.title || ''));
  return m ? Number.parseInt(m[1], 10) : null;
};

/** « 1 h 25 » au-delà de l'heure, « 25 min » en dessous. */
const durationLabel = (minutes) => {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
};

const PRESETS = [
  { key: 'today', label: "Aujourd'hui", from: () => dayKey(new Date()), to: () => dayKey(new Date()) },
  { key: '7',     label: '7 derniers jours',  from: () => shiftDays(-6),  to: () => dayKey(new Date()) },
  { key: '30',    label: '30 derniers jours', from: () => shiftDays(-29), to: () => dayKey(new Date()) },
  { key: 'custom', label: 'Intervalle…', from: null, to: null },
];

const Chip = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    style={{
      padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
      fontWeight: active ? 700 : 500, fontFamily: 'inherit',
      border: `1px solid ${active ? 'var(--color-primary)' : 'var(--border-default)'}`,
      background: active ? 'var(--color-primary)' : 'var(--bg-card)',
      color: active ? '#fff' : 'var(--text-secondary)',
    }}
  >
    {children}
  </button>
);

const Count = ({ mark, n }) => {
  const m = MARKS[mark];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700,
      color: m.color, background: m.bg, borderRadius: 6, padding: '2px 7px',
    }}>
      {m.emoji} {n}
    </span>
  );
};

export default function AppelHistoryPanel() {
  const [preset, setPreset] = useState('7');
  const [customFrom, setCustomFrom] = useState(shiftDays(-6));
  const [customTo, setCustomTo] = useState(dayKey(new Date()));
  const [groupBy, setGroupBy] = useState('schedule');   // 'schedule' | 'day'
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [markFilter, setMarkFilter] = useState('');
  const [search, setSearch] = useState('');

  const active = PRESETS.find((p) => p.key === preset) || PRESETS[1];
  const from = active.from ? active.from() : customFrom;
  const to   = active.to   ? active.to()   : customTo;

  /**
   * Une seule requête, non filtrée par garde : la liste des gardes du sélecteur
   * est déduite des déclarations réellement présentes dans l'intervalle, ce qui
   * garantit qu'une option proposée renvoie toujours des lignes. Le filtre garde
   * et le filtre agent s'appliquent donc côté client, sur le même jeu de données.
   */
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['journal', 'appel-history', from, to],
    queryFn: () => journalAPI.getEvents({
      type: 'presence,absence,late',
      from,
      to,
      limit: MAX_EVENTS,
    }),
  });

  const events = data?.data?.data?.events || [];
  const scopeLabel = data?.data?.data?.scopeLabel;
  const truncated = events.length >= MAX_EVENTS;

  const schedules = useMemo(() => {
    const m = new Map();
    events.forEach((ev) => {
      const id = ev.scheduleId || '__none__';
      if (!m.has(id)) m.set(id, ev.scheduleName || 'Hors planning');
    });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  }, [events]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events
      .filter((ev) => MARKS[ev.type])
      .filter((ev) => !scheduleFilter || (ev.scheduleId || '__none__') === scheduleFilter)
      .filter((ev) => !markFilter || ev.type === markFilter)
      .filter((ev) => {
        if (!q) return true;
        return (ev.userName || '').toLowerCase().includes(q)
          || (ev.reporterName || '').toLowerCase().includes(q)
          || (ev.scheduleName || '').toLowerCase().includes(q)
          || (ev.departmentName || '').toLowerCase().includes(q);
      })
      .map((ev) => ({ ...ev, lateMinutes: ev.type === 'late' ? lateMinutesOf(ev) : null }));
  }, [events, scheduleFilter, markFilter, search]);

  const totals = useMemo(() => {
    const t = { presence: 0, late: 0, absence: 0 };
    rows.forEach((r) => { t[r.type] += 1; });
    return t;
  }, [rows]);

  /** Regroupement demandé : par garde, ou par jour. */
  const groups = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      const key = groupBy === 'day' ? (r.date || '—') : (r.scheduleId || '__none__');
      if (!m.has(key)) {
        m.set(key, {
          key,
          title: groupBy === 'day' ? LONG_DATE(r.date) : (r.scheduleName || 'Hors planning'),
          subtitle: groupBy === 'day' ? null : (r.departmentName || null),
          items: [],
        });
      }
      m.get(key).items.push(r);
    });
    const list = [...m.values()];
    // Par jour : du plus récent au plus ancien. Par garde : ordre alphabétique.
    return groupBy === 'day'
      ? list.sort((a, b) => String(b.key).localeCompare(String(a.key)))
      : list.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
  }, [rows, groupBy]);

  return (
    <div>
      {/* ── Filtres ─────────────────────────────────────────── */}
      <div style={{ ...card, padding: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Période
          </span>
          {PRESETS.map((p) => (
            <Chip key={p.key} active={preset === p.key} onClick={() => setPreset(p.key)}>
              {p.label}
            </Chip>
          ))}
          {preset === 'custom' && (
            <>
              <input
                type="date" className="input" style={{ maxWidth: 160, fontSize: 12 }}
                value={customFrom} max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <input
                type="date" className="input" style={{ maxWidth: 160, fontSize: 12 }}
                value={customTo} min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Regrouper
          </span>
          <Chip active={groupBy === 'schedule'} onClick={() => setGroupBy('schedule')}>Par garde</Chip>
          <Chip active={groupBy === 'day'}      onClick={() => setGroupBy('day')}>Par jour</Chip>

          <span style={{ width: 1, height: 22, background: 'var(--border-default)', margin: '0 4px' }} />

          <select
            className="input" style={{ maxWidth: 260, fontSize: 12 }}
            value={scheduleFilter}
            onChange={(e) => setScheduleFilter(e.target.value)}
          >
            <option value="">Toutes les gardes</option>
            {schedules.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>

          <select
            className="input" style={{ maxWidth: 170, fontSize: 12 }}
            value={markFilter}
            onChange={(e) => setMarkFilter(e.target.value)}
          >
            <option value="">Tous les états</option>
            {Object.entries(MARKS).map(([key, m]) => (
              <option key={key} value={key}>{m.emoji} {m.label}</option>
            ))}
          </select>

          <input
            className="input" style={{ maxWidth: 220, fontSize: 12 }}
            placeholder="Agent, déclarant, service…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>{rows.length}</strong> déclaration(s)
          <Count mark="presence" n={totals.presence} />
          <Count mark="late"     n={totals.late} />
          <Count mark="absence"  n={totals.absence} />
          <span>· {SHORT_DATE(from)} → {SHORT_DATE(to)}</span>
          {scopeLabel && <span>· {scopeLabel}</span>}
        </div>

        {truncated && (
          <p style={{
            margin: 0, fontSize: 11, color: '#92400E', background: 'rgba(245, 158, 11, .10)',
            border: '1px solid rgba(245, 158, 11, .35)', borderRadius: 8, padding: '6px 10px',
          }}>
            Affichage limité aux {MAX_EVENTS} déclarations les plus récentes de l'intervalle —
            resserrez la période pour tout voir.
          </p>
        )}
      </div>

      {/* ── Résultats ───────────────────────────────────────── */}
      {isError ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--color-danger)' }}>
          {error?.response?.status === 403
            ? "Votre rôle ne donne pas accès à l'historique des appels."
            : "L'historique des appels n'a pas pu être chargé."}
        </div>
      ) : isLoading ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          Chargement de l'historique…
        </div>
      ) : !groups.length ? (
        <div style={{ ...card, padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          🗂️ Aucune déclaration sur cette période
          <div style={{ fontSize: 12, marginTop: 8 }}>
            Les pointages faits depuis l'onglet « Pointer aujourd'hui » apparaissent ici
            immédiatement.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {groups.map((g) => {
            const t = { presence: 0, late: 0, absence: 0 };
            g.items.forEach((i) => { t[i.type] += 1; });
            return (
              <div key={g.key} style={{ ...card, overflow: 'hidden' }}>
                <div style={{
                  padding: '10px 14px', background: 'var(--bg-elevated)',
                  borderBottom: '1px solid var(--border-subtle)',
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                }}>
                  <span style={{ fontSize: 14 }}>{groupBy === 'day' ? '📅' : '📋'}</span>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <p style={{ margin: 0, fontWeight: 700, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>
                      {g.title}
                    </p>
                    {g.subtitle && (
                      <p style={{ margin: 0, fontSize: 10, color: 'var(--text-muted)' }}>{g.subtitle}</p>
                    )}
                  </div>
                  <Count mark="presence" n={t.presence} />
                  <Count mark="late"     n={t.late} />
                  <Count mark="absence"  n={t.absence} />
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-sm)' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        {['Personnel concerné', 'État déclaré', groupBy === 'day' ? 'Garde' : 'Date', 'Déclaré par', 'Horodatage'].map((h) => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)',
                            fontWeight: 700, textTransform: 'uppercase', fontSize: 10,
                            letterSpacing: '.04em', whiteSpace: 'nowrap',
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((ev) => {
                        const m = MARKS[ev.type];
                        return (
                          <tr key={ev.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                            <td style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {ev.userName || '—'}
                              {ev.departmentName && groupBy === 'day' && (
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                                  {ev.departmentName}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '9px 12px', whiteSpace: 'nowrap' }}>
                              <span style={{ color: m.color, fontWeight: 700 }}>
                                {m.emoji} {m.label}
                              </span>
                              {/* Durée du retard — la donnée neuve du point 1. */}
                              {ev.type === 'late' && (
                                <span style={{
                                  marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#92400E',
                                  background: 'rgba(245, 158, 11, .14)', borderRadius: 6, padding: '1px 6px',
                                }}>
                                  {durationLabel(ev.lateMinutes) || 'durée non précisée'}
                                </span>
                              )}
                              {ev.description && (
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginTop: 2, maxWidth: 260 }}>
                                  {ev.description}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '9px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
                              {groupBy === 'day' ? (ev.scheduleName || 'Hors planning') : SHORT_DATE(ev.date)}
                            </td>
                            <td style={{ padding: '9px 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
                              {ev.reporterName || '—'}
                            </td>
                            <td style={{ padding: '9px 12px', color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>
                              {SHORT_DATE(ev.date)}{ev.hour ? ` · ${ev.hour}` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.6 }}>
        L'historique est en lecture seule et ne peut pas être modifié : chaque ligne est la trace
        d'une déclaration faite à l'appel du jour. Un agent repointé apparaît autant de fois qu'il a
        été déclaré — c'est ce qui rend la traçabilité complète.
      </p>
    </div>
  );
}
