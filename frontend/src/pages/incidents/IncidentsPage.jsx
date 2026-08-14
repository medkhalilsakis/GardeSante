import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { departmentsAPI, journalAPI } from '../../api';
import { useAuthStore } from '../../store';
import ServiceAlertsPanel from '../surveillant/components/ServiceAlertsPanel';

const ALLOWED_ROLES = ['department_head', 'service_supervisor', 'general_supervisor'];
const SEVERITIES = [
  { value: 'info', label: 'Information' },
  { value: 'warning', label: 'Vigilance' },
  { value: 'error', label: 'Grave' },
  { value: 'critical', label: 'Critique' },
];
const SEVERITY_META = {
  info: { label: 'Information', color: '#2563EB', bg: '#EFF6FF' },
  warning: { label: 'Vigilance', color: '#B45309', bg: '#FFFBEB' },
  error: { label: 'Grave', color: '#DC2626', bg: '#FEF2F2' },
  critical: { label: 'Critique', color: '#991B1B', bg: '#FEE2E2' },
};

export default function IncidentsPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isGeneralSupervisor = user?.roleCode === 'general_supervisor';
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ departmentId: '', severity: '', from: '', to: '', search: '' });
  const [form, setForm] = useState({ departmentId: '', severity: 'warning', title: '', description: '' });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'incidents'],
    queryFn: () => departmentsAPI.getAll().then(response => response.data.data || []),
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
      setForm(value => ({ ...value, title: '', description: '' }));
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal-alerts'] });
    },
    onError: error => toast.error(error.response?.data?.message || 'Déclaration impossible'),
  });

  if (!ALLOWED_ROLES.includes(user?.roleCode)) return <Navigate to="/dashboard" replace />;

  const events = data?.data?.data?.events || [];
  const visibleEvents = events.filter(event => {
    const matchesSeverity = !filters.severity || event.severity === filters.severity;
    const haystack = `${event.title || ''} ${event.description || ''} ${event.departmentName || ''} ${event.reporterName || ''}`.toLowerCase();
    return matchesSeverity && (!filters.search.trim() || haystack.includes(filters.search.trim().toLowerCase()));
  });

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

    const payload = {
      severity: form.severity,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
    };
    if (isGeneralSupervisor) payload.departmentId = form.departmentId;

    createIncident.mutate(payload);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Alertes et incidents</h1>
          <p className="page-subtitle">Déclarez les incidents de service et suivez leur prise en charge.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(value => !value)}><Plus size={16} /> Déclarer un incident</button>
      </div>

      {showForm && (
        <form onSubmit={submit} style={{ padding: 18, border: '1px solid var(--border-default)', borderLeft: '4px solid #DC2626', borderRadius: 8, background: 'var(--bg-card)', display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            {isGeneralSupervisor && <label><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>Service *</span><select className="input" value={form.departmentId} onChange={event => setForm(value => ({ ...value, departmentId: event.target.value }))}><option value="">Sélectionner…</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>}
            <label><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>Gravité</span><select className="input" value={form.severity} onChange={event => setForm(value => ({ ...value, severity: event.target.value }))}>{SEVERITIES.map(severity => <option key={severity.value} value={severity.value}>{severity.label}</option>)}</select></label>
          </div>
          <label><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>Titre *</span><input className="input" maxLength={255} value={form.title} onChange={event => setForm(value => ({ ...value, title: event.target.value }))} placeholder="Ex. Panne du système d'oxygène" /></label>
          <label><span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 5 }}>Description</span><textarea className="input" rows={4} value={form.description} onChange={event => setForm(value => ({ ...value, description: event.target.value }))} placeholder="Décrivez les faits, les personnes concernées et les mesures prises…" /></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Annuler</button><button type="submit" className="btn btn-primary" disabled={createIncident.isPending}><AlertTriangle size={15} /> {createIncident.isPending ? 'Enregistrement…' : 'Enregistrer l’incident'}</button></div>
        </form>
      )}

      <section style={{ padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-card)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
          <label style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--text-muted)' }} /><input className="input" style={{ paddingLeft: 34 }} value={filters.search} onChange={event => setFilters(value => ({ ...value, search: event.target.value }))} placeholder="Rechercher dans les incidents…" /></label>
          <select className="input" value={filters.departmentId} onChange={event => setFilters(value => ({ ...value, departmentId: event.target.value }))}><option value="">Tous les services</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
          <select className="input" value={filters.severity} onChange={event => setFilters(value => ({ ...value, severity: event.target.value }))}><option value="">Toutes gravités</option>{SEVERITIES.map(severity => <option key={severity.value} value={severity.value}>{severity.label}</option>)}</select>
          <input className="input" type="date" value={filters.from} onChange={event => setFilters(value => ({ ...value, from: event.target.value }))} />
          <input className="input" type="date" min={filters.from || undefined} value={filters.to} onChange={event => setFilters(value => ({ ...value, to: event.target.value }))} />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 'var(--font-lg)', marginBottom: 10 }}>Historique des incidents</h2>
        {isLoading ? <div style={{ padding: 32, color: 'var(--text-muted)' }}>Chargement…</div> : visibleEvents.length === 0 ? <div style={{ padding: 38, textAlign: 'center', border: '1px dashed var(--border-default)', borderRadius: 8, color: 'var(--text-muted)' }}>Aucun incident ne correspond aux filtres.</div> : <div style={{ display: 'grid', gap: 8 }}>{visibleEvents.map(event => { const meta = SEVERITY_META[event.severity] || SEVERITY_META.info; return <article key={event.id} style={{ padding: '13px 15px', border: '1px solid var(--border-subtle)', borderLeft: `4px solid ${meta.color}`, borderRadius: 8, background: 'var(--bg-card)' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}><div><strong style={{ color: 'var(--text-primary)' }}>{event.title}</strong><div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>{event.departmentName} · {event.date} à {event.hour}{event.reporterName ? ` · déclaré par ${event.reporterName}` : ''}</div></div><span style={{ padding: '3px 8px', borderRadius: 999, background: meta.bg, color: meta.color, fontSize: 10, fontWeight: 800 }}>{meta.label}</span></div>{event.description && <p style={{ margin: '9px 0 0', fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{event.description}</p>}</article>; })}</div>}
      </section>

      <section style={{ paddingTop: 18, borderTop: '1px solid var(--border-default)' }}>
        <ServiceAlertsPanel departmentId={filters.departmentId || undefined} canAct title="Alertes liées aux incidents" />
      </section>
    </div>
  );
}
