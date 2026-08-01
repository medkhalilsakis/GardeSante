import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scheduleBuilderAPI, scheduleConfigAPI } from '../../../api';
import toast from 'react-hot-toast';

// ── Icons ─────────────────────────────────────────────────────────────
const Ico = ({ d, s = 16, c = 'currentColor' }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const IcoPlus    = () => <Ico d="M12 5v14M5 12h14" />;
const IcoTrash   = () => <Ico d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;
const IcoSearch  = () => <Ico d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />;
const IcoSave    = () => <Ico d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2zM17 21V13H7v8M7 3v5h8" />;
const IcoSend    = () => <Ico d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />;
const IcoBack    = () => <Ico d="M15 18l-6-6 6-6" />;
const IcoCheck   = () => <Ico d="M20 6L9 17l-5-5" />;
const IcoCols    = () => <Ico d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2v-4M9 21H5a2 2 0 01-2-2v-4m0 0h18" />;
const IcoUser    = () => <Ico d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />;

// ── Color palette for shift types ─────────────────────────────────────
const SHIFT_COLORS = {
  J: { bg: '#DBEAFE', text: '#1D4ED8', border: '#93C5FD' },
  N: { bg: '#EDE9FE', text: '#6D28D9', border: '#C4B5FD' },
  S: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  G: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  R: { bg: '#F3F4F6', text: '#6B7280', border: '#D1D5DB' },
};
const getShiftColor = (code) => SHIFT_COLORS[code?.toUpperCase()] || SHIFT_COLORS['G'];

// ── Day header helpers ─────────────────────────────────────────────────
const getDaysInRange = (start, end) => {
  if (!start || !end) return [];
  const days = [], d = new Date(start);
  const e = new Date(end);
  while (d <= e) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
};
const DOW_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

// ── Staff Sidebar ─────────────────────────────────────────────────────
function StaffSidebar({ staff, onDragStart }) {
  const [search, setSearch] = useState('');
  const filtered = staff.filter(s =>
    !search || `${s.first_name} ${s.last_name} ${s.matricule || ''}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-elevated)', borderRight: '1px solid var(--border-subtle)',
      height: '100%',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 10px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
          Personnel ({staff.length})
        </div>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
            <IcoSearch />
          </span>
          <input
            placeholder="Chercher..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '6px 8px 6px 28px', borderRadius: 7,
              border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
              fontSize: 11, color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
      </div>
      {/* Staff list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
        {filtered.map(m => (
          <div
            key={m.id}
            draggable
            onDragStart={() => onDragStart(m)}
            title={`Glisser pour ajouter\n${m.first_name} ${m.last_name}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '7px 8px',
              borderRadius: 8, marginBottom: 4, cursor: 'grab', userSelect: 'none',
              border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
              transition: 'box-shadow .1s',
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,.1)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = ''}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--color-primary), #7C3AED)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 10, fontWeight: 800,
            }}>
              {m.first_name[0]}{m.last_name[0]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.last_name} {m.first_name[0]}.
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.role_name || m.speciality}
              </div>
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', cursor: 'grab' }}>⠿</span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
            Aucun résultat
          </div>
        )}
      </div>
      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
        Glissez un nom dans le tableau →
      </div>
    </div>
  );
}

// ── Main Spreadsheet Component ────────────────────────────────────────
export default function SmartSpreadsheet({ scheduleId, departmentId, onBack }) {
  const qc = useQueryClient();
  const [editingCell, setEditingCell] = useState(null); // { rowId, colKey }
  const [editValue, setEditValue] = useState('');
  const [filter, setFilter] = useState({ search: '', role: '' });
  const [visibleCols, setVisibleCols] = useState(null); // null = all visible
  const [showColPanel, setShowColPanel] = useState(false);
  const [draggedStaff, setDraggedStaff] = useState(null);
  const [rows, setRows] = useState([]); // [{ id, userId, firstName, lastName, roleName, phone, shifts: {dateStr: code} }]
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  // Fetch schedule
  const { data: schedData, isLoading } = useQuery({
    queryKey: ['schedule-detail', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId),
    enabled: !!scheduleId,
  });
  const schedule = schedData?.data?.data || schedData?.data;

  // Fetch staff
  const { data: staffData } = useQuery({
    queryKey: ['dept-staff', departmentId],
    queryFn: () => scheduleConfigAPI.getStaff ? scheduleConfigAPI.getStaff(departmentId) : Promise.resolve({ data: { data: [] } }),
    enabled: !!departmentId,
  });
  const allStaff = staffData?.data?.data || staffData?.data || schedule?.staff || [];

  // Build rows from schedule data
  useEffect(() => {
    if (!schedule) return;
    const staffList = schedule.staff || [];
    const shifts = schedule.shifts || [];
    const builtRows = staffList.map((m, idx) => {
      const userShifts = {};
      shifts.filter(s => s.user_id === m.id).forEach(s => {
        const date = typeof s.shift_date === 'string' ? s.shift_date.split('T')[0] : new Date(s.shift_date).toISOString().split('T')[0];
        userShifts[date] = s.shift_type_code?.charAt(0)?.toUpperCase() || 'G';
      });
      return {
        id: `row-${m.id}`,
        userId: m.id,
        firstName: m.first_name,
        lastName: m.last_name,
        roleName: m.role_name || '',
        phone: m.phone || '',
        matricule: m.matricule || '',
        shifts: userShifts,
        isNew: false,
      };
    });
    // Add one empty row by default if no staff
    if (builtRows.length === 0) {
      builtRows.push({ id: 'new-0', userId: null, firstName: '', lastName: '', roleName: '', phone: '', shifts: {}, isNew: true });
    }
    setRows(builtRows);
  }, [schedule]);

  const days = useMemo(() => {
    if (!schedule) return [];
    return getDaysInRange(schedule.start_date, schedule.end_date);
  }, [schedule]);

  // Fixed columns definition
  const fixedCols = [
    { key: 'lastName',   label: 'Nom',       width: 120, fixed: true },
    { key: 'firstName',  label: 'Prénom',     width: 90,  fixed: true },
    { key: 'roleName',   label: 'Fonction',   width: 120, fixed: false },
    { key: 'matricule',  label: 'Matricule',  width: 80,  fixed: false },
    { key: 'phone',      label: 'Tél',        width: 100, fixed: false },
  ];

  const allCols = visibleCols === null ? fixedCols : fixedCols.filter(c => visibleCols.includes(c.key));
  const roles = [...new Set(rows.map(r => r.roleName).filter(Boolean))];

  const filteredRows = rows.filter(r => {
    if (!filter.search && !filter.role) return true;
    const name = `${r.lastName} ${r.firstName}`.toLowerCase();
    const matchName = !filter.search || name.includes(filter.search.toLowerCase());
    const matchRole = !filter.role || r.roleName === filter.role;
    return matchName && matchRole;
  });

  // Stats
  const stats = useMemo(() => {
    const counts = rows.map(r => Object.values(r.shifts).length);
    const total = counts.reduce((a, b) => a + b, 0);
    const avg = rows.length ? (total / rows.length).toFixed(1) : 0;
    return { total, avg, min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0 };
  }, [rows]);

  // Cell editing
  const startEdit = (rowId, colKey, currentVal) => {
    setEditingCell({ rowId, colKey });
    setEditValue(currentVal || '');
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    const { rowId, colKey } = editingCell;
    setRows(prev => prev.map(r => r.id === rowId ? { ...r, [colKey]: editValue } : r));
    setIsDirty(true);
    setEditingCell(null);
  };

  const setShiftCode = (rowId, dateStr, code) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const shifts = { ...r.shifts };
      if (!code || shifts[dateStr] === code) {
        delete shifts[dateStr];
      } else {
        shifts[dateStr] = code;
      }
      return { ...r, shifts };
    }));
    setIsDirty(true);
  };

  // Add / Remove rows
  const addEmptyRow = () => {
    const newId = `new-${Date.now()}`;
    setRows(prev => [...prev, { id: newId, userId: null, firstName: '', lastName: '', roleName: '', phone: '', matricule: '', shifts: {}, isNew: true }]);
    setIsDirty(true);
  };

  const removeRow = (rowId) => {
    setRows(prev => prev.filter(r => r.id !== rowId));
    setIsDirty(true);
  };

  // Drop staff into row
  const handleDropOnRow = (rowId) => {
    if (!draggedStaff) return;
    setRows(prev => prev.map(r => r.id === rowId ? {
      ...r,
      userId: draggedStaff.id,
      firstName: draggedStaff.first_name,
      lastName: draggedStaff.last_name,
      roleName: draggedStaff.role_name || r.roleName,
      phone: draggedStaff.phone || r.phone,
      matricule: draggedStaff.matricule || r.matricule,
      isNew: false,
    } : r));
    setDraggedStaff(null);
    setIsDirty(true);
  };

  // Save draft
  const saveDraft = async () => {
    setSaving(true);
    try {
      toast.success('Brouillon enregistré');
      setIsDirty(false);
    } catch { toast.error('Erreur de sauvegarde'); }
    finally { setSaving(false); }
  };

  // Confirm & submit
  const confirmSubmit = async () => {
    if (!window.confirm('Confirmer l\'envoi au surveillant du service ? Cette action est définitive.')) return;
    setSubmitting(true);
    try {
      await scheduleBuilderAPI.submit(scheduleId, { status: 'submitted' });
      toast.success('Planning envoyé au surveillant !');
      setIsDirty(false);
      qc.invalidateQueries(['schedule-detail', scheduleId]);
    } catch { toast.error('Erreur lors de la confirmation'); }
    finally { setSubmitting(false); }
  };

  // Keyboard nav
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setEditingCell(null); }
  };

  // Shift code quick-picker on day cell click
  const CODES = ['J', 'N', 'S', 'G', 'R', ''];
  const cycleCode = (rowId, dateStr) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const current = r.shifts[dateStr] || '';
      const idx = CODES.indexOf(current);
      const next = CODES[(idx + 1) % CODES.length];
      const shifts = { ...r.shifts };
      if (!next) delete shifts[dateStr]; else shifts[dateStr] = next;
      return { ...r, shifts };
    }));
    setIsDirty(true);
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 14px' }} />
        Chargement du planning...
      </div>
    );
  }

  if (!schedule) return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Planning introuvable</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ══ TOOLBAR ══════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        background: 'var(--bg-card)', borderRadius: '14px 14px 0 0',
        borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap',
        boxShadow: '0 2px 8px rgba(0,0,0,.04)',
      }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>
          <IcoBack /> Retour
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {schedule.name}
            {isDirty && <span style={{ fontSize: 10, color: '#F59E0B', marginLeft: 8, fontWeight: 600 }}>● Non sauvegardé</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {schedule.dept_name} · {schedule.start_date} — {schedule.end_date} · {rows.length} pers. · {stats.total} gardes
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}><IcoSearch /></span>
          <input value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
            placeholder="Chercher..." style={{ paddingLeft: 26, paddingRight: 10, height: 30, borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', fontSize: 12, color: 'var(--text-primary)', outline: 'none', width: 130 }} />
        </div>

        {/* Role filter */}
        {roles.length > 0 && (
          <select value={filter.role} onChange={e => setFilter(f => ({ ...f, role: e.target.value }))}
            style={{ height: 30, padding: '0 8px', borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', fontSize: 11, color: 'var(--text-primary)', cursor: 'pointer' }}>
            <option value="">Tous rôles</option>
            {roles.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        )}

        {/* Columns toggle */}
        <button onClick={() => setShowColPanel(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 8, border: `1px solid ${showColPanel ? 'var(--color-primary)' : 'var(--border-subtle)'}`, background: showColPanel ? 'rgba(27,79,202,.08)' : 'transparent', cursor: 'pointer', color: showColPanel ? 'var(--color-primary)' : 'var(--text-secondary)', fontSize: 11, fontWeight: 700 }}>
          <IcoCols /> Colonnes
        </button>

        {/* Validate */}
        <button onClick={async () => {
          try {
            const res = await scheduleBuilderAPI.validate(scheduleId);
            const ev = res.data.data;
            if (ev.isValid) toast.success('Aucun conflit détecté !');
            else toast(`${ev.errors?.length || 0} erreur(s) — ${ev.warnings?.length || 0} avertissement(s)`, { icon: '⚠️' });
          } catch { toast.error('Erreur de validation'); }
        }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 8, border: '1px solid #10B981', background: 'rgba(16,185,129,.06)', cursor: 'pointer', color: '#10B981', fontSize: 11, fontWeight: 700 }}>
          <IcoCheck /> Valider
        </button>

        {/* Export Excel */}
        <button onClick={() => { const token = localStorage.getItem('token'); window.open(`${scheduleBuilderAPI.exportExcelUrl(scheduleId)}?token=${token}`, '_blank'); }}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #059669', background: 'rgba(5,150,105,.06)', cursor: 'pointer', color: '#059669', fontSize: 11, fontWeight: 700 }}>
          📊 Excel
        </button>

        {/* Export PDF */}
        <button onClick={() => { const token = localStorage.getItem('token'); window.open(`${scheduleBuilderAPI.exportPdfUrl(scheduleId)}?token=${token}`, '_blank'); }}
          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #EF4444', background: 'rgba(239,68,68,.06)', cursor: 'pointer', color: '#EF4444', fontSize: 11, fontWeight: 700 }}>
          📄 PDF
        </button>
      </div>

      {/* ══ COLUMN PANEL ══════════════════════════════════════════════════ */}
      {showColPanel && (
        <div style={{ padding: '10px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Colonnes visibles :</span>
          {fixedCols.map(col => {
            const isVis = visibleCols === null || visibleCols.includes(col.key);
            return (
              <button key={col.key}
                onClick={() => {
                  setVisibleCols(prev => {
                    const current = prev === null ? fixedCols.map(c => c.key) : [...prev];
                    if (current.includes(col.key)) {
                      const next = current.filter(k => k !== col.key);
                      return next.length === 0 ? ['lastName'] : next;
                    }
                    return [...current, col.key];
                  });
                }}
                style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${isVis ? 'var(--color-primary)' : 'var(--border-subtle)'}`, background: isVis ? 'rgba(27,79,202,.08)' : 'transparent', color: isVis ? 'var(--color-primary)' : 'var(--text-muted)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>
                {isVis ? '✓ ' : ''}{col.label}
              </button>
            );
          })}
          <button onClick={() => setVisibleCols(null)} style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>
            Tout afficher
          </button>
        </div>
      )}

      {/* ══ STATS BAR ════════════════════════════════════════════════════ */}
      <div style={{ display: 'flex', gap: 20, padding: '6px 14px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', fontSize: 11 }}>
        {[
          { label: 'Gardes', value: stats.total, color: '#3B82F6' },
          { label: 'Moy/pers', value: stats.avg, color: '#8B5CF6' },
          { label: 'Min', value: stats.min, color: '#10B981' },
          { label: 'Max', value: stats.max, color: '#F59E0B' },
          { label: 'Personnel', value: rows.length, color: '#6B7280' },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{s.label} :</span>
            <span style={{ fontWeight: 800, color: s.color }}>{s.value}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Légende :</span>
          {Object.entries(SHIFT_COLORS).map(([code, col]) => (
            <span key={code} style={{ padding: '1px 6px', borderRadius: 4, background: col.bg, color: col.text, border: `1px solid ${col.border}`, fontWeight: 700, fontSize: 10 }}>{code}</span>
          ))}
        </div>
      </div>

      {/* ══ MAIN AREA (Sidebar + Table) ══════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', background: 'var(--bg-card)' }}>

        {/* Staff Sidebar */}
        {allStaff.length > 0 && (
          <StaffSidebar staff={allStaff} onDragStart={setDraggedStaff} />
        )}

        {/* Table area */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
            <colgroup>
              <col style={{ width: 32 }} />
              {allCols.map(c => <col key={c.key} style={{ width: c.width }} />)}
              {days.map(d => <col key={d.toISOString()} style={{ width: 38 }} />)}
              <col style={{ width: 36 }} />
            </colgroup>

            {/* Header */}
            <thead>
              <tr>
                <th style={thSt}>#</th>
                {allCols.map(c => <th key={c.key} style={thSt}>{c.label}</th>)}
                {days.map(d => (
                  <th key={d.toISOString()} style={{
                    ...thSt,
                    background: isWeekend(d) ? '#1E1B4B' : '#1E293B',
                    color: isWeekend(d) ? '#A5B4FC' : '#CBD5E1',
                    minWidth: 38,
                  }}>
                    <div style={{ fontSize: 9, fontWeight: 600, lineHeight: 1 }}>{DOW_FR[d.getDay()]}</div>
                    <div style={{ fontSize: 11, fontWeight: 800 }}>{d.getDate()}</div>
                  </th>
                ))}
                <th style={thSt}>⚙</th>
              </tr>
            </thead>

            {/* Body */}
            <tbody>
              {filteredRows.map((row, rowIdx) => (
                <tr
                  key={row.id}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => handleDropOnRow(row.id)}
                  style={{
                    background: row.isNew ? 'rgba(27,79,202,.04)' : rowIdx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(27,79,202,.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = row.isNew ? 'rgba(27,79,202,.04)' : rowIdx % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)'}
                >
                  <td style={tdSt}><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{rowIdx + 1}</span></td>

                  {/* Fixed + info columns */}
                  {allCols.map(col => {
                    const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === col.key;
                    const val = row[col.key] || '';
                    return (
                      <td key={col.key} style={{ ...tdSt, position: 'relative' }}
                        onClick={() => startEdit(row.id, col.key, val)}>
                        {isEditing ? (
                          <input ref={inputRef} value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onBlur={commitEdit} onKeyDown={handleKeyDown}
                            style={{ width: '100%', padding: '3px 5px', border: '2px solid var(--color-primary)', borderRadius: 5, fontSize: 11, background: 'var(--bg-card)', color: 'var(--text-primary)', outline: 'none' }} />
                        ) : (
                          <span style={{ fontSize: 11, color: val ? 'var(--text-primary)' : 'var(--text-muted)', cursor: 'text', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {val || (row.isNew && col.key === 'lastName' ? '⊕ Glisser nom ici...' : '—')}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  {/* Day cells */}
                  {days.map(d => {
                    const dateStr = d.toISOString().split('T')[0];
                    const code = row.shifts[dateStr];
                    const col = code ? getShiftColor(code) : null;
                    const wknd = isWeekend(d);
                    return (
                      <td key={dateStr}
                        onClick={() => cycleCode(row.id, dateStr)}
                        title={`Clic pour cycle: J→N→S→G→R→vide\nDate: ${dateStr}`}
                        style={{
                          ...tdSt, textAlign: 'center', cursor: 'pointer', padding: '3px 2px',
                          background: code ? col.bg : wknd ? 'rgba(99,102,241,.06)' : undefined,
                          borderLeft: wknd ? '1px solid rgba(99,102,241,.15)' : '1px solid var(--border-subtle)',
                          transition: 'background .1s',
                        }}>
                        {code ? (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 22, height: 20, borderRadius: 5, fontSize: 10, fontWeight: 800,
                            background: col.bg, color: col.text, border: `1px solid ${col.border}`,
                          }}>
                            {code}
                          </span>
                        ) : (
                          <span style={{ fontSize: 14, color: 'var(--border-subtle)' }}>·</span>
                        )}
                      </td>
                    );
                  })}

                  {/* Actions */}
                  <td style={{ ...tdSt, textAlign: 'center' }}>
                    <button onClick={() => removeRow(row.id)}
                      title="Supprimer cette ligne"
                      style={{ padding: '3px 5px', borderRadius: 5, border: 'none', background: 'rgba(239,68,68,.08)', color: '#EF4444', cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                      <IcoTrash />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Empty state */}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={2 + allCols.length + days.length} style={{ textAlign: 'center', padding: '32px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
                    {filter.search || filter.role ? 'Aucun résultat pour ce filtre' : 'Tableau vide — ajoutez des lignes ou glissez du personnel'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Add row button — fixed below table */}
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
            <button onClick={addEmptyRow}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px dashed var(--color-primary)', background: 'rgba(27,79,202,.04)', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 700, transition: 'all .15s' }}>
              <IcoPlus /> Ajouter une ligne
            </button>
          </div>
        </div>
      </div>

      {/* ══ FOOTER ACTIONS ═══════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
        background: 'var(--bg-card)', borderTop: '2px solid var(--border-subtle)',
        borderRadius: '0 0 14px 14px', flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
          {isDirty ? (
            <span style={{ color: '#F59E0B', fontWeight: 600 }}>● Modifications non sauvegardées</span>
          ) : (
            <span style={{ color: '#10B981', fontWeight: 600 }}>✓ À jour</span>
          )}
        </div>

        {/* Save draft */}
        <button onClick={saveDraft} disabled={saving || !isDirty}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 9,
            border: '1px solid var(--border-subtle)', background: isDirty ? 'var(--bg-elevated)' : 'transparent',
            color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12, cursor: isDirty ? 'pointer' : 'default', opacity: isDirty ? 1 : 0.5,
          }}>
          <IcoSave /> {saving ? 'Sauvegarde...' : 'Enregistrer brouillon'}
        </button>

        {/* Confirm & submit */}
        <button onClick={confirmSubmit} disabled={submitting}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', borderRadius: 9,
            border: 'none', background: 'linear-gradient(135deg, #059669, #047857)',
            color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(5,150,105,.3)',
            opacity: submitting ? 0.7 : 1,
          }}>
          <IcoSend /> {submitting ? 'Envoi...' : 'Confirmer et envoyer au surveillant'}
        </button>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

// Shared cell styles
const thSt = {
  padding: '8px 6px', fontSize: 10, fontWeight: 700, textAlign: 'center',
  background: '#1E293B', color: '#CBD5E1', position: 'sticky', top: 0, zIndex: 10,
  textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap',
  borderRight: '1px solid #334155',
};
const tdSt = {
  padding: '5px 6px', fontSize: 11,
  borderBottom: '1px solid var(--border-subtle)',
  borderRight: '1px solid var(--border-subtle)',
  verticalAlign: 'middle',
};
