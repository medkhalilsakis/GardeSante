import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Plus, UserRoundX, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { absencesAPI, usersAPI, departmentsAPI } from '../../api';
import { GsBadge, GsEmpty, GsPageHeader, GsPanel, GsSkeleton, GsStat, GsStatRail, GsTable } from '../../components/gs';
import { useAuthStore } from '../../store';
import { useTranslation, formatDate, exportToPDF, exportToExcel } from '../../utils/helpers';
import './absences.css';

const EMPTY_FILTERS = { departmentId: '', userId: '', isJustified: '', from: '', to: '' };

const durationInDays = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;
  return Math.max(1, Math.ceil((end - start) / 86400000) + 1);
};

const personnelName = (person) => `${person.first_name || ''} ${person.last_name || ''}`.trim();

function JustificationState({ value }) {
  if (typeof value !== 'boolean') return <GsBadge tone="quiet">Non renseignée</GsBadge>;
  return value ? <GsBadge tone="seal" dot>Justifiée</GsBadge> : <GsBadge tone="alert" dot>Non justifiée</GsBadge>;
}

function JustificationField({ value, onChange, subject }) {
  const options = [
    { value: true, label: `${subject} justifié${subject === 'Retard' ? '' : 'e'}`, description: 'Un motif valable ou un justificatif existe.', tone: 'seal' },
    { value: false, label: `${subject} non justifié${subject === 'Retard' ? '' : 'e'}`, description: 'Aucun motif valable ou justificatif n’est retenu.', tone: 'alert' },
  ];
  return (
    <fieldset className="gsab-choice">
      <legend>Qualification du {subject.toLowerCase()} <span className="gsab-required">*</span></legend>
      <div className="gsab-choice-grid">
        {options.map((option) => (
          <label key={String(option.value)} className={`gsab-choice-option is-${option.tone}${value === option.value ? ' is-selected' : ''}`}>
            <input type="radio" name="absence-justification" checked={value === option.value} onChange={() => onChange(option.value)} required />
            <span><strong>{option.label}</strong><small>{option.description}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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
    queryFn: () => absencesAPI.getTypes().then((response) => (response.data.data || []).filter((type) => !type.is_leave)),
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

  const absences = useMemo(() => absData?.data || [], [absData]);
  const pagination = absData?.pagination || {};
  const totalPages = pagination.totalPages || 1;
  const hasFilters = Object.values(filters).some(Boolean);
  const visiblePersonnel = useMemo(() => {
    if (!filters.departmentId) return personnel;
    return personnel.filter((person) => (person.departments || []).some((department) => String(department.id) === String(filters.departmentId)));
  }, [personnel, filters.departmentId]);
  const pageStats = useMemo(() => ({
    justified: absences.filter((absence) => absence.is_justified === true).length,
    unjustified: absences.filter((absence) => absence.is_justified === false).length,
    days: absences.reduce((sum, absence) => sum + durationInDays(absence.start_date, absence.end_date), 0),
  }), [absences]);

  const setFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value, ...(key === 'departmentId' ? { userId: '' } : {}) }));
    setPage(1);
  };
  const resetFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); };

  const exportRows = absences.map((absence) => [
    `${absence.first_name} ${absence.last_name}`,
    absence.department_name,
    absence.absence_type_name,
    formatDate(absence.start_date),
    formatDate(absence.end_date),
    `${durationInDays(absence.start_date, absence.end_date)} j`,
    absence.is_justified ? 'Justifiée' : 'Non justifiée',
    absence.reason || '—',
  ]);
  const handleExportPDF = () => exportToPDF('Rapport des absences', ['Personnel', 'Service', 'Type', 'Début', 'Fin', 'Durée', 'Justification', 'Motif'], exportRows, 'absences');
  const handleExportExcel = () => exportToExcel('Absences', ['Personnel', 'Service', 'Type', 'Début', 'Fin', 'Durée', 'Justification', 'Motif'], exportRows, 'absences');

  const columns = useMemo(() => [
    { key: 'personnel', label: 'Personnel', strong: true, render: (a) => <span className="gsab-person"><b>{a.first_name} {a.last_name}</b>{a.speciality ? <small>{a.speciality}</small> : null}</span> },
    { key: 'department_name', label: 'Service', render: (a) => <span className="gsab-taxonomy">{a.department_name || 'Non rattaché'}</span> },
    { key: 'absence_type_name', label: 'Type', render: (a) => <span className="gsab-taxonomy is-strong">{a.absence_type_name || 'Absence'}</span> },
    { key: 'period', label: 'Période', render: (a) => <span className="gsab-period"><b>{formatDate(a.start_date)} — {formatDate(a.end_date)}</b><small>{durationInDays(a.start_date, a.end_date)} jour(s)</small></span> },
    { key: 'late_minutes', label: 'Retard', num: true, render: (a) => a.late_minutes !== null && a.late_minutes !== undefined ? <GsBadge tone="alert">{a.late_minutes} min</GsBadge> : <span className="gsab-muted">—</span> },
    { key: 'is_justified', label: 'Justification', render: (a) => <JustificationState value={a.is_justified} /> },
    { key: 'reason', label: 'Motif', render: (a) => <span className={`gsab-reason${a.reason ? '' : ' is-empty'}`}>{a.reason || 'Non renseigné'}</span> },
    { key: 'created_at', label: 'Déclaré le', num: true, render: (a) => <span className="gsab-date">{formatDate(a.created_at)}</span> },
  ], []);

  return (
    <div className="gsab-wrap">
      <GsPageHeader
        eyebrow="Suivi du terrain"
        title={t('absences.title')}
        subtitle="Consultez les absences et retards déclarés, puis qualifiez chaque situation sans modifier l’historique enregistré."
        meta={[{ label: 'Résultats', value: Number(pagination.total || 0) }, { label: 'Page', value: `${page} / ${totalPages}` }]}
        actions={<><button className="gs-btn" type="button" onClick={handleExportPDF} disabled={!absences.length}><FileText size={15} /> Exporter en PDF</button><button className="gs-btn" type="button" onClick={handleExportExcel} disabled={!absences.length}><FileSpreadsheet size={15} /> Exporter en Excel</button>{canDeclare ? <button className="gs-btn is-primary" type="button" onClick={() => setShowDeclare(true)}><Plus size={15} /> {t('absences.declare')}</button> : null}</>}
        rail={<GsStatRail><GsStat label="Absences affichées" value={absences.length} hint="Sur la page courante" /><GsStat label="Justifiées" value={pageStats.justified} tone="seal" hint="Sur la page courante" /><GsStat label="Non justifiées" value={pageStats.unjustified} tone="alert" hint="À examiner" /><GsStat label="Jours cumulés" value={pageStats.days} unit="j" hint="Sur la page courante" /></GsStatRail>}
      />

      <GsPanel title="Critères du registre" sub="Les dates bornent les périodes qui se chevauchent avec l’intervalle demandé." icon={<CalendarDays size={16} />} tools={hasFilters ? <button className="gs-btn is-quiet" type="button" onClick={resetFilters}><X size={14} /> Réinitialiser</button> : null}>
        <div className="gsab-filters">
          {!isDoctor ? <label className="gsab-field"><span>Service</span><select className="form-control" value={filters.departmentId} onChange={(event) => setFilter('departmentId', event.target.value)}><option value="">Tous les services</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label> : null}
          {!isDoctor && personnel.length > 0 ? <label className="gsab-field"><span>Personnel</span><select className="form-control" value={filters.userId} onChange={(event) => setFilter('userId', event.target.value)}><option value="">Tout le personnel</option>{visiblePersonnel.map((p) => <option key={p.id} value={p.id}>{personnelName(p)}</option>)}</select></label> : null}
          <label className="gsab-field"><span>Justification</span><select className="form-control" value={filters.isJustified} onChange={(event) => setFilter('isJustified', event.target.value)}><option value="">Toutes les qualifications</option><option value="true">Justifiées</option><option value="false">Non justifiées</option></select></label>
          <label className="gsab-field"><span>À partir du</span><input type="date" className="form-control" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} /></label>
          <label className="gsab-field"><span>Jusqu’au</span><input type="date" className="form-control" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} /></label>
        </div>
      </GsPanel>

      <GsPanel title="Registre des absences" sub={`${pagination.total || 0} déclaration(s) selon les critères actuels`} flush>
        {isLoading ? <div className="gsab-loading"><GsSkeleton variant="rows" count={7} /></div> : <GsTable columns={columns} rows={absences} rowKey="id" label="Registre des absences" empty={<GsEmpty icon={<UserRoundX size={28} />} title="Aucune absence pour ces critères" hint={hasFilters ? 'Modifiez ou réinitialisez les critères pour élargir le registre.' : 'Aucune absence n’a été déclarée dans le périmètre accessible.'} actions={hasFilters ? <button className="gs-btn" type="button" onClick={resetFilters}>Afficher tout</button> : null} />} />}
        {totalPages > 1 ? <nav className="gsab-pagination" aria-label="Pagination du registre"><button className="gsab-page-button" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Page précédente"><ChevronLeft size={15} /></button><span>Page <b className="gs-num">{page}</b> sur <b className="gs-num">{totalPages}</b></span><button className="gsab-page-button" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} aria-label="Page suivante"><ChevronRight size={15} /></button></nav> : null}
      </GsPanel>

      {showDeclare ? <DeclareAbsenceModal absenceTypes={absenceTypes} personnel={personnel} onClose={() => setShowDeclare(false)} onSuccess={() => { setShowDeclare(false); qc.invalidateQueries({ queryKey: ['absences'] }); }} /> : null}
    </div>
  );
}

function DeclareAbsenceModal({ absenceTypes, personnel, onClose, onSuccess }) {
  const { user } = useAuthStore();
  const { t } = useTranslation();
  const isDoctor = ['senior_doctor', 'resident'].includes(user?.roleCode);
  const today = new Date().toLocaleDateString('en-CA');
  const [form, setForm] = useState({ userId: '', absenceTypeId: '', startDate: today, endDate: today, reason: '', isJustified: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!form.absenceTypeId && absenceTypes.length) setForm((current) => ({ ...current, absenceTypeId: absenceTypes[0].id }));
  }, [absenceTypes, form.absenceTypeId]);
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape' && !loading) onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [loading, onClose]);

  const selectedType = absenceTypes.find((type) => String(type.id) === String(form.absenceTypeId));
  const isLate = selectedType?.code === 'retard' || /retard/i.test(selectedType?.name || '');
  const subject = isLate ? 'Retard' : 'Absence';
  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isDoctor && !form.userId) return toast.error('Choisissez le personnel concerné');
    if (!form.absenceTypeId) return toast.error('Choisissez un type d’absence');
    if (form.endDate < form.startDate) return toast.error('La date de fin doit être postérieure à la date de début');
    if (typeof form.isJustified !== 'boolean') return toast.error('Indiquez si la situation est justifiée ou non');
    setLoading(true);
    try {
      await absencesAPI.create({ ...form, userId: isDoctor ? user.id : form.userId });
      toast.success('Absence déclarée avec succès');
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Erreur lors de la déclaration');
    } finally { setLoading(false); }
    return undefined;
  };

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !loading && onClose()}>
      <div className="modal modal-lg gsab-modal" role="dialog" aria-modal="true" aria-labelledby="gsab-modal-title">
        <div className="modal-header"><div className="gsab-modal-heading"><span className="gs-eyebrow">Déclaration terrain</span><h2 className="modal-title" id="gsab-modal-title">{t('absences.declare')}</h2></div><button className="gs-btn is-quiet gsab-close" type="button" onClick={onClose} title="Fermer" disabled={loading}><X size={18} /></button></div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body gsab-modal-body">
            <div className="gsab-rule">La déclaration est ajoutée à l’historique. Les corrections ultérieures doivent rester traçables.</div>
            {!isDoctor ? <label className="gsab-field gsab-form-full"><span>Personnel concerné <i>*</i></span><select className="form-control" value={form.userId} onChange={(event) => setForm((current) => ({ ...current, userId: event.target.value }))} required><option value="">Choisir un membre du personnel</option>{personnel.map((person) => { const service = (person.departments || []).find((d) => d.isPrimary || d.is_primary) || (person.departments || [])[0]; return <option key={person.id} value={person.id}>{personnelName(person)}{service?.name ? ` — ${service.name}` : ''}</option>; })}</select>{!personnel.length ? <small className="gsab-field-error">Aucun personnel actif n’est disponible.</small> : null}</label> : null}
            <label className="gsab-field gsab-form-full"><span>{t('absences.absence_type')} <i>*</i></span><select className="form-control" value={form.absenceTypeId} onChange={(event) => setForm((current) => ({ ...current, absenceTypeId: event.target.value, isJustified: null }))} required disabled={!absenceTypes.length}>{!absenceTypes.length ? <option value="">Aucun type configuré</option> : null}{absenceTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
            <div className="gsab-date-grid gsab-form-full"><label className="gsab-field"><span>Du <i>*</i></span><input type="date" className="form-control" value={form.startDate} max={form.endDate || undefined} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} required /></label><label className="gsab-field"><span>Au <i>*</i></span><input type="date" className="form-control" value={form.endDate} min={form.startDate || undefined} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} required /></label></div>
            <div className="gsab-form-full"><JustificationField value={form.isJustified} onChange={(value) => setForm((current) => ({ ...current, isJustified: value }))} subject={subject} /></div>
            <label className="gsab-field gsab-form-full"><span>{t('absences.reason')}</span><textarea className="form-control form-control-textarea" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Décrivez le motif ou le contexte utile à la traçabilité." rows={4} /></label>
          </div>
          <div className="modal-footer"><button type="button" className="gs-btn" onClick={onClose} disabled={loading}>{t('common.cancel')}</button><button type="submit" className="gs-btn is-primary" disabled={loading || !absenceTypes.length || (!isDoctor && !personnel.length)}>{loading ? t('common.loading') : t('absences.declare')}</button></div>
        </form>
      </div>
    </div>
  );
}
