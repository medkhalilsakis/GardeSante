import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schedulesAPI } from '../../../api';

// ── Icons ─────────────────────────────────────────────────────────────
const Ico = ({ d, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IcoSearch = () => <Ico d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />;
const IcoClose  = () => <Ico d="M18 6L6 18M6 6l12 12" />;
const IcoFilter = () => <Ico d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />;
const IcoUser   = () => <Ico d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />;
const IcoAdd    = () => <Ico d="M12 5v14M5 12h14" />;

// ── Presence dot ───────────────────────────────────────────────────────
const presenceDot = (lastActivity) => {
  if (!lastActivity) return '#9CA3AF';
  const mins = (Date.now() - new Date(lastActivity)) / 60000;
  if (mins < 15) return '#10B981';
  if (mins < 60) return '#F59E0B';
  return '#9CA3AF';
};

// ── Staff card ─────────────────────────────────────────────────────────
function StaffCard({ member, ownDeptId, onSelect, onDragStart, compact }) {
  const isExternal = member.dept_id && ownDeptId && member.dept_id !== ownDeptId;
  const dot = presenceDot(member.last_activity_at);

  return (
    <div
      draggable
      onDragStart={() => onDragStart?.(member)}
      onClick={() => onSelect?.(member)}
      style={{
        display: 'flex', alignItems: 'center', gap: compact ? 8 : 10,
        padding: compact ? '7px 8px' : '10px 12px',
        borderRadius: 10, cursor: 'pointer', userSelect: 'none',
        border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
        transition: 'all .12s', position: 'relative',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(27,79,202,.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = ''; }}
      title={`Cliquer pour ajouter — Glisser pour déposer dans le tableau`}
    >
      {/* Avatar */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{
          width: compact ? 30 : 36, height: compact ? 30 : 36, borderRadius: '50%',
          background: isExternal
            ? 'linear-gradient(135deg, #F59E0B, #D97706)'
            : 'linear-gradient(135deg, var(--color-primary), #7C3AED)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: compact ? 10 : 12, flexShrink: 0,
        }}>
          {member.first_name?.[0]}{member.last_name?.[0]}
        </div>
        <span style={{
          position: 'absolute', bottom: 0, right: 0, width: 8, height: 8,
          borderRadius: '50%', background: dot, border: '2px solid var(--bg-card)',
        }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: compact ? 11 : 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {member.last_name} {member.first_name}
          </span>
          {isExternal && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4, background: '#FEF3C7', color: '#D97706', flexShrink: 0 }}>
              Externe
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {member.role_name} {member.dept_name ? `· ${member.dept_name}` : ''}
        </div>
        {member.phone && !compact && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{member.phone}</div>
        )}
      </div>

      {/* Drag handle */}
      <span style={{ fontSize: 16, color: 'var(--text-muted)', flexShrink: 0, cursor: 'grab' }}>⠿</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────
export default function HospitalStaffPicker({
  open,
  onClose,
  onSelect,     // (member) => void — quand on clique sur un membre
  onDragStart,  // (member) => void — pour drag-drop externe
  ownDeptId,    // id du service du chef (pour badge "Externe")
  title = 'Ajouter du personnel',
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const searchRef = useRef(null);
  const debounceTimer = useRef(null);

  // Debounce search
  useEffect(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceTimer.current);
  }, [search]);

  // Auto-focus
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 80);
  }, [open]);

  const { data, isLoading } = useQuery({
    queryKey: ['hospital-staff', debouncedSearch, roleFilter, deptFilter],
    queryFn: () => schedulesAPI.getHospitalStaff({
      search: debouncedSearch || undefined,
      role: roleFilter || undefined,
      deptId: deptFilter || undefined,
      limit: 60,
    }),
    enabled: open,
    staleTime: 30000,
  });

  const staff = data?.data?.data || data?.data || [];
  const total = data?.data?.total || staff.length;

  // Collect unique roles & departments for filters
  const roles = [...new Map(staff.map(m => [m.role_id, { id: m.role_id, name: m.role_name }])).values()].filter(r => r.id);
  const depts = [...new Map(staff.map(m => [m.dept_id, { id: m.dept_id, name: m.dept_name }])).values()].filter(d => d.id);

  // Group by department
  const grouped = staff.reduce((acc, m) => {
    const key = m.dept_name || 'Autre';
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(3px)',
      }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 401,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-card)',
        boxShadow: '-8px 0 40px rgba(0,0,0,.25)',
        animation: 'slideInRight .2s ease',
      }}>

        {/* Header */}
        <div style={{
          padding: '16px 18px', borderBottom: '1px solid var(--border-subtle)',
          background: 'linear-gradient(135deg, #1E293B, #0F172A)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{title}</div>
              <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>
                {total} membre{total !== 1 ? 's' : ''} · Tout l'hôpital
              </div>
            </div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 8,
              padding: '6px 8px', cursor: 'pointer', color: '#94A3B8', display: 'flex',
            }}><IcoClose /></button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#64748B' }}>
              <IcoSearch />
            </span>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Nom, prénom, matricule..."
              style={{
                width: '100%', padding: '9px 9px 9px 32px', borderRadius: 8,
                border: '1px solid #334155', background: '#1E293B',
                color: '#F1F5F9', fontSize: 12, outline: 'none', boxSizing: 'border-box',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', display: 'flex' }}>
                <IcoClose />
              </button>
            )}
          </div>

          {/* Filter toggle */}
          <button onClick={() => setShowFilters(v => !v)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
            borderRadius: 7, border: `1px solid ${showFilters ? '#7C3AED' : '#334155'}`,
            background: showFilters ? 'rgba(124,58,237,.15)' : 'transparent',
            color: showFilters ? '#A78BFA' : '#94A3B8', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>
            <IcoFilter /> Filtres
            {(roleFilter || deptFilter) && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#7C3AED' }} />}
          </button>

          {/* Filters panel */}
          {showFilters && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={selectSt}>
                <option value="">Tous les rôles</option>
                {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={selectSt}>
                <option value="">Tous les services</option>
                {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {(roleFilter || deptFilter) && (
                <button onClick={() => { setRoleFilter(''); setDeptFilter(''); }}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#94A3B8', fontSize: 10, cursor: 'pointer' }}>
                  Effacer filtres
                </button>
              )}
            </div>
          )}
        </div>

        {/* Help text */}
        <div style={{ padding: '8px 14px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE', fontSize: 11, color: '#3B82F6', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>💡</span>
          Cliquez pour ajouter · Glissez dans le tableau · <strong style={{ color: '#F59E0B' }}>Personnel externe</strong> = notification automatique
        </div>

        {/* Staff list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <div style={{ width: 28, height: 28, border: '3px solid var(--border-subtle)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 10px' }} />
              Chargement...
            </div>
          ) : staff.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
              Aucun résultat
            </div>
          ) : (
            Object.entries(grouped).map(([deptName, members]) => (
              <div key={deptName} style={{ marginBottom: 16 }}>
                {/* Dept header */}
                <div style={{
                  fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em',
                  color: 'var(--text-muted)', marginBottom: 6,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: deptName === (depts[0]?.name || deptName) ? 'var(--color-primary)' : '#F59E0B', display: 'inline-block' }} />
                  {deptName}
                  <span style={{ fontWeight: 500, color: 'var(--text-muted)', fontSize: 9 }}>({members.length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {members.map(m => (
                    <StaffCard
                      key={m.id}
                      member={m}
                      ownDeptId={ownDeptId}
                      onSelect={onSelect}
                      onDragStart={onDragStart}
                      compact
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
          Les membres externes génèrent une notification au chef de leur service
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

const selectSt = {
  width: '100%', padding: '6px 10px', borderRadius: 7, border: '1px solid #334155',
  background: '#1E293B', color: '#F1F5F9', fontSize: 11, cursor: 'pointer', outline: 'none',
};
