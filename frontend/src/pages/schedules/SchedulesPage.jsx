import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  FileText,
  Filter,
  Plus,
  RotateCcw,
  Send,
  UserRound,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { departmentsAPI, schedulesAPI } from '../../api';
import { GsBadge, GsEmpty, GsPageHeader, GsPanel } from '../../components/gs';
import { useAuthStore } from '../../store';
import { exportToPDF, useTranslation } from '../../utils/helpers';
import { frenchRange, longFrenchDate } from '../../utils/frenchDates';
import './SchedulesPage.css';

const EMPTY_FILTERS = { status: '', departmentId: '', from: '', to: '' };

const dateKey = (value) => String(value || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';

const localDateKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const STATUS_OPTIONS = [
  { value: '', label: 'Tous les états' },
  { value: 'draft', label: 'Brouillon' },
  { value: 'submitted', label: 'En vigueur' },
  { value: 'under_review', label: 'En révision' },
  { value: 'approved', label: 'Approuvé' },
  { value: 'rejected', label: 'À corriger' },
  { value: 'active', label: 'En cours' },
  { value: 'archived', label: 'Archivé' },
];

const stateMeta = (schedule) => {
  if (schedule?.status === 'archived') return { label: 'Archivé', tone: 'quiet', rowTone: 'quiet' };
  if (schedule?.status === 'rejected') return { label: 'À corriger', tone: 'alert', rowTone: 'alert' };
  if (schedule?.status === 'under_review') return { label: 'En révision', tone: 'seal', rowTone: 'seal' };
  if (schedule?.status === 'approved') return { label: 'Approuvé', tone: 'seal', rowTone: 'seal' };

  const state = schedule?.state || (schedule?.status === 'draft' ? 'brouillon' : '');
  if (state === 'en_cours' || schedule?.status === 'active') {
    return { label: 'En cours', tone: 'duty', rowTone: 'duty' };
  }
  if (state === 'soumis' || schedule?.status === 'submitted') {
    return { label: 'En vigueur', tone: 'seal', rowTone: 'seal' };
  }
  if (state === 'termine') return { label: 'Terminé', tone: 'quiet', rowTone: 'quiet' };
  return { label: 'Brouillon', tone: 'quiet', rowTone: 'quiet' };
};

const scheduleKind = (schedule) => (
  schedule?.schedule_type === 'special_weekend_holiday'
    ? 'Week-ends et jours fériés'
    : 'Planning normal'
);

export default function SchedulesPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const isDirector = user?.roleCode === 'director';
  const canCreate = hasPermission('schedules.create') && !isDirector;

  const {
    data: schedulesData,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery({
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
  const totalPages = Math.max(
    1,
    Number(pagination.totalPages) || Math.ceil((pagination.total || 0) / (pagination.limit || 24)),
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const pageAssignments = schedules.reduce((total, schedule) => total + (Number(schedule.total_shifts) || 0), 0);

  const submitMutation = useMutation({
    mutationFn: (id) => schedulesAPI.submit(id, {}),
    onSuccess: (response) => {
      toast.success(response?.data?.message || 'Planning envoyé et mis en vigueur');
      qc.invalidateQueries({ queryKey: ['schedules'] });
    },
    onError: (error) => toast.error(error?.response?.data?.message || 'Envoi impossible'),
  });

  const statusOptions = isDirector
    ? STATUS_OPTIONS.filter((option) => option.value !== 'draft')
    : STATUS_OPTIONS;

  const setFilter = (key, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const setStartFilter = (value) => {
    setPage(1);
    setFilters((current) => ({
      ...current,
      from: value,
      to: current.to && value && current.to < value ? '' : current.to,
    }));
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const handleExportPDF = () => {
    exportToPDF(
      'Plannings de garde',
      ['Nom', 'Service', 'Période', 'État', 'Affectations'],
      schedules.map((schedule) => [
        schedule.name,
        schedule.department_name || 'Service non précisé',
        frenchRange(dateKey(schedule.start_date), dateKey(schedule.end_date)),
        stateMeta(schedule).label,
        Number(schedule.total_shifts) || 0,
      ]),
      'plannings',
    );
  };

  return (
    <div className="gsl-page gs-clamp">
      <GsPageHeader
        eyebrow={isDirector ? 'Direction · consultation' : 'Registre de garde'}
        title={t('schedules.title')}
        subtitle={isDirector
          ? 'Consultez les plannings de l’établissement par service, période et état.'
          : 'Retrouvez chaque planning, son état de mise en vigueur et ses affectations.'}
        meta={[
          { label: 'Plannings', value: Number(pagination.total) || 0, numeric: true },
          { label: 'Page', value: `${page} sur ${totalPages}` },
          { label: 'Affectations affichées', value: pageAssignments, numeric: true },
        ]}
        actions={(
          <div className="gsl-head-actions">
            <button type="button" className="gs-btn" onClick={handleExportPDF} disabled={schedules.length === 0}>
              <FileText size={14} /> Exporter en PDF
            </button>
            {canCreate ? (
              <button type="button" className="gs-btn is-primary" onClick={() => setShowCreate(true)}>
                <Plus size={15} /> {t('schedules.create')}
              </button>
            ) : null}
          </div>
        )}
      />

      <GsPanel
        title="Rechercher dans le registre"
        sub="Les périodes sont filtrées par chevauchement : un planning couvrant une partie de l’intervalle reste visible."
        icon={<Filter size={15} />}
        tools={activeFilterCount ? <GsBadge tone="seal">{activeFilterCount} filtre(s)</GsBadge> : null}
      >
        <div className="gsl-filter-grid">
          <label className="gsl-field">
            <span>État du planning</span>
            <select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="gsl-field">
            <span>Service</span>
            <select value={filters.departmentId} onChange={(event) => setFilter('departmentId', event.target.value)}>
              <option value="">Tous les services</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </label>

          <label className="gsl-field">
            <span>Période à partir du</span>
            <input type="date" value={filters.from} onChange={(event) => setStartFilter(event.target.value)} />
          </label>

          <label className="gsl-field">
            <span>Période jusqu’au</span>
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilter('to', event.target.value)}
            />
          </label>
        </div>

        <div className="gsl-filter-foot">
          <span aria-live="polite">
            {isFetching && !isLoading ? 'Actualisation du registre…' : `${pagination.total || 0} résultat(s)`}
          </span>
          {activeFilterCount ? (
            <button type="button" className="gs-btn is-quiet" onClick={resetFilters}>
              <RotateCcw size={13} /> Réinitialiser
            </button>
          ) : null}
        </div>
      </GsPanel>

      <GsPanel
        title="Plannings enregistrés"
        sub="Une ligne résume le document ; ouvrez-la pour consulter le registre quotidien."
        icon={<ClipboardList size={15} />}
        flush
      >
        {isLoading ? (
          <div className="gsl-loading" aria-label="Chargement des plannings" aria-busy="true">
            {Array.from({ length: 6 }, (_, index) => <span key={index} />)}
          </div>
        ) : isError ? (
          <div className="gsl-state-pad">
            <GsEmpty
              icon={<ClipboardList size={27} />}
              title="Le registre n’a pas pu être chargé"
              hint="La connexion au serveur a échoué. Vous pouvez relancer la lecture sans perdre vos filtres."
              actions={<button type="button" className="gs-btn" onClick={() => refetch()}>Réessayer</button>}
            />
          </div>
        ) : schedules.length === 0 ? (
          <div className="gsl-state-pad">
            <GsEmpty
              icon={<CalendarRange size={27} />}
              title={activeFilterCount ? 'Aucun planning dans ce périmètre' : 'Aucun planning enregistré'}
              hint={activeFilterCount
                ? 'Élargissez la période, changez de service ou réinitialisez les filtres.'
                : canCreate
                  ? 'Créez le premier planning, puis complétez ses affectations dans le Tableur.'
                  : 'Aucun planning visible n’a encore été mis en vigueur dans votre périmètre.'}
              actions={activeFilterCount
                ? <button type="button" className="gs-btn" onClick={resetFilters}>Afficher tout le registre</button>
                : canCreate
                  ? <button type="button" className="gs-btn is-primary" onClick={() => setShowCreate(true)}>Créer un planning</button>
                  : null}
            />
          </div>
        ) : (
          <div className="gsl-register">
            {schedules.map((schedule) => {
              const meta = stateMeta(schedule);
              const author = [schedule.created_by_first, schedule.created_by_last].filter(Boolean).join(' ');
              return (
                <article key={schedule.id} className="gsl-row" data-tone={meta.rowTone}>
                  <span className="gsl-state-rail" aria-hidden="true" />

                  <div className="gsl-identity">
                    <Link className="gsl-open" to={`/schedules/${schedule.id}`}>
                      {schedule.name}
                    </Link>
                    <span className="gsl-service">
                      <Building2 size={13} /> {schedule.department_name || 'Service non précisé'}
                    </span>
                    {author ? (
                      <span className="gsl-author"><UserRound size={12} /> Préparé par {author}</span>
                    ) : null}
                  </div>

                  <dl className="gsl-facts">
                    <div>
                      <dt>Période</dt>
                      <dd>{frenchRange(dateKey(schedule.start_date), dateKey(schedule.end_date))}</dd>
                    </div>
                    <div>
                      <dt>Affectations</dt>
                      <dd className="gs-num">{Number(schedule.total_shifts) || 0}</dd>
                    </div>
                    <div>
                      <dt>Type</dt>
                      <dd>{scheduleKind(schedule)}</dd>
                    </div>
                  </dl>

                  <div className="gsl-row-actions">
                    <GsBadge tone={meta.tone} dot>{meta.label}</GsBadge>
                    <Link className="gs-btn" to={`/schedules/${schedule.id}`}>
                      Consulter <ArrowRight size={13} />
                    </Link>
                    {!isDirector && schedule.status === 'draft' && hasPermission('schedules.submit') ? (
                      <button
                        type="button"
                        className="gs-btn"
                        onClick={() => submitMutation.mutate(schedule.id)}
                        disabled={submitMutation.isPending}
                      >
                        <Send size={13} /> Mettre en vigueur
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </GsPanel>

      {totalPages > 1 ? (
        <nav className="gsl-pagination" aria-label="Pagination des plannings">
          <button
            type="button"
            className="gs-btn"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ArrowLeft size={13} /> Précédente
          </button>
          <span>Page <b className="gs-num">{page}</b> sur <b className="gs-num">{totalPages}</b></span>
          <button
            type="button"
            className="gs-btn"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Suivante <ArrowRight size={13} />
          </button>
        </nav>
      ) : null}

      {showCreate && canCreate ? (
        <CreateScheduleModal
          departments={departments}
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['schedules'] });
          }}
        />
      ) : null}
    </div>
  );
}

function CreateScheduleModal({ departments, onClose, onSuccess }) {
  const { t } = useTranslation();
  const today = localDateKey();
  const [form, setForm] = useState({
    name: '',
    departmentId: departments[0]?.id || '',
    startDate: today,
    endDate: '',
    scheduleType: 'normal',
    notes: '',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!form.departmentId && departments[0]?.id) {
      setForm((current) => ({ ...current, departmentId: departments[0].id }));
    }
  }, [departments, form.departmentId]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [loading, onClose]);

  const endDateMin = form.startDate && form.startDate > today ? form.startDate : today;

  const setValue = (key, value) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'startDate' && current.endDate && current.endDate < (value > today ? value : today)
        ? { endDate: '' }
        : {}),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.departmentId) {
      toast.error('Aucun service disponible pour créer ce planning');
      return;
    }
    if (!form.endDate || form.endDate < endDateMin) {
      toast.error(`La date de fin doit être égale ou postérieure au ${longFrenchDate(endDateMin)}`);
      return;
    }

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
    <div
      className="gsl-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && !loading && onClose()}
    >
      <section className="gsl-modal" role="dialog" aria-modal="true" aria-labelledby="gsl-create-title">
        <header className="gsl-modal-head">
          <div>
            <span className="gs-eyebrow">Nouveau document</span>
            <h2 id="gsl-create-title">{t('schedules.create')}</h2>
            <p>Définissez son périmètre ; les affectations seront saisies ensuite dans le Tableur.</p>
          </div>
          <button type="button" className="gs-btn is-quiet gsl-modal-close" onClick={onClose} disabled={loading} aria-label="Fermer">
            <X size={17} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="gsl-modal-body">
            <label className="gsl-field gsl-field-wide">
              <span>{t('schedules.schedule_name')} *</span>
              <input
                value={form.name}
                onChange={(event) => setValue('name', event.target.value)}
                placeholder="Ex. Planning des urgences — septembre 2026"
                maxLength={200}
                autoFocus
                required
              />
            </label>

            <label className="gsl-field">
              <span>Type de planning *</span>
              <select value={form.scheduleType} onChange={(event) => setValue('scheduleType', event.target.value)} required>
                <option value="normal">Planning normal — tous les jours</option>
                <option value="special_weekend_holiday">Planning spécial — week-ends et jours fériés</option>
              </select>
            </label>

            <label className="gsl-field">
              <span>Service *</span>
              <select value={form.departmentId} onChange={(event) => setValue('departmentId', event.target.value)} required>
                {departments.length === 0 ? <option value="">Aucun service disponible</option> : null}
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </select>
            </label>

            <label className="gsl-field">
              <span>{t('schedules.start_date')} *</span>
              <input type="date" value={form.startDate} onChange={(event) => setValue('startDate', event.target.value)} required />
              <small>Une date passée est permise pour reprendre un planning déjà en cours.</small>
            </label>

            <label className="gsl-field">
              <span>{t('schedules.end_date')} *</span>
              <input
                type="date"
                value={form.endDate}
                min={endDateMin}
                onChange={(event) => setValue('endDate', event.target.value)}
                required
              />
              <small>La fin ne peut pas être antérieure à aujourd’hui.</small>
            </label>

            <label className="gsl-field gsl-field-wide">
              <span>Notes</span>
              <textarea
                value={form.notes}
                onChange={(event) => setValue('notes', event.target.value)}
                placeholder="Consignes ou contexte utiles au service…"
                rows={4}
              />
            </label>
          </div>

          <footer className="gsl-modal-foot">
            <button type="button" className="gs-btn" onClick={onClose} disabled={loading}>{t('common.cancel')}</button>
            <button type="submit" className="gs-btn is-primary" disabled={loading || departments.length === 0}>
              <CalendarDays size={14} /> {loading ? 'Création…' : t('common.create')}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
