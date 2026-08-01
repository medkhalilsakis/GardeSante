import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scheduleBuilderAPI } from '../../../api';
import toast from 'react-hot-toast';

// ── Icons ─────────────────────────────────────────────────────
const Ico = ({ d, s = 16, c = 'currentColor' }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

// ── Helpers ───────────────────────────────────────────────────
const getWeekDays = (startDate, viewMode) => {
  const days = [];
  const start = new Date(startDate);
  // Align to Monday
  const dayOfWeek = start.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  start.setDate(start.getDate() + diff);

  const count = viewMode === 'week' ? 7 : 28;
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    days.push({
      date: d.toISOString().split('T')[0],
      day: d.getDate(),
      dow: d.getDay(),
      label: d.toLocaleDateString('fr-FR', { weekday: 'short' }),
      fullLabel: d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }),
      isToday: d.toISOString().split('T')[0] === new Date().toISOString().split('T')[0],
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    });
  }
  return days;
};

const DOW_LABELS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

// ── Shift Block (Draggable) ───────────────────────────────────
const ShiftBlock = ({ shift, onRemove, warnings }) => {
  const hasWarning = warnings?.length > 0;
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: 'move-shift', shiftId: shift.id,
          userId: shift.user_id, fromDate: shift.shift_date,
          shiftTypeId: shift.shift_type_id,
        }));
        e.dataTransfer.effectAllowed = 'move';
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 8px', borderRadius: 8,
        background: shift.color || '#3B82F6',
        color: '#fff', fontSize: 11, fontWeight: 600,
        cursor: 'grab', userSelect: 'none',
        boxShadow: hasWarning ? '0 0 0 2px #EF4444, 0 2px 8px rgba(239,68,68,.3)' : '0 1px 3px rgba(0,0,0,.15)',
        transition: 'transform .15s, box-shadow .15s',
        position: 'relative',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
      title={`${shift.first_name} ${shift.last_name}\n${shift.shift_type_name}\n${shift.start_time?.slice(0,5)} - ${shift.end_time?.slice(0,5)}${hasWarning ? '\n⚠️ ' + warnings.map(w => w.message).join(', ') : ''}`}
    >
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        background: 'rgba(255,255,255,.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 900, flexShrink: 0,
      }}>
        {shift.first_name?.[0]}{shift.last_name?.[0]}
      </div>
      <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shift.first_name} {shift.last_name?.[0]}.
      </div>
      {hasWarning && (
        <span style={{ fontSize: 10, lineHeight: 1 }}>⚠️</span>
      )}
      <button onClick={(e) => { e.stopPropagation(); onRemove(shift.id); }}
        style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', borderRadius: 4, width: 16, height: 16, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
        ✕
      </button>
    </div>
  );
};

// ── Staff Sidebar ─────────────────────────────────────────────
const StaffSidebar = ({ staff, shiftCounts, collapsed, onToggle }) => {
  const [search, setSearch] = useState('');
  const filtered = staff.filter(s => !search || `${s.firstName} ${s.lastName}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{
      width: collapsed ? 48 : 220, flexShrink: 0, background: 'var(--bg-card)',
      borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column',
      transition: 'width .25s', overflow: 'hidden',
    }}>
      {/* Toggle */}
      <button onClick={onToggle}
        style={{ padding: '10px', border: 'none', background: 'var(--bg-elevated)', cursor: 'pointer', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ico d={collapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} s={14} />
      </button>

      {!collapsed && (
        <>
          {/* Title */}
          <div style={{ padding: '10px 12px 6px', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Personnel ({staff.length})
          </div>

          {/* Search */}
          <div style={{ padding: '0 10px 8px' }}>
            <input type="text" placeholder="Chercher..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '5px 8px', fontSize: 11, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
          </div>

          {/* Staff list */}
          <div style={{ flex: 1, overflow: 'auto', padding: '0 6px' }}>
            {filtered.map(s => (
              <div key={s.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'assign-staff', userId: s.id,
                    name: `${s.firstName} ${s.lastName}`,
                  }));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 8px', borderRadius: 8, marginBottom: 3,
                  cursor: 'grab', userSelect: 'none',
                  background: 'var(--bg-elevated)', border: '1px solid transparent',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'rgba(27,79,202,.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
              >
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--color-primary), #7C3AED)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 9, fontWeight: 900,
                }}>
                  {s.firstName[0]}{s.lastName[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.firstName} {s.lastName}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                    {s.roleName} · {shiftCounts[s.id] || 0} gardes
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════
// MAIN: VisualCalendar
// ═══════════════════════════════════════════════════════════════
export default function VisualCalendar({ scheduleId, departmentId, onBack }) {
  const qc = useQueryClient();
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'month'
  const [navDate, setNavDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dragOver, setDragOver] = useState(null); // date string
  const [cellWarnings, setCellWarnings] = useState({});

  // ── Data ─────────────────────────────────────────────────
  const { data: detailData, isLoading } = useQuery({
    queryKey: ['schedule-detail', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId).then(r => r.data.data),
    enabled: !!scheduleId,
  });

  const schedule = detailData?.schedule;
  const shifts   = detailData?.shifts || [];

  // Build staff list (unique)
  const staffList = useMemo(() => {
    const map = new Map();
    shifts.forEach(s => {
      if (!map.has(s.user_id)) {
        map.set(s.user_id, {
          id: s.user_id, firstName: s.first_name, lastName: s.last_name,
          roleName: s.role_name, roleCode: s.role_code,
        });
      }
    });
    return [...map.values()];
  }, [shifts]);

  // Shift counts per user
  const shiftCounts = useMemo(() => {
    const counts = {};
    shifts.forEach(s => { counts[s.user_id] = (counts[s.user_id] || 0) + 1; });
    return counts;
  }, [shifts]);

  // Calendar days
  const days = useMemo(() => getWeekDays(navDate, viewMode), [navDate, viewMode]);

  // Shifts grouped by date
  const shiftsByDate = useMemo(() => {
    const map = {};
    shifts.forEach(s => {
      const date = typeof s.shift_date === 'string' ? s.shift_date.split('T')[0] : s.shift_date;
      if (!map[date]) map[date] = [];
      map[date].push(s);
    });
    return map;
  }, [shifts]);

  // ── Navigation ────────────────────────────────────────────
  const navigate = (dir) => {
    const d = new Date(navDate);
    d.setDate(d.getDate() + dir * (viewMode === 'week' ? 7 : 28));
    setNavDate(d.toISOString().split('T')[0]);
  };

  // ── Drag & Drop Handlers ──────────────────────────────────
  const handleDragOver = useCallback((e, date) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(date);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(null), []);

  const handleDrop = useCallback(async (e, targetDate) => {
    e.preventDefault();
    setDragOver(null);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data.type === 'assign-staff') {
        // Get first available shift type
        const ctx = await scheduleBuilderAPI.getWizardContext({ departmentId }).then(r => r.data.data);
        const defaultShiftType = ctx.shiftTypes?.[0];
        if (!defaultShiftType) { toast.error('Aucun type de garde configure'); return; }

        // Validate first
        const validation = await scheduleBuilderAPI.validateShift(scheduleId, {
          userId: data.userId, shiftDate: targetDate, shiftTypeId: defaultShiftType.id,
        });
        if (validation.data.warnings?.some(w => w.severity === 'error')) {
          toast.error(validation.data.warnings.filter(w => w.severity === 'error').map(w => w.message).join(', '));
          return;
        }
        if (validation.data.warnings?.length > 0) {
          const warnKey = `${data.userId}_${targetDate}`;
          setCellWarnings(prev => ({ ...prev, [warnKey]: validation.data.warnings }));
        }

        toast.success(`${data.name} affecte au ${new Date(targetDate).toLocaleDateString('fr-FR')}`);
        qc.invalidateQueries(['schedule-detail', scheduleId]);
      }
    } catch (err) {
      toast.error('Erreur lors du depot');
    }
  }, [scheduleId, departmentId, qc]);

  // ── Duplicate Week ────────────────────────────────────────
  const duplicateWeek = async () => {
    const weekDays = days.slice(0, 7);
    const nextWeekStart = new Date(weekDays[6].date);
    nextWeekStart.setDate(nextWeekStart.getDate() + 1);
    let count = 0;
    for (const day of weekDays) {
      const dayShifts = shiftsByDate[day.date] || [];
      for (const s of dayShifts) {
        const targetDate = new Date(nextWeekStart);
        targetDate.setDate(targetDate.getDate() + weekDays.indexOf(day));
        count++;
      }
    }
    toast.success(`Duplication de ${count} gardes vers la semaine suivante (fonctionnalite en cours)`);
  };

  // ── Loading ───────────────────────────────────────────────
  if (isLoading || !schedule) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'var(--text-muted)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 32, height: 32, border: '3px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          Chargement...
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>

      {/* ── TOOLBAR ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap',
      }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 }}>
          <Ico d="M15 18l-6-6 6-6" s={14} /> Retour
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{schedule.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{schedule.dept_name}</div>
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => navigate(-1)} style={{ ...navBtn }}><Ico d="M15 18l-6-6 6-6" s={14} /></button>
          <button onClick={() => setNavDate(new Date().toISOString().split('T')[0])}
            style={{ ...navBtn, padding: '5px 14px', fontSize: 11, fontWeight: 700 }}>Aujourd'hui</button>
          <button onClick={() => navigate(1)} style={{ ...navBtn }}><Ico d="M9 18l6-6-6-6" s={14} /></button>
        </div>

        {/* View toggle */}
        <div style={{ display: 'flex', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {['week', 'month'].map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              style={{ padding: '5px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: viewMode === v ? 'var(--color-primary)' : 'transparent', color: viewMode === v ? '#fff' : 'var(--text-secondary)', transition: 'all .15s' }}>
              {v === 'week' ? 'Semaine' : 'Mois'}
            </button>
          ))}
        </div>

        {/* Actions */}
        <button onClick={duplicateWeek}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, border: '1px solid #8B5CF6', background: 'rgba(139,92,246,.06)', cursor: 'pointer', color: '#8B5CF6', fontSize: 11, fontWeight: 700 }}>
          <Ico d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2" s={13} c="#8B5CF6" />
          Dupliquer semaine
        </button>
      </div>

      {/* ── BODY: Sidebar + Calendar ────────────────────────── */}
      <div style={{ display: 'flex', minHeight: 500 }}>

        {/* Staff sidebar */}
        <StaffSidebar
          staff={staffList}
          shiftCounts={shiftCounts}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed(c => !c)}
        />

        {/* Calendar grid */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* Day headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: viewMode === 'week' ? 'repeat(7, 1fr)' : 'repeat(7, 1fr)',
            background: '#1E293B', position: 'sticky', top: 0, zIndex: 10,
          }}>
            {(viewMode === 'week' ? days : days.slice(0, 7)).map((day, i) => (
              <div key={i} style={{
                padding: '10px 8px', textAlign: 'center',
                borderRight: i < 6 ? '1px solid rgba(255,255,255,.08)' : 'none',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: day.isWeekend ? '#F59E0B' : '#94A3B8', textTransform: 'uppercase' }}>
                  {viewMode === 'week' ? day.fullLabel.split(' ')[0] : DOW_LABELS[i === 0 ? 1 : i]} {/* Monday-aligned */}
                </div>
                {viewMode === 'week' && (
                  <div style={{
                    fontSize: 18, fontWeight: 900, marginTop: 2,
                    color: day.isToday ? '#3B82F6' : '#E2E8F0',
                  }}>
                    {day.day}
                    {day.isToday && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3B82F6', margin: '2px auto 0' }} />}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridAutoRows: viewMode === 'week' ? '1fr' : 'minmax(100px, 1fr)',
          }}>
            {days.map((day, i) => {
              const dayShifts = shiftsByDate[day.date] || [];
              const isDragTarget = dragOver === day.date;
              return (
                <div key={day.date}
                  onDragOver={e => handleDragOver(e, day.date)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, day.date)}
                  style={{
                    minHeight: viewMode === 'week' ? 300 : 100,
                    padding: 6,
                    borderRight: (i + 1) % 7 !== 0 ? '1px solid var(--border-subtle)' : 'none',
                    borderBottom: '1px solid var(--border-subtle)',
                    background: isDragTarget
                      ? 'rgba(27,79,202,.08)'
                      : day.isToday
                        ? 'rgba(59,130,246,.04)'
                        : day.isWeekend
                          ? 'rgba(99,102,241,.03)'
                          : 'var(--bg-card)',
                    transition: 'background .15s',
                    display: 'flex', flexDirection: 'column', gap: 3,
                    position: 'relative',
                  }}
                >
                  {/* Day number (month view) */}
                  {viewMode === 'month' && (
                    <div style={{
                      fontSize: 12, fontWeight: day.isToday ? 900 : 600,
                      color: day.isToday ? '#3B82F6' : day.isWeekend ? '#F59E0B' : 'var(--text-muted)',
                      marginBottom: 2,
                    }}>
                      {day.day}
                    </div>
                  )}

                  {/* Shifts */}
                  {dayShifts.map(s => (
                    <ShiftBlock key={s.id} shift={s}
                      warnings={cellWarnings[`${s.user_id}_${day.date}`]}
                      onRemove={() => { toast('Suppression de garde (en cours de dev)'); }}
                    />
                  ))}

                  {/* Drop zone indicator */}
                  {isDragTarget && (
                    <div style={{
                      position: 'absolute', inset: 4, borderRadius: 8,
                      border: '2px dashed var(--color-primary)',
                      background: 'rgba(27,79,202,.06)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      pointerEvents: 'none', zIndex: 5,
                    }}>
                      <span style={{ fontSize: 20 }}>+</span>
                    </div>
                  )}

                  {/* Empty placeholder */}
                  {dayShifts.length === 0 && !isDragTarget && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.2, fontSize: 11, color: 'var(--text-muted)' }}>
                      Glisser ici
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Shared Styles ─────────────────────────────────────────────
const navBtn = {
  padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)',
  background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
