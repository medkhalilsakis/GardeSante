import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { schedulesAPI, shiftsAPI, departmentsAPI, usersAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, getStatusBadgeClass } from '../../utils/helpers';
import toast from 'react-hot-toast';

const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export default function ScheduleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [showAddShift, setShowAddShift] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);

  const canEdit = hasPermission('schedules.update');
  const canApprove = hasPermission('schedules.approve');
  const canGenerate = hasPermission('schedules.generate');

  const { data: schedule, isLoading: loadingSchedule } = useQuery({
    queryKey: ['schedule', id],
    queryFn: () => schedulesAPI.getOne(id).then(r => r.data.data),
  });

  const { data: shiftsData, isLoading: loadingShifts } = useQuery({
    queryKey: ['schedule-shifts', id],
    queryFn: () => shiftsAPI.getAll({ scheduleId: id, limit: 500 }).then(r => r.data.data),
    enabled: !!id,
  });

  const { data: conflicts = [] } = useQuery({
    queryKey: ['schedule-conflicts', id],
    queryFn: () => schedulesAPI.getConflicts(id).then(r => r.data.data),
    enabled: !!id,
  });

  const shifts = shiftsData || [];

  const submitMutation = useMutation({
    mutationFn: () => schedulesAPI.submit(id, {}),
    onSuccess: () => { toast.success('Planning soumis pour validation'); qc.invalidateQueries(['schedule', id]); },
  });

  const approveMutation = useMutation({
    mutationFn: () => schedulesAPI.approve(id, {}),
    onSuccess: () => { toast.success('Planning approuvé ✓'); qc.invalidateQueries(['schedule', id]); },
  });

  const rejectMutation = useMutation({
    mutationFn: (reason) => schedulesAPI.reject(id, { comment: reason }),
    onSuccess: () => { toast.success('Planning rejeté'); qc.invalidateQueries(['schedule', id]); },
  });

  const generateMutation = useMutation({
    mutationFn: (config) => schedulesAPI.generate({ scheduleId: id, ...config }),
    onSuccess: (res) => {
      toast.success(`${res.data.data?.length || 0} gardes générées automatiquement`);
      qc.invalidateQueries(['schedule-shifts', id]);
      setShowGenerate(false);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erreur de génération'),
  });

  if (loadingSchedule) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" className="animate-spin">
          <path d="M21 12a9 9 0 11-6.219-8.56"/>
        </svg>
      </div>
    );
  }

  if (!schedule) return <div style={{ color: 'var(--text-muted)', padding: 40 }}>Planning introuvable</div>;

  // Construire le calendrier du planning
  const startDate = new Date(schedule.start_date);
  const endDate = new Date(schedule.end_date);
  const days = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }

  // Grouper les gardes par médecin et par date
  const doctors = [...new Map(shifts.map(s => [s.user_id, { id: s.user_id, firstName: s.first_name, lastName: s.last_name, grade: s.grade }])).values()];
  const shiftMap = shifts.reduce((acc, s) => {
    const key = `${s.user_id}|${s.shift_date?.split('T')[0] || s.shift_date}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/schedules')} style={{ marginBottom: 8 }}>
            ← Retour aux plannings
          </button>
          <h1 className="page-title">{schedule.name}</h1>
          <p className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <span>{schedule.department_name}</span>
            <span>·</span>
            <span>{formatDate(schedule.start_date)} → {formatDate(schedule.end_date)}</span>
            <span>·</span>
            <span className={`badge ${getStatusBadgeClass(schedule.status)}`}>{t(`status.${schedule.status}`)}</span>
          </p>
        </div>
        <div className="quick-actions">
          {conflicts.length > 0 && (
            <span className="badge badge-absent" style={{ padding: '6px 12px' }}>
              ⚠ {conflicts.length} conflit(s)
            </span>
          )}
          {canGenerate && schedule.status === 'draft' && (
            <button className="btn btn-secondary" onClick={() => setShowGenerate(true)}>
              ⚡ Génération auto
            </button>
          )}
          {canEdit && schedule.status === 'draft' && (
            <button className="btn btn-primary btn-sm" onClick={() => { setShowAddShift(true); }}>
              + Ajouter une garde
            </button>
          )}
          {schedule.status === 'draft' && hasPermission('schedules.submit') && (
            <button className="btn btn-warning" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
              Soumettre pour validation
            </button>
          )}
          {(schedule.status === 'submitted' || schedule.status === 'under_review') && canApprove && (
            <>
              <button className="btn btn-success" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                ✓ Approuver
              </button>
              <button className="btn btn-danger" onClick={() => {
                const r = prompt('Motif du rejet :');
                if (r) rejectMutation.mutate(r);
              }}>
                ✗ Rejeter
              </button>
            </>
          )}
        </div>
      </div>

      {/* Alertes conflits */}
      {conflicts.length > 0 && (
        <div className="alert alert-danger mb-6">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <div>
            <strong>{conflicts.length} conflit(s) détecté(s)</strong>
            <ul style={{ marginTop: 6, paddingLeft: 16 }}>
              {conflicts.slice(0, 5).map((c, i) => (
                <li key={i} style={{ fontSize: 'var(--font-xs)', marginBottom: 2 }}>
                  {c.message || JSON.stringify(c)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Résumé */}
      <div className="kpi-grid mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {[
          { label: 'Total gardes', value: shifts.length },
          { label: 'Médecins', value: doctors.length },
          { label: 'Jours couverts', value: days.length },
          { label: 'Conflits', value: conflicts.length, color: conflicts.length > 0 ? 'var(--color-danger)' : 'var(--color-success)' },
        ].map(s => (
          <div key={s.label} className="kpi-card" style={{ '--kpi-color': s.color || 'var(--color-primary)', '--kpi-color-10': `${s.color || 'var(--color-primary)'}18` }}>
            <div className="kpi-value" style={{ color: s.color }}>{s.value}</div>
            <div className="kpi-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tableau type Gantt / Calendrier médecin×date */}
      {loadingShifts ? (
        <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />
      ) : doctors.length === 0 ? (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-md)' }}>
            {schedule.status === 'draft' ? 'Aucune garde — utilisez la génération automatique ou ajoutez manuellement' : 'Aucune garde dans ce planning'}
          </p>
          {canGenerate && schedule.status === 'draft' && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowGenerate(true)}>
              ⚡ Générer les gardes automatiquement
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{
                    padding: '10px 16px', textAlign: 'left',
                    fontSize: 'var(--font-xs)', fontWeight: 700, color: 'var(--text-muted)',
                    background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)',
                    position: 'sticky', left: 0, zIndex: 2,
                    minWidth: 160,
                  }}>
                    Médecin
                  </th>
                  {days.map(d => {
                    const dateStr = d.toISOString().split('T')[0];
                    const isWeekend = [0, 6].includes(d.getDay());
                    const isToday = dateStr === new Date().toISOString().split('T')[0];
                    return (
                      <th key={dateStr} style={{
                        padding: '6px 4px', textAlign: 'center',
                        fontSize: 10, color: isToday ? 'var(--color-primary-light)' : isWeekend ? 'var(--color-warning)' : 'var(--text-muted)',
                        fontWeight: isToday ? 800 : 500,
                        background: isToday ? 'var(--color-primary-10)' : isWeekend ? 'rgba(245,158,11,0.05)' : 'var(--bg-elevated)',
                        borderBottom: '1px solid var(--border-subtle)',
                        minWidth: 42,
                      }}>
                        <div>{DAYS_FR[d.getDay()]}</div>
                        <div style={{ fontWeight: 800, fontSize: 11 }}>{d.getDate()}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {doctors.map((doctor, dIdx) => (
                  <tr key={doctor.id}>
                    <td style={{
                      padding: '8px 16px',
                      background: 'var(--bg-surface)',
                      borderBottom: '1px solid var(--border-subtle)',
                      position: 'sticky', left: 0, zIndex: 1,
                    }}>
                      <p style={{ fontWeight: 600, fontSize: 'var(--font-xs)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                        Dr. {doctor.firstName?.[0]}. {doctor.lastName}
                      </p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>{doctor.grade}</p>
                    </td>
                    {days.map(d => {
                      const dateStr = d.toISOString().split('T')[0];
                      const key = `${doctor.id}|${dateStr}`;
                      const cellShifts = shiftMap[key] || [];
                      const isWeekend = [0, 6].includes(d.getDay());

                      return (
                        <td key={dateStr} style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          borderRight: '1px solid var(--border-subtle)',
                          padding: 2, textAlign: 'center',
                          background: isWeekend ? 'rgba(245,158,11,0.03)' : 'transparent',
                          verticalAlign: 'middle',
                        }}>
                          {cellShifts.map(s => (
                            <div key={s.id} style={{
                              background: `${s.shift_color || '#1B4FCA'}30`,
                              borderRadius: 3, padding: '3px 4px',
                              fontSize: 9, fontWeight: 700,
                              color: s.shift_color || 'var(--color-primary-light)',
                              margin: 1,
                              title: s.shift_type_name,
                              opacity: s.status === 'cancelled' ? 0.3 : 1,
                              borderLeft: s.status === 'absent' ? '3px solid var(--color-danger)' : 'none',
                              cursor: 'pointer',
                            }}
                            title={`${s.shift_type_name} — ${t(`status.${s.status}`)}`}
                            >
                              {s.shift_type_name?.substring(0, 3).toUpperCase()}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Légende types de garde */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {[...new Map(shifts.map(s => [s.shift_type_name, s])).values()].map(s => (
              <div key={s.shift_type_id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: 2, background: `${s.shift_color || '#1B4FCA'}40`, border: `1px solid ${s.shift_color || '#1B4FCA'}` }} />
                <span style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>{s.shift_type_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal Génération Auto */}
      {showGenerate && (
        <GenerateModal
          schedule={schedule}
          onClose={() => setShowGenerate(false)}
          onGenerate={(config) => generateMutation.mutate(config)}
          isPending={generateMutation.isPending}
        />
      )}
    </div>
  );
}

function GenerateModal({ schedule, onClose, onGenerate, isPending }) {
  const [config, setConfig] = useState({
    algorithm: 'round_robin',
    minRestHours: 11,
    maxShiftsPerWeek: 3,
  });

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">⚡ Génération automatique</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="alert alert-warning">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Les gardes existantes seront conservées. Seules les dates non couvertes seront complétées.
          </div>
          <div className="form-group">
            <label className="form-label">Algorithme</label>
            <select className="form-control" value={config.algorithm} onChange={e => setConfig(c => ({ ...c, algorithm: e.target.value }))}>
              <option value="round_robin">Round-Robin équitable</option>
              <option value="fair">Basé sur la charge (équilibre)</option>
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Repos min. entre gardes (h)</label>
              <input type="number" className="form-control" value={config.minRestHours} onChange={e => setConfig(c => ({ ...c, minRestHours: parseInt(e.target.value) }))} min={8} max={24} />
            </div>
            <div className="form-group">
              <label className="form-label">Max gardes / semaine</label>
              <input type="number" className="form-control" value={config.maxShiftsPerWeek} onChange={e => setConfig(c => ({ ...c, maxShiftsPerWeek: parseInt(e.target.value) }))} min={1} max={7} />
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={() => onGenerate(config)} disabled={isPending}>
            {isPending ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                Génération en cours...
              </span>
            ) : '⚡ Générer maintenant'}
          </button>
        </div>
      </div>
    </div>
  );
}
