import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shiftsAPI, schedulesAPI, departmentsAPI, usersAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, getStatusBadgeClass } from '../../utils/helpers';
import toast from 'react-hot-toast';

// ============================================================
// CALENDRIER INTERACTIF DE GARDES
// ============================================================

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export default function ShiftsPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const today = new Date();
  const [viewDate, setViewDate] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [viewMode, setViewMode] = useState('month'); // month | week | day | list
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedShift, setSelectedShift] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addDate, setAddDate] = useState(null);

  const canCreate = hasPermission('shifts.create');
  const canUpdate = hasPermission('shifts.update');
  const canConfirm = hasPermission('shifts.confirm');

  // Période du mois courant
  const startDate = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}-01`;
  const endDate = `${viewDate.year}-${String(viewDate.month + 1).padStart(2, '0')}-${getDaysInMonth(viewDate.year, viewDate.month)}`;

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ['shifts', viewDate, selectedDept],
    queryFn: () => shiftsAPI.getAll({
      from: startDate,
      to: endDate,
      departmentId: selectedDept || undefined,
      limit: 500,
    }).then(r => r.data.data),
    refetchInterval: 30000,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsAPI.getAll().then(r => r.data.data),
  });

  const { data: todayShifts = [] } = useQuery({
    queryKey: ['today-shifts'],
    queryFn: () => shiftsAPI.getToday().then(r => r.data.data),
    refetchInterval: 30000,
  });

  const confirmMutation = useMutation({
    mutationFn: (id) => shiftsAPI.confirm(id, { actualStart: new Date() }),
    onSuccess: () => { toast.success('Présence confirmée ✓'); qc.invalidateQueries(['shifts']); qc.invalidateQueries(['today-shifts']); setSelectedShift(null); },
    onError: (err) => toast.error(err.response?.data?.message || 'Erreur'),
  });

  const absentMutation = useMutation({
    mutationFn: (id) => shiftsAPI.markAbsent(id),
    onSuccess: () => { toast.success('Absence enregistrée'); qc.invalidateQueries(['shifts']); qc.invalidateQueries(['today-shifts']); setSelectedShift(null); },
    onError: (err) => toast.error(err.response?.data?.message || 'Erreur'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => shiftsAPI.delete(id),
    onSuccess: () => { toast.success('Garde annulée'); qc.invalidateQueries(['shifts']); setSelectedShift(null); },
  });

  // Grouper les gardes par date
  const shiftsByDate = shifts.reduce((acc, shift) => {
    const date = shift.shift_date?.split('T')[0] || shift.shift_date;
    if (!acc[date]) acc[date] = [];
    acc[date].push(shift);
    return acc;
  }, {});

  const navigate = (dir) => {
    setViewDate(prev => {
      let m = prev.month + dir;
      let y = prev.year;
      if (m > 11) { m = 0; y++; }
      if (m < 0)  { m = 11; y--; }
      return { year: y, month: m };
    });
  };

  const goToToday = () => setViewDate({ year: today.getFullYear(), month: today.getMonth() });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('shifts.title')}</h1>
          <p className="page-subtitle">
            {MONTHS_FR[viewDate.month]} {viewDate.year}
            {' · '}{shifts.length} garde(s)
          </p>
        </div>
        <div className="quick-actions">
          {/* Vue */}
          {['month','week','list'].map(v => (
            <button key={v} className={`btn btn-sm ${viewMode === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setViewMode(v)}>
              {v === 'month' ? 'Mois' : v === 'week' ? 'Semaine' : 'Liste'}
            </button>
          ))}
          <div className="divider" style={{ width: 1, height: 24, margin: '0 4px', background: 'var(--border-default)' }} />
          {canCreate && (
            <button className="btn btn-primary btn-sm" onClick={() => { setAddDate(new Date().toISOString().split('T')[0]); setShowAddModal(true); }}>
              + {t('shifts.add_shift')}
            </button>
          )}
        </div>
      </div>

      {/* Gardes du jour — Barre d'action rapide */}
      {todayShifts.length > 0 && (
        <div className="card mb-4" style={{ padding: '12px 20px', background: 'var(--color-primary-10)', borderColor: 'var(--border-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, color: 'var(--color-primary-light)', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
              ● AUJOURD'HUI
            </span>
            {todayShifts.slice(0, 6).map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg-card)', borderRadius: 8, padding: '6px 12px',
                border: `1px solid ${s.shift_color || 'var(--border-default)'}30`,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
              onClick={() => setSelectedShift(s)}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.shift_color || 'var(--color-primary)', flexShrink: 0 }} />
                <span style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Dr. {s.first_name?.[0]}. {s.last_name}
                </span>
                <span className={`badge ${getStatusBadgeClass(s.status)}`} style={{ fontSize: 9 }}>
                  {t(`status.${s.status}`)}
                </span>
              </div>
            ))}
            {todayShifts.length > 6 && (
              <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>+{todayShifts.length - 6} de plus</span>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 'var(--space-4)' }}>
        {/* Sidebar filtres */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Navigation mois */}
          <div className="card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => navigate(-1)}>←</button>
              <button className="btn btn-ghost btn-sm" onClick={goToToday} style={{ fontSize: 'var(--font-xs)' }}>Aujourd'hui</button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => navigate(1)}>→</button>
            </div>
            <p style={{ textAlign: 'center', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              {MONTHS_FR[viewDate.month]}
            </p>
            <p style={{ textAlign: 'center', fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>{viewDate.year}</p>
          </div>

          {/* Filtre service */}
          <div className="card" style={{ padding: '12px 16px' }}>
            <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Service</p>
            <select className="form-control" style={{ fontSize: 'var(--font-xs)' }} value={selectedDept} onChange={e => setSelectedDept(e.target.value)}>
              <option value="">Tous les services</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {/* Légende statuts */}
          <div className="card" style={{ padding: '12px 16px' }}>
            <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Légende</p>
            {[
              { status: 'planned', label: t('status.planned') },
              { status: 'confirmed', label: t('status.confirmed') },
              { status: 'absent', label: t('status.absent') },
              { status: 'replaced', label: t('status.replaced') },
              { status: 'completed', label: t('status.completed') },
            ].map(({ status, label }) => (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span className={`badge ${getStatusBadgeClass(status)}`} style={{ fontSize: 9 }}>●</span>
                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>{label}</span>
              </div>
            ))}
          </div>

          {/* Stats rapides */}
          <div className="card" style={{ padding: '12px 16px' }}>
            <p style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Ce mois</p>
            {[
              { label: 'Planifiées', value: shifts.filter(s => s.status === 'planned').length, color: 'var(--color-primary-light)' },
              { label: 'Confirmées', value: shifts.filter(s => s.status === 'confirmed').length, color: 'var(--color-success)' },
              { label: 'Absences', value: shifts.filter(s => s.status === 'absent').length, color: 'var(--color-danger)' },
              { label: 'Remplacées', value: shifts.filter(s => s.status === 'replaced').length, color: 'var(--color-warning)' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>{s.label}</span>
                <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Calendrier principal */}
        {viewMode === 'month' && (
          <MonthCalendar
            viewDate={viewDate}
            shiftsByDate={shiftsByDate}
            isLoading={isLoading}
            today={today}
            onDayClick={(date) => { if (canCreate) { setAddDate(date); setShowAddModal(true); } }}
            onShiftClick={setSelectedShift}
            t={t}
          />
        )}

        {viewMode === 'list' && (
          <ShiftsList
            shifts={shifts}
            isLoading={isLoading}
            onShiftClick={setSelectedShift}
            t={t}
          />
        )}
      </div>

      {/* Modal Détail Garde */}
      {selectedShift && (
        <ShiftDetailModal
          shift={selectedShift}
          onClose={() => setSelectedShift(null)}
          canConfirm={canConfirm}
          canUpdate={canUpdate}
          onConfirm={() => confirmMutation.mutate(selectedShift.id)}
          onAbsent={() => absentMutation.mutate(selectedShift.id)}
          onDelete={() => {
            if (window.confirm('Annuler cette garde ?')) deleteMutation.mutate(selectedShift.id);
          }}
          isPending={confirmMutation.isPending || absentMutation.isPending}
          t={t}
        />
      )}

      {/* Modal Ajouter Garde */}
      {showAddModal && (
        <AddShiftModal
          departments={departments}
          defaultDate={addDate}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => { setShowAddModal(false); qc.invalidateQueries(['shifts']); toast.success('Garde ajoutée !'); }}
        />
      )}
    </div>
  );
}

// ============================================================
// CALENDRIER MENSUEL
// ============================================================
function MonthCalendar({ viewDate, shiftsByDate, isLoading, today, onDayClick, onShiftClick, t }) {
  const { year, month } = viewDate;
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const todayStr = today.toISOString().split('T')[0];

  const cells = [];
  // Jours vides avant le 1er
  for (let i = 0; i < firstDay; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(d);
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {/* En-têtes jours */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        {DAYS_FR.map(d => (
          <div key={d} style={{
            padding: '10px 8px', textAlign: 'center',
            fontSize: 'var(--font-xs)', fontWeight: 600,
            color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Grille des jours */}
      {isLoading ? (
        <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" className="animate-spin">
            <path d="M21 12a9 9 0 11-6.219-8.56"/>
          </svg>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 'minmax(100px, auto)' }}>
          {cells.map((day, idx) => {
            if (!day) return <div key={`empty-${idx}`} style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }} />;

            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayShifts = shiftsByDate[dateStr] || [];
            const isToday = dateStr === todayStr;
            const isWeekend = [0, 6].includes(new Date(year, month, day).getDay());

            return (
              <div
                key={dateStr}
                onClick={() => onDayClick(dateStr)}
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderTop: 'none', borderLeft: 'none',
                  padding: '6px 8px',
                  minHeight: 100,
                  background: isToday ? 'var(--color-primary-10)' : isWeekend ? 'rgba(255,255,255,0.01)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background var(--transition-fast)',
                  position: 'relative',
                }}
                onMouseEnter={e => !isToday && (e.currentTarget.style.background = 'var(--bg-elevated)')}
                onMouseLeave={e => e.currentTarget.style.background = isToday ? 'var(--color-primary-10)' : isWeekend ? 'rgba(255,255,255,0.01)' : 'transparent'}
              >
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
                }}>
                  <span style={{
                    fontSize: 'var(--font-xs)', fontWeight: isToday ? 800 : 500,
                    color: isToday ? 'var(--color-primary-light)' : isWeekend ? 'var(--text-muted)' : 'var(--text-secondary)',
                    background: isToday ? 'var(--color-primary)' : 'transparent',
                    borderRadius: '50%',
                    width: isToday ? 22 : 'auto',
                    height: isToday ? 22 : 'auto',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isToday ? '#fff' : undefined,
                  }}>
                    {day}
                  </span>
                  {dayShifts.length > 0 && (
                    <span style={{ fontSize: 9, background: 'var(--bg-elevated)', color: 'var(--text-muted)', padding: '1px 5px', borderRadius: 4 }}>
                      {dayShifts.length}
                    </span>
                  )}
                </div>

                {/* Gardes du jour (max 3 visibles) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {dayShifts.slice(0, 3).map(shift => (
                    <div
                      key={shift.id}
                      onClick={e => { e.stopPropagation(); onShiftClick(shift); }}
                      style={{
                        background: `${shift.shift_color || '#1B4FCA'}20`,
                        borderLeft: `3px solid ${shift.shift_color || '#1B4FCA'}`,
                        padding: '2px 5px',
                        borderRadius: '0 3px 3px 0',
                        fontSize: 10, fontWeight: 600,
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        transition: 'all var(--transition-fast)',
                        opacity: shift.status === 'cancelled' ? 0.4 : 1,
                        textDecoration: shift.status === 'absent' ? 'line-through' : 'none',
                      }}
                    >
                      {shift.first_name?.[0]}. {shift.last_name} · {shift.shift_type_name}
                    </div>
                  ))}
                  {dayShifts.length > 3 && (
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', paddingLeft: 4 }}>
                      +{dayShifts.length - 3} de plus
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// VUE LISTE
// ============================================================
function ShiftsList({ shifts, isLoading, onShiftClick, t }) {
  if (isLoading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 64, borderRadius: 10 }} />)}
    </div>
  );

  if (!shifts.length) return (
    <div className="card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
      Aucune garde pour cette période
    </div>
  );

  // Grouper par date
  const grouped = shifts.reduce((acc, s) => {
    const d = s.shift_date?.split('T')[0] || s.shift_date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(s);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {Object.entries(grouped).sort().map(([date, dayShifts]) => (
        <div key={date}>
          <p style={{ fontSize: 'var(--font-xs)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, paddingLeft: 4 }}>
            {formatDate(date, 'fr', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <div className="card" style={{ overflow: 'hidden' }}>
            {dayShifts.map((shift, i) => (
              <div
                key={shift.id}
                onClick={() => onShiftClick(shift)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '12px 20px',
                  borderBottom: i < dayShifts.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  cursor: 'pointer', transition: 'background var(--transition-fast)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ width: 4, height: 40, borderRadius: 2, background: shift.shift_color || 'var(--color-primary)', flexShrink: 0 }} />
                <div className="avatar avatar-sm" style={{ background: `${shift.shift_color || '#1B4FCA'}20`, color: shift.shift_color || 'var(--color-primary-light)', flexShrink: 0 }}>
                  {shift.first_name?.[0]}{shift.last_name?.[0]}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>
                    Dr. {shift.first_name} {shift.last_name}
                    {shift.grade && <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>({shift.grade})</span>}
                  </p>
                  <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                    {shift.department_name} · {shift.shift_type_name}
                    {shift.start_time && ` · ${shift.start_time.substring(0,5)}–${shift.end_time.substring(0,5)}`}
                    {shift.duration_hours && ` · ${shift.duration_hours}h`}
                  </p>
                </div>
                <span className={`badge ${getStatusBadgeClass(shift.status)}`}>{t(`status.${shift.status}`)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// MODAL DÉTAIL GARDE
// ============================================================
function ShiftDetailModal({ shift, onClose, canConfirm, canUpdate, onConfirm, onAbsent, onDelete, isPending, t }) {
  const isToday = shift.shift_date?.split('T')[0] === new Date().toISOString().split('T')[0];

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: shift.shift_color || 'var(--color-primary)', flexShrink: 0 }} />
            Détail de la garde
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Infos médecin */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '16px', background: 'var(--bg-elevated)', borderRadius: 10 }}>
            <div className="avatar avatar-xl" style={{ background: `${shift.shift_color || '#1B4FCA'}20`, color: shift.shift_color || 'var(--color-primary-light)', fontWeight: 800 }}>
              {shift.first_name?.[0]}{shift.last_name?.[0]}
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--font-xl)', fontWeight: 800, color: 'var(--text-primary)' }}>
                Dr. {shift.first_name} {shift.last_name}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-sm)' }}>
                {shift.speciality || 'Médecin'}
                {shift.grade && ` · ${shift.grade}`}
              </p>
              <span className={`badge ${getStatusBadgeClass(shift.status)}`} style={{ marginTop: 6 }}>
                {t(`status.${shift.status}`)}
              </span>
            </div>
          </div>

          {/* Détails de la garde */}
          <div style={{ display: 'grid', gap: 12 }}>
            {[
              { label: 'Service', value: shift.department_name || shift.department_name_ar },
              { label: 'Type de garde', value: `${shift.shift_type_name} (${shift.duration_hours}h)` },
              { label: 'Date', value: formatDate(shift.shift_date, 'fr', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) },
              { label: 'Horaire', value: shift.start_time && shift.end_time ? `${shift.start_time.substring(0,5)} → ${shift.end_time.substring(0,5)}` : '—' },
              shift.actual_start ? { label: 'Entrée réelle', value: new Date(shift.actual_start).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) } : null,
              shift.notes ? { label: 'Notes', value: shift.notes } : null,
            ].filter(Boolean).map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', fontWeight: 600, minWidth: 100, textTransform: 'uppercase', letterSpacing: '0.04em', paddingTop: 2 }}>{label}</span>
                <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Alertes */}
          {isToday && shift.status === 'planned' && (
            <div className="alert alert-warning" style={{ marginTop: 16 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Garde en cours — Confirmez la présence ou déclarez une absence
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <div>
            {canUpdate && !['completed','cancelled'].includes(shift.status) && (
              <button className="btn btn-danger btn-sm" onClick={onDelete} disabled={isPending}>
                Annuler la garde
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
            {canConfirm && ['planned','confirmed'].includes(shift.status) && isToday && (
              <>
                <button className="btn btn-danger btn-sm" onClick={onAbsent} disabled={isPending}>
                  ✗ Absent
                </button>
                <button className="btn btn-success btn-sm" onClick={onConfirm} disabled={isPending}>
                  ✓ Présent
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MODAL AJOUTER GARDE
// ============================================================
function AddShiftModal({ departments, defaultDate, onClose, onSuccess }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ departmentId: departments[0]?.id || '', userId: '', shiftTypeId: '', shiftDate: defaultDate || '', notes: '' });
  const [users, setUsers] = useState([]);
  const [shiftTypes, setShiftTypes] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (form.departmentId) {
      usersAPI.getAll({ departmentId: form.departmentId, isActive: 'true', limit: 100 })
        .then(r => setUsers(r.data.data));
      import('../../api').then(({ schedulesAPI }) =>
        schedulesAPI.getAll({ departmentId: form.departmentId, status: 'active', limit: 10 })
          .then(r => setSchedules(r.data.data))
      );
      // On récupère les shift types via l'API establishments
      fetch(`/api/shifts?departmentId=${form.departmentId}&limit=1`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}` }
      }).catch(() => {});
    }
  }, [form.departmentId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.userId || !form.shiftDate) return toast.error('Remplissez tous les champs');
    setLoading(true);
    try {
      // Créer une garde hors planning (garde extra)
      await shiftsAPI.create({
        ...form,
        isExtra: !form.scheduleId,
        scheduleId: form.scheduleId || schedules[0]?.id,
      });
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{t('shifts.add_shift')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">Service *</label>
              <select className="form-control" value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value, userId: '' }))}>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Médecin *</label>
              <select className="form-control" value={form.userId} onChange={e => setForm(f => ({ ...f, userId: e.target.value }))} required>
                <option value="">Sélectionner un médecin</option>
                {users.map(u => <option key={u.id} value={u.id}>Dr. {u.first_name} {u.last_name} — {u.grade}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Date *</label>
                <input type="date" className="form-control" value={form.shiftDate} onChange={e => setForm(f => ({ ...f, shiftDate: e.target.value }))} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Remarques..." />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t('common.loading') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
