/**
 * SmartSpreadsheet — Cockpit tableau de garde
 * Excel/Airtable-like : freeze colonnes, drag-reorder, context menu,
 * sidebar picker, shift codes inline, draft/submit
 */
import React, {
  useState, useRef, useEffect, useMemo, useCallback,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { scheduleBuilderAPI, schedulesAPI } from '../../../api';
import HospitalStaffPicker from './HospitalStaffPicker';
import toast from 'react-hot-toast';

// ── Icônes ──────────────────────────────────────────────────────────────
const Ico = ({ d, s = 14 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IcoBack    = () => <Ico d="M15 18l-6-6 6-6" />;
const IcoSave    = () => <Ico d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2zM17 21V13H7v8M7 3v5h8" />;
const IcoSend    = () => <Ico d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />;
const IcoPlus    = () => <Ico d="M12 5v14M5 12h14" />;
const IcoTrash   = () => <Ico d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;
const IcoSearch  = () => <Ico d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />;
const IcoCheck   = () => <Ico d="M20 6L9 17l-5-5" />;
const IcoCopy    = () => <Ico d="M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.912 4.895 3 6 3h8c1.105 0 2 .912 2 2.036v1.866m-6 .17h8c1.105 0 2 .91 2 2.035v10.857C20 21.088 19.105 22 18 22h-8c-1.105 0-2-.912-2-2.036V9.107c0-1.124.895-2.036 2-2.036z" />;
const IcoDrag    = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="9" cy="6"  r="1.5"/><circle cx="15" cy="6"  r="1.5"/>
    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
    <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
  </svg>
);
const IcoUsers   = () => <Ico d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" s={16} />;

// ── Constantes ─────────────────────────────────────────────────────────
const SHIFT_META = {
  J: { label: 'Jour',  description: 'Service de jour.', bg: '#DBEAFE', text: '#1D4ED8', border: '#93C5FD' },
  N: { label: 'Nuit',  description: 'Service de nuit.', bg: '#EDE9FE', text: '#6D28D9', border: '#C4B5FD' },
  S: { label: 'Soir',  description: 'Service du soir.', bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  G: { label: 'Garde', description: 'Garde complète selon le type de garde configuré.', bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  R: { label: 'Repos', description: 'Repos : aucune garde n’est créée pour cette date.', bg: '#F3F4F6', text: '#6B7280', border: '#D1D5DB' },
};
const SHIFT_CODES = ['J', 'N', 'S', 'G', 'R'];
const DOW_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

function getDays(start, end) {
  if (!start || !end) return [];
  // Date pure : midi local évite que `new Date('YYYY-MM-DD')` recule d'un jour.
  const days = [], d = new Date(`${dateKey(start)}T12:00:00`), last = new Date(`${dateKey(end)}T12:00:00`);
  while (d <= last) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

// Les dates de PostgreSQL peuvent arriver sous forme ISO ou Date : le tableur
// compare toujours des clés YYYY-MM-DD, sans effet de fuseau horaire.
const dateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  const raw = String(value);
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
};

// ── Status badge ────────────────────────────────────────────────────────
const STATUS_META = {
  draft:              { label: 'Brouillon',           bg: '#F3F4F6', text: '#6B7280' },
  preparing:          { label: 'En préparation',      bg: '#FEF3C7', text: '#92400E' },
  pending_validation: { label: 'En attente',          bg: '#EFF6FF', text: '#1D4ED8' },
  validated:          { label: 'Validé',              bg: '#ECFDF5', text: '#065F46' },
  submitted:          { label: 'Soumis',              bg: '#EFF6FF', text: '#1D4ED8' },
  archived:           { label: 'Archivé',             bg: '#F9FAFB', text: '#9CA3AF' },
};

// ── Context Menu ─────────────────────────────────────────────────────────
function ContextMenu({ x, y, rowIdx, onAction, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handle = e => { if (!ref.current?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);

  const items = [
    { icon: '↑', label: 'Insérer au-dessus', action: 'insertAbove' },
    { icon: '↓', label: 'Insérer en dessous', action: 'insertBelow' },
    { divider: true },
    { icon: '⧉', label: 'Dupliquer la ligne', action: 'duplicate' },
    { divider: true },
    { icon: '🗑', label: 'Supprimer la ligne', action: 'delete', danger: true },
  ];

  return (
    <div ref={ref} style={{
      position: 'fixed', top: y, left: x, zIndex: 9999,
      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
      borderRadius: 10, padding: '4px 0',
      boxShadow: '0 12px 40px rgba(0,0,0,.2)', minWidth: 180,
      animation: 'fadeIn .1s ease',
    }}>
      {items.map((item, i) => item.divider ? (
        <div key={i} style={{ height: 1, background: 'var(--border-subtle)', margin: '3px 0' }} />
      ) : (
        <button key={item.action}
          onClick={() => { onAction(item.action); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%',
            padding: '7px 14px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, textAlign: 'left',
            color: item.danger ? '#EF4444' : 'var(--text-primary)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = item.danger ? '#FEF2F2' : 'var(--bg-elevated)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <span style={{ fontSize: 14 }}>{item.icon}</span> {item.label}
        </button>
      ))}
    </div>
  );
}

// ── Shift Code Cell ──────────────────────────────────────────────────────
function ShiftCell({ code, onClick }) {
  const m = code ? SHIFT_META[code] : null;
  return (
    <div onClick={onClick} title={m ? `${code} – ${m.label}\nCliquer pour changer` : 'Cliquer pour affecter une garde'}
      style={{
        width: 28, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 5, cursor: 'pointer', fontWeight: 800, fontSize: 11, margin: '0 auto',
        background: m ? m.bg : 'transparent', color: m ? m.text : 'var(--border-subtle)',
        border: m ? `1px solid ${m.border}` : '1px dashed var(--border-subtle)',
        transition: 'all .1s', userSelect: 'none',
      }}
      onMouseEnter={e => { if (!m) e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
      onMouseLeave={e => { if (!m) e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
    >
      {m ? code : '·'}
    </div>
  );
}

function PeriodCalendar({ value, min, max, anchor, onSelect, onClose }) {
  const toDate = (key) => new Date(`${key}T12:00:00`);
  const initial = value || min;
  const [cursor, setCursor] = useState(() => toDate(initial));
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevEnabled = new Date(year, month, 0) >= toDate(min);
  const nextEnabled = new Date(year, month + 1, 1) <= toDate(max);
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) => i < firstDay ? null : i - firstDay + 1);
  const keyFor = (day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return (
    <div style={{ position: 'fixed', zIndex: 5000, top: Math.min((anchor?.bottom || 0) + 6, window.innerHeight - 360), left: Math.min(anchor?.left || 8, window.innerWidth - 290), width: 276, padding: 12, borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', boxShadow: '0 12px 30px rgba(0,0,0,.2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <button type="button" disabled={!prevEnabled} onClick={() => setCursor(new Date(year, month - 1, 1))} style={{ ...calendarNav, opacity: prevEnabled ? 1 : .35 }}>‹</button>
        <strong style={{ fontSize: 12 }}>{MONTH_FR[month]} {year}</strong>
        <button type="button" disabled={!nextEnabled} onClick={() => setCursor(new Date(year, month + 1, 1))} style={{ ...calendarNav, opacity: nextEnabled ? 1 : .35 }}>›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, textAlign: 'center' }}>
        {['D','L','M','M','J','V','S'].map((day, i) => <span key={`${day}-${i}`} style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', padding: 3 }}>{day}</span>)}
        {cells.map((day, i) => {
          if (!day) return <span key={`empty-${i}`} />;
          const key = keyFor(day), disabled = key < min || key > max, selected = key === value;
          return <button type="button" key={key} disabled={disabled} onClick={() => { onSelect(key); onClose(); }} style={{ border: 'none', borderRadius: 6, minHeight: 27, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: selected ? 800 : 500, background: selected ? 'var(--color-primary)' : disabled ? 'transparent' : 'var(--bg-elevated)', color: selected ? '#fff' : disabled ? 'var(--text-muted)' : 'var(--text-primary)', opacity: disabled ? .3 : 1 }}>{day}</button>;
        })}
      </div>
      <div style={{ marginTop: 9, fontSize: 9, color: 'var(--text-muted)', textAlign: 'center' }}>Dates autorisées : {min} au {max}</div>
    </div>
  );
}

function PeriodTimeline({ rows, start, end }) {
  const toDay = (value) => new Date(`${dateKey(value)}T12:00:00`).getTime() / 86400000;
  const first = toDay(start), last = toDay(end), total = Math.max(1, last - first + 1);
  const monthMarkers = [];
  const cursor = new Date(`${dateKey(start)}T12:00:00`);
  while (cursor.getTime() <= new Date(`${dateKey(end)}T12:00:00`).getTime()) {
    monthMarkers.push({ label: `${MONTH_FR[cursor.getMonth()]} ${cursor.getFullYear()}`, left: ((cursor.getTime() / 86400000 - first) / total) * 100 });
    cursor.setMonth(cursor.getMonth() + 1, 1);
  }
  return (
    <div style={{ padding: 18, overflowX: 'auto', background: 'var(--bg-card)', minHeight: 260 }}>
      <div style={{ minWidth: 720 }}>
        <div style={{ marginLeft: 210, height: 24, position: 'relative', borderBottom: '1px solid var(--border-subtle)' }}>
          {monthMarkers.map(marker => <span key={marker.label} style={{ position: 'absolute', left: `${marker.left}%`, transform: 'translateX(4px)', fontSize: 10, fontWeight: 800, color: 'var(--text-muted)' }}>{marker.label}</span>)}
        </div>
        {rows.filter(row => row.userId).map(row => {
          const periodStart = dateKey(row.periodStart) || dateKey(start), periodEnd = dateKey(row.periodEnd) || dateKey(end);
          const left = Math.max(0, ((toDay(periodStart) - first) / total) * 100);
          const width = Math.max(2, ((toDay(periodEnd) - toDay(periodStart) + 1) / total) * 100);
          return <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '210px 1fr', minHeight: 52, borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
            <div style={{ paddingRight: 12 }}><strong style={{ fontSize: 12 }}>{row.lastName} {row.firstName}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.roleName || 'Fonction non renseignée'}</div></div>
            <div style={{ height: 24, position: 'relative', background: 'var(--bg-elevated)', borderRadius: 6 }}>
              <div title={`${periodStart} 00:00:00 → ${periodEnd} 23:59:59`} style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, minWidth: 12, top: 2, bottom: 2, borderRadius: 5, background: 'linear-gradient(90deg,var(--color-primary),#7C3AED)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{periodStart} → {periodEnd}</div>
            </div>
          </div>;
        })}
      </div>
      {rows.filter(row => row.userId).length === 0 && <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)', fontSize: 13 }}>Ajoutez du personnel dans le tableur pour visualiser son calendrier.</div>}
    </div>
  );
}

const STAFF_PALETTE = [
  '#2563EB', // Royal Blue
  '#7C3AED', // Vivid Purple
  '#059669', // Emerald Green
  '#D97706', // Amber Orange
  '#DB2777', // Pink Rose
  '#0891B2', // Cyan
  '#4F46E5', // Indigo
  '#EA580C', // Deep Orange
  '#0D9488', // Teal
  '#DC2626', // Red
];

function DetailedCalendar({ rows, days, start, end }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [filterType, setFilterType] = useState('ALL');
  const [filterUserKey, setFilterUserKey] = useState('ALL');

  // Mapping unique de chaque personnel vers sa puce de couleur et ses jours d'affectation
  const staffColorMap = useMemo(() => {
    const map = {};
    const activeRows = rows.filter(r => r.userId || r.lastName);
    activeRows.forEach((r, idx) => {
      const key = r.userId || r.id;
      const color = STAFF_PALETTE[idx % STAFF_PALETTE.length];
      const shiftDates = Object.entries(r.shifts || {})
        .filter(([_, code]) => code && code !== 'R')
        .map(([dStr]) => dStr)
        .sort();

      map[key] = {
        key,
        color,
        name: `${r.lastName} ${r.firstName}`.trim() || 'Agent',
        role: r.roleName || 'Personnel',
        shiftCount: shiftDates.length,
        firstDate: shiftDates[0] || null,
        lastDate: shiftDates[shiftDates.length - 1] || null,
      };
    });
    return map;
  }, [rows]);

  const dailyMap = useMemo(() => {
    const map = {};
    days.forEach(d => {
      const dStr = dateKey(d);
      map[dStr] = [];
    });

    rows.filter(r => r.userId || r.lastName).forEach(r => {
      const userKey = r.userId || r.id;
      const staffInfo = staffColorMap[userKey] || { color: '#3B82F6', name: `${r.lastName} ${r.firstName}` };

      Object.entries(r.shifts || {}).forEach(([dStr, code]) => {
        if (map[dStr]) {
          map[dStr].push({
            user: r,
            userKey,
            staffInfo,
            code,
            shiftStart: r.shiftStart || '07:00',
            shiftEnd: r.shiftEnd || '07:00',
          });
        }
      });
    });

    return map;
  }, [rows, days, staffColorMap]);

  const totalShiftsCount = useMemo(() => {
    let count = 0;
    Object.values(dailyMap).forEach(list => {
      count += list.filter(item => item.code && item.code !== 'R').length;
    });
    return count;
  }, [dailyMap]);

  const activeStaffList = useMemo(() => {
    return Object.values(staffColorMap);
  }, [staffColorMap]);

  return (
    <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, minHeight: 400 }}>
      {/* Concept & Executive Summary Banner ("L'idée qui décrit tout") */}
      <div style={{
        padding: '16px 20px',
        borderRadius: 12,
        background: 'linear-gradient(135deg, rgba(27,79,202,0.08) 0%, rgba(124,58,237,0.08) 100%)',
        border: '1px solid rgba(27,79,202,0.2)',
        marginBottom: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 800, color: 'var(--color-primary)' }}>
              <span>📅</span> Calendrier Détaillé des Gardes (avec Puces de Couleur par Agent)
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 780 }}>
              <strong>Vue synthétique & identifiée :</strong> Chaque agent du tableur est identifié par un <strong>point de couleur spécifique</strong>. Retrouvez facilement sur chaque carte quotidienne les jours de présence attribués à chaque personnel.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ background: 'var(--bg-card)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Total Gardes</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-primary)' }}>{totalShiftsCount}</div>
            </div>
            <div style={{ background: 'var(--bg-card)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Agents Mobilisés</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#7C3AED' }}>{activeStaffList.length}</div>
            </div>
            <div style={{ background: 'var(--bg-card)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Plage Planning</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#10B981' }}>{days.length} jours</div>
            </div>
          </div>
        </div>

        {/* Personnel Color Legend / Guide */}
        {activeStaffList.length > 0 && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🎨</span> Puces de Couleur par Agent (Légende du Personnel) :
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setFilterUserKey('ALL')}
                style={{
                  padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  border: '1px solid var(--border-subtle)', cursor: 'pointer',
                  background: filterUserKey === 'ALL' ? 'var(--color-primary)' : 'var(--bg-card)',
                  color: filterUserKey === 'ALL' ? '#fff' : 'var(--text-secondary)'
                }}>
                Tous les agents
              </button>
              {activeStaffList.map(st => {
                const active = filterUserKey === st.key;
                return (
                  <button
                    key={st.key}
                    type="button"
                    onClick={() => setFilterUserKey(active ? 'ALL' : st.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                      border: `1.5px solid ${st.color}`, cursor: 'pointer',
                      background: active ? st.color : 'var(--bg-card)',
                      color: active ? '#fff' : 'var(--text-primary)',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: active ? '#fff' : st.color, display: 'inline-block' }} />
                    <span>{st.name}</span>
                    <span style={{ fontSize: 10, opacity: 0.85, fontWeight: 600 }}>
                      ({st.shiftCount}j {st.firstDate ? `• ${st.firstDate.slice(5)} → ${st.lastDate.slice(5)}` : ''})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Shift Code Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Filtrer par type de garde :</span>
          <button type="button" onClick={() => setFilterType('ALL')} style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, border: '1px solid var(--border-subtle)', cursor: 'pointer', background: filterType === 'ALL' ? 'var(--color-primary)' : 'var(--bg-card)', color: filterType === 'ALL' ? '#fff' : 'var(--text-secondary)' }}>Tous types</button>
          {SHIFT_CODES.map(code => {
            const m = SHIFT_META[code];
            const active = filterType === code;
            return (
              <button key={code} type="button" onClick={() => setFilterType(active ? 'ALL' : code)} style={{ padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 700, border: `1px solid ${m.border}`, cursor: 'pointer', background: active ? m.text : m.bg, color: active ? '#fff' : m.text }}>
                {code} ({m.label})
              </button>
            );
          })}
        </div>
      </div>

      {/* Days Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
        {days.map(d => {
          const dStr = dateKey(d);
          const rawAssigned = dailyMap[dStr] || [];
          const assigned = rawAssigned.filter(a => {
            const passType = filterType === 'ALL' || a.code === filterType;
            const passUser = filterUserKey === 'ALL' || a.userKey === filterUserKey;
            return passType && passUser;
          });
          const isWk = isWeekend(d);

          return (
            <div
              key={dStr}
              onClick={() => setSelectedDay({ dateStr: dStr, dateObj: d, items: rawAssigned })}
              style={{
                borderRadius: 10,
                border: isWk ? '1.5px solid #C7D2FE' : '1px solid var(--border-subtle)',
                background: isWk ? 'rgba(99,102,241,0.03)' : 'var(--bg-card)',
                padding: 12,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.08)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.02)'; }}
            >
              {/* Card Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 800, color: isWk ? '#4F46E5' : 'var(--text-primary)' }}>
                    {DOW_FR[d.getDay()]} {d.getDate()} {MONTH_FR[d.getMonth()]}
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dStr}</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Colored dots preview in card header for on-duty staff */}
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                    {rawAssigned.map((item, idx) => (
                      <span
                        key={idx}
                        style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: item.staffInfo.color,
                          display: 'inline-block'
                        }}
                        title={`${item.staffInfo.name} (${item.code})`}
                      />
                    ))}
                  </div>
                  {isWk && (
                    <span style={{ fontSize: 9, fontWeight: 800, background: '#EEF2FF', color: '#4F46E5', padding: '2px 6px', borderRadius: 4, border: '1px solid #C7D2FE' }}>
                      🌟
                    </span>
                  )}
                </div>
              </div>

              {/* Shift Assignments List */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 40 }}>
                {assigned.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0', textAlign: 'center' }}>
                    {rawAssigned.length === 0 ? 'Aucune garde affectée' : 'Aucun résultat pour ce filtre'}
                  </div>
                ) : (
                  assigned.map((item, idx) => {
                    const m = SHIFT_META[item.code] || SHIFT_META.G;
                    const stColor = item.staffInfo.color;
                    return (
                      <div key={idx} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: 6, background: m.bg, border: `1px solid ${m.border}`,
                        borderLeft: `4px solid ${stColor}`, color: m.text
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                          {/* Personnel Colored Dot */}
                          <span
                            style={{
                              width: 10, height: 10, borderRadius: '50%',
                              background: stColor, display: 'inline-block', flexShrink: 0,
                              boxShadow: `0 0 0 2px ${stColor}33`
                            }}
                            title={`Agent: ${item.staffInfo.name}`}
                          />
                          <span style={{ fontSize: 9, fontWeight: 900, width: 16, height: 16, borderRadius: '50%', background: m.text, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {item.code}
                          </span>
                          <div style={{ fontSize: 11, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.user.lastName} {item.user.firstName}
                          </div>
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 800, opacity: 0.85, flexShrink: 0, marginLeft: 4 }}>
                          {item.shiftStart} - {item.shiftEnd}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Card Footer */}
              <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px dashed var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
                <span>{assigned.length} agent(s)</span>
                <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>Inspecter →</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Day Inspector Modal */}
      {selectedDay && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 6000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSelectedDay(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 520, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', border: '1px solid var(--border-subtle)' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
                  📋 Détail des gardes du {DOW_FR[selectedDay.dateObj.getDay()]} {selectedDay.dateObj.getDate()} {MONTH_FR[selectedDay.dateObj.getMonth()]} {selectedDay.dateObj.getFullYear()}
                </h3>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  Plage globale du planning : {dateKey(start)} au {dateKey(end)}
                </div>
              </div>
              <button type="button" onClick={() => setSelectedDay(null)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
              {selectedDay.items.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                  Aucun membre du personnel n'est affecté à une garde pour cette date.
                </div>
              ) : (
                selectedDay.items.map((item, i) => {
                  const m = SHIFT_META[item.code] || SHIFT_META.G;
                  const stColor = item.staffInfo.color;
                  return (
                    <div key={i} style={{ padding: 12, borderRadius: 10, background: 'var(--bg-elevated)', border: `1px solid ${m.border}`, borderLeft: `5px solid ${stColor}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* Colored Dot Badge */}
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: stColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13, boxShadow: `0 3px 8px ${stColor}44` }}>
                          {item.code}
                        </div>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: stColor, display: 'inline-block' }} />
                            {item.user.lastName} {item.user.firstName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {item.user.roleName || 'Fonction non renseignée'} {item.user.phone ? `• Tél: ${item.user.phone}` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, background: m.bg, color: m.text, fontWeight: 800, fontSize: 10 }}>
                          {m.label}
                        </span>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
                          ⏰ {item.shiftStart} → {item.shiftEnd}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div style={{ marginTop: 20, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setSelectedDay(null)} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--color-primary)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const calendarNav = { border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', borderRadius: 6, cursor: 'pointer', width: 25, height: 24, fontSize: 18, lineHeight: 1 };

// ── Main ─────────────────────────────────────────────────────────────────
export default function SmartSpreadsheet({ scheduleId, departmentId, onBack }) {
  const qc = useQueryClient();

  // ── State ──
  const [rows, setRows]               = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [editVal, setEditVal]         = useState('');
  const [filter, setFilter]           = useState({ search: '', role: '' });
  const [hiddenCols, setHiddenCols]   = useState(new Set());
  const [showColPanel, setShowColPanel] = useState(false);
  const [isDirty, setIsDirty]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [pickerOpen, setPickerOpen]   = useState(false);
  const [pickerRowId, setPickerRowId] = useState(null);
  const [personSearch, setPersonSearch] = useState(null);
  const [periodPicker, setPeriodPicker] = useState(null);
  const [shiftHelp, setShiftHelp] = useState(null);
  const [viewMode, setViewMode] = useState('table');
  const [dragOverRow, setDragOverRow] = useState(null);
  const [draggingRow, setDraggingRow] = useState(null);
  // Colonnes dynamiques
  const [customCols, setCustomCols]   = useState([]);
  const [showAddCol, setShowAddCol]   = useState(false);
  const [newColName, setNewColName]   = useState('');
  const [newColType, setNewColType]   = useState('text');
  const [editingColHeader, setEditingColHeader] = useState(null); // key of col being renamed
  const [colHeaderVal, setColHeaderVal] = useState('');
  const inputRef = useRef(null);
  const saveVersion = useRef(0);

  // ── Data fetch ──
  const { data: schedData, isLoading } = useQuery({
    queryKey: ['schedule-detail', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId),
    enabled: !!scheduleId,
  });
  // L'API renvoie { success, data: { schedule, shifts, ... } }.
  // Le tableur doit utiliser le planning imbriqué pour lire ses dates globales.
  const scheduleDetail = schedData?.data?.data || schedData?.data;
  const schedule = scheduleDetail?.schedule || scheduleDetail;

  const days = useMemo(() => getDays(schedule?.start_date, schedule?.end_date), [schedule]);
  const showDailyGrid = false;

  // Build rows from schedule
  useEffect(() => {
    if (!schedule) return;
    const savedRows = schedule.metadata?.spreadsheet?.rows;
    const staffList = scheduleDetail?.staff || schedule.staff || [];
    const shifts    = scheduleDetail?.shifts || schedule.shifts || [];
    const sourceRows = savedRows?.length ? savedRows : staffList;
    const built = sourceRows.map(m => {
      // Une ligne sauvegardee a un id de ligne temporaire (`new-...`) et
      // l'UUID du personnel dans userId : ces deux identifiants sont distincts.
      const personnelId = m.userId || m.user_id || m.id;
      const shiftMap = {};
      shifts.filter(s => s.user_id === personnelId).forEach(s => {
        const d = String(s.shift_date).split('T')[0];
        shiftMap[d] = (s.shift_type_code || 'G').charAt(0).toUpperCase();
      });
      return {
        id: `row-${personnelId}`, userId: personnelId,
        lastName: m.last_name || m.lastName || '', firstName: m.first_name || m.firstName || '',
        roleName: m.role_name || m.roleName || '', phone: m.phone || '', matricule: m.matricule || '',
        periodStart: dateKey(m.periodStart || m.period_start) || dateKey(schedule.start_date),
        periodEnd: dateKey(m.periodEnd || m.period_end) || dateKey(schedule.end_date),
        shiftStart: m.shiftStart || '07:00', shiftEnd: m.shiftEnd || '07:00',
        deptId: m.department_id || departmentId,
        shifts: shiftMap, isNew: false,
        custom: m.custom || {},
      };
    });
    // Ajouter une ligne vide si aucun personnel
    if (built.length === 0) {
      built.push(emptyRow());
    }
    setRows(built);
    setCustomCols(schedule.metadata?.spreadsheet?.customCols || []);
  }, [schedule, scheduleDetail, departmentId]);

  const emptyRow = (idx = Date.now()) => ({
    id: `new-${idx}`, userId: null,
    lastName: '', firstName: '', roleName: '', phone: '', matricule: '',
    periodStart: dateKey(schedule?.start_date), periodEnd: dateKey(schedule?.end_date),
    shiftStart: '07:00', shiftEnd: '07:00',
    deptId: departmentId, shifts: {}, isNew: true,
    custom: {},
  });

  // Période = jours de participation ; durée = heures de la garde.
  const fixedCols = [
    { key: 'lastName',   label: 'Nom',           w: 120 },
    { key: 'firstName',  label: 'Prénom',         w: 100 },
    { key: 'phone',      label: 'Tél',            w: 100 },
    { key: 'matricule',  label: 'Matricule',      w: 90  },
    { key: 'roleName',   label: 'Fonction',       w: 135 },
    { key: 'periodStart', label: 'Période - début', w: 118, type: 'date' },
    { key: 'periodEnd',   label: 'Période - fin',   w: 118, type: 'date' },
    { key: 'shiftStart',  label: 'Durée - début', w: 105, type: 'time' },
    { key: 'shiftEnd',    label: 'Durée - fin',    w: 105, type: 'time' },
  ];
  const visibleFixedCols = fixedCols.filter(c => !hiddenCols.has(c.key));
  const visibleCols = visibleFixedCols; // backward compat alias
  const roles = [...new Set(rows.map(r => r.roleName).filter(Boolean))];

  const filteredRows = rows.filter(r => {
    if (!filter.search && !filter.role) return true;
    const name = `${r.lastName} ${r.firstName}`.toLowerCase();
    return (!filter.search || name.includes(filter.search.toLowerCase()))
        && (!filter.role || r.roleName === filter.role);
  });

  // ── Stats ──
  const stats = useMemo(() => {
    const counts = rows.map(r => Object.values(r.shifts).length);
    const t = counts.reduce((a, b) => a + b, 0);
    return { total: t, avg: rows.length ? (t / rows.length).toFixed(1) : 0, staff: rows.length };
  }, [rows]);

  const periodErrors = useMemo(() => {
    const roster = rows.filter(r => r.userId);
    if (!roster.length || !schedule) return [];
    const start = dateKey(schedule.start_date);
    const end = dateKey(schedule.end_date);
    const errors = [];
    roster.forEach(r => {
      const name = `${r.lastName} ${r.firstName}`.trim() || 'Personnel sélectionné';
      const pStart = dateKey(r.periodStart), pEnd = dateKey(r.periodEnd);
      if (!pStart) errors.push(`${name} : date de début requise.`);
      else if (pStart < start) errors.push(`${name} : la date de début ne peut pas être avant le ${start}.`);
      else if (pStart > end) errors.push(`${name} : la date de début ne peut pas être après le ${end}.`);
      if (!pEnd) errors.push(`${name} : date de fin requise.`);
      else if (pEnd > end) errors.push(`${name} : la date de fin ne peut pas dépasser le ${end}.`);
      else if (pEnd < start) errors.push(`${name} : la date de fin ne peut pas être avant le ${start}.`);
      if (pStart && pEnd && pStart > pEnd) errors.push(`${name} : la date de début doit être antérieure ou égale à la date de fin.`);
    });
    if (!roster.some(r => dateKey(r.periodStart) === start)) errors.push(`Couverture manquante : au moins un personnel doit commencer le ${start}.`);
    if (!roster.some(r => dateKey(r.periodEnd) === end)) errors.push(`Couverture manquante : au moins un personnel doit finir le ${end}.`);
    return errors;
  }, [rows, schedule]);

  const dirty = useCallback(() => { saveVersion.current += 1; setIsDirty(true); }, []);

  const { data: searchData } = useQuery({
    queryKey: ['spreadsheet-person-search', personSearch?.value],
    queryFn: () => schedulesAPI.getHospitalStaff({ search: personSearch?.value, limit: 8 }),
    enabled: !!personSearch?.value?.trim(),
  });
  const searchResults = searchData?.data?.data || searchData?.data || [];

  // ── Row mutations ──
  const updateRow = (id, patch) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    dirty();
  };

  const cycleShift = (rowId, dateStr) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const cur = r.shifts[dateStr];
      const idx = cur ? SHIFT_CODES.indexOf(cur) : -1;
      const next = SHIFT_CODES[(idx + 1) % (SHIFT_CODES.length + 1)];
      const shifts = { ...r.shifts };
      if (!next || idx === SHIFT_CODES.length - 1) delete shifts[dateStr];
      else shifts[dateStr] = next;
      return { ...r, shifts };
    }));
    dirty();
  };

  const addRow = (afterIdx = -1) => {
    const row = emptyRow();
    setRows(prev => {
      const arr = [...prev];
      arr.splice(afterIdx < 0 ? arr.length : afterIdx + 1, 0, row);
      return arr;
    });
    dirty();
  };

  const removeRow = id => { setRows(prev => prev.filter(r => r.id !== id)); dirty(); };

  const duplicateRow = idx => {
    const src = rows[idx];
    const copy = { ...src, id: `new-${Date.now()}`, isNew: true, shifts: { ...src.shifts } };
    setRows(prev => { const arr = [...prev]; arr.splice(idx + 1, 0, copy); return arr; });
    dirty();
  };

  const insertRow = (idx, above) => {
    addRow(above ? idx - 1 : idx);
  };

  const handleContextAction = (action, idx) => {
    if (action === 'delete')       removeRow(rows[idx].id);
    else if (action === 'duplicate') duplicateRow(idx);
    else if (action === 'insertAbove') insertRow(idx, true);
    else if (action === 'insertBelow') insertRow(idx, false);
  };

  // ── Drag-to-reorder rows ──
  const handleRowDragStart = (e, idx) => {
    setDraggingRow(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };

  const handleRowDrop = (e, targetIdx) => {
    e.preventDefault();
    const staffPayload = e.dataTransfer.getData('application/json');
    if (staffPayload) {
      try {
        applyStaffToRow(rows[targetIdx].id, JSON.parse(staffPayload));
        setDragOverRow(null);
        return;
      } catch { /* déplacement de ligne : géré ci-dessous */ }
    }
    const from = parseInt(e.dataTransfer.getData('text/plain'));
    if (isNaN(from) || from === targetIdx) return;
    setRows(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(targetIdx, 0, moved);
      return arr;
    });
    setDragOverRow(null);
    setDraggingRow(null);
    dirty();
  };

  // ── Drop staff from sidebar OR HospitalStaffPicker ──
  const applyStaffToRow = (rowId, member) => {
    updateRow(rowId, {
      userId:    member.id,
      firstName: member.first_name || member.firstName || '',
      lastName:  member.last_name  || member.lastName  || '',
      roleName:  member.role_name  || member.roleName  || '',
      phone:     member.phone || '',
      matricule: member.matricule || '',
      deptId:    member.dept_id || member.deptId || departmentId,
      isNew:     false,
    });
    // Si personnel externe → notification
    if (member.dept_id && member.dept_id !== departmentId) {
      toast(`⚠️ Personnel externe (${member.dept_name}) — notification envoyée au chef du service`, { icon: '🔔' });
      // Call backend to record external assignment
      schedulesAPI.action?.(scheduleId, 'notify_external', {
        userId: member.id, deptId: member.dept_id,
      }).catch(() => {});
    }
  };

  // ── Staff picker select (adds to first empty row or new row) ──
  const handlePickerSelect = (member) => {
    if (pickerRowId) {
      applyStaffToRow(pickerRowId, member);
      setPickerRowId(null);
      setPickerOpen(false);
      return;
    }
    const emptyIdx = rows.findIndex(r => r.isNew || !r.userId);
    if (emptyIdx >= 0) {
      applyStaffToRow(rows[emptyIdx].id, member);
    } else {
      const row = emptyRow();
      setRows(prev => [...prev, row]);
      setTimeout(() => applyStaffToRow(row.id, member), 0);
    }
  };

  // Les données d'identité proviennent exclusivement de la fiche personnel.
  const startEdit = (id, key, val) => {
    setEditingCell({ id, key });
    setEditVal(val || '');
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    updateRow(editingCell.id, { [editingCell.key]: editVal });
    setEditingCell(null);
  };

  // ── Save / Submit ──
  const saveDraft = async (silent = false) => {
    if (periodErrors.length) {
      toast.error(`Brouillon non enregistré : ${periodErrors[0]}`);
      return;
    }
    const versionAtStart = saveVersion.current;
    setSaving(true);
    try {
      await scheduleBuilderAPI.saveDraft(scheduleId, { rows, customCols });
      // Une modification intervenue pendant la requête reste marquée à sauvegarder.
      if (saveVersion.current === versionAtStart) setIsDirty(false);
      qc.invalidateQueries({ queryKey: ['schedule-detail', scheduleId] });
      if (!silent) toast.success('Brouillon enregistré');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Impossible d\'enregistrer le brouillon. Vérifiez la connexion au serveur.');
    } finally { setSaving(false); }
  };

  // Sauvegarde automatique en brouillon : les modifications ne sont jamais perdues.
  useEffect(() => {
    if (!isDirty || saving || schedule?.status !== 'draft') return undefined;
    const timer = setTimeout(() => saveDraft(true), 1200);
    return () => clearTimeout(timer);
  }, [isDirty, rows, customCols]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmSubmit = async () => {
    if (!confirm('Envoyer ce planning au surveillant du service ? Cette action est définitive.')) return;
    setSubmitting(true);
    try {
      await scheduleBuilderAPI.submit(scheduleId, { status: 'submitted' });
      toast.success('Planning envoyé !');
      setIsDirty(false);
      qc.invalidateQueries(['schedule-detail', scheduleId]);
    } catch { toast.error('Erreur lors de l\'envoi'); }
    finally { setSubmitting(false); }
  };

  // ── Context menu handler ──
  const openContextMenu = (e, idx) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, rowIdx: idx });
  };

  // ── Loading / empty ──
  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 14px' }} />
        Chargement du tableur...
      </div>
    );
  }
  if (!schedule) return <div style={{ textAlign: 'center', padding: 40 }}>Planning introuvable</div>;

  const statusMeta = STATUS_META[schedule.status] || STATUS_META.draft;
  const periodPickerRow = periodPicker ? rows.find(row => row.id === periodPicker.rowId) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
      {periodPicker && periodPickerRow && (
        <PeriodCalendar
          value={periodPickerRow[periodPicker.key] || ''}
          min={dateKey(schedule.start_date)} max={dateKey(schedule.end_date)} anchor={periodPicker.anchor}
          onSelect={(date) => updateRow(periodPicker.rowId, { [periodPicker.key]: date })}
          onClose={() => setPeriodPicker(null)}
        />
      )}

      {/* ══ TOOLBAR ══════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        background: 'var(--bg-card)', borderBottom: '2px solid var(--border-subtle)',
        flexWrap: 'wrap', boxShadow: '0 2px 8px rgba(0,0,0,.04)',
      }}>
        {periodErrors.length > 0 && (
          <div style={{ width: '100%', padding: '8px 10px', borderRadius: 7, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: 11, fontWeight: 600 }}>
            Période invalide : {periodErrors[0]}
          </div>
        )}
        {/* Back */}
        <button onClick={onBack} style={btnGhost}>
          <IcoBack /> <span>Retour</span>
        </button>

        {/* Title + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {schedule.name}
            </span>
            <span style={{ padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: statusMeta.bg, color: statusMeta.text }}>
              {statusMeta.label}
            </span>
            {isDirty && <span style={{ fontSize: 10, color: '#F59E0B', fontWeight: 700 }}>● Non sauvegardé</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {schedule.start_date} — {schedule.end_date} · {days.length} jours · {stats.staff} pers.
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><IcoSearch /></span>
          <input value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            placeholder="Chercher..." style={{ paddingLeft: 26, paddingRight: 8, height: 30, borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-primary)', outline: 'none', width: 120 }} />
        </div>

        {/* Role filter */}
        {roles.length > 0 && (
          <select value={filter.role} onChange={e => setFilter(f => ({ ...f, role: e.target.value }))}
            style={{ height: 30, padding: '0 8px', borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', fontSize: 11, cursor: 'pointer', color: 'var(--text-primary)' }}>
            <option value="">Tous rôles</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}

        {/* Columns toggle */}
        <button onClick={() => setShowColPanel(v => !v)} style={{ ...btnGhost, borderColor: showColPanel ? 'var(--color-primary)' : undefined, color: showColPanel ? 'var(--color-primary)' : undefined }}>
          ⊟ Colonnes
        </button>

        {/* Validate */}
        <button onClick={async () => {
          try {
            const r = await scheduleBuilderAPI.validate(scheduleId);
            const ev = r.data.data;
            if (ev.isValid) toast.success('✓ Aucun conflit !');
            else toast(`${ev.errors?.length || 0} erreur(s) · ${ev.warnings?.length || 0} avert.`, { icon: '⚠️' });
          } catch { toast.error('Erreur de validation'); }
        }} style={{ ...btnGhost, color: '#10B981', borderColor: '#10B981' }}>
          <IcoCheck /> Valider
        </button>

        {/* Export */}
        <button onClick={() => {
          const t = localStorage.getItem('token');
          window.open(`${scheduleBuilderAPI.exportExcelUrl?.(scheduleId)}?token=${t}`, '_blank');
        }} style={{ ...btnGhost, color: '#059669', borderColor: '#059669' }}>📊</button>
        <button onClick={() => {
          const t = localStorage.getItem('token');
          window.open(`${scheduleBuilderAPI.exportPdfUrl?.(scheduleId)}?token=${t}`, '_blank');
        }} style={{ ...btnGhost, color: '#EF4444', borderColor: '#EF4444' }}>📄</button>

        {/* Add column button */}
        <button onClick={() => { setShowAddCol(true); setNewColName(''); setNewColType('text'); }} style={{ ...btnGhost, color: '#8B5CF6', borderColor: '#8B5CF6', display: 'flex', alignItems: 'center', gap: 5 }}>
          <IcoPlus /> Colonne
        </button>

        {/* Add staff button */}
        <button onClick={() => setPickerOpen(true)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
          borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #1B4FCA, #7C3AED)',
          color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
          boxShadow: '0 3px 10px rgba(27,79,202,.3)',
        }}>
          <IcoUsers /> Ajouter du personnel
        </button>
      </div>

      {/* ══ ADD COLUMN MODAL ═══════════════════════════════════════════════ */}
      {showAddCol && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowAddCol(false)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 28, width: 340, boxShadow: '0 24px 80px rgba(0,0,0,.3)' }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 18px', fontSize: 16, fontWeight: 800 }}>＋ Nouvelle colonne</h3>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Nom de la colonne *</span>
              <input autoFocus value={newColName} onChange={e => setNewColName(e.target.value)}
                placeholder="Ex: Service, Grade, Note..."
                style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 20 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Type</span>
              <select value={newColType} onChange={e => setNewColType(e.target.value)}
                style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', fontSize: 13, background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', outline: 'none' }}>
                <option value="text">Texte</option>
                <option value="number">Nombre</option>
                <option value="time">Heure (HH:MM)</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddCol(false)} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>Annuler</button>
              <button disabled={!newColName.trim()} onClick={() => {
                if (!newColName.trim()) return;
                const key = `custom_${Date.now()}`;
                setCustomCols(prev => [...prev, { key, label: newColName.trim(), type: newColType, w: 110 }]);
                setRows(prev => prev.map(r => ({ ...r, custom: { ...(r.custom || {}), [key]: '' } })));
                setShowAddCol(false);
                dirty();
              }} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: newColName.trim() ? 'var(--color-primary)' : '#9CA3AF', color: '#fff', cursor: newColName.trim() ? 'pointer' : 'not-allowed', fontWeight: 700 }}>Ajouter</button>
            </div>
          </div>
        </div>
      )}

      {/* Column visibility panel */}
      {showColPanel && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Colonnes :</span>
          {fixedCols.map(c => {
            const vis = !hiddenCols.has(c.key);
            return (
              <button key={c.key} onClick={() => {
                setHiddenCols(prev => {
                  const next = new Set(prev);
                  if (next.has(c.key)) next.delete(c.key);
                  else next.add(c.key);
                  return next;
                });
              }} style={{
                padding: '4px 10px', borderRadius: 6, fontWeight: 600, fontSize: 11, cursor: 'pointer',
                border: `1px solid ${vis ? 'var(--color-primary)' : 'var(--border-subtle)'}`,
                background: vis ? 'rgba(27,79,202,.08)' : 'transparent',
                color: vis ? 'var(--color-primary)' : 'var(--text-muted)',
              }}>
                {vis ? '✓ ' : ''}{c.label}
              </button>
            );
          })}
          {hiddenCols.size > 0 && (
            <button onClick={() => setHiddenCols(new Set())} style={{ ...btnGhost, fontSize: 10 }}>Tout afficher</button>
          )}
        </div>
      )}

      {/* ══ STATS BAR ════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', gap: 18, padding: '5px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', fontSize: 11, alignItems: 'center' }}>
        {[
          { l: 'Gardes',   v: stats.total,  c: '#3B82F6' },
          { l: 'Moy/pers', v: stats.avg,    c: '#8B5CF6' },
          { l: 'Personnel',v: stats.staff,  c: '#6B7280' },
        ].map(s => (
          <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.c, display: 'inline-block' }} />
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{s.l} :</span>
            <span style={{ fontWeight: 800, color: s.c }}>{s.v}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Clic = cycle garde ·</span>
          {SHIFT_CODES.map(code => {
            const m = SHIFT_META[code];
            return <button type="button" key={code} onClick={() => setShiftHelp(shiftHelp === code ? null : code)} title={`${m.label} : ${m.description}`} style={{ padding: '1px 6px', borderRadius: 4, background: m.bg, color: m.text, border: `1px solid ${m.border}`, fontWeight: 700, fontSize: 10, cursor: 'pointer' }}>{code}</button>;
          })}
        </div>
      </div>

      {/* ══ TABLE / CALENDAR VIEW MODE SELECTOR ══════════════════════════ */}
      {shiftHelp && (
        <div style={{ padding: '8px 14px', background: SHIFT_META[shiftHelp].bg, borderBottom: `1px solid ${SHIFT_META[shiftHelp].border}`, color: SHIFT_META[shiftHelp].text, fontSize: 11 }}>
          <strong>{shiftHelp} — {SHIFT_META[shiftHelp].label} :</strong> {SHIFT_META[shiftHelp].description}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setViewMode('table')} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: viewMode === 'table' ? 'var(--color-primary)' : 'var(--bg-card)', color: viewMode === 'table' ? '#fff' : 'var(--text-secondary)' }}>📊 Tableur</button>
        <button type="button" onClick={() => setViewMode('calendar')} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: viewMode === 'calendar' ? 'var(--color-primary)' : 'var(--bg-card)', color: viewMode === 'calendar' ? '#fff' : 'var(--text-secondary)' }}>📈 Calendrier synthétique</button>
        <button type="button" onClick={() => setViewMode('detailed')} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: viewMode === 'detailed' ? 'var(--color-primary)' : 'var(--bg-card)', color: viewMode === 'detailed' ? '#fff' : 'var(--text-secondary)' }}>📅 Calendrier détaillé (par jour)</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: 'var(--color-primary-10)', borderBottom: '1px solid var(--color-primary-20)', color: 'var(--text-primary)', fontSize: 12 }}>
        <span style={{ fontWeight: 800, color: 'var(--color-primary)' }}>Période globale du planning</span>
        <span style={{ fontWeight: 700 }}>{dateKey(schedule.start_date) || '—'} 00:00:00 → {dateKey(schedule.end_date) || '—'} 23:59:59</span>
        <span style={{ color: 'var(--text-muted)' }}>Le jour de début est inclus, et le jour de fin est le dernier jour de garde.</span>
      </div>

      {viewMode === 'calendar' && <PeriodTimeline rows={filteredRows} start={schedule.start_date} end={schedule.end_date} />}
      {viewMode === 'detailed' && <DetailedCalendar rows={filteredRows} days={days} start={schedule.start_date} end={schedule.end_date} />}

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0, display: viewMode === 'table' ? 'block' : 'none' }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 28 }} /> {/* drag */}
            <col style={{ width: 28 }} /> {/* # */}
            {visibleCols.map(c => <col key={c.key} style={{ width: c.w }} />)}
            {customCols.map(c => <col key={c.key} style={{ width: c.w }} />)}
            {showDailyGrid && days.map(d => <col key={d.toISOString()} style={{ width: 36 }} />)}
            <col style={{ width: 32 }} /> {/* actions */}
          </colgroup>

          {/* Header */}
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            {/* Column labels */}
            <tr>
              <th style={{ ...thBase, width: 28 }} />
              <th style={{ ...thBase, width: 28 }}><span style={{ fontSize: 9 }}>#</span></th>
              {visibleCols.map(c => (
                <th key={c.key} style={{ ...thBase, position: 'relative' }}>
                  {c.type === 'date'
                    ? <span title="Période individuelle de présence dans ce planning">{c.label} 📅</span>
                    : c.type === 'time'
                    ? <span title="Heures de début et fin de garde">{c.label} ⏰</span>
                    : c.label
                  }
                </th>
              ))}
              {/* Custom columns header with rename + delete */}
              {customCols.map(c => (
                <th key={c.key} style={{ ...thBase, position: 'relative', minWidth: c.w }}>
                  {editingColHeader === c.key ? (
                    <input autoFocus value={colHeaderVal}
                      onChange={e => setColHeaderVal(e.target.value)}
                      onBlur={() => {
                        if (colHeaderVal.trim()) setCustomCols(prev => prev.map(col => col.key === c.key ? { ...col, label: colHeaderVal.trim() } : col));
                        setEditingColHeader(null);
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingColHeader(null); }}
                      style={{ width: '80%', fontSize: 10, padding: '2px 4px', border: '1px solid var(--color-primary)', borderRadius: 3, background: '#1E293B', color: '#fff', outline: 'none' }} />
                  ) : (
                    <span style={{ cursor: 'text' }} onDoubleClick={() => { setEditingColHeader(c.key); setColHeaderVal(c.label); }}>
                      {c.label}
                    </span>
                  )}
                  <button onClick={() => {
                    setCustomCols(prev => prev.filter(col => col.key !== c.key));
                    setRows(prev => prev.map(r => { const { [c.key]: _, ...rest } = (r.custom || {}); return { ...r, custom: rest }; }));
                    dirty();
                  }} title="Supprimer cette colonne"
                    style={{ position: 'absolute', top: 1, right: 2, background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0 }}>✕</button>
                </th>
              ))}
              {showDailyGrid && days.map(d => (
                <th key={d.toISOString()} style={{
                  ...thBase,
                  background: isWeekend(d) ? '#1A1040' : '#1E293B',
                  color: isWeekend(d) ? '#A5B4FC' : '#CBD5E1',
                }}>
                  <div style={{ fontSize: 8, fontWeight: 700, lineHeight: 1, color: isWeekend(d) ? '#A5B4FC' : '#94A3B8' }}>{DOW_FR[d.getDay()]}</div>
                  <div style={{ fontSize: 11, fontWeight: 900 }}>{d.getDate()}</div>
                </th>
              ))}
              <th style={thBase}>⚙</th>
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {filteredRows.map((row, ri) => {
              const isDragging = draggingRow === ri;
              const isOver = dragOverRow === ri;
              return (
                <tr
                  key={row.id}
                  draggable
                  onDragStart={e => handleRowDragStart(e, ri)}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/json') ? 'copy' : 'move'; setDragOverRow(ri); }}
                  onDragLeave={() => setDragOverRow(null)}
                  onDrop={e => handleRowDrop(e, ri)}
                  onContextMenu={e => openContextMenu(e, ri)}
                  style={{
                    background: isOver ? 'rgba(27,79,202,.07)' : ri % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)',
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'background .1s',
                    outline: isOver ? '2px solid var(--color-primary)' : 'none',
                    boxShadow: isOver ? 'inset 0 0 0 2px rgba(27,79,202,.15)' : 'none',
                  }}
                  onMouseEnter={e => { if (!isOver && !isDragging) e.currentTarget.style.background = 'rgba(27,79,202,.04)'; }}
                  onMouseLeave={e => { if (!isOver) e.currentTarget.style.background = ri % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)'; }}
                >
                  {/* Drag handle */}
                  <td style={{ ...tdBase, cursor: 'grab', textAlign: 'center', color: 'var(--text-muted)', paddingLeft: 4 }}
                    onDragStart={e => handleRowDragStart(e, ri)}>
                    <IcoDrag />
                  </td>

                  {/* Row number */}
                  <td style={{ ...tdBase, textAlign: 'center' }}>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{ri + 1}</span>
                  </td>

                  {/* Info columns — fixed + time */}
                  {visibleCols.map(col => {
                    const isEd = editingCell?.id === row.id && editingCell?.key === col.key;
                    const val = row[col.key] || '';
                    if (col.type === 'date') {
                      const isOpen = periodPicker?.rowId === row.id && periodPicker?.key === col.key;
                      return (
                        <td key={col.key} style={{ ...tdBase }}>
                          <button type="button" onClick={(event) => setPeriodPicker(isOpen ? null : { rowId: row.id, key: col.key, anchor: event.currentTarget.getBoundingClientRect() })}
                            style={{ width: '100%', padding: '4px 5px', border: '1px solid var(--border-subtle)', borderRadius: 5, background: 'var(--bg-elevated)', color: val ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 10, cursor: 'pointer', textAlign: 'left' }}>
                            {val || 'Choisir une date'} 📅
                          </button>
                        </td>
                      );
                    }
                    if (col.type === 'time') {
                      return <td key={col.key} style={{ ...tdBase }}>
                        <input type="time" value={val || '07:00'} onChange={e => updateRow(row.id, { [col.key]: e.target.value })}
                          style={{ fontSize: 10, border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', padding: 0, width: '100%', outline: 'none' }} />
                      </td>;
                    }
                    const isPersonnelField = ['lastName', 'firstName', 'phone', 'matricule', 'roleName'].includes(col.key);
                    if (isPersonnelField) {
                      const isSearchCell = !row.userId && col.key === 'lastName';
                      return (
                        <td key={col.key} style={{ ...tdBase, position: 'relative', maxWidth: col.w }}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => { const data = e.dataTransfer.getData('application/json'); if (data) { try { applyStaffToRow(row.id, JSON.parse(data)); } catch {} } }}
                          onClick={() => { if (!row.userId) { setPickerRowId(row.id); setPickerOpen(true); } }}>
                          {isSearchCell ? (
                            <>
                              <input value={personSearch?.rowId === row.id ? personSearch.value : ''}
                                onClick={e => e.stopPropagation()}
                                onChange={e => setPersonSearch({ rowId: row.id, value: e.target.value })}
                                placeholder="Rechercher..."
                                style={{ width: '100%', padding: '3px 4px', border: '1px solid var(--color-primary)', borderRadius: 4, fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }} />
                              {personSearch?.rowId === row.id && personSearch.value && (
                                <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, width: 260, maxHeight: 190, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 7, boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
                                  {searchResults.map(member => <button key={member.id} onClick={e => { e.stopPropagation(); applyStaffToRow(row.id, member); setPersonSearch(null); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11 }}>
                                    <strong>{member.last_name} {member.first_name}</strong> <span style={{ color: 'var(--text-muted)' }}>· {member.matricule || member.role_name}</span>
                                  </button>)}
                                </div>
                              )}
                            </>
                          ) : (
                            <span title={row.userId ? 'Information verrouillée : issue de la fiche personnel' : 'Cliquez pour choisir un membre du personnel'} style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: row.userId ? 'not-allowed' : 'pointer', color: val ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                              {val || 'Choisir...'}
                            </span>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} style={{ ...tdBase, position: 'relative', maxWidth: col.w }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          const data = e.dataTransfer.getData('application/json');
                          if (data) { try { applyStaffToRow(row.id, JSON.parse(data)); } catch {} }
                        }}
                        onClick={() => startEdit(row.id, col.key, val)}>
                        {isEd ? (
                          <input ref={inputRef} value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit(); } if (e.key === 'Escape') setEditingCell(null); }}
                            style={{ width: '100%', padding: '2px 4px', border: '2px solid var(--color-primary)', borderRadius: 4, fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }} />
                        ) : (
                          <span style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', color: val ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {val || (row.isNew && col.key === 'lastName' ? '⊕ Glisser...' : '—')}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Custom dynamic columns */}
                  {customCols.map(col => {
                    const val = (row.custom || {})[col.key] || '';
                    const isEd = editingCell?.id === row.id && editingCell?.key === col.key;
                    return (
                      <td key={col.key} style={{ ...tdBase, maxWidth: col.w }}
                        onClick={() => startEdit(row.id, col.key, val)}>
                        {isEd ? (
                          <input ref={inputRef} type={col.type === 'number' ? 'number' : col.type === 'time' ? 'time' : 'text'}
                            value={editVal} onChange={e => setEditVal(e.target.value)}
                            onBlur={() => {
                              setRows(prev => prev.map(r => r.id === row.id ? { ...r, custom: { ...(r.custom || {}), [col.key]: editVal } } : r));
                              setEditingCell(null); dirty();
                            }}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
                            style={{ width: '100%', padding: '2px 4px', border: '2px solid var(--color-primary)', borderRadius: 4, fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }} />
                        ) : (
                          <span style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', color: val ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {val || '—'}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Day cells (masques dans la vue compacte) */}
                  {showDailyGrid && days.map(d => {
                    const dateStr = d.toISOString().split('T')[0];
                    const code = row.shifts[dateStr];
                    return (
                      <td key={dateStr} style={{
                        ...tdBase, padding: '4px 3px', textAlign: 'center',
                        borderLeft: isWeekend(d) ? '1px solid rgba(99,102,241,.2)' : '1px solid var(--border-subtle)',
                        background: isWeekend(d) && !code ? 'rgba(99,102,241,.04)' : undefined,
                      }}>
                        <ShiftCell code={code} onClick={() => cycleShift(row.id, dateStr)} />
                      </td>
                    );
                  })}

                  {/* Row actions */}
                  <td style={{ ...tdBase, textAlign: 'center', padding: '2px 4px' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <button onClick={e => { e.stopPropagation(); duplicateRow(ri); }}
                        title="Dupliquer la ligne"
                        style={{ padding: '3px 4px', borderRadius: 4, border: 'none', background: 'rgba(27,79,202,.07)', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        <IcoCopy />
                      </button>
                      <button onClick={e => { e.stopPropagation(); removeRow(row.id); }}
                        title="Supprimer la ligne"
                        style={{ padding: '3px 4px', borderRadius: 4, border: 'none', background: 'rgba(239,68,68,.07)', color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        <IcoTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* Empty state */}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={2 + visibleCols.length + customCols.length + (showDailyGrid ? days.length : 0) + 1} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
                  {filter.search || filter.role ? 'Aucun résultat pour ce filtre' : 'Tableau vide — cliquez "Ajouter du personnel" ou glissez depuis le panneau'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ══ ADD ROW BAR ══════════════════════════════════════════════════ */}
      <div style={{ padding: '6px 14px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
        <button onClick={() => addRow()} style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px',
          borderRadius: 7, border: '1px dashed var(--color-primary)',
          background: 'rgba(27,79,202,.04)', color: 'var(--color-primary)',
          fontWeight: 700, fontSize: 12, cursor: 'pointer',
        }}>
          <IcoPlus /> Ajouter une ligne
        </button>
      </div>

      {/* ══ FOOTER ═══════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
        background: 'var(--bg-card)', borderTop: '2px solid var(--border-subtle)', flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, fontSize: 11 }}>
          {isDirty
            ? <span style={{ color: '#F59E0B', fontWeight: 700 }}>● Modifications non sauvegardées</span>
            : <span style={{ color: '#10B981', fontWeight: 700 }}>✓ Tout est sauvegardé</span>}
        </div>

        <button onClick={saveDraft} disabled={!isDirty || saving}
          style={{ ...btnGhost, opacity: isDirty ? 1 : 0.5, gap: 6, display: 'flex', alignItems: 'center', padding: '8px 16px' }}>
          <IcoSave /> {saving ? 'Sauvegarde...' : 'Enregistrer brouillon'}
        </button>

        <button onClick={confirmSubmit} disabled={submitting}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px',
            borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, #059669, #047857)',
            color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(5,150,105,.3)', opacity: submitting ? 0.7 : 1,
          }}>
          <IcoSend /> {submitting ? 'Envoi...' : 'Confirmer — Envoyer au surveillant'}
        </button>
      </div>

      {/* ══ CONTEXT MENU ════════════════════════════════════════════════ */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y} rowIdx={contextMenu.rowIdx}
          onAction={action => handleContextAction(action, contextMenu.rowIdx)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ══ HOSPITAL STAFF PICKER ════════════════════════════════════════ */}
      <HospitalStaffPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        onDragStart={member => {
          // store in dataTransfer for drop on row
          window.__draggedStaff = member;
        }}
        ownDeptId={departmentId}
        title="Ajouter du personnel"
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: scale(1); } }
      `}</style>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────
const thBase = {
  padding: '6px 5px', fontSize: 10, fontWeight: 700, textAlign: 'center',
  background: '#1E293B', color: '#CBD5E1', position: 'sticky', top: 0, zIndex: 2,
  whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.04em',
  borderRight: '1px solid #334155', borderBottom: '1px solid #334155',
};
const tdBase = {
  padding: '5px 6px', fontSize: 11, borderBottom: '1px solid var(--border-subtle)',
  borderRight: '1px solid var(--border-subtle)', verticalAlign: 'middle',
};
const btnGhost = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px',
  borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)',
  fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
};

