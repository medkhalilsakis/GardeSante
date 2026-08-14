/**
 * SmartSpreadsheet — Cockpit tableau de garde
 * Excel/Airtable-like : freeze colonnes, drag-reorder, context menu,
 * sidebar picker, shift codes inline, draft/submit
 */
import React, {
  useState, useRef, useEffect, useMemo, useCallback,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminAPI, scheduleBuilderAPI, schedulesAPI } from '../../../api';
import HospitalStaffPicker from './HospitalStaffPicker';
import ImportModal from './ImportModal';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../store';

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

const PROPOSAL_COLOR_PALETTES = [
  {
    key: 'amber',
    bg: '#FEF9C3',
    bgDark: '#FEF08A',
    badgeBg: '#FDE047',
    border: '#EAB308',
    borderDark: '#CA8A04',
    text: '#854D0E',
    textDark: '#713F12',
    name: 'Ambre / Jaune',
    dot: '🟡',
  },
  {
    key: 'sky',
    bg: '#E0F2FE',
    bgDark: '#BAE6FD',
    badgeBg: '#7DD3FC',
    border: '#0284C7',
    borderDark: '#0369A1',
    text: '#0C4A6E',
    textDark: '#0369A1',
    name: 'Ciel / Bleu',
    dot: '🔵',
  },
  {
    key: 'purple',
    bg: '#F3E8FF',
    bgDark: '#E9D5FF',
    badgeBg: '#C084FC',
    border: '#9333EA',
    borderDark: '#7E22CE',
    text: '#581C87',
    textDark: '#6B21A8',
    name: 'Violet',
    dot: '🟣',
  },
  {
    key: 'emerald',
    bg: '#D1FAE5',
    bgDark: '#A7F3D0',
    badgeBg: '#6EE7B7',
    border: '#10B981',
    borderDark: '#047857',
    text: '#064E3B',
    textDark: '#065F46',
    name: 'Émeraude / Vert',
    dot: '🟢',
  },
  {
    key: 'rose',
    bg: '#FFE4E6',
    bgDark: '#FECDD3',
    badgeBg: '#FDA4AF',
    border: '#F43F5E',
    borderDark: '#BE123C',
    text: '#881337',
    textDark: '#9F1239',
    name: 'Rose',
    dot: '🔴',
  },
  {
    key: 'orange',
    bg: '#FFEDD5',
    bgDark: '#FED7AA',
    badgeBg: '#FDBA74',
    border: '#F97316',
    borderDark: '#C2410C',
    text: '#7C2D12',
    textDark: '#9A3412',
    name: 'Orange',
    dot: '🟠',
  },
];

const getProposalPalette = (index = 0) => PROPOSAL_COLOR_PALETTES[index % PROPOSAL_COLOR_PALETTES.length];

// Teinte réservée aux agents empruntés à un autre service, tant que leur chef
// n'a pas répondu. Volontairement distincte des palettes de propositions
// (ambre/orange) pour qu'on ne confonde pas les deux signaux.
const PENDING_EXT = {
  bg: 'rgba(249, 115, 22, .10)',
  bgDark: 'rgba(249, 115, 22, .20)',
  border: '#F97316',
  text: '#9A3412',
};

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
  if (typeof value === 'string') {
    const direct = value.match(/^\d{4}-\d{2}-\d{2}/);
    if (direct) return direct[0];
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value);
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeRowPeriods = (row, fallbackStart = '', fallbackEnd = '') => {
  const source = Array.isArray(row?.periods)
    ? row.periods
    : [{ startDate: row?.periodStart || row?.period_start || fallbackStart, endDate: row?.periodEnd || row?.period_end || fallbackEnd }];
  const periods = source
    .map(period => ({
      startDate: dateKey(period?.startDate || period?.start || period?.periodStart || period?.period_start),
      endDate: dateKey(period?.endDate || period?.end || period?.periodEnd || period?.period_end),
    }))
    .filter(period => period.startDate || period.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return periods.filter((period, index) => index === 0
    || period.startDate !== periods[index - 1].startDate
    || period.endDate !== periods[index - 1].endDate);
};

const periodBounds = (periods = []) => ({
  startDate: periods[0]?.startDate || '',
  endDate: periods.at(-1)?.endDate || '',
});

const dateInRowPeriods = (date, row, fallbackStart = '', fallbackEnd = '') => {
  const key = dateKey(date);
  return normalizeRowPeriods(row, fallbackStart, fallbackEnd)
    .some(period => key >= period.startDate && key <= period.endDate);
};

const periodsLabel = (periods = [], compact = false) => periods
  .map(period => compact ? `${period.startDate} → ${period.endDate}` : `du ${period.startDate} au ${period.endDate}`)
  .join(' ; ');

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
function ShiftCell({ code, onClick, isProposed, isConflict, proposedCode, originalCode, proposerName, palette }) {
  const displayCode = isProposed ? proposedCode : code;
  const m = displayCode && displayCode.length === 1 ? SHIFT_META[displayCode] : null;
  const pal = palette || { bg: '#FEF9C3', border: '#EAB308', borderDark: '#CA8A04', textDark: '#713F12', badgeBg: '#FDE047', dot: '🟡' };

  return (
    <div onClick={onClick}
      title={
        isConflict
          ? `⚡ CONFLIT : ${proposerName}\nCliquez pour inspecter et choisir la valeur !`
          : isProposed
          ? `⚠️ Proposition (${proposerName || 'Surveillant'}):\nAncienne garde : ${originalCode || 'Aucune'}\nNouvelle garde proposée : ${proposedCode}`
          : m
          ? `${code} – ${m.label}\nCliquer pour changer`
          : 'Cliquer pour affecter une garde'
      }
      style={{
        width: isConflict ? 34 : 28, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 5, cursor: 'pointer', fontWeight: 800, fontSize: isConflict ? 10 : 11, margin: '0 auto',
        background: isConflict
          ? 'linear-gradient(135deg, #FEF9C3 0%, #E0F2FE 100%)'
          : isProposed
          ? pal.bg
          : m ? m.bg : 'transparent',
        color: isConflict ? '#581C87' : isProposed ? pal.textDark : m ? m.text : 'var(--border-subtle)',
        border: isConflict
          ? '2px dashed #9333EA'
          : isProposed
          ? `1.5px solid ${pal.borderDark}`
          : m ? `1px solid ${m.border}` : '1px dashed var(--border-subtle)',
        boxShadow: isConflict
          ? '0 0 10px rgba(147, 51, 234, 0.4)'
          : isProposed ? `0 0 8px ${pal.border}66` : 'none',
        transition: 'all .1s', userSelect: 'none', position: 'relative'
      }}
      onMouseEnter={e => { if (!m && !isProposed && !isConflict) e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
      onMouseLeave={e => { if (!m && !isProposed && !isConflict) e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
    >
      {isProposed && (
        <span style={{
          position: 'absolute', top: -3, right: -3, width: 7, height: 7, borderRadius: '50%',
          background: '#EAB308', border: '1px solid #713F12', boxShadow: '0 0 4px rgba(234,179,8,0.8)'
        }} />
      )}
      {displayCode || '·'}
    </div>
  );
}

function MultiPeriodPicker({ row, min, max, onChange, onClose }) {
  const [periods, setPeriods] = useState(() => normalizeRowPeriods(row, min, max));
  const [range, setRange] = useState({ startDate: min, endDate: max });

  const addRange = () => {
    if (!range.startDate || !range.endDate || range.startDate > range.endDate) {
      toast.error('Choisissez une période valide.');
      return;
    }
    if (range.startDate < min || range.endDate > max) {
      toast.error(`La période doit rester comprise entre le ${min} et le ${max}.`);
      return;
    }
    const next = [...periods, range]
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
    if (next.some((period, index) => index > 0 && period.startDate <= next[index - 1].endDate)) {
      toast.error('Les périodes ne peuvent pas se chevaucher.');
      return;
    }
    setPeriods(next);
  };

  const save = () => {
    if (!periods.length) {
      toast.error('Ajoutez au moins une période.');
      return;
    }
    const bounds = periodBounds(periods);
    onChange({ periods, periodStart: bounds.startDate, periodEnd: bounds.endDate });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 5200, background: 'rgba(15,23,42,.58)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ width: 'min(680px, 100%)', maxHeight: '88vh', overflow: 'auto', background: 'var(--bg-card)', borderRadius: 16, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,.35)' }} onClick={event => event.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
          <div>
            <strong>Périodes d'affectation</strong>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              Affectez la période complète ou plusieurs plages distinctes comprises dans le planning.
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ ...btnGhost, padding: '5px 9px' }}>✕</button>
        </div>

        <button type="button" onClick={() => setPeriods([{ startDate: min, endDate: max }])} style={{ ...btnGhost, width: '100%', justifyContent: 'center', marginBottom: 12, background: 'var(--color-primary-10)', borderColor: 'var(--color-primary-30)', color: 'var(--color-primary)' }}>
          Utiliser toute la période du planning : {min} → {max}
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, padding: 12, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 14 }}>
          <input type="date" value={range.startDate} min={min} max={max} onChange={event => setRange(value => ({ ...value, startDate: event.target.value, endDate: event.target.value > value.endDate ? event.target.value : value.endDate }))} style={weekInputStyle} />
          <input type="date" value={range.endDate} min={range.startDate || min} max={max} onChange={event => setRange(value => ({ ...value, endDate: event.target.value }))} style={weekInputStyle} />
          <button type="button" onClick={addRange} style={{ ...btnGhost, background: 'var(--color-primary)', color: '#fff' }}>Ajouter</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {periods.map((period, index) => (
            <div key={`${period.startDate}-${period.endDate}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--color-primary-10)', color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 }}>{index + 1}</span>
              <strong style={{ flex: 1, fontSize: 12 }}>{period.startDate} → {period.endDate}</strong>
              <button type="button" onClick={() => setPeriods(current => current.filter((_, itemIndex) => itemIndex !== index))} title="Supprimer cette période" style={{ ...btnGhost, padding: '5px 8px', color: 'var(--color-danger)' }}><IcoTrash /></button>
            </div>
          ))}
          {!periods.length && <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border-default)', borderRadius: 9, color: 'var(--text-muted)', fontSize: 12 }}>Aucune période ajoutée.</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Annuler</button>
          <button type="button" onClick={save} style={{ ...btnGhost, background: 'var(--color-primary)', color: '#fff' }}>Enregistrer les périodes</button>
        </div>
      </div>
    </div>
  );
}

function SpecialDatesPicker({ row, allowedDays, holidays = [], onChange, onClose }) {
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const selected = new Set(Object.entries(row?.shifts || {})
    .filter(([, code]) => code && code !== 'R')
    .map(([date]) => dateKey(date)));
  const allowedKeys = allowedDays.map(dateKey);
  const holidayName = key => holidays
    .filter(h => key >= dateKey(h.start_date) && key <= dateKey(h.end_date))
    .map(h => h.name).join(', ');

  const commit = (nextSelected) => {
    const nextShifts = { ...(row?.shifts || {}) };
    allowedKeys.forEach(key => {
      if (nextSelected.has(key)) nextShifts[key] = nextShifts[key] && nextShifts[key] !== 'R' ? nextShifts[key] : 'G';
      else delete nextShifts[key];
    });
    onChange(nextShifts);
  };

  const toggle = key => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    commit(next);
  };

  const addRange = () => {
    if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return toast.error('Choisissez une plage valide.');
    const next = new Set(selected);
    allowedKeys.filter(key => key >= rangeStart && key <= rangeEnd).forEach(key => next.add(key));
    if (next.size === selected.size) return toast.error('Cette plage ne contient aucun week-end ou jour férié autorisé.');
    commit(next);
    setRangeStart(''); setRangeEnd('');
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 5200, background: 'rgba(15,23,42,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div style={{ width: 'min(760px, 100%)', maxHeight: '86vh', overflow: 'auto', background: 'var(--bg-card)', borderRadius: 16, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,.35)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div><strong>Jours de garde spéciaux</strong><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Sélectionnez un jour, plusieurs jours, ou une plage. Seuls les samedis, dimanches et jours fériés seront ajoutés.</div></div>
          <button type="button" onClick={onClose} style={{ ...btnGhost, padding: '5px 9px' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, padding: 12, borderRadius: 10, background: '#FFFBEB', border: '1px solid #FDE68A', marginBottom: 14 }}>
          <input type="date" value={rangeStart} min={allowedKeys[0]} max={allowedKeys.at(-1)} onChange={e => setRangeStart(e.target.value)} style={weekInputStyle} />
          <input type="date" value={rangeEnd} min={rangeStart || allowedKeys[0]} max={allowedKeys.at(-1)} onChange={e => setRangeEnd(e.target.value)} style={weekInputStyle} />
          <button type="button" onClick={addRange} style={{ ...btnGhost, background: '#FEF3C7', color: '#92400E', borderColor: '#F59E0B' }}>Ajouter la plage</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 }}>
          {allowedKeys.map(key => {
            const date = new Date(`${key}T12:00:00`);
            const holiday = holidayName(key);
            const checked = selected.has(key);
            return <button type="button" key={key} onClick={() => toggle(key)} style={{ padding: '9px 10px', textAlign: 'left', borderRadius: 9, cursor: 'pointer', border: `1.5px solid ${checked ? '#7C3AED' : holiday ? '#D97706' : '#C4B5FD'}`, background: checked ? '#EDE9FE' : holiday ? '#FFFBEB' : '#F5F3FF', color: checked ? '#5B21B6' : 'var(--text-primary)' }}>
              <div style={{ fontSize: 11, fontWeight: 900 }}>{checked ? '✓ ' : ''}{DOW_FR[date.getDay()]} {date.getDate()} {MONTH_FR[date.getMonth()]}</div>
              <div style={{ fontSize: 9, color: holiday ? '#B45309' : 'var(--text-muted)', marginTop: 2 }}>{holiday || 'Week-end'}</div>
            </button>;
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#6D28D9' }}>{selected.size} date(s) sélectionnée(s)</span>
          <button type="button" onClick={onClose} style={{ ...btnGhost, background: 'var(--color-primary)', color: '#fff' }}>Terminer</button>
        </div>
      </div>
    </div>
  );
}

export function PeriodTimeline({ rows, start, end }) {
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
          const periods = normalizeRowPeriods(row, dateKey(start), dateKey(end));
          return <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '210px 1fr', minHeight: 52, borderBottom: '1px solid var(--border-subtle)', alignItems: 'center' }}>
            <div style={{ paddingRight: 12 }}><strong style={{ fontSize: 12 }}>{row.lastName} {row.firstName}</strong><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.roleName || 'Fonction non renseignée'} · {periods.length} période(s)</div></div>
            <div style={{ height: 24, position: 'relative', background: 'var(--bg-elevated)', borderRadius: 6 }}>
              {periods.map((period, index) => { const left = Math.max(0, ((toDay(period.startDate) - first) / total) * 100); const width = Math.max(2, ((toDay(period.endDate) - toDay(period.startDate) + 1) / total) * 100); return <div key={`${period.startDate}-${period.endDate}-${index}`} title={`${period.startDate} 00:00:00 → ${period.endDate} 23:59:59`} style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, minWidth: 12, top: 2, bottom: 2, borderRadius: 5, background: index % 2 ? '#7C3AED' : 'var(--color-primary)', color: '#fff', fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{period.startDate} → {period.endDate}</div>; })}
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

export function DetailedCalendar({ rows, days, start, end, holidays = [], weekOrganization = [], isSpecialSchedule = false }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const staff = useMemo(() => rows
    .filter(row => row.userId || row.lastName)
    .map((row, index) => ({
      row,
      key: row.userId || row.id,
      color: STAFF_PALETTE[index % STAFF_PALETTE.length],
      name: `${row.lastName} ${row.firstName}`.trim() || 'Agent',
      role: row.roleName || 'Fonction non renseignée',
      periods: normalizeRowPeriods(row, dateKey(start), dateKey(end)),
      selectedDates: new Set(Object.entries(row.shifts || {}).filter(([, code]) => code && code !== 'R').map(([date]) => dateKey(date))),
    })), [rows, start, end]);

  const dailyMap = useMemo(() => {
    const map = Object.fromEntries(days.map(day => [dateKey(day), []]));
    staff.forEach(person => {
      days.forEach(day => {
        const key = dateKey(day);
        if (isSpecialSchedule ? person.selectedDates.has(key) : person.periods.some(period => key >= period.startDate && key <= period.endDate)) map[key].push(person);
      });
    });
    return map;
  }, [days, staff, isSpecialSchedule]);

  const totalPresences = useMemo(() => Object.values(dailyMap).reduce((total, people) => total + people.length, 0), [dailyMap]);

  return (
    <div style={{ padding: 20, background: 'var(--bg-card)', borderRadius: 12, minHeight: 400 }}>
      <div style={{ padding: '16px 20px', borderRadius: 12, background: 'linear-gradient(135deg, rgba(27,79,202,.08), rgba(124,58,237,.08))', border: '1px solid rgba(27,79,202,.2)', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-primary)' }}>Calendrier détaillé des présences</div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)', maxWidth: 760 }}>Vue de présentation : chaque membre du tableur possède une couleur. Son point apparaît sur tous les jours compris entre son début et sa fin de période.</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ background: 'var(--bg-card)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Personnel</div><div style={{ fontWeight: 800, color: '#7C3AED' }}>{staff.length}</div></div>
            <div style={{ background: 'var(--bg-card)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', textAlign: 'center' }}><div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Présences</div><div style={{ fontWeight: 800, color: 'var(--color-primary)' }}>{totalPresences}</div></div>
          </div>
        </div>
        {staff.length > 0 && <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {staff.map(person => <span key={person.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 20, background: 'var(--bg-card)', border: `1px solid ${person.color}55`, fontSize: 11, fontWeight: 700 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: person.color }} />{person.name} <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>· {person.role}</span></span>)}
        </div>}
      </div>

      {weekOrganization.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '10px 12px', marginBottom: 14, borderRadius: 10, background: 'var(--bg-elevated)' }}>{weekOrganization.map((group, index) => <div key={group.id || index} style={{ borderLeft: `5px solid ${group.color || '#6366F1'}`, padding: '6px 10px', borderRadius: 6, background: `${group.color || '#6366F1'}12`, fontSize: 11 }}><strong style={{ color: group.color || '#6366F1' }}>{group.name}</strong><div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{group.startDate} → {group.endDate}</div></div>)}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
        {days.map(day => {
          const key = dateKey(day);
          const people = dailyMap[key] || [];
          const weekend = isWeekend(day);
          const matchingHolidays = holidays.filter(h => {
            const hStart = dateKey(h.start_date);
            const hEnd = dateKey(h.end_date);
            return key >= hStart && key <= hEnd;
          });
          const isHolidayDay = matchingHolidays.length > 0;
          const holidayNames = matchingHolidays.map(h => h.name).filter(Boolean).join(', ') || 'Jour Férié';

          let borderStyle = '1px solid var(--border-subtle)';
          let bgStyle = 'var(--bg-card)';

          if (isHolidayDay) {
            borderStyle = '1.5px solid #F59E0B';
            bgStyle = 'rgba(245, 158, 11, 0.06)';
          } else if (weekend) {
            borderStyle = '1.5px solid #C7D2FE';
            bgStyle = 'rgba(99,102,241,.03)';
          }

          return (
            <button type="button" key={key} onClick={() => setSelectedDay({ day, people, isHolidayDay, holidayNames, weekend })} style={{ textAlign: 'left', borderRadius: 10, border: borderStyle, background: bgStyle, padding: 12, cursor: 'pointer', color: 'var(--text-primary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 7, marginBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
                <strong style={{ color: isHolidayDay ? '#B45309' : weekend ? '#4F46E5' : 'var(--text-primary)' }}>
                  {DOW_FR[day.getDay()]} {day.getDate()} {MONTH_FR[day.getMonth()]}
                </strong>
                <span style={{ fontSize: 10, color: isHolidayDay ? '#B45309' : weekend ? '#4F46E5' : 'var(--text-muted)', fontWeight: isHolidayDay || weekend ? 800 : 400 }}>
                  {isHolidayDay ? `🟡 Jour Férié (${holidayNames})` : weekend ? '🟣 Week-end' : people.length + ' présent(s)'}
                </span>
              </div>
              {people.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{people.map(person => <span key={person.key} title={`${person.name} — ${person.role}`} style={{ width: 12, height: 12, borderRadius: '50%', background: person.color, boxShadow: `0 0 0 2px ${person.color}22` }} />)}</div> : <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Aucun personnel sur cette période</span>}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 6000, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setSelectedDay(null)}>
          <div style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: 520, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.3)', border: '1px solid var(--border-subtle)' }} onClick={event => event.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
              <div>
                <strong>Personnel présent le {DOW_FR[selectedDay.day.getDay()]} {selectedDay.day.getDate()} {MONTH_FR[selectedDay.day.getMonth()]}</strong>
                {selectedDay.isHolidayDay && <div style={{ fontSize: 11, color: '#B45309', fontWeight: 800, marginTop: 2 }}>🟡 {selectedDay.holidayNames}</div>}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Consultation uniquement — aucune modification du tableur.</div>
              </div>
              <button type="button" onClick={() => setSelectedDay(null)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            {selectedDay.people.length ? <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{selectedDay.people.map(person => <div key={person.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: 'var(--bg-elevated)', borderLeft: `5px solid ${person.color}` }}><span style={{ width: 12, height: 12, borderRadius: '50%', background: person.color }} /><div><strong style={{ fontSize: 13 }}>{person.name}</strong><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{person.role} · {periodsLabel(person.periods, true)}</div></div></div>)}</div> : <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Aucun personnel prévu ce jour.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
function CellProposalModal({ cellInfo, onClose, onApplyValue }) {
  if (!cellInfo) return null;
  const { rowName, colLabel, originalVal, proposals } = cellInfo;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.65)', backdropFilter: 'blur(4px)', zIndex: 3500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-subtle)', padding: 24, width: 490, maxWidth: '94vw', boxShadow: '0 24px 60px rgba(0,0,0,.35)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#9333EA', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>⚡</span> <span>Propositions & Conflits sur cette case</span>
            </div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 900, color: 'var(--text-primary)' }}>
              {rowName}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Champ : <strong>{colLabel}</strong>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>✕</button>
        </div>

        {/* Valeur officielle actuelle */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Officiel Actuel :</span>
          <strong style={{ fontSize: 13, color: 'var(--text-primary)', padding: '2px 8px', borderRadius: 6, background: 'rgba(0,0,0,.06)' }}>
            {originalVal || 'Non renseigné'}
          </strong>
        </div>

        {/* Liste des propositions side by side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 320, overflowY: 'auto', marginBottom: 20 }}>
          {proposals.map((prop, idx) => (
            <div key={prop.proposalId || idx} style={{
              padding: 14, borderRadius: 12,
              background: prop.palette.bg,
              border: `2px solid ${prop.palette.borderDark}`,
              boxShadow: `0 4px 14px ${prop.palette.border}33`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15 }}>{prop.palette.dot}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: prop.palette.textDark }}>
                    {prop.proposerName}
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 12, background: prop.palette.badgeBg, color: prop.palette.textDark, border: `1px solid ${prop.palette.borderDark}` }}>
                    {prop.roleIcon} {prop.roleTitle}
                  </span>
                </div>

                <div style={{ fontSize: 13, fontWeight: 900, color: prop.palette.textDark, marginTop: 4 }}>
                  Proposé : <span style={{ textDecoration: 'underline', background: prop.palette.badgeBg, padding: '2px 8px', borderRadius: 6 }}>{prop.proposedVal || prop.proposedCode}</span>
                </div>

                {prop.comment && (
                  <div style={{ fontSize: 11, color: prop.palette.text, marginTop: 6, fontStyle: 'italic', background: 'rgba(255,255,255,.5)', padding: '4px 8px', borderRadius: 6 }}>
                    💬 "{prop.comment}"
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  onApplyValue(prop.rawValue ?? prop.proposedVal ?? prop.proposedCode);
                  onClose();
                }}
                style={{
                  padding: '9px 16px', borderRadius: 8, border: 'none',
                  background: prop.palette.borderDark, color: '#fff',
                  fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
                  boxShadow: '0 3px 10px rgba(0,0,0,.2)'
                }}>
                ✓ Appliquer
              </button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

const weekInputStyle = { padding: '6px 8px', borderRadius: 6, border: '1px solid #C4B5FD', background: '#fff', color: 'var(--text-primary)', fontSize: 11 };

// ── Main ─────────────────────────────────────────────────────────────────
export default function SmartSpreadsheet({ scheduleId, departmentId, onBack, onManageProposals }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();

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
  const [specialDatesPicker, setSpecialDatesPicker] = useState(null);
  const [shiftHelp, setShiftHelp] = useState(null);
  const [viewMode, setViewMode] = useState('table');
  const [dragOverRow, setDragOverRow] = useState(null);
  const [draggingRow, setDraggingRow] = useState(null);
  // Colonnes dynamiques
  const [customCols, setCustomCols]   = useState([]);
  const [weekOrganization, setWeekOrganization] = useState([]);
  const [showWeekOrganization, setShowWeekOrganization] = useState(false);
  const [showAddCol, setShowAddCol]   = useState(false);
  const [newColName, setNewColName]   = useState('');
  const [newColType, setNewColType]   = useState('text');
  const [editingColHeader, setEditingColHeader] = useState(null); // key of col being renamed
  const [colHeaderVal, setColHeaderVal] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const inputRef = useRef(null);
  const saveVersion = useRef(0);
  const downloadScheduleExport = async (format) => {
    const requests = {
      pdf: scheduleBuilderAPI.exportPDF,
      excel: scheduleBuilderAPI.exportExcel,
      csv: scheduleBuilderAPI.exportCSV,
      calendar: scheduleBuilderAPI.exportCalendarPDF,
    };
    const names = { pdf: 'tableur-garde.pdf', excel: 'tableur-garde.xlsx', csv: 'tableur-garde.csv', calendar: 'calendrier-detaille-garde.pdf' };
    try {
      const response = await requests[format](scheduleId);
      const disposition = response.headers?.['content-disposition'] || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || names[format];
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success('Export telecharge avec succes.');
    } catch (error) {
      toast.error('Impossible de generer cet export.');
    }
  };

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

  // Personnel emprunté à un autre service : l'accord du chef propriétaire est
  // demandé automatiquement mais ne bloque rien. Tant qu'il n'a pas répondu, la
  // ligne est teintée ; s'il accepte elle redevient normale ; s'il refuse le
  // serveur la retire seul, sans toucher à l'état du planning.
  const externalLoans = scheduleDetail?.externalLoans || {};
  const pendingExternalCount = useMemo(
    () => Object.values(externalLoans).filter(l => l.status === 'pending').length,
    [externalLoans]
  );

  // Change proposals fetch (du surveillant)
  const { data: propData } = useQuery({
    queryKey: ['schedule-change-proposals', scheduleId],
    queryFn: () => scheduleBuilderAPI.getChangeProposals(scheduleId),
    enabled: !!scheduleId,
  });
  const proposals = propData?.data?.data || propData?.data || [];
  const pendingProposals = useMemo(() => {
    return proposals.filter(p => p.status === 'pending');
  }, [proposals]);

  const [activeProposalId, setActiveProposalId] = useState(null);
  const [cellModalInfo, setCellModalInfo]       = useState(null);

  const proposalsWithPalettes = useMemo(() => {
    return pendingProposals.map((prop, idx) => {
      const palette = getProposalPalette(idx);
      const isSG = prop.proposer_role_code === 'general_supervisor' || (prop.proposer_role && prop.proposer_role.toLowerCase().includes('général'));
      const roleTitle = isSG ? 'Surveillant Général' : (prop.proposer_role || 'Surveillant de Service');
      const roleIcon = isSG ? '🛡️' : '📋';
      const mapByUserId = {};
      (prop.proposal?.rows || []).forEach(r => {
        const uId = r.userId || r.user_id || r.id;
        if (uId) mapByUserId[uId] = r;
      });
      return {
        ...prop,
        idx,
        palette,
        roleTitle,
        roleIcon,
        isSG,
        mapByUserId,
        proposerName: `${prop.first_name || ''} ${prop.last_name || ''}`.trim() || roleTitle,
      };
    });
  }, [pendingProposals]);

  const activeProposalsToEvaluate = useMemo(() => {
    if (!activeProposalId || activeProposalId === 'all') {
      return proposalsWithPalettes;
    }
    return proposalsWithPalettes.filter(p => p.id === activeProposalId);
  }, [proposalsWithPalettes, activeProposalId]);

  const pendingProposal = useMemo(() => {
    if (!pendingProposals.length) return null;
    if (activeProposalId === 'all') return pendingProposals[0];
    return pendingProposals.find(p => p.id === activeProposalId) || pendingProposals[0];
  }, [pendingProposals, activeProposalId]);

  const activeProposalIndex = useMemo(() => {
    if (!pendingProposal || !pendingProposals.length) return 0;
    const idx = pendingProposals.findIndex(p => p.id === pendingProposal.id);
    return idx >= 0 ? idx : 0;
  }, [pendingProposal, pendingProposals]);

  const activePalette = useMemo(() => getProposalPalette(activeProposalIndex), [activeProposalIndex]);

  const [notifyingSG, setNotifyingSG] = useState(false);
  const handleNotifySG = async () => {
    const comment = window.prompt('Note ou message pour le Surveillant Général (optionnel) :');
    if (comment === null) return;
    setNotifyingSG(true);
    try {
      const res = await scheduleBuilderAPI.notifySG(scheduleId, { comment });
      toast.success(res.data?.message || 'Planning transmis au Surveillant Général avec succès !');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la transmission au SG');
    } finally {
      setNotifyingSG(false);
    }
  };

  const [decidingProposal, setDecidingProposal] = useState(false);
  const refreshProposalData = async () => {
    await qc.refetchQueries({ queryKey: ['schedule-change-proposals', scheduleId] });
    await qc.refetchQueries({ queryKey: ['schedule-detail', scheduleId] });
  };

  const resolveProposalLocally = (proposalId, status) => {
    qc.setQueryData(['schedule-change-proposals', scheduleId], old => {
      if (!old?.data?.data || !Array.isArray(old.data.data)) return old;
      return { ...old, data: { ...old.data, data: old.data.data.map(p => p.id === proposalId ? { ...p, status } : p) } };
    });
  };

  const getMultiCellProposals = useCallback((row, colKey) => {
    if (!activeProposalsToEvaluate.length) return [];
    const cellProps = [];

    activeProposalsToEvaluate.forEach(prop => {
      if (row.isProposedNewRow) {
        const rawValue = row[colKey];
        const proposedVal = colKey === 'periods'
          ? periodsLabel(normalizeRowPeriods(row), true)
          : String(rawValue || '').trim();
        if (proposedVal) {
          cellProps.push({
            proposalId: prop.id,
            proposerName: prop.proposerName,
            roleTitle: prop.roleTitle,
            roleIcon: prop.roleIcon,
            originalVal: 'Non présent dans l’officiel',
            proposedVal,
            rawValue,
            palette: prop.palette,
            comment: prop.comment
          });
        }
      } else {
        const propRow = prop.mapByUserId[row.userId || row.id];
        if (propRow) {
          const rawValue = propRow[colKey] || propRow[colKey === 'periodStart' ? 'period_start' : colKey === 'periodEnd' ? 'period_end' : colKey];
          const currentVal = colKey === 'periods'
            ? periodsLabel(normalizeRowPeriods(row), true)
            : String(row[colKey] || '').trim();
          const proposedVal = colKey === 'periods'
            ? periodsLabel(normalizeRowPeriods(propRow), true)
            : String(rawValue || '').trim();
          if (proposedVal && proposedVal !== currentVal) {
            cellProps.push({
              proposalId: prop.id,
              proposerName: prop.proposerName,
              roleTitle: prop.roleTitle,
              roleIcon: prop.roleIcon,
              originalVal: currentVal || 'Non renseigné',
              proposedVal,
              rawValue: colKey === 'periods' ? normalizeRowPeriods(propRow) : rawValue,
              palette: prop.palette,
              comment: prop.comment
            });
          }
        }
      }
    });

    return cellProps;
  }, [activeProposalsToEvaluate]);

  const getMultiShiftProposals = useCallback((row, dateStr) => {
    if (!activeProposalsToEvaluate.length) return [];
    const shiftProps = [];

    activeProposalsToEvaluate.forEach(prop => {
      if (row.isProposedNewRow) {
        const proposedCode = (row.shifts?.[dateStr] || '').toUpperCase();
        if (proposedCode) {
          shiftProps.push({
            proposalId: prop.id,
            proposerName: prop.proposerName,
            roleTitle: prop.roleTitle,
            roleIcon: prop.roleIcon,
            originalCode: 'Aucune',
            proposedCode,
            palette: prop.palette,
            comment: prop.comment
          });
        }
      } else {
        const propRow = prop.mapByUserId[row.userId || row.id];
        if (propRow) {
          const currentCode = (row.shifts[dateStr] || '').toUpperCase();
          const proposedCode = (propRow.shifts?.[dateStr] || '').toUpperCase();
          if (proposedCode && proposedCode !== currentCode) {
            shiftProps.push({
              proposalId: prop.id,
              proposerName: prop.proposerName,
              roleTitle: prop.roleTitle,
              roleIcon: prop.roleIcon,
              originalCode: currentCode || 'Libre',
              proposedCode,
              palette: prop.palette,
              comment: prop.comment
            });
          }
        }
      }
    });

    return shiftProps;
  }, [activeProposalsToEvaluate]);

  const handleApplyProposalValue = (val) => {
    if (!cellModalInfo) return;
    const { rowId, colKey, dateStr, isShift } = cellModalInfo;
    if (isShift) {
      cycleShift(rowId, dateStr, val);
    } else if (colKey && colKey.startsWith('custom_')) {
      setRows(prev => prev.map(r => r.id === rowId ? { ...r, custom: { ...(r.custom || {}), [colKey]: val } } : r));
      dirty();
    } else if (colKey === 'periods') {
      const periods = normalizeRowPeriods({ periods: val });
      const bounds = periodBounds(periods);
      updateRow(rowId, { periods, periodStart: bounds.startDate, periodEnd: bounds.endDate });
    } else if (colKey) {
      updateRow(rowId, { [colKey]: val });
    }
    toast.success(`✓ Valeur "${val}" appliquée au planning !`);
  };

  const startYear = useMemo(() => schedule?.start_date ? new Date(schedule.start_date).getFullYear() : new Date().getFullYear(), [schedule]);
  const endYear   = useMemo(() => schedule?.end_date ? new Date(schedule.end_date).getFullYear() : startYear, [schedule, startYear]);

  const { data: holidaysRes } = useQuery({
    queryKey: ['admin-holidays', dateKey(schedule?.start_date), dateKey(schedule?.end_date)],
    queryFn: async () => {
      const result = await adminAPI.getHolidays({ startDate: dateKey(schedule.start_date), endDate: dateKey(schedule.end_date) });
      return result.data?.data || result.data || [];
    },
    enabled: !!schedule,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });
  const publicHolidays = holidaysRes || [];

  const isWeekendHolidaySchedule = schedule?.schedule_type === 'special_weekend_holiday' || schedule?.metadata?.schedule_kind === 'weekend_holiday' || schedule?.metadata?.special_days_only === true;

  const days = useMemo(() => {
    const allDays = getDays(schedule?.start_date, schedule?.end_date);
    if (!isWeekendHolidaySchedule) return allDays;

    return allDays.filter(day => {
      const key = dateKey(day);
      const dayOfWeek = day.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = publicHolidays.some(h => {
        const hStart = dateKey(h.start_date);
        const hEnd = dateKey(h.end_date);
        return key >= hStart && key <= hEnd;
      });
      return isWeekend || isHoliday;
    });
  }, [schedule, isWeekendHolidaySchedule, publicHolidays]);

  const showDailyGrid = false;
  // Un planning envoyé est en vigueur ('submitted') puis en cours ('active').
  // Les deux ouvrent le droit de proposer une modification : sans 'active', les
  // surveillants perdraient ce droit au moment même où le planning démarre.
  const canProposeChanges = ['submitted', 'active'].includes(schedule?.status) && ['service_supervisor', 'general_supervisor'].includes(user?.roleCode);
  const canDirectEdit = schedule?.status === 'draft'
    || (['submitted', 'active'].includes(schedule?.status) && user?.roleCode === 'department_head');
  const canManageProposals = ['submitted', 'active'].includes(schedule?.status) && user?.roleCode === 'department_head';
  // En revanche l'annulation d'envoi s'arrête au démarrage : un planning en
  // cours ne peut plus revenir en brouillon.
  const canCancelSubmission = schedule?.status === 'submitted' && user?.roleCode === 'department_head';

  // Build rows from schedule
  useEffect(() => {
    if (!schedule) return;
    const savedRows = schedule.metadata?.spreadsheet?.rows;
    const staffList = scheduleDetail?.staff || schedule.staff || [];
    const shifts    = scheduleDetail?.shifts || schedule.shifts || [];
    const officialRows = savedRows?.length ? savedRows : staffList;
    // Les membres ajoutés dans des propositions n’existent pas encore dans le planning officiel.
    const allProposedRows = proposalsWithPalettes.flatMap(p => p.proposal?.rows || []);
    const existingPersonnelIds = new Set(officialRows.map(m => m.userId || m.user_id || m.id).filter(Boolean));
    const sourceRows = [...officialRows, ...allProposedRows.filter(m => {
      const id = m.userId || m.user_id || m.id;
      return id && !existingPersonnelIds.has(id);
    })];
    const built = sourceRows.map(m => {
      const personnelId = m.userId || m.user_id || m.id;
      const isProposedNewRow = Boolean(pendingProposal && !existingPersonnelIds.has(personnelId));
      const shiftMap = { ...(m.shifts || {}) };
      shifts.filter(s => s.user_id === personnelId).forEach(s => {
        const d = String(s.shift_date).split('T')[0];
        shiftMap[d] = (s.shift_type_code || 'G').charAt(0).toUpperCase();
      });
      return {
        id: `row-${personnelId}`, userId: personnelId,
        lastName: m.last_name || m.lastName || '', firstName: m.first_name || m.firstName || '',
        roleName: m.role_name || m.roleName || '', phone: m.phone || '', matricule: m.matricule || '',
        periods: normalizeRowPeriods(m, dateKey(schedule.start_date), dateKey(schedule.end_date)),
        periodStart: dateKey(m.periodStart || m.period_start) || dateKey(schedule.start_date),
        periodEnd: dateKey(m.periodEnd || m.period_end) || dateKey(schedule.end_date),
        shiftStart: m.shiftStart || '07:00', shiftEnd: m.shiftEnd || '07:00',
        // Garde à domicile — absent ⇒ false ⇒ garde à l'hôpital, en présence.
        // Les plannings enregistrés avant cette colonne restent donc en présence.
        atHome: (m.atHome ?? m.at_home) === true,
        deptId: m.department_id || departmentId,
        shifts: shiftMap, isNew: false,
        isProposedNewRow,
        custom: m.custom || {},
      };
    });
    // Ajouter une ligne vide si aucun personnel
    if (built.length === 0) {
      built.push(emptyRow());
    }
    setRows(built);
    setCustomCols(schedule.metadata?.spreadsheet?.customCols || []);
    setWeekOrganization(schedule.metadata?.spreadsheet?.week_organization || []);
  }, [schedule, scheduleDetail, departmentId, pendingProposal]);

  const emptyRow = (idx = Date.now()) => ({
    id: `new-${idx}`, userId: null,
    lastName: '', firstName: '', roleName: '', phone: '', matricule: '',
    periods: [{ startDate: dateKey(schedule?.start_date), endDate: dateKey(schedule?.end_date) }],
    periodStart: dateKey(schedule?.start_date), periodEnd: dateKey(schedule?.end_date),
    shiftStart: '07:00', shiftEnd: '07:00',
    atHome: false,
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
    { key: 'periods',     label: 'Périodes',        w: 230, type: 'periods' },
    { key: 'shiftStart',  label: 'Durée - début', w: 105, type: 'time' },
    { key: 'shiftEnd',    label: 'Durée - fin',    w: 105, type: 'time' },
    // Nature de la garde : décochée par défaut ⇒ garde à l'hôpital, en présence.
    { key: 'atHome',      label: 'Garde à domicile', w: 112, type: 'bool' },
  ];
  const specialFixedCols = [
    ...fixedCols.slice(0, 5),
    { key: 'specialDates', label: 'Jours / périodes autorisés', w: 190, type: 'special-dates' },
    ...fixedCols.filter(c => ['shiftStart', 'shiftEnd', 'atHome'].includes(c.key)),
  ];
  const activeFixedCols = isWeekendHolidaySchedule ? specialFixedCols : fixedCols;
  const visibleFixedCols = activeFixedCols.filter(c => !hiddenCols.has(c.key));
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
    const isHeadEditingPublished = user?.roleCode === 'department_head'
      && ['submitted', 'active'].includes(schedule?.status);
    const roster = rows.filter(r => r.userId && !(isHeadEditingPublished && r.isProposedNewRow));
    if (!roster.length || !schedule) return [];
    const start = dateKey(schedule.start_date);
    const end = dateKey(schedule.end_date);
    const errors = [];
    roster.forEach(r => {
      const name = `${r.lastName} ${r.firstName}`.trim() || 'Personnel sélectionné';
      if (isWeekendHolidaySchedule) {
        const selected = Object.entries(r.shifts || {}).filter(([, code]) => code && code !== 'R').map(([date]) => dateKey(date));
        if (!selected.length) errors.push(`${name} : sélectionnez au moins un week-end ou jour férié.`);
        const invalid = selected.find(date => !days.some(day => dateKey(day) === date));
        if (invalid) errors.push(`${name} : la date ${invalid} n'est pas un week-end ou un jour férié autorisé.`);
        return;
      }
      const periods = normalizeRowPeriods(r, start, end);
      if (!periods.length) errors.push(`${name} : ajoutez au moins une période.`);
      periods.forEach((period, index) => {
        const label = periods.length > 1 ? `période ${index + 1}` : 'période';
        if (!period.startDate || !period.endDate) errors.push(`${name} : les deux dates de la ${label} sont obligatoires.`);
        else if (period.startDate < start || period.endDate > end) errors.push(`${name} : la ${label} doit rester entre le ${start} et le ${end}.`);
        else if (period.startDate > period.endDate) errors.push(`${name} : le début de la ${label} doit précéder sa fin.`);
        if (index > 0 && period.startDate <= periods[index - 1].endDate) errors.push(`${name} : les périodes ${index} et ${index + 1} se chevauchent.`);
      });
    });
    if (!isWeekendHolidaySchedule) {
      if (!roster.some(r => normalizeRowPeriods(r, start, end).some(period => period.startDate === start))) errors.push(`Couverture manquante : au moins un personnel doit commencer le ${start}.`);
      if (!roster.some(r => normalizeRowPeriods(r, start, end).some(period => period.endDate === end))) errors.push(`Couverture manquante : au moins un personnel doit finir le ${end}.`);
    }
    return errors;
  }, [rows, schedule, user?.roleCode, isWeekendHolidaySchedule, days]);

  const dirty = useCallback(() => { saveVersion.current += 1; setIsDirty(true); }, []);

  const existingUserIds = useMemo(() => {
    return rows.map(r => r.userId).filter(Boolean);
  }, [rows]);

  const { data: searchData } = useQuery({
    queryKey: ['spreadsheet-person-search', personSearch?.value],
    queryFn: () => schedulesAPI.getHospitalStaff({ search: personSearch?.value, limit: 12 }),
    enabled: !!personSearch?.value?.trim(),
  });
  const searchResults = useMemo(() => {
    const raw = searchData?.data?.data || searchData?.data || [];
    const set = new Set(existingUserIds);
    return raw.filter(member => !set.has(member.id));
  }, [searchData, existingUserIds]);

  // ── Row mutations ──
  const updateRow = (id, patch) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
    dirty();
  };

  const cycleShift = (rowId, dateStr, forcedCode) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      if (!isWeekendHolidaySchedule && !dateInRowPeriods(dateStr, r, dateKey(schedule?.start_date), dateKey(schedule?.end_date))) return r;
      const cur = r.shifts[dateStr];
      const idx = cur ? SHIFT_CODES.indexOf(cur) : -1;
      const next = forcedCode ?? SHIFT_CODES[(idx + 1) % (SHIFT_CODES.length + 1)];
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
    const copy = { ...src, id: `new-${Date.now()}`, isNew: true, periods: normalizeRowPeriods(src).map(period => ({ ...period })), shifts: { ...src.shifts } };
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
    // Personnel externe : la demande d'accord part toute seule à l'enregistrement.
    // Rien n'est bloqué ici — la ligne sera simplement teintée tant que le chef
    // propriétaire n'a pas répondu.
    if (member.dept_id && member.dept_id !== departmentId) {
      toast(`Personnel externe (${member.dept_name}) — une demande d'accord partira à son chef à l'enregistrement. Le tableur reste enregistrable et envoyable.`, { icon: '🔔', duration: 5000 });
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
      toast.error(`Modification non enregistrée : ${periodErrors[0]}`);
      return;
    }
    const versionAtStart = saveVersion.current;
    // Les nouvelles lignes jaunes appartiennent encore à une proposition en
    // attente. Une sauvegarde directe du chef ne doit pas les accepter en bloc :
    // elles passent par les boutons d'acceptation/refus des propositions.
    const rowsToSave = canDirectEdit && ['submitted', 'active'].includes(schedule?.status)
      ? rows.filter(row => !row.isProposedNewRow)
      : rows;
    setSaving(true);
    try {
      if (canProposeChanges) {
        await scheduleBuilderAPI.proposeChanges(scheduleId, { rows, customCols, week_organization: weekOrganization });
        if (saveVersion.current === versionAtStart) setIsDirty(false);
        if (!silent) toast.success('Proposition envoyée au chef de service');
        return;
      }
      const res = await scheduleBuilderAPI.saveDraft(scheduleId, { rows: rowsToSave, customCols, week_organization: weekOrganization });
      // Une modification intervenue pendant la requête reste marquée à sauvegarder.
      if (saveVersion.current === versionAtStart) setIsDirty(false);
      qc.invalidateQueries({ queryKey: ['schedule-detail', scheduleId] });
      qc.invalidateQueries({ queryKey: ['staff-loans'] });
      if (!silent) {
        const waiting = res?.data?.data?.pendingExternal?.length || 0;
        const savedLabel = schedule?.status === 'draft' ? 'Brouillon enregistré' : 'Planning mis à jour';
        if (waiting) toast.success(`${savedLabel} — ${waiting} agent(s) externe(s) en attente de l'accord de leur chef`);
        else toast.success(savedLabel);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Impossible d\'enregistrer les modifications. Vérifiez la connexion au serveur.');
    } finally { setSaving(false); }
  };

  // Sauvegarde automatique en brouillon : les modifications ne sont jamais perdues.
  useEffect(() => {
    if (!isDirty || saving || schedule?.status !== 'draft') return undefined;
    const timer = setTimeout(() => saveDraft(true), 1200);
    return () => clearTimeout(timer);
  }, [isDirty, rows, customCols, weekOrganization]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const cancelSubmission = async () => {
    const reason = window.prompt('Motif obligatoire de l’annulation :');
    if (!reason?.trim()) return;
    try {
      await scheduleBuilderAPI.cancelSubmission(scheduleId, reason.trim());
      toast.success('Envoi annulé : les surveillants ont été informés.');
      qc.invalidateQueries({ queryKey: ['schedule-detail', scheduleId] });
    } catch (err) { toast.error(err.response?.data?.message || 'Impossible d’annuler l’envoi.'); }
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>
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
        {pendingExternalCount > 0 && (
          <div style={{ width: '100%', padding: '8px 10px', borderRadius: 7, background: PENDING_EXT.bg, border: `1px dashed ${PENDING_EXT.border}`, color: PENDING_EXT.text, fontSize: 11, fontWeight: 600 }}>
            ⏳ {pendingExternalCount} personnel(s) d'un autre service en attente de l'accord de leur chef.
            Les lignes concernées sont teintées. Vous pouvez enregistrer et envoyer ce planning normalement :
            en cas de refus, seule la ligne concernée sera retirée automatiquement.
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

        {/* Exports du contenu du tableur et du calendrier detaille */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)' }}>Export</span>
          <button type="button" onClick={() => downloadScheduleExport('pdf')} title="Exporter le contenu du tableur en PDF" style={{ ...btnGhost, padding: '5px 8px', color: '#DC2626', borderColor: '#FCA5A5' }}>PDF</button>
          <button type="button" onClick={() => downloadScheduleExport('excel')} title="Exporter le contenu du tableur en Excel" style={{ ...btnGhost, padding: '5px 8px', color: '#059669', borderColor: '#6EE7B7' }}>Excel</button>
          <button type="button" onClick={() => downloadScheduleExport('csv')} title="Exporter le contenu du tableur en CSV" style={{ ...btnGhost, padding: '5px 8px', color: '#2563EB', borderColor: '#93C5FD' }}>CSV</button>
          <button type="button" onClick={() => downloadScheduleExport('calendar')} title="Exporter le calendrier detaille en PDF horizontal" style={{ ...btnGhost, padding: '5px 8px', color: '#7C3AED', borderColor: '#C4B5FD' }}>Calendrier PDF</button>
        </div>
        {/* Add column button */}
        <button onClick={() => { setShowAddCol(true); setNewColName(''); setNewColType('text'); }} style={{ ...btnGhost, color: '#8B5CF6', borderColor: '#8B5CF6', display: 'flex', alignItems: 'center', gap: 5 }}>
          <IcoPlus /> Colonne
        </button>

        {/* Transmettre au SG — possible tant que le planning est en vigueur
            ('submitted' avant son démarrage, 'active' une fois en cours). */}
        {['service_supervisor', 'department_head'].includes(user?.roleCode) && ['submitted', 'active'].includes(schedule?.status) && (
          <button
            type="button"
            onClick={handleNotifySG}
            disabled={notifyingSG}
            title="Envoyer une notification au Surveillant Général pour consultation et suggestions"
            style={{
              padding: '6px 12px', borderRadius: 7, border: '1px solid #7C3AED',
              background: '#F3E8FF', color: '#6B21A8', fontSize: 11, fontWeight: 700,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5
            }}
          >
            📧 Transmettre au SG
          </button>
        )}

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
          {activeFixedCols.map(c => {
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
      {/* ══ BANNIÈRE CONSULTATION SURVEILLANT GÉNÉRAL ════════════════════ */}
      {user?.roleCode === 'general_supervisor' && (
        <div style={{
          margin: '10px 14px', padding: '12px 16px', borderRadius: 12,
          background: 'linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)',
          border: '2px solid #9333EA', boxShadow: '0 4px 14px rgba(147, 51, 234, 0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>👁️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#581C87' }}>
                Mode Consultation & Suggestions — Surveillant Général
              </div>
              <div style={{ fontSize: 11, color: '#6B21A8', marginTop: 2 }}>
                Vous consultez ce planning de garde. Vous pouvez proposer des modifications qui seront immédiatement transmises au Chef de Service pour validation finale.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ BANNIÈRE PROPOSITION SURVEILLANT ════════════════════════════ */}
      {pendingProposals.length > 0 && (
        <div style={{
          margin: '10px 14px', padding: '14px 18px', borderRadius: 12,
          background: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1)
            ? 'linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%)'
            : `linear-gradient(135deg, ${activePalette.bg} 0%, ${activePalette.bgDark} 100%)`,
          border: `2px solid ${activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '#9333EA' : activePalette.border}`,
          boxShadow: `0 4px 16px ${activePalette.border}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12
        }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '#581C87' : activePalette.text }}>
              <span style={{ fontSize: 16 }}>{activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '🌈' : activePalette.dot}</span>
              <span>
                {pendingProposals.length > 1
                  ? `${pendingProposals.length} propositions de modification en attente`
                  : `Proposition de modification reçue de ${pendingProposal.first_name} ${pendingProposal.last_name} (${pendingProposal.proposer_role || 'Surveillant'})`}
              </span>
              <span style={{ padding: '2px 8px', borderRadius: 12, background: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '#E9D5FF' : activePalette.badgeBg, border: `1px solid ${activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '#7E22CE' : activePalette.borderDark}`, fontSize: 10, fontWeight: 800, color: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '#6B21A8' : activePalette.textDark }}>
                {pendingProposals.length > 1 ? (activeProposalId === 'all' || !activeProposalId ? 'Vue Combinée (Toutes)' : `Filtre: ${pendingProposal.first_name} ${pendingProposal.last_name}`) : 'En attente de décision'}
              </span>
            </div>

            {/* Onglets si plusieurs propositions */}
            {pendingProposals.length > 1 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#581C87' }}>Mode d'affichage :</span>

                {/* Tab vue combinée */}
                <button
                  type="button"
                  onClick={() => setActiveProposalId('all')}
                  style={{
                    padding: '4px 12px', borderRadius: 14, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                    border: `1.5px solid ${activeProposalId === 'all' || !activeProposalId ? '#7E22CE' : '#C084FC'}`,
                    background: activeProposalId === 'all' || !activeProposalId ? '#E9D5FF' : '#F3E8FF',
                    color: '#581C87',
                    boxShadow: activeProposalId === 'all' || !activeProposalId ? '0 2px 8px rgba(126,34,206,.3)' : 'none',
                    display: 'flex', alignItems: 'center', gap: 5
                  }}
                >
                  <span>🌈</span>
                  <span>Toutes les propositions ({pendingProposals.length}) — Vue Combinée</span>
                </button>

                {/* Tabs individuels */}
                {proposalsWithPalettes.map(prop => {
                  const isSel = activeProposalId === prop.id;
                  const pal = prop.palette;
                  return (
                    <button
                      key={prop.id}
                      type="button"
                      onClick={() => setActiveProposalId(prop.id)}
                      style={{
                        padding: '4px 12px', borderRadius: 14, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        border: `1.5px solid ${isSel ? pal.borderDark : pal.border}`,
                        background: isSel ? pal.badgeBg : pal.bg,
                        color: pal.textDark,
                        boxShadow: isSel ? `0 2px 8px ${pal.border}66` : 'none',
                        display: 'flex', alignItems: 'center', gap: 5
                      }}
                    >
                      <span>{pal.dot}</span>
                      <span>{prop.proposerName} ({prop.roleTitle})</span>
                    </button>
                  );
                })}
              </div>
            )}

            {pendingProposal.comment && (
              <div style={{ fontSize: 11, color: activePalette.textDark, marginTop: 4, fontStyle: 'italic' }}>
                💬 Note : "{pendingProposal.comment}"
              </div>
            )}
            <div style={{ fontSize: 11, color: activeProposalId === 'all' || (!activeProposalId && pendingProposals.length > 1) ? '#6B21A8' : activePalette.text, marginTop: 4, fontWeight: 600 }}>
              💡 Chaque auteur a sa couleur propre. En cas de propositions multiples sur le même champ, la case s'affiche avec ⚡ (cliquez sur la case pour inspecter les propositions en conflit).
            </div>
          </div>

          {user?.roleCode === 'department_head' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Bouton ACCEPTER TOUT si plusieurs propositions */}
              {pendingProposals.length > 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setDecidingProposal(true);
                      await scheduleBuilderAPI.decideAllProposals(scheduleId, { decision: 'accepted' });
                      toast.success(`✓ Les ${pendingProposals.length} propositions ont été acceptées et appliquées !`);
                      refreshProposalData();
                    } catch (err) {
                      toast.error(err.response?.data?.message || 'Erreur lors de la décision générale');
                    } finally {
                      setDecidingProposal(false);
                    }
                  }}
                  disabled={decidingProposal}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: 'linear-gradient(135deg, #15803D, #047857)', color: '#fff',
                    fontWeight: 900, fontSize: 12, cursor: 'pointer', boxShadow: '0 4px 12px rgba(21, 128, 61, 0.4)',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  ⚡ Accepter tout ({pendingProposals.length})
                </button>
              )}

              {/* Bouton Approuver la proposition active */}
              <button
                type="button"
                onClick={async () => {
                  try {
                    setDecidingProposal(true);
                    await scheduleBuilderAPI.decideProposal(scheduleId, pendingProposal.id, { decision: 'accepted' });
                    resolveProposalLocally(pendingProposal.id, 'accepted');
                    toast.success(pendingProposals.length > 1 ? `✓ Proposition de ${pendingProposal.first_name} acceptée !` : '✓ Proposition acceptée et appliquée au planning !');
                    refreshProposalData();
                  } catch (err) {
                    toast.error(err.response?.data?.message || 'Erreur lors de la décision');
                  } finally {
                    setDecidingProposal(false);
                  }
                }}
                disabled={decidingProposal}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: 'linear-gradient(135deg, #16A34A, #15803D)', color: '#fff',
                  fontWeight: 800, fontSize: 12, cursor: 'pointer', boxShadow: '0 3px 10px rgba(22, 163, 74, 0.3)',
                  display: 'flex', alignItems: 'center', gap: 6
                }}
              >
                ✓ {pendingProposals.length > 1 ? 'Accepter cette proposition' : 'Approuver la proposition'}
              </button>

              {/* Bouton Rejeter tout si plusieurs propositions */}
              {pendingProposals.length > 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setDecidingProposal(true);
                      await scheduleBuilderAPI.decideAllProposals(scheduleId, { decision: 'rejected' });
                      toast.success('Toutes les propositions ont été refusées.');
                      refreshProposalData();
                    } catch (err) {
                      toast.error(err.response?.data?.message || 'Erreur lors du refus');
                    } finally {
                      setDecidingProposal(false);
                    }
                  }}
                  disabled={decidingProposal}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: '1px solid #DC2626',
                    background: '#FEF2F2', color: '#991B1B',
                    fontWeight: 800, fontSize: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  ✕ Rejeter tout ({pendingProposals.length})
                </button>
              )}

              {/* Bouton Rejeter la proposition active */}
              {pendingProposals.length === 1 && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      setDecidingProposal(true);
                      await scheduleBuilderAPI.decideProposal(scheduleId, pendingProposal.id, { decision: 'rejected' });
                      resolveProposalLocally(pendingProposal.id, 'rejected');
                      toast.success('Proposition refusée.');
                      refreshProposalData();
                    } catch (err) {
                      toast.error(err.response?.data?.message || 'Erreur lors du refus');
                    } finally {
                      setDecidingProposal(false);
                    }
                  }}
                  disabled={decidingProposal}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: `1px solid ${activePalette.borderDark}`,
                    background: activePalette.bg, color: activePalette.textDark,
                    fontWeight: 800, fontSize: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  ✕ Rejeter la proposition
                </button>
              )}
            </div>
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

      <div style={{ padding: '10px 14px', background: 'linear-gradient(90deg,#EEF2FF,#F5F3FF)', borderBottom: '1px solid #DDD6FE' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><strong style={{ fontSize: 12, color: '#4338CA' }}>Organisation temporelle</strong><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Groupes libres, sans modifier les gardes.</span><button type="button" onClick={() => setShowWeekOrganization(v => !v)} style={{ marginLeft: 'auto', padding: '5px 10px', borderRadius: 7, border: '1px solid #C4B5FD', background: '#fff', color: '#5B21B6', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>{showWeekOrganization ? 'Masquer' : 'Organiser les semaines'}</button></div>
        {weekOrganization.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{weekOrganization.map((group, index) => <span key={group.id || index} style={{ padding: '4px 9px', borderRadius: 20, background: `${group.color || '#6366F1'}18`, color: group.color || '#6366F1', border: `1px solid ${group.color || '#6366F1'}55`, fontSize: 10, fontWeight: 800 }}>{group.name} · {group.startDate} → {group.endDate}</span>)}</div>}
        {showWeekOrganization && <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>{weekOrganization.map((group, index) => <div key={group.id || index} style={{ display: 'grid', gridTemplateColumns: '28px minmax(90px,1fr) 140px 140px 26px', gap: 7 }}><input type="color" value={group.color || '#6366F1'} onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, color: e.target.value } : item)); dirty(); }} /><input value={group.name || ''} onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item)); dirty(); }} placeholder="Semaine A" style={weekInputStyle} /><input type="date" value={group.startDate || ''} onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, startDate: e.target.value } : item)); dirty(); }} style={weekInputStyle} /><input type="date" value={group.endDate || ''} onChange={e => { setWeekOrganization(items => items.map((item, i) => i === index ? { ...item, endDate: e.target.value } : item)); dirty(); }} style={weekInputStyle} /><button type="button" onClick={() => { setWeekOrganization(items => items.filter((_, i) => i !== index)); dirty(); }} style={{ border: 0, background: 'transparent', color: '#DC2626', cursor: 'pointer' }}>×</button></div>)}<button type="button" onClick={() => { setWeekOrganization(items => [...items, { id: `week-${Date.now()}`, name: `Semaine ${String.fromCharCode(65 + items.length)}`, startDate: dateKey(schedule.start_date), endDate: dateKey(schedule.end_date), color: ['#6366F1','#059669','#D97706','#DB2777'][items.length % 4] }]); dirty(); }} style={{ width: 'fit-content', padding: '6px 10px', borderRadius: 7, border: '1px dashed #8B5CF6', background: '#fff', color: '#6D28D9', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>+ Ajouter une semaine / groupe</button></div>}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setViewMode('table')} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: viewMode === 'table' ? 'var(--color-primary)' : 'var(--bg-card)', color: viewMode === 'table' ? '#fff' : 'var(--text-secondary)' }}>📊 Tableur</button>
        {!isWeekendHolidaySchedule && <button type="button" onClick={() => setViewMode('calendar')} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: viewMode === 'calendar' ? 'var(--color-primary)' : 'var(--bg-card)', color: viewMode === 'calendar' ? '#fff' : 'var(--text-secondary)' }}>📈 Calendrier synthétique</button>}
        <button type="button" onClick={() => setViewMode('detailed')} style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: viewMode === 'detailed' ? 'var(--color-primary)' : 'var(--bg-card)', color: viewMode === 'detailed' ? '#fff' : 'var(--text-secondary)' }}>📅 Calendrier détaillé (par jour)</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: isWeekendHolidaySchedule ? '#FFFBEB' : 'var(--color-primary-10)', borderBottom: isWeekendHolidaySchedule ? '1px solid #FDE68A' : '1px solid var(--color-primary-20)', color: 'var(--text-primary)', fontSize: 12 }}>
        <span style={{ fontWeight: 800, color: isWeekendHolidaySchedule ? '#B45309' : 'var(--color-primary)' }}>{isWeekendHolidaySchedule ? 'Planning week-ends & jours fériés' : 'Période globale du planning'}</span>
        <span style={{ fontWeight: 700 }}>{dateKey(schedule.start_date) || '—'} 00:00:00 → {dateKey(schedule.end_date) || '—'} 23:59:59</span>
        <span style={{ color: 'var(--text-muted)' }}>{isWeekendHolidaySchedule ? `${days.length} date(s) autorisée(s) seulement : week-ends et jours fériés configurés.` : 'Le jour de début est inclus, et le jour de fin est le dernier jour de garde.'}</span>
      </div>

      {viewMode === 'calendar' && <PeriodTimeline rows={filteredRows} start={schedule.start_date} end={schedule.end_date} />}
      {viewMode === 'detailed' && <DetailedCalendar rows={filteredRows} days={days} start={schedule.start_date} end={schedule.end_date} holidays={publicHolidays} weekOrganization={weekOrganization} isSpecialSchedule={isWeekendHolidaySchedule} />}

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
                    : c.type === 'bool'
                    ? <span title="Cochée : l'agent assure sa garde à domicile (astreinte). Décochée (par défaut) : garde à l'hôpital, en présence.">{c.label} 🏠</span>
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
              const rowProps = visibleCols.flatMap(c => getMultiCellProposals(row, c.key));
              const hasRowConflict = visibleCols.some(c => getMultiCellProposals(row, c.key).length > 1) ||
                customCols.some(c => getMultiCellProposals(row, c.key).length > 1) ||
                Object.keys(row.shifts || {}).some(d => getMultiShiftProposals(row, d).length > 1);
              const isRowProposedYellow = row.isProposedNewRow || rowProps.length > 0 ||
                customCols.some(c => getMultiCellProposals(row, c.key).length > 0) ||
                Object.keys(row.shifts || {}).some(d => getMultiShiftProposals(row, d).length > 0);

              const firstRowProp = rowProps[0];
              const rowPalette = firstRowProp ? firstRowProp.palette : activePalette;

              // Ligne d'un agent externe en attente de l'accord de son chef.
              // Teinte distincte, uniquement si aucune proposition ne colore déjà la ligne.
              const loanState = row.userId ? externalLoans[row.userId] : null;
              const showPendingExternal = loanState?.status === 'pending' && !hasRowConflict && !isRowProposedYellow;
              const pendingTitle = showPendingExternal
                ? `En attente de l'accord de ${loanState.ownerChiefName || 'son chef de service'}${loanState.ownerDepartmentName ? ` (${loanState.ownerDepartmentName})` : ''}. Le tableur s'enregistre et s'envoie normalement ; en cas de refus cette ligne sera retirée automatiquement.`
                : undefined;
              const baseBg = showPendingExternal
                ? PENDING_EXT.bg
                : ri % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)';

              return (
                <tr
                  key={row.id}
                  draggable
                  title={pendingTitle}
                  onDragStart={e => handleRowDragStart(e, ri)}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/json') ? 'copy' : 'move'; setDragOverRow(ri); }}
                  onDragLeave={() => setDragOverRow(null)}
                  onDrop={e => handleRowDrop(e, ri)}
                  onContextMenu={e => openContextMenu(e, ri)}
                  style={{
                    background: isOver
                      ? 'rgba(234,179,8,.25)'
                      : hasRowConflict
                      ? 'linear-gradient(135deg, rgba(254,249,195,.4) 0%, rgba(243,232,255,.5) 100%)'
                      : isRowProposedYellow
                      ? rowPalette.bg
                      : baseBg,
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'background .1s',
                    outline: isOver ? '2px solid var(--color-primary)' : hasRowConflict ? '2px dashed #9333EA' : isRowProposedYellow ? `1.5px solid ${rowPalette.borderDark}` : showPendingExternal ? `1.5px dashed ${PENDING_EXT.border}` : 'none',
                    boxShadow: isOver ? 'inset 0 0 0 2px rgba(27,79,202,.15)' : isRowProposedYellow ? `inset 0 0 0 1px ${rowPalette.badgeBg}` : 'none',
                  }}
                  onMouseEnter={e => { if (!isOver && !isDragging) e.currentTarget.style.background = isRowProposedYellow ? rowPalette.bgDark : showPendingExternal ? PENDING_EXT.bgDark : 'rgba(27,79,202,.04)'; }}
                  onMouseLeave={e => { if (!isOver) e.currentTarget.style.background = isRowProposedYellow ? rowPalette.bg : baseBg; }}
                >
                  {/* Drag handle */}
                  <td style={{ ...tdBase, cursor: 'grab', textAlign: 'center', color: isRowProposedYellow ? rowPalette.textDark : 'var(--text-muted)', paddingLeft: 4, background: isRowProposedYellow ? rowPalette.bgDark : undefined }}
                    onDragStart={e => handleRowDragStart(e, ri)}>
                    <IcoDrag />
                  </td>

                  {/* Row number */}
                  <td style={{ ...tdBase, textAlign: 'center', background: isRowProposedYellow ? rowPalette.bgDark : undefined }}>
                    <span style={{ fontSize: 9, fontWeight: isRowProposedYellow ? 800 : 400, color: isRowProposedYellow ? rowPalette.textDark : 'var(--text-muted)' }}>{ri + 1}</span>
                    {showPendingExternal && <span style={{ fontSize: 9, marginLeft: 2 }} aria-label="En attente d'accord">⏳</span>}
                  </td>

                  {/* Info columns — fixed + time */}
                  {visibleCols.map(col => {
                    const isEd = editingCell?.id === row.id && editingCell?.key === col.key;
                    const val = row[col.key] || '';
                    const cellProps = getMultiCellProposals(row, col.key);
                    const hasProps = cellProps.length > 0;
                    const isConflict = cellProps.length > 1;
                    const topProp = cellProps[0];
                    const pal = topProp ? topProp.palette : activePalette;

                    const cellBg = isConflict
                      ? 'linear-gradient(135deg, #FEF9C3 0%, #E0F2FE 100%)'
                      : hasProps ? pal.bgDark : undefined;

                    const cellBorder = isConflict
                      ? '2px dashed #9333EA'
                      : hasProps ? `1.5px solid ${pal.borderDark}` : undefined;

                    const tooltipTitle = isConflict
                      ? `⚡ CONFLIT : ${cellProps.length} propositions sur ce champ :\n` + cellProps.map(p => `${p.palette.dot} ${p.proposerName} (${p.roleTitle}) : "${p.proposedVal}"${p.comment ? ` (${p.comment})` : ''}`).join('\n') + `\n\nCliquez pour inspecter et choisir la valeur !`
                      : hasProps
                      ? `⚠️ Proposition (${topProp.proposerName} - ${topProp.roleTitle}) :\nActuel : ${topProp.originalVal}\nProposé : ${topProp.proposedVal}`
                      : undefined;

                    if (col.type === 'periods') {
                      const currentPeriods = normalizeRowPeriods(row, dateKey(schedule.start_date), dateKey(schedule.end_date));
                      const displayVal = hasProps ? (isConflict ? cellProps.map(p => p.proposedVal).join(' / ') : topProp.proposedVal) : periodsLabel(currentPeriods, true);
                      return (
                        <td key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder }}>
                          <button type="button"
                            onClick={() => {
                              if (hasProps) {
                                setCellModalInfo({
                                  rowId: row.id,
                                  rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                                  colKey: col.key,
                                  colLabel: col.label,
                                  originalVal: val || 'Non renseigné',
                                  proposals: cellProps,
                                  isShift: false
                                });
                              } else {
                                setPeriodPicker({ rowId: row.id });
                              }
                            }}
                            title={tooltipTitle}
                            style={{
                              width: '100%', padding: '4px 5px', borderRadius: 5, fontSize: 10, cursor: 'pointer', textAlign: 'left',
                              border: isConflict ? '1.5px solid #9333EA' : hasProps ? `1px solid ${pal.borderDark}` : '1px solid var(--border-subtle)',
                              background: isConflict ? '#F3E8FF' : hasProps ? pal.bgDark : 'var(--bg-elevated)',
                              color: isConflict ? '#581C87' : hasProps ? pal.textDark : val ? 'var(--text-primary)' : 'var(--text-muted)',
                              fontWeight: hasProps ? 800 : 500
                            }}>
                            {displayVal || 'Choisir les périodes'} {isConflict ? '⚡' : hasProps ? pal.dot : '📅'}
                          </button>
                        </td>
                      );
                    }
                    if (col.type === 'special-dates') {
                      const selectedDates = Object.entries(row.shifts || {}).filter(([, code]) => code && code !== 'R').map(([date]) => dateKey(date));
                      const label = selectedDates.length === 0 ? 'Choisir les jours' : `${selectedDates.length} jour(s) sélectionné(s)`;
                      return <td key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder }}>
                        <button type="button" onClick={() => setSpecialDatesPicker({ rowId: row.id })} title="Sélectionner un ou plusieurs week-ends / jours fériés" style={{ width: '100%', padding: '6px 7px', borderRadius: 6, border: hasProps ? `1px solid ${pal.borderDark}` : '1px solid #F59E0B', background: hasProps ? pal.bgDark : '#FFFBEB', color: hasProps ? pal.textDark : '#92400E', cursor: 'pointer', fontSize: 10, fontWeight: 800 }}>
                          📅 {label}
                        </button>
                      </td>;
                    }
                    if (col.type === 'time') {
                      const displayTime = hasProps ? (isConflict ? topProp.proposedVal : topProp.proposedVal) : (val || '07:00');
                      return (
                        <td key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder }}
                          onClick={() => {
                            if (hasProps) {
                              setCellModalInfo({
                                rowId: row.id,
                                rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                                colKey: col.key,
                                colLabel: col.label,
                                originalVal: val || '07:00',
                                proposals: cellProps,
                                isShift: false
                              });
                            }
                          }}
                          title={tooltipTitle}>
                          <input type="time" value={displayTime} onChange={e => updateRow(row.id, { [col.key]: e.target.value })}
                            style={{ fontSize: 10, border: 'none', background: 'transparent', color: isConflict ? '#581C87' : hasProps ? pal.textDark : 'var(--text-primary)', fontWeight: hasProps ? 800 : 400, cursor: 'pointer', padding: 0, width: '100%', outline: 'none' }} />
                        </td>
                      );
                    }
                    // Garde à domicile — une simple case à cocher, décochée par
                    // défaut. Cochée : astreinte à domicile ; décochée : garde à
                    // l'hôpital, en présence. La valeur est un booléen, pas un
                    // code : rien d'autre dans le tableur ne change.
                    if (col.type === 'bool') {
                      const checked = row[col.key] === true;
                      return (
                        <td key={col.key} style={{ ...tdBase, background: cellBg, border: cellBorder, textAlign: 'center' }}
                          title={tooltipTitle || (checked
                            ? 'Garde à domicile (astreinte) — décochez pour une garde à l’hôpital'
                            : 'Garde à l’hôpital, en présence — cochez pour une garde à domicile')}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 10, fontWeight: 700, color: checked ? '#7C3AED' : 'var(--text-muted)' }}>
                            <input type="checkbox" checked={checked}
                              onChange={e => updateRow(row.id, { [col.key]: e.target.checked })}
                              style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#7C3AED', margin: 0 }} />
                            {checked ? '🏠 Domicile' : 'Présence'}
                          </label>
                        </td>
                      );
                    }
                    const isPersonnelField = ['lastName', 'firstName', 'phone', 'matricule', 'roleName'].includes(col.key);
                    if (isPersonnelField) {
                      const isSearchCell = !row.userId && col.key === 'lastName';
                      const displayPersonnelVal = hasProps ? (isConflict ? `${topProp.proposedVal} (+${cellProps.length - 1})` : topProp.proposedVal) : val;
                      return (
                        <td key={col.key} style={{ ...tdBase, position: 'relative', maxWidth: col.w, background: cellBg, border: cellBorder }}
                          title={tooltipTitle}
                          onDragOver={e => e.preventDefault()}
                          onDrop={e => { const data = e.dataTransfer.getData('application/json'); if (data) { try { applyStaffToRow(row.id, JSON.parse(data)); } catch {} } }}
                          onClick={() => {
                            if (hasProps) {
                              setCellModalInfo({
                                rowId: row.id,
                                rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                                colKey: col.key,
                                colLabel: col.label,
                                originalVal: val || 'Non renseigné',
                                proposals: cellProps,
                                isShift: false
                              });
                            } else if (!row.userId) { setPickerRowId(row.id); setPickerOpen(true); }
                          }}>
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
                            <span title={row.userId ? 'Information issue de la fiche personnel' : 'Cliquez pour choisir un membre du personnel'} style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: isConflict ? '#581C87' : hasProps ? pal.textDark : val ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: hasProps ? 800 : 500 }}>
                              {displayPersonnelVal || 'Choisir...'} {isConflict ? `⚡ (${cellProps.length} props)` : row.isProposedNewRow ? `${pal.dot} (Nouveau)` : hasProps ? pal.dot : ''}
                            </span>
                          )}
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} style={{ ...tdBase, position: 'relative', maxWidth: col.w, background: cellBg, border: cellBorder }}
                        title={tooltipTitle}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          const data = e.dataTransfer.getData('application/json');
                          if (data) { try { applyStaffToRow(row.id, JSON.parse(data)); } catch {} }
                        }}
                        onClick={() => {
                          if (hasProps) {
                            setCellModalInfo({
                              rowId: row.id,
                              rowName: `${row.lastName} ${row.firstName}`.trim() || 'Personnel',
                              colKey: col.key,
                              colLabel: col.label,
                              originalVal: val || 'Non renseigné',
                              proposals: cellProps,
                              isShift: false
                            });
                          } else {
                            startEdit(row.id, col.key, val);
                          }
                        }}>
                        {isEd ? (
                          <input ref={inputRef} value={editVal}
                            onChange={e => setEditVal(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit(); } if (e.key === 'Escape') setEditingCell(null); }}
                            style={{ width: '100%', padding: '2px 4px', border: '2px solid var(--color-primary)', borderRadius: 4, fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }} />
                        ) : (
                          <span style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', color: isConflict ? '#581C87' : hasProps ? pal.textDark : val ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: hasProps ? 800 : 400 }}>
                            {isConflict ? `${topProp.proposedVal} ⚡` : hasProps ? `${topProp.proposedVal} ${pal.dot}` : (val || (row.isNew && col.key === 'lastName' ? '⊕ Glisser...' : '—'))}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Custom dynamic columns */}
                  {customCols.map(col => {
                    const val = (row.custom || {})[col.key] || '';
                    const isEd = editingCell?.id === row.id && editingCell?.key === col.key;
                    const propCustomVal = proposalMap?.mapByUserId[row.userId || row.id]?.custom?.[col.key];
                    const isYellow = propCustomVal !== undefined && String(propCustomVal).trim() !== String(val).trim();

                    return (
                      <td key={col.key} style={{ ...tdBase, maxWidth: col.w, background: isYellow ? activePalette.bgDark : undefined, border: isYellow ? `1.5px solid ${activePalette.borderDark}` : undefined }}
                        title={isYellow ? `⚠️ Proposition du surveillant :\nActuel : ${val || '—'}\nProposé : ${propCustomVal}` : undefined}
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
                          <span style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text', color: isYellow ? activePalette.textDark : val ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: isYellow ? 800 : 400 }}>
                            {isYellow ? `${propCustomVal} ${activePalette.dot}` : (val || '—')}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Day cells (masques dans la vue compacte) */}
                  {showDailyGrid && days.map(d => {
                    const dateStr = dateKey(d);
                    const code = row.shifts[dateStr];
                    const propShiftStatus = getProposedShiftStatus(row, dateStr);
                    const inPeriod = isWeekendHolidaySchedule || dateInRowPeriods(dateStr, row, dateKey(schedule.start_date), dateKey(schedule.end_date));
                    return (
                      <td key={dateStr} style={{
                        ...tdBase, padding: '4px 3px', textAlign: 'center',
                        borderLeft: isWeekend(d) ? '1px solid rgba(99,102,241,.2)' : '1px solid var(--border-subtle)',
                        background: !inPeriod ? 'rgba(148,163,184,.10)' : propShiftStatus?.isProposed ? activePalette.bgDark : isWeekend(d) && !code ? 'rgba(99,102,241,.04)' : undefined,
                        opacity: inPeriod ? 1 : .38,
                      }}>
                        <ShiftCell
                          code={code}
                          isProposed={propShiftStatus?.isProposed}
                          proposedCode={propShiftStatus?.proposedCode}
                          originalCode={propShiftStatus?.originalCode}
                          proposerName={propShiftStatus?.proposerName}
                          onClick={() => { if (inPeriod) cycleShift(row.id, dateStr); }}
                        />
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

        <button onClick={() => saveDraft(false)} disabled={(!canDirectEdit && !canProposeChanges) || !isDirty || saving}
          style={{ ...btnGhost, opacity: isDirty ? 1 : 0.5, gap: 6, display: 'flex', alignItems: 'center', padding: '8px 16px' }}>
          <IcoSave /> {saving ? 'Sauvegarde...' : canProposeChanges ? 'Envoyer la proposition' : schedule.status === 'draft' ? 'Enregistrer brouillon' : 'Enregistrer les modifications'}
        </button>

        {schedule.status === 'draft' && <button onClick={confirmSubmit} disabled={submitting}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px',
            borderRadius: 9, border: 'none', background: 'linear-gradient(135deg, #059669, #047857)',
            color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(5,150,105,.3)', opacity: submitting ? 0.7 : 1,
          }}>
          <IcoSend /> {submitting ? 'Envoi...' : 'Confirmer — Envoyer au surveillant'}
        </button>}
        {canManageProposals && <button onClick={onManageProposals} style={{ ...btnGhost, color: 'var(--color-primary)', padding: '8px 14px' }}>Gérer les propositions</button>}
        {canCancelSubmission && <button onClick={cancelSubmission} style={{ ...btnGhost, color: '#DC2626', borderColor: '#FCA5A5', padding: '8px 14px' }}>Annuler l’envoi</button>}
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
        excludeUserIds={existingUserIds}
      />

      {/* ══ PERIOD DATE PICKER CALENDAR ════════════════════════════════ */}
      {periodPicker && (
        <MultiPeriodPicker
          row={rows.find(r => r.id === periodPicker.rowId)}
          min={dateKey(schedule?.start_date)}
          max={dateKey(schedule?.end_date)}
          onChange={(patch) => updateRow(periodPicker.rowId, patch)}
          onClose={() => setPeriodPicker(null)}
        />
      )}

      {specialDatesPicker && (
        <SpecialDatesPicker
          row={rows.find(r => r.id === specialDatesPicker.rowId)}
          allowedDays={days}
          holidays={publicHolidays}
          onChange={shifts => updateRow(specialDatesPicker.rowId, { shifts })}
          onClose={() => setSpecialDatesPicker(null)}
        />
      )}

      {/* ══ CELL PROPOSAL CONFLICT MODAL ════════════════════════════════ */}
      <CellProposalModal
        cellInfo={cellModalInfo}
        onClose={() => setCellModalInfo(null)}
        onApplyValue={handleApplyProposalValue}
      />

      {showImportModal && (
        <ImportModal
          departmentId={departmentId || schedule?.department_id}
          scheduleId={scheduleId}
          onClose={() => setShowImportModal(false)}
          onImported={() => {
            setShowImportModal(false);
            qc.invalidateQueries(['schedule-detail', scheduleId]);
            refetch?.();
          }}
        />
      )}

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

