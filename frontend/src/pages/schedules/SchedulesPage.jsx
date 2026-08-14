import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FileText, PenLine, Plus, Search, ShieldCheck, X } from 'lucide-react';
import { schedulesAPI, departmentsAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, exportToPDF } from '../../utils/helpers';
import PlanningStateBadge from '../../components/planning/PlanningStateBadge';
import toast from 'react-hot-toast';

const EMPTY_FILTERS = { status: '', departmentId: '', from: '', to: '' };
const localDateKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export default function SchedulesPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const isDirector = user?.roleCode === 'director';
  const canCreate = hasPermission('schedules.create') && !isDirector;

  const { data: schedulesData, isLoading } = useQuery({
    queryKey: ['schedules', filters, page],
    queryFn: () => schedulesAPI.getAll({
      ...filters,
      page,
      limit: 24,
    }).then((response) => response.data),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsAPI.getAll().then((response) => response.data.data),
  });

  const schedules = schedulesData?.data || [];
  const pagination = schedulesData?.pagination || {};
  const totalPages = Math.max(1, Math.ceil((pagination.total || 0) / (pagination.limit || 24)));

  const submitMutation = useMutation({
    mutationFn: (id) => schedulesAPI.submit(id, {}),
    onSuccess: (response) => {
      toast.success(response?.data?.message || 'Planning envoyé et mis en vigueur');
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (error) => toast.error(error?.response?.data?.message || 'Envoi impossible'),
  });

  const statusOptions = [
    { value: '', label: 'Tous les statuts' },
    ...(!isDirector ? [{ value: 'draft', label: t('status.draft') }] : []),
    { value: 'submitted', label: t('status.submitted') },
    { value: 'active', label: t('status.active') },
    { value: 'archived', label: 'Archivé' },
  ];

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleExportPDF = () => {
    exportToPDF(
      'Plannings de garde',
      ['Nom', 'Service', 'Période', 'Statut', 'Gardes'],
      schedules.map((schedule) => [
        schedule.name,
        schedule.department_name,
        `${formatDate(schedule.start_date)} → ${formatDate(schedule.end_date)}`,
        t(`status.${schedule.status}`),
        schedule.total_shifts,
      ]),
      'plannings'
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('schedules.title')}</h1>
          <p className="page-subtitle">{pagination.total || 0} planning(s)</p>
        </div>
        <div className="quick-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>
            <FileText size={14} />
            {t('common.pdf')}
          </button>
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} />
              {t('schedules.create')}
            </button>
          )}
        </div>
      </div>

      <div className="card mb-6" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Search size={16} color="var(--text-muted)" />
          <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>Filtres</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>État</span>
            <select className="form-control" value={filters.status}
              onChange={(event) => setFilter('status', event.target.value)}>
              {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Service</span>
            <select className="form-control" value={filters.departmentId}
              onChange={(event) => setFilter('departmentId', event.target.value)}>
              <option value="">Tous les services</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Période à partir du</span>
            <input type="date" className="form-control" value={filters.from}
              onChange={(event) => setFilter('from', event.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Période jusqu’au</span>
            <input type="date" className="form-control" value={filters.to} min={filters.from || undefined}
              onChange={(event) => setFilter('to', event.target.value)} />
          </label>
        </div>
        {Object.values(filters).some(Boolean) && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}
            onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
            <X size={14} /> Réinitialiser les filtres
          </button>
        )}
      </div>

      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton" style={{ height: 190, borderRadius: 14 }} />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-md)' }}>
            Aucun planning ne correspond aux critères.
          </p>
          {canCreate && (
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowCreate(true)}>
              Créer le premier planning
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 14 }}>
            {schedules.map((schedule) => (
              <article key={schedule.id} className="card" style={{
                padding: 18, display: 'flex', flexDirection: 'column', gap: 13, minHeight: 190,
                borderTop: `4px solid ${
                  schedule.state === 'en_cours' ? '#10B981'
                    : schedule.state === 'soumis' ? '#3B82F6'
                    : schedule.state === 'termine' ? '#64748B'
                    : '#94A3B8'
                }`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--font-md)', color: 'var(--text-primary)', lineHeight: 1.35 }}>
                      {schedule.name}
                    </h3>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 11 }}>
                      {schedule.department_name || 'Service non précisé'}
                    </p>
                  </div>
                  <PlanningStateBadge
                    state={schedule.state}
                    status={schedule.status}
                    startDate={schedule.start_date}
                    endDate={schedule.end_date}
                    size="sm"
                  />
                </div>

                <div style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px',
                  color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600,
                }}>
                  <CalendarDays size={15} /> {formatDate(schedule.start_date)} → {formatDate(schedule.end_date)}
                </div>

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><ShieldCheck size={13} /> <strong style={{ color: 'var(--text-secondary)' }}>{schedule.total_shifts || 0}</strong> garde(s)</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><PenLine size={13} /> {schedule.created_by_first} {schedule.created_by_last}</span>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 'auto' }}>
                  <a href={`/schedules/${schedule.id}`} className="btn btn-ghost btn-sm">
                    Voir les gardes
                  </a>
                  {!isDirector && schedule.status === 'draft' && hasPermission('schedules.submit') && (
                    <button className="btn btn-warning btn-sm"
                      onClick={() => submitMutation.mutate(schedule.id)}
                      disabled={submitMutation.isPending}>
                      {t('schedules.submit_for_validation')}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination" style={{ marginTop: 18 }}>
              <button className="pagination-btn" disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}>←</button>
              <span style={{ padding: '0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
                Page {page} sur {totalPages}
              </span>
              <button className="pagination-btn" disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>→</button>
            </div>
          )}
        </>
      )}

      {showCreate && canCreate && (
        <CreateScheduleModal
          departments={departments}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['schedules'] });
          }}
        />
      )}
    </div>
  );
}

function CreateScheduleModal({ departments, onClose, onSuccess }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    departmentId: departments[0]?.id || '',
    startDate: localDateKey(),
    endDate: '',
    scheduleType: 'normal',
    notes: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      await schedulesAPI.create(form);
      toast.success('Planning créé avec succès');
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Erreur lors de la création');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{t('schedules.create')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Fermer"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">{t('schedules.schedule_name')} *</label>
              <input className="form-control" value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex: Planning Urgences Septembre 2026" required />
            </div>
            <div className="form-group">
              <label className="form-label">Type de planning *</label>
              <select className="form-control" value={form.scheduleType}
                onChange={(event) => setForm((current) => ({ ...current, scheduleType: event.target.value }))} required>
                <option value="normal">Planning normal (tous les jours)</option>
                <option value="special_weekend_holiday">Planning spécial (week-ends et jours fériés)</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">{t('common.department')} *</label>
              <select className="form-control" value={form.departmentId}
                onChange={(event) => setForm((current) => ({ ...current, departmentId: event.target.value }))} required>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">{t('schedules.start_date')} *</label>
                <input type="date" className="form-control" value={form.startDate}
                  onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">{t('schedules.end_date')} *</label>
                <input type="date" className="form-control" value={form.endDate} min={form.startDate}
                  onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-control form-control-textarea" value={form.notes}
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Instructions particulières…" />
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
