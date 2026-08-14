import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { absencesAPI, usersAPI, departmentsAPI } from '../../api';
import JustificationChoice, { JustificationBadge } from '../../components/common/JustificationChoice';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, exportToPDF, exportToExcel } from '../../utils/helpers';

const EMPTY_FILTERS = {
  departmentId: '',
  userId: '',
  isJustified: '',
  from: '',
  to: '',
};

const durationInDays = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.ceil((end - start) / 86400000) + 1);
};

const personnelName = (person) => `${person.first_name || ''} ${person.last_name || ''}`.trim();

export default function AbsencesPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showDeclare, setShowDeclare] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const canDeclare = hasPermission('absences.create');
  const isDoctor = ['senior_doctor', 'resident'].includes(user?.roleCode);

  const { data: absData, isLoading } = useQuery({
    queryKey: ['absences', filters, page],
    queryFn: () => absencesAPI.getAll({ ...filters, page, limit: 20 }).then((response) => response.data),
  });

  const { data: absenceTypes = [] } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => absencesAPI.getTypes().then((response) => (
      (response.data.data || []).filter((type) => !type.is_leave)
    )),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsAPI.getAll().then((response) => response.data.data || []),
  });

  const { data: personnel = [] } = useQuery({
    queryKey: ['absence-personnel-options'],
    queryFn: () => usersAPI.getAll({ limit: 500, isActive: true }).then((response) => response.data.data || []),
    enabled: !isDoctor && hasPermission('users.read'),
  });

  const absences = absData?.data || [];
  const pagination = absData?.pagination || {};
  const totalPages = pagination.totalPages || 1;

  const visiblePersonnel = useMemo(() => {
    if (!filters.departmentId) return personnel;
    return personnel.filter((person) => (
      (person.departments || []).some((department) => department.id === filters.departmentId)
    ));
  }, [personnel, filters.departmentId]);

  const setFilter = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'departmentId' ? { userId: '' } : {}),
    }));
    setPage(1);
  };

  const handleExportPDF = () => {
    exportToPDF(
      'Rapport des absences',
      ['Personnel', 'Service', 'Type', 'Début', 'Fin', 'Durée', 'Justification', 'Motif'],
      absences.map((absence) => [
        `${absence.first_name} ${absence.last_name}`,
        absence.department_name,
        absence.absence_type_name,
        formatDate(absence.start_date),
        formatDate(absence.end_date),
        `${durationInDays(absence.start_date, absence.end_date)} j`,
        absence.is_justified ? 'Justifiée' : 'Non justifiée',
        absence.reason || '—',
      ]),
      'absences'
    );
  };

  const handleExportExcel = () => {
    exportToExcel(
      'Absences',
      ['Personnel', 'Service', 'Type', 'Début', 'Fin', 'Durée', 'Justification', 'Motif'],
      absences.map((absence) => [
        `${absence.first_name} ${absence.last_name}`,
        absence.department_name,
        absence.absence_type_name,
        formatDate(absence.start_date),
        formatDate(absence.end_date),
        `${durationInDays(absence.start_date, absence.end_date)} j`,
        absence.is_justified ? 'Justifiée' : 'Non justifiée',
        absence.reason || '—',
      ]),
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
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF} disabled={!absences.length}><FileText size={14} /> PDF</button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportExcel} disabled={!absences.length}><FileSpreadsheet size={14} /> Excel</button>
          {canDeclare && (
            <button className="btn btn-primary" onClick={() => setShowDeclare(true)}>
              <Plus size={16} />
              {t('absences.declare')}
            </button>
          )}
        </div>
      </div>

      <div className="card mb-6" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          {!isDoctor && (
            <select className="form-control" value={filters.departmentId} onChange={(event) => setFilter('departmentId', event.target.value)}>
              <option value="">Tous les services</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          )}
          {!isDoctor && personnel.length > 0 && (
            <select className="form-control" value={filters.userId} onChange={(event) => setFilter('userId', event.target.value)}>
              <option value="">Tout le personnel</option>
              {visiblePersonnel.map((person) => (
                <option key={person.id} value={person.id}>{personnelName(person)}</option>
              ))}
            </select>
          )}
          <select className="form-control" value={filters.isJustified} onChange={(event) => setFilter('isJustified', event.target.value)}>
            <option value="">Toutes les qualifications</option>
            <option value="true">Justifiées</option>
            <option value="false">Non justifiées</option>
          </select>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>À partir du</span>
            <input type="date" className="form-control" value={filters.from} max={filters.to || undefined}
              onChange={(event) => setFilter('from', event.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Jusqu’au</span>
            <input type="date" className="form-control" value={filters.to} min={filters.from || undefined}
              onChange={(event) => setFilter('to', event.target.value)} />
          </label>
        </div>
        {Object.values(filters).some(Boolean) && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
            <X size={14} /> Réinitialiser les filtres
          </button>
        )}
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Personnel</th>
                <th>Service</th>
                <th>Type</th>
                <th>Période</th>
                <th>Durée</th>
                <th>Justification</th>
                <th>Motif</th>
                <th>Déclaré le</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <tr key={index}>
                    {Array.from({ length: 8 }).map((__, cellIndex) => (
                      <td key={cellIndex}><div className="skeleton" style={{ height: 14, borderRadius: 4 }} /></td>
                    ))}
                  </tr>
                ))
              ) : absences.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                    Aucune absence pour ces critères
                  </td>
                </tr>
              ) : (
                absences.map((absence) => {
                  const duration = durationInDays(absence.start_date, absence.end_date);
                  return (
                    <tr key={absence.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {absence.first_name} {absence.last_name}
                        </div>
                        {absence.speciality && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{absence.speciality}</div>}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-xs)' }}>{absence.department_name}</td>
                      <td>
                        <span style={{
                          background: `${absence.absence_type_color || '#EF4444'}20`,
                          color: absence.absence_type_color || '#EF4444',
                          padding: '3px 8px', borderRadius: 999,
                          fontSize: 'var(--font-xs)', fontWeight: 700, whiteSpace: 'nowrap',
                        }}>
                          {absence.absence_type_name}
                        </span>
                      </td>
                      <td style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatDate(absence.start_date)} → {formatDate(absence.end_date)}
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, color: duration > 7 ? 'var(--color-warning)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                          {duration} {t('absences.days')}
                        </span>
                        {absence.late_minutes !== null && absence.late_minutes !== undefined && (
                          <div style={{ fontSize: 10, color: '#B45309', marginTop: 2 }}>{absence.late_minutes} min de retard</div>
                        )}
                      </td>
                      <td><JustificationBadge value={absence.is_justified} /></td>
                      <td style={{ fontSize: 'var(--font-xs)', color: 'var(--text-secondary)', maxWidth: 240 }}>
                        {absence.reason || '—'}
                      </td>
                      <td style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(absence.created_at)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="pagination">
            <button className="pagination-btn" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>←</button>
            <span style={{ padding: '0 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
              Page {page} sur {totalPages}
            </span>
            <button className="pagination-btn" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>→</button>
          </div>
        )}
      </div>

      {showDeclare && (
        <DeclareAbsenceModal
          absenceTypes={absenceTypes}
          personnel={personnel}
          onClose={() => setShowDeclare(false)}
          onSuccess={() => {
            setShowDeclare(false);
            qc.invalidateQueries({ queryKey: ['absences'] });
          }}
        />
      )}
    </div>
  );
}

function DeclareAbsenceModal({ absenceTypes, personnel, onClose, onSuccess }) {
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const isDoctor = ['senior_doctor', 'resident'].includes(user?.roleCode);
  const today = new Date().toLocaleDateString('en-CA');
  const [form, setForm] = useState({
    userId: '',
    absenceTypeId: '',
    startDate: today,
    endDate: today,
    reason: '',
    isJustified: null,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!form.absenceTypeId && absenceTypes.length) {
      setForm((current) => ({ ...current, absenceTypeId: absenceTypes[0].id }));
    }
  }, [absenceTypes, form.absenceTypeId]);

  const selectedType = absenceTypes.find((type) => type.id === form.absenceTypeId);
  const isLate = selectedType?.code === 'retard' || /retard/i.test(selectedType?.name || '');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isDoctor && !form.userId) return toast.error('Choisissez le personnel concerné');
    if (!form.absenceTypeId) return toast.error('Choisissez un type d’absence');
    if (form.endDate < form.startDate) return toast.error('La date de fin doit être postérieure à la date de début');
    if (typeof form.isJustified !== 'boolean') return toast.error('Indiquez si la situation est justifiée ou non');

    setLoading(true);
    try {
      await absencesAPI.create({
        ...form,
        userId: isDoctor ? user.id : form.userId,
      });
      toast.success('Absence déclarée avec succès');
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Erreur lors de la déclaration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <h2 className="modal-title">{t('absences.declare')}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Fermer"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!isDoctor && (
              <div className="form-group">
                <label className="form-label">Personnel concerné *</label>
                <select className="form-control" value={form.userId}
                  onChange={(event) => setForm((current) => ({ ...current, userId: event.target.value }))} required>
                  <option value="">Choisir un membre du personnel</option>
                  {personnel.map((person) => {
                    const service = (person.departments || []).find((department) => department.isPrimary || department.is_primary)
                      || (person.departments || [])[0];
                    return (
                      <option key={person.id} value={person.id}>
                        {personnelName(person)}{service?.name ? ` — ${service.name}` : ''}
                      </option>
                    );
                  })}
                </select>
                {!personnel.length && (
                  <p style={{ marginTop: 4, fontSize: 11, color: 'var(--color-danger)' }}>
                    Aucun personnel actif n’est disponible.
                  </p>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">{t('absences.absence_type')} *</label>
              <select className="form-control" value={form.absenceTypeId}
                onChange={(event) => setForm((current) => ({ ...current, absenceTypeId: event.target.value, isJustified: null }))}
                required disabled={!absenceTypes.length}>
                {!absenceTypes.length && <option value="">Aucun type configuré</option>}
                {absenceTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Du *</label>
                <input type="date" className="form-control" value={form.startDate} max={form.endDate || undefined}
                  onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Au *</label>
                <input type="date" className="form-control" value={form.endDate} min={form.startDate || undefined}
                  onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} required />
              </div>
            </div>

            <JustificationChoice
              value={form.isJustified}
              onChange={(value) => setForm((current) => ({ ...current, isJustified: value }))}
              subject={isLate ? 'Retard' : 'Absence'}
              label={isLate ? 'Qualification du retard' : 'Qualification de l’absence'}
              required
            />

            <div className="form-group">
              <label className="form-label">{t('absences.reason')}</label>
              <textarea className="form-control form-control-textarea" value={form.reason}
                onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder="Motif de l'absence…" rows={3} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !absenceTypes.length || (!isDoctor && !personnel.length)}>
              {loading ? t('common.loading') : t('absences.declare')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
