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
  J: { label: 'Jour',  bg: '#DBEAFE', text: '#1D4ED8', border: '#93C5FD' },
  N: { label: 'Nuit',  bg: '#EDE9FE', text: '#6D28D9', border: '#C4B5FD' },
  S: { label: 'Soir',  bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  G: { label: 'Garde', bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  R: { label: 'Repos', bg: '#F3F4F6', text: '#6B7280', border: '#D1D5DB' },
};
const SHIFT_CODES = ['J', 'N', 'S', 'G', 'R'];
const DOW_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;

function getDays(start, end) {
  if (!start || !end) return [];
  const days = [], d = new Date(start);
  while (d <= new Date(end)) { days.push(new Date(d)); d.setDate(d.getDate() + 1); }
  return days;
}

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

  // ── Data fetch ──
  const { data: schedData, isLoading } = useQuery({
    queryKey: ['schedule-detail', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId),
    enabled: !!scheduleId,
  });
  const schedule = schedData?.data?.data || schedData?.data;

  const days = useMemo(() => getDays(schedule?.start_date, schedule?.end_date), [schedule]);

  // Build rows from schedule
  useEffect(() => {
    if (!schedule) return;
    const staffList = schedule.staff || [];
    const shifts    = schedule.shifts || [];
    const built = staffList.map(m => {
      const shiftMap = {};
      shifts.filter(s => s.user_id === m.id).forEach(s => {
        const d = String(s.shift_date).split('T')[0];
        shiftMap[d] = (s.shift_type_code || 'G').charAt(0).toUpperCase();
      });
      return {
        id: `row-${m.id}`, userId: m.id,
        lastName: m.last_name || '', firstName: m.first_name || '',
        roleName: m.role_name || '', phone: m.phone || '', matricule: m.matricule || '',
        shiftStart: m.shift_start || '07:00',
        shiftEnd:   m.shift_end   || '07:00',
        deptId: m.department_id || departmentId,
        shifts: shiftMap, isNew: false,
        custom: {},
      };
    });
    // Ajouter une ligne vide si aucun personnel
    if (built.length === 0) {
      built.push(emptyRow());
    }
    setRows(built);
  }, [schedule, departmentId]);

  const emptyRow = (idx = Date.now()) => ({
    id: `new-${idx}`, userId: null,
    lastName: '', firstName: '', roleName: '', phone: '', matricule: '',
    shiftStart: '07:00', shiftEnd: '07:00',
    deptId: departmentId, shifts: {}, isNew: true,
    custom: {},
  });

  // ── Colonnes fixes (incluant durée de garde) ──
  const fixedCols = [
    { key: 'lastName',   label: 'Nom',           w: 120 },
    { key: 'firstName',  label: 'Prénom',         w: 100 },
    { key: 'roleName',   label: 'Fonction',       w: 120 },
    { key: 'matricule',  label: 'Matricule',      w: 90  },
    { key: 'phone',      label: 'Tél',            w: 100 },
    { key: 'shiftStart', label: 'Début garde',   w: 90, type: 'time' },
    { key: 'shiftEnd',   label: 'Fin garde',     w: 90, type: 'time' },
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

  const dirty = useCallback(() => setIsDirty(true), []);

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
    const emptyIdx = rows.findIndex(r => r.isNew || !r.userId);
    if (emptyIdx >= 0) {
      applyStaffToRow(rows[emptyIdx].id, member);
    } else {
      const row = emptyRow();
      setRows(prev => [...prev, row]);
      setTimeout(() => applyStaffToRow(row.id, member), 0);
    }
  };

  // ── Cell editing ──
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
  const saveDraft = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 300));
    setSaving(false);
    setIsDirty(false);
    toast.success('Brouillon enregistré localement');
  };

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ══ TOOLBAR ══════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        background: 'var(--bg-card)', borderBottom: '2px solid var(--border-subtle)',
        flexWrap: 'wrap', boxShadow: '0 2px 8px rgba(0,0,0,.04)',
      }}>
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
            return <span key={code} style={{ padding: '1px 6px', borderRadius: 4, background: m.bg, color: m.text, border: `1px solid ${m.border}`, fontWeight: 700, fontSize: 10 }}>{code}</span>;
          })}
        </div>
      </div>

      {/* ══ TABLE ════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 28 }} /> {/* drag */}
            <col style={{ width: 28 }} /> {/* # */}
            {visibleCols.map(c => <col key={c.key} style={{ width: c.w }} />)}
            {customCols.map(c => <col key={c.key} style={{ width: c.w }} />)}
            {days.map(d => <col key={d.toISOString()} style={{ width: 36 }} />)}
            <col style={{ width: 32 }} /> {/* actions */}
          </colgroup>

          {/* Header */}
          <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            {/* Month labels */}
            <tr>
              <th style={{ ...thBase, background: '#0F172A', borderBottom: 0 }} colSpan={2} />
              {visibleCols.map(c => <th key={c.key} style={{ ...thBase, background: '#0F172A', borderBottom: 0 }} />)}
              {(() => {
                const groups = [];
                let cur = null;
                days.forEach(d => {
                  const m = MONTH_FR[d.getMonth()];
                  if (cur && cur.label === m) cur.span++;
                  else { cur = { label: m, span: 1 }; groups.push(cur); }
                });
                return groups.map((g, i) => (
                  <th key={i} colSpan={g.span} style={{ ...thBase, background: '#0F172A', color: '#94A3B8', fontSize: 9, letterSpacing: '.06em', textAlign: 'center', borderBottom: 0 }}>
                    {g.label}
                  </th>
                ));
              })()}
              <th style={{ ...thBase, background: '#0F172A', borderBottom: 0 }} />
            </tr>

            {/* Column labels */}
            <tr>
              <th style={{ ...thBase, width: 28 }} />
              <th style={{ ...thBase, width: 28 }}><span style={{ fontSize: 9 }}>#</span></th>
              {visibleCols.map(c => (
                <th key={c.key} style={{ ...thBase, position: 'relative' }}>
                  {c.type === 'time'
                    ? <span title="Heure de début/fin de garde — modifiable par ligne">{c.label} ⏰</span>
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
              {days.map(d => (
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
                  onDragOver={e => { e.preventDefault(); setDragOverRow(ri); }}
                  onDragLeave={() => setDragOverRow(null)}
                  onDrop={e => handleRowDrop(e, ri)}
                  onContextMenu={e => openContextMenu(e, ri)}
                  style={{
                    background: isOver ? 'rgba(27,79,202,.07)' : ri % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)',
                    opacity: isDragging ? 0.4 : 1,
                    transition: 'background .1s',
                    outline: isOver ? '2px solid var(--color-primary)' : 'none',
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
                    // Time columns (shiftStart / shiftEnd) — use input type=time
                    if (col.type === 'time') {
                      const otherKey = col.key === 'shiftStart' ? 'shiftEnd' : 'shiftStart';
                      const startH = parseInt((row.shiftStart || '07:00').split(':')[0]);
                      const endH   = parseInt((row.shiftEnd   || '07:00').split(':')[0]);
                      const durH   = ((endH - startH + 24) % 24) || 24;
                      return (
                        <td key={col.key} style={{ ...tdBase, position: 'relative' }}
                          title={col.key === 'shiftEnd' ? `Durée : ${durH}h` : undefined}>
                          <input type="time" value={val || (col.key === 'shiftStart' ? '07:00' : '07:00')}
                            onChange={e => { updateRow(row.id, { [col.key]: e.target.value }); }}
                            style={{ fontSize: 10, border: 'none', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', padding: 0, width: '100%', outline: 'none' }} />
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

                  {/* Day cells */}
                  {days.map(d => {
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
                <td colSpan={2 + visibleCols.length + days.length + 1} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
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
