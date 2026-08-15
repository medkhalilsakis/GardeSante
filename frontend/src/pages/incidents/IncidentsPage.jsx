import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BellRing,
  Building2,
  CalendarDays,
  Info,
  Plus,
  RotateCcw,
  Search,
  SearchX,
  Send,
  ShieldAlert,
  Siren,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { departmentsAPI, journalAPI } from '../../api';
import { useAuthStore } from '../../store';
import ServiceAlertsPanel from '../surveillant/components/ServiceAlertsPanel';
import './IncidentsPage.css';

const ALLOWED_ROLES = ['department_head', 'service_supervisor', 'general_supervisor'];
const SEVERITIES = [
  { value: 'info', label: 'Information', icon: Info },
  { value: 'warning', label: 'Vigilance', icon: BellRing },
  { value: 'error', label: 'Grave', icon: AlertTriangle },
  { value: 'critical', label: 'Critique', icon: ShieldAlert },
];
const SEVERITY_META = {
  info: { label: 'Information', color: '#2563EB', bg: '#EFF6FF' },
  warning: { label: 'Vigilance', color: '#B45309', bg: '#FFFBEB' },
  error: { label: 'Grave', color: '#DC2626', bg: '#FEF2F2' },
  critical: { label: 'Critique', color: '#991B1B', bg: '#FEE2E2' },
};

const roleLabels = {
  department_head: 'Chef de service',
  service_supervisor: 'Surveillant de service',
  general_supervisor: 'Surveillant général',
};

const formatDate = (value, options = {}) => {
  if (!value) return 'Date inconnue';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', ...options });
};

const formatShortDate = (value) => {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

const getTunisDateKey = () => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function StatTile({ icon: Icon, label, value, tone = 'blue', detail }) {
  return (
    <div className={`incident-stat incident-stat-${tone}`}>
      <div className="incident-stat-icon"><Icon size={17} strokeWidth={2.2} /></div>
      <div className="incident-stat-content">
        <span className="incident-stat-label">{label}</span>
        <strong className="incident-stat-value">{value}</strong>
        {detail && <span className="incident-stat-detail">{detail}</span>}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.info;
  return <span className={`incident-severity incident-severity-${severity || 'info'}`}><span className="incident-severity-dot" />{meta.label}</span>;
}

function IncidentRow({ event }) {
  const meta = SEVERITY_META[event.severity] || SEVERITY_META.info;
  const reporter = event.reporterName || 'Déclarant non identifié';
  return (
    <article className={`incident-row incident-row-${event.severity || 'info'}`}>
      <div className="incident-row-rail" aria-hidden="true" />
      <div className="incident-row-icon" style={{ '--incident-tone': meta.color, '--incident-tone-bg': meta.bg }}>
        {event.severity === 'critical' ? <ShieldAlert size={17} /> : event.severity === 'error' ? <AlertTriangle size={17} /> : <Activity size={17} />}
      </div>
      <div className="incident-row-body">
        <div className="incident-row-topline">
          <div className="incident-row-title-wrap">
            <h3>{event.title}</h3>
            <SeverityBadge severity={event.severity} />
          </div>
          <span className="incident-row-date">{formatShortDate(event.date)}{event.hour ? ` · ${event.hour}` : ''}</span>
        </div>
        {event.description && <p className="incident-row-description">{event.description}</p>}
        <div className="incident-row-meta">
          <span><Building2 size={13} />{event.departmentName || 'Service non précisé'}</span>
          <span><UserRound size={13} />{reporter}</span>
        </div>
      </div>
    </article>
  );
}

function IncidentHistory({ events, isLoading, filtersActive }) {
  if (isLoading) {
    return <div className="incident-history-state"><div className="incident-spinner" /><span>Chargement du journal…</span></div>;
  }
  if (!events.length) {
    return (
      <div className="incident-history-state incident-history-empty">
        <div className="incident-empty-icon"><SearchX size={22} /></div>
        <strong>{filtersActive ? 'Aucun résultat pour ces filtres' : 'Aucun incident enregistré'}</strong>
        <span>{filtersActive ? 'Aucun incident ne correspond aux filtres actifs.' : 'Aucun incident dans ce périmètre.'}</span>
      </div>
    );
  }

  const groups = events.reduce((accumulator, event) => {
    const key = event.date || 'unknown';
    if (!accumulator[key]) accumulator[key] = [];
    accumulator[key].push(event);
    return accumulator;
  }, {});

  return (
    <div className="incident-history-list">
      {Object.entries(groups).map(([date, dayEvents]) => (
        <section className="incident-day-group" key={date}>
          <div className="incident-day-heading"><span>{formatDate(date)}</span><b>{dayEvents.length} signalement{dayEvents.length > 1 ? 's' : ''}</b></div>
          <div className="incident-day-items">{dayEvents.map((event) => <IncidentRow event={event} key={event.id} />)}</div>
        </section>
      ))}
    </div>
  );
}

export default function IncidentsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isGeneralSupervisor = user?.roleCode === 'general_supervisor';
  const [showForm, setShowForm] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ departmentId: '', severity: '', from: '', to: '', search: '' });
  const [form, setForm] = useState({ departmentId: '', severity: 'warning', title: '', description: '' });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'incidents'],
    queryFn: () => departmentsAPI.getAll().then((response) => response.data.data || []),
    enabled: ALLOWED_ROLES.includes(user?.roleCode),
  });

  const journalParams = useMemo(() => ({
    type: 'incident',
    departmentId: filters.departmentId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    limit: 300,
  }), [filters.departmentId, filters.from, filters.to]);

  const { data, isLoading } = useQuery({
    queryKey: ['journal', 'incidents', journalParams],
    queryFn: () => journalAPI.getEvents(journalParams),
    enabled: ALLOWED_ROLES.includes(user?.roleCode),
  });

  const createIncident = useMutation({
    mutationFn: (payload) => journalAPI.addEvent({ ...payload, eventType: 'incident' }),
    onSuccess: () => {
      toast.success('Incident déclaré');
      setForm((value) => ({ ...value, title: '', description: '' }));
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-alerts'] });
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Déclaration impossible'),
  });

  if (!ALLOWED_ROLES.includes(user?.roleCode)) return <Navigate to="/dashboard" replace />;

  const events = data?.data?.data?.events || [];
  const visibleEvents = events.filter((event) => {
    const matchesSeverity = !filters.severity || event.severity === filters.severity;
    const haystack = `${event.title || ''} ${event.description || ''} ${event.departmentName || ''} ${event.reporterName || ''}`.toLowerCase();
    return matchesSeverity && (!filters.search.trim() || haystack.includes(filters.search.trim().toLowerCase()));
  });
  const criticalCount = visibleEvents.filter((event) => ['error', 'critical'].includes(event.severity)).length;
  const today = getTunisDateKey();
  const todayCount = visibleEvents.filter((event) => event.date === today).length;
  const serviceCount = new Set(visibleEvents.map((event) => event.departmentId || event.departmentName).filter(Boolean)).size;
  const filtersActive = Boolean(filters.search || filters.departmentId || filters.severity || filters.from || filters.to);
  const assignedDepartment = user?.departments?.find((department) => department.is_primary) || user?.departments?.[0];

  const resetFilters = () => setFilters({ departmentId: '', severity: '', from: '', to: '', search: '' });

  const submit = (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      toast.error('Le titre est obligatoire');
      return;
    }
    if (isGeneralSupervisor && !form.departmentId) {
      toast.error('Le service et le titre sont obligatoires');
      return;
    }
    const payload = { severity: form.severity, title: form.title.trim(), description: form.description.trim() || undefined };
    if (isGeneralSupervisor) payload.departmentId = form.departmentId;
    createIncident.mutate(payload);
  };

  return (
    <div className="incidents-page">
      <header className="incidents-header">
        <div className="incidents-header-copy">
          <div className="incidents-eyebrow">
            <span className="incidents-live-dot" />
            Centre de vigilance
          </div>
          <div className="incidents-title-line">
            <div className="incidents-title-icon"><Siren size={24} /></div>
            <div><h1>Alertes et incidents</h1></div>
          </div>
          <div className="incidents-context">
            <Building2 size={14} />
            <span>{user?.establishmentName || 'Votre établissement'}</span>
            <span className="incidents-context-separator">/</span>
            <span>{roleLabels[user?.roleCode] || 'Responsable habilité'}</span>
            {!isGeneralSupervisor && assignedDepartment?.name && (
              <>
                <span className="incidents-context-separator">/</span>
                <strong>{assignedDepartment.name}</strong>
              </>
            )}
          </div>
        </div>
        <button
          className="incidents-primary-action"
          onClick={() => setShowForm((value) => !value)}
          aria-expanded={showForm}
        >
          {showForm ? <X size={17} /> : <Plus size={17} />}
          {showForm ? 'Fermer la déclaration' : 'Déclarer un incident'}
        </button>
      </header>

      <div className="incidents-stats" aria-label="Synthèse des incidents">
        <StatTile
          icon={Activity}
          label="Résultats affichés"
          value={visibleEvents.length}
          detail={filtersActive ? 'Après filtrage' : 'Journal récent'}
          tone="blue"
        />
        <StatTile
          icon={ShieldAlert}
          label="Graves ou critiques"
          value={criticalCount}
          detail={criticalCount ? 'À surveiller' : 'Aucun signal fort'}
          tone="red"
        />
        <StatTile icon={CalendarDays} label="Aujourd’hui" value={todayCount} detail="Dans les résultats" tone="amber" />
        <StatTile icon={UsersRound} label="Services concernés" value={serviceCount} detail="Dans le journal affiché" tone="teal" />
      </div>

      {showForm && (
        <form className="incident-declaration" onSubmit={submit}>
          <div className="incident-declaration-head">
            <div>
              <span className="incident-section-kicker">Nouveau signalement</span>
              <h2>Décrire la situation</h2>
            </div>
            <button
              type="button"
              className="incident-icon-button"
              onClick={() => setShowForm(false)}
              title="Fermer"
              aria-label="Fermer la déclaration"
            >
              <X size={18} />
            </button>
          </div>
          <div className="incident-form-grid">
            <div className="incident-form-main">
              <label className="incident-field">
                <span>Titre <b>*</b></span>
                <input
                  className="incident-control"
                  maxLength={255}
                  value={form.title}
                  onChange={(event) => setForm((value) => ({ ...value, title: event.target.value }))}
                  placeholder="Ex. Panne du système d'oxygène"
                  autoFocus
                />
              </label>
              <label className="incident-field">
                <span>Description</span>
                <textarea
                  className="incident-control incident-textarea"
                  rows={5}
                  value={form.description}
                  onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))}
                  placeholder="Faits constatés, personnes concernées et premières mesures prises…"
                />
              </label>
            </div>
            <div className="incident-form-side">
              {isGeneralSupervisor && (
                <label className="incident-field">
                  <span>Service <b>*</b></span>
                  <select
                    className="incident-control"
                    value={form.departmentId}
                    onChange={(event) => setForm((value) => ({ ...value, departmentId: event.target.value }))}
                  >
                    <option value="">Sélectionner un service…</option>
                    {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                </label>
              )}
              <fieldset className="incident-severity-field">
                <legend>Gravité du signalement</legend>
                <div className="incident-severity-grid">
                  {SEVERITIES.map(({ value, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={value}
                      className={`incident-severity-option ${form.severity === value ? 'is-selected' : ''} incident-severity-option-${value}`}
                      onClick={() => setForm((current) => ({ ...current, severity: value }))}
                      aria-pressed={form.severity === value}
                    >
                      <Icon size={16} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </div>
          <div className="incident-declaration-footer">
            <div>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Annuler</button>
              <button type="submit" className="incidents-submit" disabled={createIncident.isPending}>
                <Send size={15} />
                {createIncident.isPending ? 'Enregistrement…' : 'Enregistrer l’incident'}
              </button>
            </div>
          </div>
        </form>
      )}

      <section className="incident-filters-panel">
        <div className="incident-filter-topline">
          <div>
            <span className="incident-section-kicker">Journal de surveillance</span>
            <h2>Incidents déclarés</h2>
          </div>
          <button
            className="incident-filter-toggle"
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
          >
            <SlidersHorizontal size={15} />
            {showFilters ? 'Masquer les filtres' : 'Afficher les filtres'}
            {filtersActive && <i />}
          </button>
        </div>
        <div className={`incident-filters ${showFilters ? 'is-open' : ''}`}>
          <label className="incident-search-field">
            <Search size={16} />
            <input
              className="incident-control"
              aria-label="Rechercher dans les incidents"
              value={filters.search}
              onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))}
              placeholder="Rechercher un titre, un service ou un déclarant…"
            />
          </label>
          <div className="incident-filter-controls">
            <label className="incident-field incident-filter-field">
              <span>Service</span>
              <select className="incident-control" value={filters.departmentId} onChange={(event) => setFilters((value) => ({ ...value, departmentId: event.target.value }))}>
                <option value="">Tous les services</option>
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
            <label className="incident-field incident-filter-field">
              <span>Gravité</span>
              <select className="incident-control" value={filters.severity} onChange={(event) => setFilters((value) => ({ ...value, severity: event.target.value }))}>
                <option value="">Toutes les gravités</option>
                {SEVERITIES.map((severity) => <option key={severity.value} value={severity.value}>{severity.label}</option>)}
              </select>
            </label>
            <label className="incident-field incident-filter-field">
              <span>Du</span>
              <div className="incident-date-control">
                <CalendarDays size={14} />
                <input className="incident-control" type="date" value={filters.from} onChange={(event) => setFilters((value) => ({ ...value, from: event.target.value }))} />
              </div>
            </label>
            <label className="incident-field incident-filter-field">
              <span>Au</span>
              <div className="incident-date-control">
                <CalendarDays size={14} />
                <input className="incident-control" type="date" min={filters.from || undefined} value={filters.to} onChange={(event) => setFilters((value) => ({ ...value, to: event.target.value }))} />
              </div>
            </label>
            {filtersActive && <button type="button" className="incident-reset-button" onClick={resetFilters}><RotateCcw size={14} />Réinitialiser</button>}
          </div>
        </div>
        <div className="incident-filter-summary">
          <span><span className="incident-summary-pulse" />{visibleEvents.length} résultat{visibleEvents.length === 1 ? '' : 's'} dans le périmètre</span>
          {filtersActive && <span className="incident-filter-active-label">Filtres actifs</span>}
        </div>
      </section>

      <div className="incident-workspace-grid">
        <section className="incident-history-panel">
          <IncidentHistory events={visibleEvents} isLoading={isLoading} filtersActive={filtersActive} />
        </section>
        <aside className="incident-alerts-panel">
          <div className="incident-alerts-heading">
            <div>
              <span className="incident-section-kicker">Action immédiate</span>
              <h2>Alertes opérationnelles</h2>
            </div>
            <div className="incident-alerts-heading-icon"><BellRing size={18} /></div>
          </div>
          <ServiceAlertsPanel departmentId={filters.departmentId || undefined} canAct title="Alertes opérationnelles" variant="workspace" />
        </aside>
      </div>
    </div>
  );
}
