import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { absencesAPI, usersAPI, departmentsAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, getStatusBadgeClass, exportToPDF, exportToExcel } from '../../utils/helpers';
import toast from 'react-hot-toast';

export default function AbsencesPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showDeclare, setShowDeclare] = useState(false);
  const [filters, setFilters] = useState({ status: '', departmentId: '' });
  const [page, setPage] = useState(1);

  const canDeclare = hasPermission('absences.create');
  const canApprove = hasPermission('absences.approve');
  const isDoctor = ['senior_doctor', 'resident'].includes(user?.roleCode);

  const { data: absData, isLoading } = useQuery({
    queryKey: ['absences', filters, page],
    queryFn: () => absencesAPI.getAll({ ...filters, page, limit: 20 }).then(r => r.data),
  });

  const { data: absenceTypes = [] } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => absencesAPI.getTypes().then(r => r.data.data),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsAPI.getAll().then(r => r.data.data),
  });

  const absences = absData?.data || [];
  const pagination = absData?.pagination || {};

  const approveMutation = useMutation({
    mutationFn: (id) => absencesAPI.approve(id, {}),
    onSuccess: () => { toast.success('Absence approuvée'); qc.invalidateQueries(['absences']); },
    onError: (err) => toast.error(err.response?.data?.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => absencesAPI.reject(id, { reason }),
    onSuccess: () => { toast.success('Absence rejetée'); qc.invalidateQueries(['absences']); },
  });

  const handleExportPDF = () => {
    exportToPDF(
      'Rapport des absences',
      ['Médecin', 'Service', 'Type', 'Début', 'Fin', 'Durée', 'Statut'],
      absences.map(a => [
        `${a.first_name} ${a.last_name}`,
        a.department_name,
        a.absence_type_name,
        formatDate(a.start_date),
        formatDate(a.end_date),
        `${Math.ceil((new Date(a.end_date) - new Date(a.start_date)) / 86400000) + 1} j`,
        t(`status.${a.status}`),
      ]),
      'absences'
    );
  };

  const handleExportExcel = () => {
    exportToExcel(
      'Absences',
      ['Médecin', 'Service', 'Type', 'Début', 'Fin', 'Statut'],
      absences.map(a => [`${a.first_name} ${a.last_name}`, a.department_name, a.absence_type_name, formatDate(a.start_date), formatDate(a.end_date), t(`status.${a.status}`)]),
      'absences'
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('absences.title')}</h1>
          <p className="page-subtitle">{pagination.total || 0} absence(s)</p>
        </div>
        <div className="quick-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>PDF</button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportExcel}>Excel</button>
          {canDeclare && (
            <button className="btn btn-primary" onClick={() => setShowDeclare(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              {t('absences.declare')}
            </button>
          )}
        </div>
      </div>

      {/* Filtres */}
      <div className="card mb-6" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select className="form-control" style={{ width: 'auto' }} value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">Tous les statuts</option>
            <option value="pending">{t('status.pending')}</option>
            <option value="approved">{t('status.approved')}</option>
            <option value="rejected">{t('status.rejected')}</option>
          </select>
          {!isDoctor && (
            <select className="form-control" style={{ width: 'auto' }} value={filters.departmentId} onChange={e => setFilters(f => ({ ...f, departmentId: e.target.value }))}>
              <option value="">Tous les services</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Tableau */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Médecin</th>
                <th>Service</th>
                <th>Type</th>
                <th>Période</th>
                <th>Durée</th>
                <th>Statut</th>
                <th>Déclaré le</th>
                {canApprove && <th>{t('common.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: canApprove ? 8 : 7 }).map((_, j) => (
                      <td key={j}><div className="skeleton" style={{ height: 14, borderRadius: 4 }} /></td>
                    ))}
                  </tr>
                ))
              ) : absences.length === 0 ? (
                <tr>
                  <td colSpan={canApprove ? 8 : 7} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                    Aucune absence
                  </td>
                </tr>
              ) : (
                absences.map(absence => {
                  const duration = Math.ceil((new Date(absence.end_date) - new Date(absence.start_date)) / 86400000) + 1;
                  return (
                    <tr key={absence.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          Dr. {absence.first_name} {absence.last_name}
                        </div>
                        {absence.speciality && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{absence.speciality}</div>}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-xs)' }}>{absence.department_name}</td>
                      <td>
                        <span style={{
                          background: `${absence.absence_type_color}20`,
                          color: absence.absence_type_color,
                          padding: '3px 8px', borderRadius: 4,
                          fontSize: 'var(--font-xs)', fontWeight: 600,
                        }}>
                          {absence.absence_type_name}
                        </span>
                      </td>
                      <td style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                        {formatDate(absence.start_date)} → {formatDate(absence.end_date)}
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: duration > 7 ? 'var(--color-warning)' : 'var(--text-primary)' }}>
                          {duration} {t('absences.days')}
                        </span>
                      </td>
                      <td><span className={`badge ${getStatusBadgeClass(absence.status)}`}>{t(`status.${absence.status}`)}</span></td>
                      <td style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{formatDate(absence.created_at)}</td>
                      {canApprove && (
                        <td>
                          {absence.status === 'pending' && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-success btn-sm" onClick={() => approveMutation.mutate(absence.id)} disabled={approveMutation.isPending}>✓</button>
                              <button className="btn btn-danger btn-sm" onClick={() => {
                                const reason = prompt('Motif du rejet :');
                                if (reason) rejectMutation.mutate({ id: absence.id, reason });
                              }}>✗</button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="pagination">
            <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>←</button>
            {Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} className={`pagination-btn ${p === page ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="pagination-btn" onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}>→</button>
          </div>
        )}
      </div>

      {showDeclare && (
        <DeclareAbsenceModal
          absenceTypes={absenceTypes}
          departments={departments}
          onClose={() => setShowDeclare(false)}
          onSuccess={() => { setShowDeclare(false); qc.invalidateQueries(['absences']); }}
        />
      )}
    </div>
  );
}

function DeclareAbsenceModal({ absenceTypes, departments, onClose, onSuccess }) {
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const isDoctor = ['senior_doctor', 'resident'].includes(user?.roleCode);
  const [form, setForm] = useState({
    absenceTypeId: absenceTypes[0]?.id || '',
    departmentId: departments[0]?.id || '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    reason: '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await absencesAPI.create({
        ...form,
        userId: isDoctor ? user.id : form.userId,
      });
      toast.success('Absence déclarée avec succès');
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">{t('absences.declare')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">{t('absences.absence_type')} *</label>
              <select className="form-control" value={form.absenceTypeId} onChange={e => setForm(f => ({ ...f, absenceTypeId: e.target.value }))} required>
                {absenceTypes.map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
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
                <label className="form-label">Du *</label>
                <input type="date" className="form-control" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Au *</label>
                <input type="date" className="form-control" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} required />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">{t('absences.reason')}</label>
              <textarea className="form-control form-control-textarea" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="Motif de l'absence..." rows={3} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t('common.loading') : t('absences.declare')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
