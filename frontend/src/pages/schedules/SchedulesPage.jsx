import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { schedulesAPI, departmentsAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, getStatusBadgeClass, exportToPDF } from '../../utils/helpers';
import toast from 'react-hot-toast';

export default function SchedulesPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [filters, setFilters] = useState({ status: '', departmentId: '' });

  const canCreate = hasPermission('schedules.create');
  const canApprove = hasPermission('schedules.approve');
  const canGenerate = hasPermission('schedules.generate');

  const { data: schedulesData, isLoading } = useQuery({
    queryKey: ['schedules', filters],
    queryFn: () => schedulesAPI.getAll({ ...filters, limit: 50 }).then(r => r.data),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsAPI.getAll().then(r => r.data.data),
  });

  const schedules = schedulesData?.data || [];

  const submitMutation = useMutation({
    mutationFn: (id) => schedulesAPI.submit(id, {}),
    onSuccess: () => { toast.success('Planning soumis pour validation'); qc.invalidateQueries(['schedules']); },
  });

  const approveMutation = useMutation({
    mutationFn: (id) => schedulesAPI.approve(id, {}),
    onSuccess: () => { toast.success('Planning approuvé'); qc.invalidateQueries(['schedules']); },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => schedulesAPI.reject(id, { comment: reason }),
    onSuccess: () => { toast.success('Planning rejeté'); qc.invalidateQueries(['schedules']); },
  });

  const statusOptions = [
    { value: '', label: 'Tous les statuts' },
    { value: 'draft', label: t('status.draft') },
    { value: 'submitted', label: t('status.submitted') },
    { value: 'under_review', label: t('status.under_review') },
    { value: 'approved', label: t('status.approved') },
    { value: 'active', label: t('status.active') },
    { value: 'rejected', label: t('status.rejected') },
  ];

  const handleExportPDF = () => {
    exportToPDF(
      'Plannings de garde',
      ['Nom', 'Service', 'Période', 'Statut', 'Gardes'],
      schedules.map(s => [s.name, s.department_name, `${formatDate(s.start_date)} → ${formatDate(s.end_date)}`, t(`status.${s.status}`), s.total_shifts]),
      'plannings'
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('schedules.title')}</h1>
          <p className="page-subtitle">{schedules.length} planning(s) trouvé(s)</p>
        </div>
        <div className="quick-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {t('common.pdf')}
          </button>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {t('schedules.create')}
            </button>
          )}
        </div>
      </div>

      {/* Filtres */}
      <div className="card mb-6" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 200 }}
            value={filters.status}
            onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
          >
            {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 200 }}
            value={filters.departmentId}
            onChange={(e) => setFilters(f => ({ ...f, departmentId: e.target.value }))}
          >
            <option value="">Tous les services</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {(filters.status || filters.departmentId) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilters({ status: '', departmentId: '' })}>
              ✕ Réinitialiser
            </button>
          )}
        </div>
      </div>

      {/* Liste des plannings */}
      {isLoading ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-md)' }}>Aucun planning trouvé</p>
          {canCreate && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowCreate(true)}>
              Créer le premier planning
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {schedules.map(schedule => (
            <div key={schedule.id} className="card" style={{ padding: '16px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                {/* Barre de statut colorée */}
                <div style={{
                  width: 4, height: 48, borderRadius: 2, flexShrink: 0,
                  background: schedule.status === 'approved' || schedule.status === 'active' ? 'var(--color-success)' :
                               schedule.status === 'rejected' ? 'var(--color-danger)' :
                               schedule.status === 'submitted' || schedule.status === 'under_review' ? 'var(--color-warning)' :
                               'var(--color-primary)',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <h3 style={{ fontSize: 'var(--font-md)', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {schedule.name}
                    </h3>
                    <span className={`badge ${getStatusBadgeClass(schedule.status)}`}>
                      {t(`status.${schedule.status}`)}
                    </span>
                  </div>
                  <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                    <strong>{schedule.department_name}</strong>
                    {' · '}{formatDate(schedule.start_date)} → {formatDate(schedule.end_date)}
                    {' · '}{schedule.total_shifts} garde(s)
                    {' · Par '}{schedule.created_by_first} {schedule.created_by_last}
                  </p>
                  {schedule.rejection_reason && (
                    <p style={{ fontSize: 'var(--font-xs)', color: 'var(--color-danger)', marginTop: 4 }}>
                      ↩ {schedule.rejection_reason}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <a href={`/schedules/${schedule.id}`} className="btn btn-ghost btn-sm">
                    Voir les gardes
                  </a>
                  {schedule.status === 'draft' && hasPermission('schedules.submit') && (
                    <button
                      className="btn btn-warning btn-sm"
                      onClick={() => submitMutation.mutate(schedule.id)}
                      disabled={submitMutation.isPending}
                    >
                      {t('schedules.submit_for_validation')}
                    </button>
                  )}
                  {(schedule.status === 'submitted' || schedule.status === 'under_review') && canApprove && (
                    <>
                      <button className="btn btn-success btn-sm" onClick={() => approveMutation.mutate(schedule.id)} disabled={approveMutation.isPending}>
                        ✓ {t('common.approve')}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => {
                        const reason = prompt('Motif du rejet :');
                        if (reason) rejectMutation.mutate({ id: schedule.id, reason });
                      }}>
                        ✗ {t('common.reject')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Créer Planning */}
      {showCreate && <CreateScheduleModal departments={departments} onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['schedules']); }} />}
    </div>
  );
}

// ============================================================
// MODAL CRÉER PLANNING
// ============================================================
function CreateScheduleModal({ departments, onClose, onSuccess }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    departmentId: departments[0]?.id || '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    scheduleType: 'normal',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await schedulesAPI.create({
        name: form.name,
        departmentId: form.departmentId,
        startDate: form.startDate,
        endDate: form.endDate,
        scheduleType: form.scheduleType,
        notes: form.notes,
      });
      toast.success('Planning créé avec succès');
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{t('schedules.create')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">{t('schedules.schedule_name')} *</label>
              <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ex: Planning Urgences Juillet 2025" required />
            </div>
            <div className="form-group">
              <label className="form-label">Type de planning *</label>
              <select className="form-control" value={form.scheduleType} onChange={e => setForm(f => ({ ...f, scheduleType: e.target.value }))} required>
                <option value="normal">📋 Planning Normal (Tous les jours)</option>
                <option value="special_weekend_holiday">⚡ Planning Spécial (Week-ends & Jours Fériés uniquement)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('common.department')} *</label>
              <select className="form-control" value={form.departmentId} onChange={e => setForm(f => ({ ...f, departmentId: e.target.value }))} required>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">{t('schedules.start_date')} *</label>
                <input type="date" className="form-control" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">{t('schedules.end_date')} *</label>
                <input type="date" className="form-control" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-control form-control-textarea" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Instructions particulières..." />
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
