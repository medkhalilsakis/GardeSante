import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { establishmentsAPI, adminAPI, usersAPI } from '../../api';
import { useAuthStore } from '../../store';
import Avatar from '../../components/common/Avatar';
import toast from 'react-hot-toast';

// ── Config ─────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';
const ONLINE_THRESH_MIN = 5; // minutes

// ── Helpers présence ──────────────────────────────────────────
const computePresence = (lastActivity) => {
  if (!lastActivity) return { status: 'offline', label: 'Jamais connecté' };
  const diff = Date.now() - new Date(lastActivity).getTime();
  const min = Math.floor(diff / 60000);
  const h   = Math.floor(min / 60);
  const d   = Math.floor(h / 24);
  if (min < ONLINE_THRESH_MIN) return { status: 'online', label: 'Connecté' };
  if (min < 30)  return { status: 'away',    label: `Il y a ${min} min` };
  if (h < 24)    return { status: 'offline',  label: `Il y a ${h}h` };
  if (d < 7)     return { status: 'offline',  label: `Il y a ${d} jour${d > 1 ? 's' : ''}` };
  return {
    status: 'offline',
    label: `Le ${new Date(lastActivity).toLocaleDateString('fr-FR')}`,
  };
};

// ── Icônes ────────────────────────────────────────────────────
const I = {
  hospital: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10',
  user:     'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 11a4 4 0 100-8 4 4 0 000 8z',
  users:    'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75',
  plus:     'M12 5v14M5 12h14',
  edit:     'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
  trash:    'M3 6h18 M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6 M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2',
  x:        'M18 6L6 18M6 6l12 12',
  back:     'M19 12H5 M12 5l-7 7 7 7',
  power:    'M18.36 6.64a9 9 0 11-12.73 0M12 2v10',
  check:    'M20 6L9 17l-5-5',
  eye:      'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 12a3 3 0 100-6 3 3 0 000 6',
  clock:    'M12 2a10 10 0 110 20A10 10 0 0112 2z M12 6v6l4 2',
  money:    'M12 1v22 M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  history:  'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0',
  search:   'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0',
  alert:    'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z M12 9v4 M12 17h.01',
  key:      'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.778-7.778z',
  chart:    'M18 20V10 M12 20V4 M6 20v-6',
  map:      'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z M8 2v16 M16 6v16',
  filter:   'M22 3H2l8 9.46V19l4 2v-8.54L22 3',
  refresh:  'M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15',
  lock:     'M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z M7 11V7a5 5 0 0110 0v4',
  wifi:     'M5 12.55a11 11 0 0114.08 0 M1.42 9a16 16 0 0121.16 0 M8.53 16.11a6 6 0 016.95 0 M12 20h.01',
  stats:    'M21 21H3V3 M7 14l4-4 4 4 4-6',
};

const Ico = ({ path, size = 16, stroke = 'currentColor', fill = 'none', style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d={path} />
  </svg>
);

// ── Composants atomiques ───────────────────────────────────────
const Btn = ({ children, variant = 'primary', size = 'md', icon, onClick, disabled, style = {}, title }) => {
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit',
    fontWeight: 600, borderRadius: 8, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'all 0.18s', opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap',
    ...(size === 'sm' ? { padding: '5px 12px', fontSize: 12 } : { padding: '8px 18px', fontSize: 13 }),
  };
  const variants = {
    primary: { background: 'var(--color-primary)', color: '#fff' },
    danger:  { background: '#DC2626', color: '#fff' },
    success: { background: '#059669', color: '#fff' },
    warning: { background: '#D97706', color: '#fff' },
    ghost:   { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' },
    outline: { background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' },
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{ ...base, ...variants[variant], ...style }}>
      {icon && <Ico path={I[icon]} size={14} />}{children}
    </button>
  );
};

const Field = ({ label, required, children }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>
      {label}{required && <span style={{ color: '#DC2626', marginLeft: 3 }}>*</span>}
    </label>
    {children}
  </div>
);

const Inp = ({ style = {}, ...props }) => (
  <input {...props} style={{
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-default)',
    borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s', ...style,
  }}
    onFocus={e => e.target.style.borderColor = 'var(--color-primary)'}
    onBlur={e => e.target.style.borderColor = 'var(--border-default)'}
  />
);

const Sel = ({ children, style = {}, ...props }) => (
  <select {...props} style={{
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-default)',
    borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
    fontSize: 13, outline: 'none', boxSizing: 'border-box', ...style,
  }}>
    {children}
  </select>
);

// ── Présence Badge ─────────────────────────────────────────────
const PresenceBadge = ({ lastActivity, small }) => {
  const p = computePresence(lastActivity);
  const colors = {
    online:  { dot: '#10B981', bg: '#10B98118', text: '#10B981' },
    away:    { dot: '#F59E0B', bg: '#F59E0B18', text: '#F59E0B' },
    offline: { dot: '#6B7280', bg: '#6B728018', text: '#6B7280' },
  };
  const c = colors[p.status];
  return (
    <span title={`Dernière activité : ${p.label}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: small ? '2px 8px' : '3px 10px',
      borderRadius: 20, fontSize: small ? 10 : 11, fontWeight: 600,
      background: c.bg, color: c.text,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0, boxShadow: p.status === 'online' ? `0 0 0 2px ${c.dot}40` : 'none' }} />
      {p.label}
    </span>
  );
};

// ── Status établissement ───────────────────────────────────────
const EstBadge = ({ active, small }) => (
  <span style={{
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: small ? '1px 8px' : '3px 10px',
    borderRadius: 20, fontSize: small ? 10 : 11, fontWeight: 700,
    background: active ? '#05966918' : '#DC262618',
    color: active ? '#059669' : '#DC2626',
  }}>
    {active ? '● Actif' : '○ Désactivé'}
  </span>
);

const ROLE_LABELS = {
  director:           { label: 'Directeur',           color: '#7C3AED', bg: '#7C3AED18' },
  general_supervisor: { label: 'Superviseur Général', color: '#1B4FCA', bg: '#1B4FCA18' },
  department_head:    { label: 'Chef de Service',     color: '#059669', bg: '#05966918' },
  service_supervisor: { label: 'Superviseur',         color: '#D97706', bg: '#D9770618' },
  senior_doctor:      { label: 'Médecin Senior',      color: '#DC2626', bg: '#DC262618' },
  resident:           { label: 'Résident',            color: '#6B7280', bg: '#6B728018' },
};

const RoleBadge = ({ code }) => {
  const r = ROLE_LABELS[code] || { label: code, color: '#6B7280', bg: '#6B728018' };
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: r.bg, color: r.color }}>{r.label}</span>;
};

const MONTH_NAMES = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

// ── KPI Card ──────────────────────────────────────────────────
const KpiCard = ({ icon, label, value, sub, color = '#1B4FCA', onClick }) => (
  <div onClick={onClick} style={{
    background: 'var(--bg-card)', borderRadius: 12, padding: '16px 18px',
    border: '1px solid var(--border-subtle)', borderTop: `3px solid ${color}`,
    cursor: onClick ? 'pointer' : 'default', transition: 'box-shadow 0.2s, transform 0.2s',
  }}
    onMouseEnter={e => { if (onClick) { e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)'; e.currentTarget.style.transform = 'translateY(-2px)'; } }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>{value ?? '—'}</div>
      <div style={{ background: `${color}20`, color, borderRadius: 8, padding: 8, display: 'flex' }}>
        <Ico path={I[icon]} size={16} />
      </div>
    </div>
    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 6 }}>{label}</div>
    {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
  </div>
);

// ── Modal ─────────────────────────────────────────────────────
const Modal = ({ title, onClose, children, wide, icon }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
    onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{ background: 'var(--bg-card)', borderRadius: 16, width: '100%', maxWidth: wide ? 800 : 520, maxHeight: '92vh', overflow: 'auto', boxShadow: '0 40px 100px rgba(0,0,0,0.6)' }}>
      <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}><Ico path={I.x} size={18} /></button>
      </div>
      <div style={{ padding: 22 }}>{children}</div>
    </div>
  </div>
);

const Confirm = ({ message, sub, onConfirm, onCancel, danger = true }) => (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
    <div style={{ background: 'var(--bg-card)', borderRadius: 14, padding: 26, maxWidth: 440, width: '100%', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
        <div style={{ background: danger ? '#DC262620' : '#05966920', borderRadius: 10, padding: 10, flexShrink: 0 }}>
          <Ico path={I.alert} size={22} stroke={danger ? '#DC2626' : '#059669'} />
        </div>
        <div>
          <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 14 }}>{message}</p>
          {sub && <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{sub}</p>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onCancel}>Annuler</Btn>
        <Btn variant={danger ? 'danger' : 'success'} onClick={onConfirm}>Confirmer</Btn>
      </div>
    </div>
  </div>
);

// ══════════════════════════════════════════════════════════════
// GOUVERNORATS — Sélecteur avec recherche
// ══════════════════════════════════════════════════════════════
function GovSelect({ value, onChange, govList }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const filtered = useMemo(() =>
    govList.filter(g => g.name.toLowerCase().includes(search.toLowerCase())),
    [govList, search]
  );
  const selected = govList.find(g => g.name === value);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)} style={{
        width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-default)',
        borderRadius: 8, padding: '8px 12px', cursor: 'pointer', textAlign: 'left',
        color: value ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 13, fontFamily: 'inherit',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{selected ? `${selected.name} (${selected.region})` : 'Sélectionner un gouvernorat…'}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-card)',
          border: '1px solid var(--border-default)', borderRadius: 8, zIndex: 200,
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)', overflow: 'hidden', marginTop: 4,
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
            <Inp placeholder="Rechercher…" value={search} onChange={e => setSearch(e.target.value)} autoFocus style={{ padding: '6px 10px' }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <div onClick={() => { onChange(''); setOpen(false); setSearch(''); }} style={{ padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              — Aucun gouvernorat —
            </div>
            {filtered.map(g => (
              <div key={g.code} onClick={() => { onChange(g.name); setOpen(false); setSearch(''); }}
                style={{
                  padding: '9px 14px', cursor: 'pointer', fontSize: 13,
                  background: g.name === value ? 'var(--color-primary)20' : 'transparent',
                  color: g.name === value ? 'var(--color-primary)' : 'var(--text-primary)',
                  borderLeft: g.name === value ? '3px solid var(--color-primary)' : '3px solid transparent',
                }}
                onMouseEnter={e => { if (g.name !== value) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                onMouseLeave={e => { if (g.name !== value) e.currentTarget.style.background = 'transparent'; }}>
                <div style={{ fontWeight: 600 }}>{g.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{g.region}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// GRAPHIQUES simples (SVG natif — sans dépendance)
// ══════════════════════════════════════════════════════════════
function BarChart({ data, color = '#1B4FCA', height = 120 }) {
  if (!data?.length) return <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>Pas de données</p>;
  const max = Math.max(...data.map(d => d.count || d.value || 0), 1);
  const w = 100 / data.length;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} xmlns="http://www.w3.org/2000/svg">
        {data.map((d, i) => {
          const val = d.count || d.value || d.establishments || 0;
          const barH = (val / max) * (height - 20);
          return (
            <g key={i}>
              <rect x={i * w + w * 0.15} y={height - barH - 10} width={w * 0.7} height={barH} fill={color} rx="2" opacity="0.85" />
              <text x={i * w + w / 2} y={height - 1} textAnchor="middle" fontSize="4" fill="var(--text-muted)">
                {d.month?.slice(-2) || d.day?.slice(-2) || (d.governorate?.slice(0, 4)) || ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function LineChart({ data, color = '#059669', height = 100 }) {
  if (!data?.length) return <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>Pas de données</p>;
  const max = Math.max(...data.map(d => parseInt(d.count) || 0), 1);
  const W = 100, H = height;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1 || 1)) * W;
    const y = H - 10 - ((parseInt(d.count) || 0) / max) * (H - 20);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height }} xmlns="http://www.w3.org/2000/svg">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => {
        const x = (i / (data.length - 1 || 1)) * W;
        const y = H - 10 - ((parseInt(d.count) || 0) / max) * (H - 20);
        return <circle key={i} cx={x} cy={y} r="1.5" fill={color} />;
      })}
    </svg>
  );
}

function PieChart({ data, size = 100 }) {
  if (!data?.length) return null;
  const total = data.reduce((s, d) => s + (parseInt(d.count) || parseInt(d.value) || 0), 0);
  if (!total) return null;
  const COLORS = ['#1B4FCA', '#7C3AED', '#059669', '#D97706', '#DC2626', '#06B6D4'];
  let angle = 0;
  const slices = data.map((d, i) => {
    const val = parseInt(d.count) || parseInt(d.value) || 0;
    const pct = val / total;
    const a1 = angle, a2 = angle + pct * 2 * Math.PI;
    angle = a2;
    const x1 = 50 + 40 * Math.cos(a1), y1 = 50 + 40 * Math.sin(a1);
    const x2 = 50 + 40 * Math.cos(a2), y2 = 50 + 40 * Math.sin(a2);
    const large = pct > 0.5 ? 1 : 0;
    return { d: `M50,50 L${x1},${y1} A40,40,0,${large},1,${x2},${y2}Z`, color: COLORS[i % COLORS.length], label: d.label || d.governorate || d.type, pct };
  });
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <svg viewBox="0 0 100 100" style={{ width: size, height: size, flexShrink: 0 }} xmlns="http://www.w3.org/2000/svg">
        {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} opacity={0.9} />)}
      </svg>
      <div style={{ flex: 1 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.label} ({Math.round(s.pct * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// HOLIDAY FORM COMPONENT
// ══════════════════════════════════════════════════════════════
function HolidayForm({ form, setForm }) {
  return (
    <div>
      <Field label="Nom de la fête / événement" required>
        <Inp
          value={form.name || ''}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Ex: Fête de l'Indépendance, Aïd el-Fitr..."
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Catégorie" required>
          <Sel value={form.category || 'national'} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="national">🏛️ National (Fête civile)</option>
            <option value="religious">🌙 Religieux (Fête religieuse)</option>
            <option value="special">⭐ Spécial (Période d'urgence / Autre)</option>
          </Sel>
        </Field>

        <Field label="Année" required>
          <Inp
            type="number"
            value={form.year || new Date().getFullYear()}
            onChange={e => setForm(f => ({ ...f, year: parseInt(e.target.value) || new Date().getFullYear() }))}
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Date de début" required>
          <Inp
            type="date"
            value={form.startDate || ''}
            onChange={e => setForm(f => ({
              ...f,
              startDate: e.target.value,
              endDate: f.endDate && f.endDate < e.target.value ? e.target.value : (f.endDate || e.target.value)
            }))}
          />
        </Field>

        <Field label="Date de fin (pour les périodes)">
          <Inp
            type="date"
            value={form.endDate || form.startDate || ''}
            onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Coeff. Garde (Multiplicateur)">
          <Inp
            type="number" step="0.1" min="1.0" max="3.0"
            value={form.multiplier || 1.5}
            onChange={e => setForm(f => ({ ...f, multiplier: parseFloat(e.target.value) || 1.5 }))}
            placeholder="1.5 = Majorée de 50%"
          />
        </Field>

        <Field label="Récurrence">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', height: 38, fontSize: 13, fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={Boolean(form.isRecurring)}
              onChange={e => setForm(f => ({ ...f, isRecurring: e.target.checked }))}
              style={{ width: 16, height: 16, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
            />
            <span>Récurrent chaque année (date fixe)</span>
          </label>
        </Field>
      </div>

      <Field label="Notes / Description (Optionnel)">
        <Inp
          value={form.notes || ''}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          placeholder="Ex: Majoration double de nuit, congés légaux..."
        />
      </Field>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// HOLIDAYS SECTION COMPONENT
// ══════════════════════════════════════════════════════════════
function HolidaysSection({ onOpenCreate, onEdit, onDelete, onSeedTunisia }) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  const { data: holidaysData, isLoading } = useQuery({
    queryKey: ['admin-holidays', selectedYear],
    queryFn: () => adminAPI.getHolidays({ year: selectedYear }),
  });
  const holidays = holidaysData?.data?.data || holidaysData?.data || [];

  const categoryBadges = {
    national:  { label: '🏛️ National', bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
    religious: { label: '🌙 Religieux', bg: '#F3E8FF', color: '#7E22CE', border: '#E9D5FF' },
    special:   { label: '⭐ Spécial',   bg: '#FEF3C7', color: '#B45309', border: '#FDE68A' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header section */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 18,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: '#7C3AED20', color: '#7C3AED', padding: 10, borderRadius: 10 }}>
            <span style={{ fontSize: 22 }}>📅</span>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>
              Jours & Périodes Fériés {selectedYear}
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Gérez le calendrier officiel des jours fériés pour l'attribution et le calcul des gardes.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8, padding: 3, border: '1px solid var(--border-subtle)' }}>
            {years.map(y => (
              <button
                key={y}
                type="button"
                onClick={() => setSelectedYear(y)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                  background: selectedYear === y ? 'var(--color-primary)' : 'transparent',
                  color: selectedYear === y ? '#fff' : 'var(--text-secondary)',
                  transition: 'all .15s'
                }}
              >
                {y}
              </button>
            ))}
          </div>

          <Btn variant="ghost" onClick={() => onSeedTunisia(selectedYear)} title="Précharger les 8 jours fériés nationaux tunisiens">
            ⚡ Jours Fériés Tunisiens
          </Btn>
          <Btn variant="primary" icon="plus" onClick={() => onOpenCreate(selectedYear)}>
            Ajouter un jour/période
          </Btn>
        </div>
      </div>

      {/* KPI summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KpiCard icon="clock" label="Total Fériés" value={holidays.length} sub={`Année ${selectedYear}`} color="#7C3AED" />
        <KpiCard icon="check" label="Nationaux" value={holidays.filter(h => h.category === 'national').length} sub="Fêtes civiles & nationaux" color="#1B4FCA" />
        <KpiCard icon="history" label="Religieux" value={holidays.filter(h => h.category === 'religious').length} sub="Fêtes religieuses" color="#059669" />
        <KpiCard icon="stats" label="Récurrents" value={holidays.filter(h => h.is_recurring).length} sub="Reconduits chaque année" color="#D97706" />
      </div>

      {/* Table grid */}
      {isLoading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement des jours fériés...</div>
      ) : holidays.length === 0 ? (
        <div style={{
          background: 'var(--bg-card)', borderRadius: 14, border: '1px dashed var(--border-subtle)', padding: 40,
          textAlign: 'center', color: 'var(--text-muted)'
        }}>
          <span style={{ fontSize: 36, display: 'block', marginBottom: 10 }}>📅</span>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
            Aucun jour férié configuré pour {selectedYear}
          </h3>
          <p style={{ margin: '0 0 16px', fontSize: 12 }}>
            Ajoutez les jours et périodes fériés manuellement ou préchargez les jours fériés usuels en 1 clic.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Btn variant="ghost" onClick={() => onSeedTunisia(selectedYear)}>⚡ Précharger les jours tunisiens</Btn>
            <Btn variant="primary" icon="plus" onClick={() => onOpenCreate(selectedYear)}>Ajouter manuellement</Btn>
          </div>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                <th style={{ padding: '12px 16px' }}>Événement / Fête</th>
                <th style={{ padding: '12px 16px' }}>Type</th>
                <th style={{ padding: '12px 16px' }}>Dates & Période</th>
                <th style={{ padding: '12px 16px' }}>Catégorie</th>
                <th style={{ padding: '12px 16px' }}>Récurrence</th>
                <th style={{ padding: '12px 16px' }}>Coeff. Garde</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((h, idx) => {
                const sStr = String(h.start_date || '').split('T')[0];
                const eStr = String(h.end_date || '').split('T')[0];
                const isPeriod = sStr !== eStr;
                const cat = categoryBadges[h.category] || categoryBadges.national;
                const fmtDate = str => {
                  if (!str) return '';
                  const [y, m, d] = str.split('-');
                  return y && m && d ? `${d}/${m}/${y}` : str;
                };
                const startDateFormatted = fmtDate(sStr);
                const endDateFormatted = fmtDate(eStr);
                return (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: idx % 2 === 0 ? 'transparent' : 'var(--bg-elevated)' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      {h.name}
                      {h.notes && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted)', marginTop: 2 }}>{h.notes}</div>}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 700,
                        background: isPeriod ? '#FEF3C7' : '#F3F4F6', color: isPeriod ? '#92400E' : '#4B5563', border: `1px solid ${isPeriod ? '#FDE68A' : '#E5E7EB'}`
                      }}>
                        {isPeriod ? '📆 Période' : '📅 Jour unique'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 700 }}>
                      {isPeriod ? `${startDateFormatted} → ${endDateFormatted}` : startDateFormatted}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: cat.bg, color: cat.color, border: `1px solid ${cat.border}` }}>
                        {cat.label}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: h.is_recurring ? '#059669' : 'var(--text-muted)' }}>
                        {h.is_recurring ? '🔄 Oui (Annuel)' : '📌 Date fixe'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 800, color: '#7C3AED' }}>
                      x{parseFloat(h.multiplier || 1.5).toFixed(2)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Btn size="sm" variant="ghost" icon="edit" onClick={() => onEdit(h)} title="Éditer" />
                        <Btn size="sm" variant="danger" icon="trash" onClick={() => onDelete(h)} title="Supprimer" />
                      </div>
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
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function SuperAdminDashboard() {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const [selectedEstId, setSelectedEstId] = useState(null);
  const [activeTab, setActiveTab]     = useState('overview');
  const [modal, setModal]             = useState(null);
  const [modalData, setModalData]     = useState({});
  const [confirm, setConfirm]         = useState(null);
  const [mainTab, setMainTab]         = useState('establishments'); // 'establishments'|'stats'

  const [estForm,     setEstForm]     = useState({});
  const [dirForm,     setDirForm]     = useState({});
  const [staffForm,   setStaffForm]   = useState({});
  const [pwdForm,     setPwdForm]     = useState({ newPassword: '', confirm: '' });
  const [holidayForm, setHolidayForm] = useState({});

  const [staffFilter, setStaffFilter] = useState({ search: '', roleCode: '', isActive: 'true' });
  const [histFilter,  setHistFilter]  = useState({ from: '', to: '', category: '' });
  const [salaryPeriod, setSalaryPeriod] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });

  const inv = (...keys) => keys.forEach(k => qc.invalidateQueries([k]));

  // ── Données ──────────────────────────────────────────────────
  const { data: governorates = [] } = useQuery({
    queryKey: ['governorates'],
    queryFn: () => adminAPI.getGovernorates().then(r => r.data.data),
    staleTime: Infinity,
  });

  const { data: establishments = [], isLoading: loadingEsts } = useQuery({
    queryKey: ['establishments'],
    queryFn: () => establishmentsAPI.getAll().then(r => r.data.data),
  });

  const { data: globalStats, isLoading: loadingStats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => adminAPI.getStats().then(r => r.data.data),
    enabled: mainTab === 'stats',
    refetchInterval: 60000,
  });

  const selectedEst = useMemo(() => establishments.find(e => e.id === selectedEstId) || null, [establishments, selectedEstId]);

  const { data: personnel = [], isLoading: loadingPersonnel } = useQuery({
    queryKey: ['personnel', selectedEstId, staffFilter],
    queryFn: () => establishmentsAPI.getPersonnel(selectedEstId, {
      isActive: staffFilter.isActive || undefined,
      roleCode: staffFilter.roleCode || undefined,
      search:   staffFilter.search   || undefined,
      limit: 100,
    }).then(r => r.data.data),
    enabled: !!selectedEstId && activeTab === 'personnel',
  });

  const { data: director } = useQuery({
    queryKey: ['director', selectedEstId],
    queryFn: () => establishmentsAPI.getDirector(selectedEstId).then(r => r.data.data),
    enabled: !!selectedEstId && (activeTab === 'director' || activeTab === 'overview'),
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['est-history', selectedEstId, histFilter],
    queryFn: () => establishmentsAPI.getHistory(selectedEstId, { limit: 50, ...histFilter }).then(r => r.data.data),
    enabled: !!selectedEstId && activeTab === 'history',
  });

  const { data: salaryReport } = useQuery({
    queryKey: ['salary', modalData?.userId, salaryPeriod],
    queryFn: () => establishmentsAPI.getSalaryReport(modalData.userId, salaryPeriod).then(r => r.data.data),
    enabled: !!modalData?.userId && modal === 'staff-card',
  });

  // ── Mutations ─────────────────────────────────────────────────
  const mut = (fn, keys, msg) => useMutation({
    mutationFn: fn,
    onSuccess: r => { toast.success(r.data.message || msg); setModal(null); setConfirm(null); inv(...(Array.isArray(keys) ? keys : [keys])); },
    onError: e => toast.error(e.response?.data?.message || 'Erreur'),
  });

  const createEst         = mut(d => establishmentsAPI.create(d),               ['establishments'], 'Établissement créé');
  const updateEst         = mut(({ id, ...d }) => establishmentsAPI.update(id, d), ['establishments'], 'Mis à jour');
  const deactivateEst     = mut(id => adminAPI.deactivateEst(id),               ['establishments', 'admin-stats'], 'Établissement désactivé');
  const activateEst       = mut(({ id, ...d }) => adminAPI.activateEst(id, d),  ['establishments', 'admin-stats', 'director'], 'Établissement réactivé');
  const createDir         = mut(d => usersAPI.create(d),                        ['establishments', 'director'], 'Directeur créé');
  const updateDir         = mut(({ id, ...d }) => establishmentsAPI.updateDirector(id, d), ['director', 'establishments'], 'Directeur mis à jour');
  const toggleDirStatus   = mut(id => adminAPI.toggleDirectorStatus(id),        ['director', 'establishments'], 'Statut mis à jour');
  const resetDirPwd       = mut(({ id, ...d }) => adminAPI.resetDirectorPwd(id, d), ['director'], 'Mot de passe réinitialisé');
  const removeStaff       = mut(id => establishmentsAPI.removePersonnel(id),    ['personnel'], 'Compte désactivé');
  const updateStaff       = mut(({ id, ...d }) => establishmentsAPI.updatePersonnel(id, d), ['personnel', 'salary'], 'Informations mises à jour');

  const createHoliday     = mut(d => adminAPI.createHoliday(d),                 ['admin-holidays'], 'Jour férié enregistré');
  const updateHoliday     = mut(({ id, ...d }) => adminAPI.updateHoliday(id, d), ['admin-holidays'], 'Jour férié mis à jour');
  const deleteHoliday     = mut(id => adminAPI.deleteHoliday(id),               ['admin-holidays'], 'Jour férié supprimé');
  const seedTunisiaHolidays = mut(year => adminAPI.seedTunisiaHolidays({ year }), ['admin-holidays'], 'Jours fériés tunisiens préchargés !');

  // ── Handlers ──────────────────────────────────────────────────
  const goToEst   = useCallback(id => { setSelectedEstId(id); setActiveTab('overview'); }, []);
  const goBack    = useCallback(() => { setSelectedEstId(null); setActiveTab('overview'); }, []);
  const avatarSrc = u => u?.avatar_url ? (u.avatar_url.startsWith('http') ? u.avatar_url : `${API_BASE}${u.avatar_url}`) : null;

  const totalActive    = establishments.filter(e => e.is_active).length;
  const totalPersonnel = establishments.reduce((s, e) => s + (parseInt(e.user_count) || 0), 0);
  const totalDirectors = establishments.filter(e => e.director_id).length;

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <div>
      {/* ── En-tête ── */}
      <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {selectedEstId && (
            <button onClick={goBack} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
              <Ico path={I.back} size={14} /> Établissements
            </button>
          )}
          <div style={{ background: 'linear-gradient(135deg,#1B4FCA,#7C3AED)', borderRadius: 12, padding: '10px 13px', display: 'flex' }}>
            <Ico path={selectedEstId ? I.hospital : I.hospital} size={20} stroke="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
              {selectedEstId ? selectedEst?.name || 'Établissement' : 'Administration GardeSante'}
            </h1>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
              {selectedEstId
                ? `${selectedEst?.code} · ${selectedEst?.type}${selectedEst?.governorate ? ` · ${selectedEst.governorate}` : ''}`
                : `Super Admin · ${user?.firstName} ${user?.lastName}`}
            </p>
          </div>
        </div>
        {!selectedEstId && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn variant={mainTab === 'establishments' ? 'primary' : 'ghost'} onClick={() => setMainTab('establishments')}>
              🏥 Établissements
            </Btn>
            <Btn variant={mainTab === 'holidays' ? 'primary' : 'ghost'} onClick={() => setMainTab('holidays')}>
              📅 Jours Fériés
            </Btn>
            <Btn icon="chart" variant={mainTab === 'stats' ? 'primary' : 'ghost'} onClick={() => setMainTab('stats')}>
              Statistiques
            </Btn>
            {mainTab === 'establishments' && (
              <Btn icon="plus" onClick={() => { setEstForm({}); setModal('create-est'); }}>
                Nouvel établissement
              </Btn>
            )}
          </div>
        )}
      </div>

      {/* ── Vue liste, jours fériés OU stats ── */}
      {!selectedEstId && (
        <>
          {mainTab === 'establishments' ? (
            <>
              {/* KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginBottom: 22 }}>
                <KpiCard icon="hospital" label="Établissements" value={establishments.length} sub={`${totalActive} actifs`} color="#1B4FCA" />
                <KpiCard icon="users"   label="Personnel total" value={totalPersonnel} sub="Tous établissements" color="#059669" />
                <KpiCard icon="key"     label="Directeurs nommés" value={totalDirectors} sub={`${establishments.length - totalDirectors} à nommer`} color="#7C3AED" />
              </div>
              {/* Grille */}
              {loadingEsts ? (
                <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>
              ) : establishments.length === 0 ? (
                <Empty onAction={() => { setEstForm({}); setModal('create-est'); }} />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                  {establishments.map(est => (
                    <EstCard key={est.id} est={est}
                      onSelect={goToEst}
                      onEdit={() => { setEstForm({ name: est.name, nameAr: est.name_ar, type: est.type, address: est.address, city: est.city, phone: est.phone, email: est.email, governorate: est.governorate }); setSelectedEstId(est.id); setModal('edit-est'); }}
                      onToggle={() => est.is_active
                        ? setConfirm({ message: `Désactiver "${est.name}" ?`, sub: 'Tous les comptes rattachés seront désactivés.', action: () => deactivateEst.mutate(est.id) })
                        : setConfirm({ message: `Réactiver "${est.name}" ?`, sub: 'Les comptes ne seront pas automatiquement réactivés.', action: () => activateEst.mutate({ id: est.id }), danger: false })
                      }
                    />
                  ))}
                </div>
              )}
            </>
          ) : mainTab === 'holidays' ? (
            <HolidaysSection
              onOpenCreate={(yr) => {
                setHolidayForm({
                  name: '',
                  category: 'national',
                  startDate: `${yr}-01-01`,
                  endDate: `${yr}-01-01`,
                  year: yr,
                  isRecurring: true,
                  multiplier: 1.5,
                  notes: ''
                });
                setModal('create-holiday');
              }}
              onEdit={(h) => {
                setHolidayForm({
                  id: h.id,
                  name: h.name,
                  category: h.category,
                  startDate: h.start_date?.substring(0, 10),
                  endDate: h.end_date?.substring(0, 10),
                  year: h.year,
                  isRecurring: Boolean(h.is_recurring),
                  multiplier: h.multiplier,
                  notes: h.notes || ''
                });
                setModal('edit-holiday');
              }}
              onDelete={(h) => {
                setConfirm({
                  message: `Supprimer "${h.name}" ?`,
                  sub: 'Ce jour férié sera retiré du calendrier.',
                  action: () => deleteHoliday.mutate(h.id)
                });
              }}
              onSeedTunisia={(yr) => {
                setConfirm({
                  message: `Précharger les 8 jours fériés nationaux tunisiens pour ${yr} ?`,
                  sub: 'Les jours fériés usuels seront automatiquement enregistrés.',
                  action: () => seedTunisiaHolidays.mutate(yr),
                  danger: false
                });
              }}
            />
          ) : (
            <StatsSection stats={globalStats} loading={loadingStats} />
          )}
        </>
      )}

      {/* ── Vue détail établissement ── */}
      {selectedEstId && selectedEst && (
        <EstDetail
          est={selectedEst}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          director={director}
          personnel={personnel}
          loadingPersonnel={loadingPersonnel}
          history={history}
          loadingHistory={loadingHistory}
          histFilter={histFilter}
          onHistFilter={setHistFilter}
          staffFilter={staffFilter}
          onStaffFilter={setStaffFilter}
          governorates={governorates}
          onOpenCreateDir={() => { setDirForm({ establishmentId: selectedEstId }); setModal('create-dir'); }}
          onOpenEditDir={() => { setDirForm({ firstName: director?.first_name, lastName: director?.last_name, email: director?.email, phone: director?.phone, matricule: director?.matricule, baseSalary: director?.base_salary, hourlyRate: director?.hourly_rate, hireDate: director?.hire_date?.substring(0, 10) }); setModal('edit-dir'); }}
          onToggleDir={() => setConfirm({ message: director?.is_active ? `Désactiver ${director?.first_name} ${director?.last_name} ?` : `Réactiver ${director?.first_name} ${director?.last_name} ?`, action: () => toggleDirStatus.mutate(selectedEstId), danger: director?.is_active })}
          onResetDirPwd={() => { setPwdForm({ newPassword: '', confirm: '' }); setModal('reset-pwd'); }}
          onStaffCard={s => { setModalData({ userId: s.id, staff: s }); setModal('staff-card'); }}
          onEditStaff={s => { setStaffForm({ baseSalary: s.base_salary, hourlyRate: s.hourly_rate, hireDate: s.hire_date?.substring(0, 10), phone: s.phone, speciality: s.speciality, grade: s.grade }); setModalData({ userId: s.id, staff: s }); setModal('edit-staff'); }}
          onRemoveStaff={s => setConfirm({ message: `Désactiver ${s.first_name} ${s.last_name} ?`, action: () => removeStaff.mutate(s.id) })}
          onEditEst={() => { setEstForm({ name: selectedEst.name, nameAr: selectedEst.name_ar, type: selectedEst.type, address: selectedEst.address, city: selectedEst.city, phone: selectedEst.phone, email: selectedEst.email, governorate: selectedEst.governorate }); setModal('edit-est'); }}
          onToggleEst={() => selectedEst.is_active
            ? setConfirm({ message: `Désactiver "${selectedEst.name}" ?`, sub: 'Tous les comptes seront désactivés.', action: () => deactivateEst.mutate(selectedEstId) })
            : setConfirm({ message: `Réactiver "${selectedEst.name}" ?`, action: () => activateEst.mutate({ id: selectedEstId }), danger: false })
          }
          avatarSrc={avatarSrc}
        />
      )}

      {/* ══ MODALES ══ */}

      {modal === 'create-est' && (
        <Modal title="Nouvel établissement" icon="🏥" onClose={() => setModal(null)} wide>
          <EstForm form={estForm} setForm={setEstForm} govList={governorates} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="check" onClick={() => createEst.mutate(estForm)} disabled={createEst.isPending}>
              {createEst.isPending ? 'Création…' : 'Créer'}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === 'edit-est' && (
        <Modal title={`Modifier — ${selectedEst?.name || ''}`} icon="✏️" onClose={() => setModal(null)} wide>
          <EstForm form={estForm} setForm={setEstForm} editing govList={governorates} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="check" onClick={() => updateEst.mutate({ id: selectedEstId, ...estForm })} disabled={updateEst.isPending}>
              {updateEst.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === 'create-dir' && (
        <Modal title="Créer un directeur" icon="👔" onClose={() => setModal(null)}>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '7px 12px', marginBottom: 14, fontSize: 12, color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
            🏥 <strong>{selectedEst?.name}</strong>
          </div>
          <DirForm form={dirForm} setForm={setDirForm} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="user" onClick={() => createDir.mutate({ ...dirForm, roleCode: 'director', establishmentId: selectedEstId })} disabled={createDir.isPending}>
              {createDir.isPending ? 'Création…' : 'Créer le directeur'}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === 'edit-dir' && director && (
        <Modal title="Modifier le directeur" icon="✏️" onClose={() => setModal(null)}>
          <DirForm form={dirForm} setForm={setDirForm} editing />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="check" onClick={() => updateDir.mutate({ id: selectedEstId, ...dirForm })} disabled={updateDir.isPending}>
              {updateDir.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === 'reset-pwd' && (
        <Modal title="Réinitialiser le mot de passe" icon="🔑" onClose={() => setModal(null)}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
            Définir un nouveau mot de passe pour <strong>{director?.first_name} {director?.last_name}</strong>
          </p>
          <Field label="Nouveau mot de passe" required>
            <Inp type="password" value={pwdForm.newPassword} onChange={e => setPwdForm(p => ({ ...p, newPassword: e.target.value }))} placeholder="Min. 8 caractères" />
          </Field>
          <Field label="Confirmer le mot de passe" required>
            <Inp type="password" value={pwdForm.confirm} onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))} placeholder="Répéter le mot de passe" />
          </Field>
          {pwdForm.confirm && pwdForm.newPassword !== pwdForm.confirm && (
            <p style={{ color: '#DC2626', fontSize: 12, margin: '0 0 10px' }}>⚠️ Les mots de passe ne correspondent pas</p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="lock" variant="warning"
              onClick={() => resetDirPwd.mutate({ id: selectedEstId, newPassword: pwdForm.newPassword })}
              disabled={resetDirPwd.isPending || pwdForm.newPassword !== pwdForm.confirm || pwdForm.newPassword.length < 8}>
              {resetDirPwd.isPending ? 'Réinitialisation…' : 'Réinitialiser'}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === 'staff-card' && modalData.staff && (
        <Modal title={`${modalData.staff.first_name} ${modalData.staff.last_name}`} icon="👤" onClose={() => { setModal(null); setModalData({}); }} wide>
          <StaffCard staff={modalData.staff} salaryReport={salaryReport} salaryPeriod={salaryPeriod} onPeriodChange={setSalaryPeriod} avatarSrc={avatarSrc}
            onEdit={() => { setStaffForm({ baseSalary: modalData.staff.base_salary, hourlyRate: modalData.staff.hourly_rate, hireDate: modalData.staff.hire_date?.substring(0, 10), phone: modalData.staff.phone, speciality: modalData.staff.speciality, grade: modalData.staff.grade }); setModal('edit-staff'); }}
            onRemove={() => { setModal(null); setConfirm({ message: `Désactiver ${modalData.staff.first_name} ${modalData.staff.last_name} ?`, action: () => removeStaff.mutate(modalData.staff.id) }); }}
          />
        </Modal>
      )}

      {modal === 'edit-staff' && modalData.staff && (
        <Modal title={`Modifier — ${modalData.staff.first_name} ${modalData.staff.last_name}`} icon="✏️" onClose={() => setModal(null)}>
          <StaffEditForm form={staffForm} setForm={setStaffForm} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="check" onClick={() => updateStaff.mutate({ id: modalData.userId, ...staffForm })} disabled={updateStaff.isPending}>
              {updateStaff.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === 'create-holiday' && (
        <Modal title="Ajouter un jour ou une période férié(e)" icon="📅" onClose={() => setModal(null)}>
          <HolidayForm form={holidayForm} setForm={setHolidayForm} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="check" onClick={() => createHoliday.mutate(holidayForm)} disabled={createHoliday.isPending || !holidayForm.name?.trim() || !holidayForm.startDate}>
              {createHoliday.isPending ? 'Enregistrement…' : 'Enregistrer le jour férié'}
            </Btn>
          </div>
        </Modal>
      )}

      {modal === 'edit-holiday' && (
        <Modal title="Modifier le jour / la période férié(e)" icon="✏️" onClose={() => setModal(null)}>
          <HolidayForm form={holidayForm} setForm={setHolidayForm} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
            <Btn variant="ghost" onClick={() => setModal(null)}>Annuler</Btn>
            <Btn icon="check" onClick={() => updateHoliday.mutate(holidayForm)} disabled={updateHoliday.isPending || !holidayForm.name?.trim() || !holidayForm.startDate}>
              {updateHoliday.isPending ? 'Enregistrement…' : 'Mettre à jour'}
            </Btn>
          </div>
        </Modal>
      )}

      {confirm && <Confirm message={confirm.message} sub={confirm.sub} onConfirm={() => confirm.action()} onCancel={() => setConfirm(null)} danger={confirm.danger !== false} />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// EMPTY STATE
// ══════════════════════════════════════════════════════════════
function Empty({ onAction }) {
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 60, textAlign: 'center', border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 48, marginBottom: 14 }}>🏥</div>
      <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>Aucun établissement</h3>
      <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>Créez le premier établissement de la plateforme.</p>
      <Btn icon="plus" onClick={onAction}>Créer un établissement</Btn>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ESTABLISHMENT CARD
// ══════════════════════════════════════════════════════════════
function EstCard({ est, onSelect, onEdit, onToggle }) {
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-subtle)', overflow: 'hidden', opacity: est.is_active ? 1 : 0.65, transition: 'box-shadow 0.2s, transform 0.2s' }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
      <div style={{ height: 4, background: est.is_active ? 'linear-gradient(90deg,#1B4FCA,#7C3AED)' : '#6B7280' }} />
      <div style={{ padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, background: 'var(--bg-elevated)', padding: '2px 7px', borderRadius: 5, color: 'var(--color-primary)' }}>{est.code}</span>
              <EstBadge active={est.is_active} small />
            </div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{est.name}</h3>
            {est.governorate && <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>📍 {est.governorate}{est.city ? `, ${est.city}` : ''}</p>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[{ label: 'Personnel', v: est.user_count || 0, e: '👥' }, { label: 'Services', v: est.dept_count || 0, e: '🏢' }, { label: 'Directeur', v: est.director_id ? '✓' : '—', e: '👔' }].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 7, padding: '7px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, marginBottom: 1 }}>{s.e}</div>
              <div style={{ fontWeight: 800, fontSize: 14 }}>{s.v}</div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s.label}</div>
            </div>
          ))}
        </div>
        {est.director_id ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-elevated)', borderRadius: 7, padding: '7px 10px', marginBottom: 12 }}>
            <Avatar firstName={est.director_first_name} lastName={est.director_last_name} size="xs" />
            <div style={{ fontSize: 12, fontWeight: 600 }}>{est.director_first_name} {est.director_last_name}</div>
          </div>
        ) : (
          <div style={{ background: '#D9770618', borderRadius: 7, padding: '7px 10px', marginBottom: 12, fontSize: 12, color: '#D97706', fontWeight: 600 }}>⚠️ Aucun directeur nommé</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onSelect(est.id)} style={{ flex: 1, background: 'var(--color-primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 0', cursor: 'pointer', fontWeight: 700, fontSize: 12, fontFamily: 'inherit' }}>Gérer →</button>
          <button onClick={onEdit}   title="Modifier"                       style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 7, padding: '0 9px', cursor: 'pointer', color: 'var(--text-secondary)' }}><Ico path={I.edit} size={13} /></button>
          <button onClick={onToggle} title={est.is_active ? 'Désactiver' : 'Réactiver'} style={{ background: est.is_active ? '#DC262615' : '#05966915', border: `1px solid ${est.is_active ? '#DC262630' : '#05966930'}`, borderRadius: 7, padding: '0 9px', cursor: 'pointer', color: est.is_active ? '#DC2626' : '#059669' }}><Ico path={I.power} size={13} /></button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ESTABLISHMENT DETAIL — 4 onglets
// ══════════════════════════════════════════════════════════════
function EstDetail({ est, activeTab, onTabChange, director, personnel, loadingPersonnel, history, loadingHistory, histFilter, onHistFilter, staffFilter, onStaffFilter, governorates, onOpenCreateDir, onOpenEditDir, onToggleDir, onResetDirPwd, onStaffCard, onEditStaff, onRemoveStaff, onEditEst, onToggleEst, avatarSrc }) {
  const tabs = [
    { id: 'overview',  icon: '📋', label: 'Aperçu' },
    { id: 'director',  icon: '👔', label: 'Directeur' },
    { id: 'personnel', icon: '👥', label: 'Personnel' },
    { id: 'history',   icon: '📜', label: 'Historique' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 22, background: 'var(--bg-elevated)', borderRadius: 12, padding: 4, width: 'fit-content' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => onTabChange(t.id)} style={{ padding: '8px 18px', borderRadius: 9, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, background: activeTab === t.id ? 'var(--color-primary)' : 'transparent', color: activeTab === t.id ? '#fff' : 'var(--text-muted)', transition: 'all 0.2s' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── APERÇU ── */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div className="card">
            <div className="card-header" style={{ justifyContent: 'space-between' }}>
              <h3 className="card-title">Informations</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn size="sm" variant="ghost" icon="edit" onClick={onEditEst}>Modifier</Btn>
                <Btn size="sm" variant={est.is_active ? 'danger' : 'success'} icon="power" onClick={onToggleEst}>{est.is_active ? 'Désactiver' : 'Réactiver'}</Btn>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              {[
                { label: 'Code', value: est.code, mono: true },
                { label: 'Type', value: est.type },
                { label: 'Gouvernorat', value: est.governorate || '—' },
                { label: 'Ville', value: est.city || '—' },
                { label: 'Adresse', value: est.address || '—' },
                { label: 'Téléphone', value: est.phone || '—' },
                { label: 'Email', value: est.email || '—' },
                { label: 'Statut', value: <EstBadge active={est.is_active} /> },
                { label: 'Créé le', value: new Date(est.created_at).toLocaleDateString('fr-FR') },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{r.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, fontFamily: r.mono ? 'monospace' : 'inherit' }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <KpiCard icon="users"   label="Personnel" value={est.user_count || 0} color="#1B4FCA" />
              <KpiCard icon="hospital" label="Services"  value={est.dept_count || 0} color="#059669" />
            </div>
            <div className="card" style={{ flex: 1 }}>
              <div className="card-header">
                <h3 className="card-title">Directeur</h3>
                {!director && <Btn size="sm" icon="plus" onClick={onOpenCreateDir}>Nommer</Btn>}
              </div>
              <div style={{ padding: '12px 16px' }}>
                {director ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar firstName={director.first_name} lastName={director.last_name} src={avatarSrc(director)} size="lg" />
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>{director.first_name} {director.last_name}</p>
                      <p style={{ margin: '2px 0', fontSize: 12, color: 'var(--text-muted)' }}>{director.email}</p>
                      <PresenceBadge lastActivity={director.last_activity_at || director.last_login} small />
                    </div>
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>⚠️ Aucun directeur nommé.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DIRECTEUR ── */}
      {activeTab === 'director' && (
        <div className="card" style={{ maxWidth: 640, margin: '0 auto' }}>
          <div className="card-header">
            <h3 className="card-title">👔 Directeur</h3>
          </div>
          {director ? (
            <div style={{ padding: 22 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 22 }}>
                <Avatar firstName={director.first_name} lastName={director.last_name} src={avatarSrc(director)} size="xl" />
                <div style={{ flex: 1 }}>
                  <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 800 }}>{director.first_name} {director.last_name}</h2>
                  <p style={{ margin: '0 0 8px', color: 'var(--text-muted)', fontSize: 12 }}>Directeur · {est.name}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <PresenceBadge lastActivity={director.last_activity_at || director.last_login} />
                    <EstBadge active={director.is_active} />
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 22px', marginBottom: 22 }}>
                {[
                  { label: 'Email',      value: director.email },
                  { label: 'Téléphone', value: director.phone || '—' },
                  { label: 'Matricule', value: director.matricule || '—' },
                  { label: 'Embauche',  value: director.hire_date ? new Date(director.hire_date).toLocaleDateString('fr-FR') : '—' },
                  { label: 'Salaire de base', value: director.base_salary ? `${parseFloat(director.base_salary).toLocaleString('fr-FR')} DZD` : '—' },
                  { label: 'Taux horaire',    value: director.hourly_rate ? `${parseFloat(director.hourly_rate).toLocaleString('fr-FR')} DZD/h` : '—' },
                  { label: 'Dernière activité', value: director.last_activity_at ? new Date(director.last_activity_at).toLocaleString('fr-FR') : (director.last_login ? new Date(director.last_login).toLocaleString('fr-FR') : 'Jamais') },
                  { label: 'Créé le',   value: new Date(director.created_at).toLocaleDateString('fr-FR') },
                ].map(r => (
                  <div key={r.label} style={{ padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{r.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Btn icon="edit" onClick={onOpenEditDir}>Modifier</Btn>
                <Btn variant="warning" icon="lock" onClick={onResetDirPwd}>Réinitialiser MDP</Btn>
                <Btn variant={director.is_active ? 'danger' : 'success'} icon="power" onClick={onToggleDir}>
                  {director.is_active ? 'Désactiver' : 'Réactiver'}
                </Btn>
              </div>
            </div>
          ) : (
            <div style={{ padding: 46, textAlign: 'center' }}>
              <div style={{ fontSize: 46, marginBottom: 12 }}>👔</div>
              <p style={{ color: 'var(--text-muted)', marginBottom: 18 }}>Aucun directeur pour cet établissement.</p>
              <Btn icon="plus" onClick={onOpenCreateDir}>Créer un compte directeur</Btn>
            </div>
          )}
        </div>
      )}

      {/* ── PERSONNEL ── */}
      {activeTab === 'personnel' && (
        <div>
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <Field label="Recherche">
                  <div style={{ position: 'relative' }}>
                    <Ico path={I.search} size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <Inp placeholder="Nom, email, matricule…" value={staffFilter.search} onChange={e => onStaffFilter(f => ({ ...f, search: e.target.value }))} style={{ paddingLeft: 30 }} />
                  </div>
                </Field>
              </div>
              <div style={{ flex: '0 0 160px' }}>
                <Field label="Rôle">
                  <Sel value={staffFilter.roleCode} onChange={e => onStaffFilter(f => ({ ...f, roleCode: e.target.value }))}>
                    <option value="">Tous les rôles</option>
                    {Object.entries(ROLE_LABELS).filter(([k]) => k !== 'director').map(([code, { label }]) => <option key={code} value={code}>{label}</option>)}
                  </Sel>
                </Field>
              </div>
              <div style={{ flex: '0 0 130px' }}>
                <Field label="Statut">
                  <Sel value={staffFilter.isActive} onChange={e => onStaffFilter(f => ({ ...f, isActive: e.target.value }))}>
                    <option value="">Tous</option>
                    <option value="true">Actifs</option>
                    <option value="false">Inactifs</option>
                  </Sel>
                </Field>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">Personnel ({personnel.length})</h3></div>
            {loadingPersonnel ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div> : personnel.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Aucun personnel.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                      {['Personnel', 'Rôle', 'Spécialité', 'Gardes/mois', 'Heures/mois', 'Présence', 'Actions'].map(h => (
                        <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {personnel.map(s => (
                      <tr key={s.id} onClick={() => onStaffCard(s)} style={{ borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', opacity: s.is_active ? 1 : 0.55 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '11px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                            <Avatar firstName={s.first_name} lastName={s.last_name} size="xs" />
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{s.first_name} {s.last_name}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '11px 12px' }}><RoleBadge code={s.role_code} /></td>
                        <td style={{ padding: '11px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>{s.speciality || '—'}</td>
                        <td style={{ padding: '11px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--color-primary)' }}>{s.shifts_this_month}</td>
                        <td style={{ padding: '11px 12px', textAlign: 'center', fontWeight: 700, color: '#059669' }}>{parseFloat(s.hours_this_month).toFixed(1)}h</td>
                        <td style={{ padding: '11px 12px' }}><PresenceBadge lastActivity={s.last_activity_at || s.last_login} small /></td>
                        <td style={{ padding: '11px 12px' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <button onClick={() => onStaffCard(s)} title="Fiche" style={{ background: '#1B4FCA18', border: '1px solid #1B4FCA30', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#1B4FCA' }}><Ico path={I.eye} size={12} /></button>
                            <button onClick={() => onEditStaff(s)} title="Modifier" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: 'var(--text-secondary)' }}><Ico path={I.edit} size={12} /></button>
                            {s.is_active && <button onClick={() => onRemoveStaff(s)} title="Désactiver" style={{ background: '#DC262618', border: '1px solid #DC262630', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#DC2626' }}><Ico path={I.trash} size={12} /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── HISTORIQUE ── */}
      {activeTab === 'history' && (
        <div>
          <div className="card" style={{ marginBottom: 14, padding: 14 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: '0 0 150px' }}><Field label="Du"><Inp type="date" value={histFilter.from} onChange={e => onHistFilter(f => ({ ...f, from: e.target.value }))} /></Field></div>
              <div style={{ flex: '0 0 150px' }}><Field label="Au"><Inp type="date" value={histFilter.to} onChange={e => onHistFilter(f => ({ ...f, to: e.target.value }))} /></Field></div>
              <div style={{ flex: '0 0 170px' }}>
                <Field label="Catégorie">
                  <Sel value={histFilter.category} onChange={e => onHistFilter(f => ({ ...f, category: e.target.value }))}>
                    <option value="">Toutes</option>
                    <option value="auth">Authentification</option>
                    <option value="admin">Administration</option>
                    <option value="schedule">Planning</option>
                    <option value="shift">Garde</option>
                    <option value="absence">Absence</option>
                  </Sel>
                </Field>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">📜 Journal d'activité</h3></div>
            {loadingHistory ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div> : history.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Aucun événement.</div> : (
              <div style={{ padding: '6px 0' }}>
                {history.map(h => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: h.severity === 'warning' ? '#D97706' : h.severity === 'error' ? '#DC2626' : '#059669' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{h.description}{h.first_name && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>par {h.first_name} {h.last_name}</span>}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: 10 }}>{new Date(h.created_at).toLocaleString('fr-FR')}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                        <span style={{ fontSize: 10, background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h.category}</span>
                        <span style={{ fontSize: 10, background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4, color: 'var(--text-muted)' }}>{h.action}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STATS SECTION
// ══════════════════════════════════════════════════════════════
function StatsSection({ stats, loading }) {
  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement des statistiques…</div>;
  if (!stats)  return null;

  const { establishments: e, users: u, byGovernorate, evolution, recentLogins, recentEstablishments } = stats;

  const typeData = [
    { label: 'Hôpitaux',   value: parseInt(e.hospitals)  || 0 },
    { label: 'Cliniques',  value: parseInt(e.clinics)   || 0 },
    { label: 'Instituts',  value: parseInt(e.institutes) || 0 },
  ].filter(d => d.value > 0);

  return (
    <div>
      {/* KPIs Établissements */}
      <h2 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}>🏥 Établissements</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 22 }}>
        <KpiCard icon="hospital" label="Total"       value={e.total}        sub={`+${e.new_last_30d} ce mois`} color="#1B4FCA" />
        <KpiCard icon="check"    label="Actifs"      value={e.active}       color="#059669" />
        <KpiCard icon="power"    label="Désactivés"  value={e.inactive}     color="#DC2626" />
        <KpiCard icon="key"      label="Directeurs"  value={u.directors}    color="#7C3AED" />
      </div>

      {/* KPIs Utilisateurs */}
      <h2 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 700, color: 'var(--text-secondary)' }}>👥 Utilisateurs</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 22 }}>
        <KpiCard icon="users"   label="Total personnel"  value={u.total}         color="#1B4FCA" />
        <KpiCard icon="wifi"    label="En ligne (5 min)" value={u.online_now}    color="#10B981" />
        <KpiCard icon="clock"   label="Connectés aujourd'hui" value={u.connected_today} color="#D97706" />
        <KpiCard icon="user"    label="Chefs de service" value={u.dept_heads}    color="#7C3AED" />
      </div>

      {/* Graphiques */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 22 }}>
        {/* Évolution établissements */}
        <div className="card">
          <div className="card-header"><h3 className="card-title">📈 Évolution établissements (12 mois)</h3></div>
          <div style={{ padding: '12px 16px' }}>
            <BarChart data={evolution.establishments} color="#1B4FCA" height={110} />
          </div>
        </div>

        {/* Évolution connexions */}
        <div className="card">
          <div className="card-header"><h3 className="card-title">📊 Connexions (30 jours)</h3></div>
          <div style={{ padding: '12px 16px' }}>
            <LineChart data={evolution.logins} color="#059669" height={110} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 22 }}>
        {/* Répartition par gouvernorat */}
        <div className="card">
          <div className="card-header"><h3 className="card-title">📍 Par gouvernorat</h3></div>
          <div style={{ padding: '8px 0', maxHeight: 260, overflowY: 'auto' }}>
            {byGovernorate.map((g, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{g.governorate}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{g.users} personnel</div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--color-primary)' }}>{g.establishments}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>établ.</span>
                  <div style={{ width: 60, height: 6, background: 'var(--bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'var(--color-primary)', borderRadius: 4, width: `${Math.min((parseInt(g.establishments) / Math.max(...byGovernorate.map(x => parseInt(x.establishments)))) * 100, 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Répartition par type */}
        <div className="card">
          <div className="card-header"><h3 className="card-title">🏢 Répartition par type</h3></div>
          <div style={{ padding: '20px 16px' }}>
            <PieChart data={typeData} size={110} />
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Médecins seniors', value: u.senior_doctors, color: '#DC2626' },
                { label: 'Résidents',        value: u.residents,      color: '#6B7280' },
                { label: 'Superviseurs',     value: u.supervisors,    color: '#D97706' },
                { label: 'Actifs totaux',    value: u.active,         color: '#059669' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Dernières connexions */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-header"><h3 className="card-title">🕐 Dernières connexions</h3></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                {['Utilisateur', 'Rôle', 'Établissement', 'Gouvernorat', 'Présence'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentLogins.slice(0, 10).map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Avatar firstName={u.first_name} lastName={u.last_name} size="xs" />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{u.first_name} {u.last_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px' }}><RoleBadge code={u.role_code} /></td>
                  <td style={{ padding: '10px 14px', fontSize: 12 }}>{u.establishment_name}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>{u.governorate || '—'}</td>
                  <td style={{ padding: '10px 14px' }}><PresenceBadge lastActivity={u.last_activity_at || u.last_login} small /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nouveaux établissements */}
      <div className="card">
        <div className="card-header"><h3 className="card-title">🆕 Établissements récents</h3></div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                {['Établissement', 'Type', 'Gouvernorat', 'Directeur', 'Statut', 'Créé le'].map(h => (
                  <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentEstablishments.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={ev => ev.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{e.name}</div>
                    <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--color-primary)' }}>{e.code}</div>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12 }}>{e.type}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12 }}>{e.governorate || '—'}</td>
                  <td style={{ padding: '10px 14px', fontSize: 12 }}>{e.dir_first ? `${e.dir_first} ${e.dir_last}` : <span style={{ color: '#D97706' }}>Non nommé</span>}</td>
                  <td style={{ padding: '10px 14px' }}><EstBadge active={e.is_active} small /></td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text-muted)' }}>{new Date(e.created_at).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STAFF CARD MODAL
// ══════════════════════════════════════════════════════════════
function StaffCard({ staff, salaryReport, salaryPeriod, onPeriodChange, avatarSrc, onEdit, onRemove }) {
  const fmt = n => n ? parseFloat(n).toLocaleString('fr-FR') : '—';
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 22 }}>
        <Avatar firstName={staff.first_name} lastName={staff.last_name} src={avatarSrc(staff)} size="xl" />
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800 }}>{staff.first_name} {staff.last_name}</h2>
          <RoleBadge code={staff.role_code} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PresenceBadge lastActivity={staff.last_activity_at || staff.last_login} />
            <EstBadge active={staff.is_active} small />
            {staff.is_on_leave && <span style={{ fontSize: 11, background: '#D9770618', color: '#D97706', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>En congé</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Informations</h4>
          {[{ label: 'Email', v: staff.email }, { label: 'Téléphone', v: staff.phone || '—' }, { label: 'Matricule', v: staff.matricule || '—' }, { label: 'Spécialité', v: staff.speciality || '—' }, { label: 'Grade', v: staff.grade || '—' }, { label: 'Service(s)', v: staff.departments || '—' }].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{r.label}</span>
              <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{r.v}</span>
            </div>
          ))}
        </div>
        <div>
          <h4 style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Carrière</h4>
          {[{ label: 'Embauche', v: staff.hire_date ? new Date(staff.hire_date).toLocaleDateString('fr-FR') : '—' }, { label: 'Ancienneté', v: salaryReport?.user?.seniority ? `${salaryReport.user.seniority.years}a ${salaryReport.user.seniority.months}m` : '—' }, { label: 'Salaire base', v: staff.base_salary ? `${fmt(staff.base_salary)} DZD` : '—' }, { label: 'Taux horaire', v: staff.hourly_rate ? `${fmt(staff.hourly_rate)} DZD/h` : '—' }, { label: 'Dernière activité', v: staff.last_activity_at ? new Date(staff.last_activity_at).toLocaleString('fr-FR') : (staff.last_login ? new Date(staff.last_login).toLocaleString('fr-FR') : 'Jamais') }].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>{r.label}</span>
              <span style={{ fontSize: 12, fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{r.v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: 14, marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>💰 Rapport mensuel</h4>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={salaryPeriod.month} onChange={e => onPeriodChange(p => ({ ...p, month: parseInt(e.target.value) }))} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '3px 7px', fontSize: 12, color: 'var(--text-primary)' }}>
              {MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <select value={salaryPeriod.year} onChange={e => onPeriodChange(p => ({ ...p, year: parseInt(e.target.value) }))} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '3px 7px', fontSize: 12, color: 'var(--text-primary)' }}>
              {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        {salaryReport ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {[
              { label: 'Gardes',       v: salaryReport.shifts.total_shifts,                        color: '#1B4FCA' },
              { label: 'Heures',       v: `${parseFloat(salaryReport.shifts.total_hours).toFixed(1)}h`, color: '#059669' },
              { label: 'Extra',        v: `${parseFloat(salaryReport.shifts.extra_hours).toFixed(1)}h`, color: '#D97706' },
              { label: 'Salaire base', v: `${fmt(salaryReport.salary.baseSalary)} DZD`,            color: '#6B7280' },
              { label: 'Prime',        v: `${fmt(salaryReport.salary.extraPay)} DZD`,              color: '#7C3AED' },
              { label: 'Total estimé', v: `${fmt(salaryReport.salary.totalSalary)} DZD`,           color: '#059669', bold: true },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg-card)', borderRadius: 8, padding: '9px 10px', textAlign: 'center', border: s.bold ? `2px solid ${s.color}` : '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: s.bold ? 14 : 16, fontWeight: 800, color: s.color }}>{s.v}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, fontWeight: s.bold ? 700 : 400 }}>{s.label}</div>
              </div>
            ))}
          </div>
        ) : <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Chargement…</p>}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <Btn icon="edit" onClick={onEdit}>Modifier</Btn>
        {staff.is_active && <Btn variant="danger" icon="trash" onClick={onRemove}>Désactiver</Btn>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// FORMULAIRES
// ══════════════════════════════════════════════════════════════
function EstForm({ form, setForm, editing, govList }) {
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      {!editing && <Field label="Code unique" required><Inp placeholder="CHU-TUN" value={form.code || ''} onChange={e => f('code', e.target.value.toUpperCase())} /></Field>}
      <Field label="Type">
        <Sel value={form.type || 'hospital'} onChange={e => f('type', e.target.value)}>
          <option value="hospital">Hôpital</option>
          <option value="clinic">Clinique</option>
          <option value="institute">Institut</option>
        </Sel>
      </Field>
      <div style={{ gridColumn: editing ? '1/-1' : 'auto' }}>
        <Field label="Nom (français)" required><Inp placeholder="CHU de Tunis" value={form.name || ''} onChange={e => f('name', e.target.value)} /></Field>
      </div>
      <Field label="Nom (arabe)"><Inp placeholder="مستشفى جامعي" value={form.nameAr || ''} onChange={e => f('nameAr', e.target.value)} style={{ direction: 'rtl' }} /></Field>
      <div style={{ gridColumn: '1/-1' }}>
        <Field label="Gouvernorat (Tunisie)" required>
          <GovSelect value={form.governorate || ''} onChange={v => f('governorate', v)} govList={govList} />
        </Field>
      </div>
      <Field label="Ville"><Inp placeholder="Tunis" value={form.city || ''} onChange={e => f('city', e.target.value)} /></Field>
      <Field label="Téléphone"><Inp placeholder="+216 71…" value={form.phone || ''} onChange={e => f('phone', e.target.value)} /></Field>
      <Field label="Email"><Inp type="email" placeholder="contact@chu.tn" value={form.email || ''} onChange={e => f('email', e.target.value)} /></Field>
      <div style={{ gridColumn: '1/-1' }}><Field label="Adresse"><Inp placeholder="Rue, quartier, ville" value={form.address || ''} onChange={e => f('address', e.target.value)} /></Field></div>
    </div>
  );
}

function DirForm({ form, setForm, editing }) {
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const [showPwd, setShowPwd] = useState(false);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Field label="Prénom" required><Inp value={form.firstName || ''} onChange={e => f('firstName', e.target.value)} /></Field>
      <Field label="Nom" required><Inp value={form.lastName || ''} onChange={e => f('lastName', e.target.value)} /></Field>
      <div style={{ gridColumn: '1/-1' }}><Field label="Email" required><Inp type="email" value={form.email || ''} onChange={e => f('email', e.target.value)} /></Field></div>
      {!editing && (
        <div style={{ gridColumn: '1/-1' }}>
          <Field label="Mot de passe" required>
            <div style={{ position: 'relative' }}>
              <Inp type={showPwd ? 'text' : 'password'} value={form.password || ''} onChange={e => f('password', e.target.value)} />
              <button type="button" onClick={() => setShowPwd(s => !s)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>{showPwd ? '🙈' : '👁️'}</button>
            </div>
          </Field>
        </div>
      )}
      <Field label="Téléphone"><Inp value={form.phone || ''} onChange={e => f('phone', e.target.value)} /></Field>
      <Field label="Matricule"><Inp placeholder="DIR-001" value={form.matricule || ''} onChange={e => f('matricule', e.target.value)} /></Field>
      <Field label="Date d'embauche"><Inp type="date" value={form.hireDate || ''} onChange={e => f('hireDate', e.target.value)} /></Field>
      <Field label="Salaire base (DZD)"><Inp type="number" value={form.baseSalary || ''} onChange={e => f('baseSalary', e.target.value)} /></Field>
      <Field label="Taux horaire (DZD/h)"><Inp type="number" value={form.hourlyRate || ''} onChange={e => f('hourlyRate', e.target.value)} /></Field>
    </div>
  );
}

function StaffEditForm({ form, setForm }) {
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <Field label="Téléphone"><Inp value={form.phone || ''} onChange={e => f('phone', e.target.value)} /></Field>
      <Field label="Spécialité"><Inp value={form.speciality || ''} onChange={e => f('speciality', e.target.value)} /></Field>
      <Field label="Grade"><Inp value={form.grade || ''} onChange={e => f('grade', e.target.value)} /></Field>
      <Field label="Date d'embauche"><Inp type="date" value={form.hireDate || ''} onChange={e => f('hireDate', e.target.value)} /></Field>
      <Field label="Salaire base (DZD)"><Inp type="number" value={form.baseSalary || ''} onChange={e => f('baseSalary', e.target.value)} /></Field>
      <Field label="Taux horaire (DZD/h)"><Inp type="number" value={form.hourlyRate || ''} onChange={e => f('hourlyRate', e.target.value)} /></Field>
    </div>
  );
}
