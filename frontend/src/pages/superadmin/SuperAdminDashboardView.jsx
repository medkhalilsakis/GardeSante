import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  ContactRound,
  Eye,
  EyeOff,
  History,
  Hospital,
  Info,
  KeyRound,
  Library,
  LockKeyhole,
  MapPin,
  Megaphone,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  TriangleAlert,
  UserRound,
  UserX,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAPI, establishmentsAPI, userArchiveAPI, usersAPI } from '../../api';
import {
  GsBadge,
  GsEmpty,
  GsFilterBar,
  GsPageHeader,
  GsPanel,
  GsSkeleton,
  GsStat,
  GsStatRail,
  GsTable,
  GsTabRail,
} from '../../components/gs';
import Avatar from '../../components/common/Avatar';
import NoteComposer from '../../components/notes/NoteComposer';
import NotesFeed from '../../components/notes/NotesFeed';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ScopedStatsPanel from '../../components/statistics/ScopedStatsPanel';
import { longFrenchDate } from '../../utils/frenchDates';
import { useAuthStore } from '../../store';
import AnnuaireNationalPanel from './components/AnnuaireNationalPanel';
import CirculaireDiffusionPanel from './components/CirculaireDiffusionPanel';
import ConformitePanel from './components/ConformitePanel';
import EstablishmentOversightPanel from './components/EstablishmentOversightPanel';
import PlatformActivitySection from './components/PlatformActivitySection';
import ReferentielsSection from './components/ReferentielsSection';
import './superadmin.css';

const ONLINE_THRESH_MIN = 5;
const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

const ROLE_LABELS = {
  director: 'Directeur',
  general_supervisor: 'Surveillant général',
  department_head: 'Chef de service',
  service_supervisor: 'Surveillant de service',
  senior_doctor: 'Médecin senior',
  resident: 'Résident',
};

const MAIN_TABS = [
  { id: 'establishments', label: 'Établissements', icon: <Hospital size={13} /> },
  { id: 'holidays', label: 'Jours fériés', icon: <CalendarDays size={13} /> },
  { id: 'referentiels', label: 'Référentiels', icon: <Library size={13} /> },
  { id: 'conformite', label: 'Conformité', icon: <ShieldCheck size={13} /> },
  { id: 'annuaire', label: 'Annuaire', icon: <ContactRound size={13} /> },
  { id: 'stats', label: 'Statistiques', icon: <BarChart3 size={13} /> },
  { id: 'notes', label: 'Notes', icon: <Megaphone size={13} /> },
];

const EST_TABS = [
  { id: 'overview', label: 'Aperçu', icon: <ClipboardList size={13} /> },
  { id: 'director', label: 'Directeur', icon: <UserRound size={13} /> },
  { id: 'personnel', label: 'Personnel', icon: <Users size={13} /> },
  { id: 'history', label: 'Historique', icon: <History size={13} /> },
  { id: 'gardes', label: 'Gardes', icon: <ShieldCheck size={13} /> },
  { id: 'calendrier', label: 'Calendrier', icon: <CalendarDays size={13} /> },
  { id: 'stats', label: 'Statistiques', icon: <BarChart3 size={13} /> },
];

const EST_TYPE_LABEL = {
  hospital: 'Hôpital',
  clinic: 'Clinique',
  institute: 'Institut',
};

const HOLIDAY_CATEGORY = {
  national: 'National',
  religious: 'Religieux',
  special: 'Spécial',
};

const number = (value) => Number(value || 0);
const fixedHours = (value) => Number(value ?? 0).toFixed(1);
const money = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== '' && value != null
    ? parsed.toLocaleString('fr-FR')
    : '—';
};

const dateKey = (value) => String(value || '').slice(0, 10);
const dateOnly = (value) => {
  const key = dateKey(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? longFrenchDate(key) : '—';
};
const dateTime = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('fr-FR');
};

const computePresence = (lastActivity) => {
  if (!lastActivity) return { status: 'offline', label: 'Jamais connecté' };
  const diff = Date.now() - new Date(lastActivity).getTime();
  const min = Math.floor(diff / 60000);
  const hours = Math.floor(min / 60);
  const days = Math.floor(hours / 24);
  if (min < ONLINE_THRESH_MIN) return { status: 'online', label: 'Connecté' };
  if (min < 30) return { status: 'away', label: `Il y a ${min} min` };
  if (hours < 24) return { status: 'offline', label: `Il y a ${hours}h` };
  if (days < 7) return { status: 'offline', label: `Il y a ${days} jour${days > 1 ? 's' : ''}` };
  return { status: 'offline', label: dateTime(lastActivity) };
};

function Presence({ value }) {
  const presence = computePresence(value);
  const className = presence.status === 'online'
    ? 'gsa-pres is-live'
    : presence.status === 'away' ? 'gsa-pres is-recent' : 'gsa-pres';
  return <span className={className}><i aria-hidden="true" />{presence.label}</span>;
}

function EstablishmentState({ active }) {
  return <GsBadge tone={active ? 'duty' : 'quiet'} dot>{active ? 'Actif' : 'Désactivé'}</GsBadge>;
}

function AccountState({ user }) {
  if (user.archived_at) return <GsBadge tone="alert" dot>Archivé</GsBadge>;
  return <GsBadge tone={user.is_active ? 'duty' : 'quiet'} dot>{user.is_active ? 'Actif' : 'Inactif'}</GsBadge>;
}

function FormField({ label, required = false, className = '', children }) {
  return (
    <label className={`gsa-field${className ? ` ${className}` : ''}`}>
      <span>{label}{required ? <b className="gsa-req">*</b> : null}</span>
      {children}
    </label>
  );
}

function DialogShell({ title, onClose, wide = false, footer, children }) {
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button type="button" className="gsa-icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
        <div className="modal-body gsa-modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

function GovSelect({ value, onChange, govList }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const filtered = useMemo(
    () => govList.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())),
    [govList, search],
  );
  const selected = govList.find((item) => item.name === value);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const closeEscape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeEscape);
    };
  }, [open]);

  return (
    <div className="gsa-gov" ref={ref}>
      <button
        type="button"
        className={`gsa-gov-open${value ? '' : ' is-void'}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected ? `${selected.name} (${selected.region})` : 'Sélectionner un gouvernorat…'}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="gsa-gov-panel">
          <div className="gsa-gov-search">
            <input
              className="form-control"
              type="search"
              autoFocus
              value={search}
              placeholder="Rechercher…"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="gsa-gov-list" role="listbox" aria-label="Gouvernorats">
            <button
              type="button"
              className="gsa-gov-none"
              onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
            >
              Aucun gouvernorat
            </button>
            {filtered.map((item) => (
              <button
                type="button"
                className="gsa-gov-item"
                key={item.code}
                role="option"
                aria-selected={item.name === value}
                onClick={() => { onChange(item.name); setOpen(false); setSearch(''); }}
              >
                <b>{item.name}</b>
                <span>{item.region}</span>
              </button>
            ))}
            {filtered.length === 0 ? <div className="gsa-gov-empty">Aucun résultat</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BarChart({ data = [] }) {
  if (!data.length) return <p className="gsa-chart-empty">Pas de données</p>;
  const values = data.map((item) => number(item.count ?? item.value ?? item.establishments));
  const max = Math.max(...values, 1);
  const width = 100 / data.length;
  return (
    <div className="gsa-chart">
      <svg className="gsa-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {values.map((value, index) => {
          const height = (value / max) * 84;
          return <rect key={data[index].month || index} className="gsa-chart-bar" x={index * width + width * 0.18} y={94 - height} width={width * 0.64} height={height} rx="1" />;
        })}
      </svg>
      <div className="gsa-chart-axis">
        {data.map((item, index) => <span key={item.month || index}>{item.month?.slice(-2) || item.day?.slice(-2) || ''}</span>)}
      </div>
    </div>
  );
}

function LineChart({ data = [] }) {
  if (!data.length) return <p className="gsa-chart-empty">Pas de données</p>;
  const values = data.map((item) => number(item.count));
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1 || 1)) * 100;
    const y = 94 - (value / max) * 84;
    return `${x},${y}`;
  }).join(' ');
  return (
    <div className="gsa-chart is-duty">
      <svg className="gsa-chart-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline className="gsa-chart-line" points={points} />
        {values.map((value, index) => {
          const x = (index / (values.length - 1 || 1)) * 100;
          const y = 94 - (value / max) * 84;
          return <circle key={data[index].day || index} className="gsa-chart-dot" cx={x} cy={y} r="1.5" />;
        })}
      </svg>
      <div className="gsa-chart-axis is-ends">
        <span>{data[0]?.day?.slice(5) || ''}</span>
        <span>{data[data.length - 1]?.day?.slice(5) || ''}</span>
      </div>
    </div>
  );
}

function Distribution({ rows = [], duty = false }) {
  const max = Math.max(...rows.map((row) => number(row.value)), 1);
  if (!rows.length) return <p className="gsa-chart-empty">Pas de données</p>;
  return (
    <div className="gsa-bars">
      {rows.map((row) => (
        <div className={`gsa-bar${duty ? ' is-duty' : ''}`} key={row.label}>
          <span className="gsa-bar-label">{row.label}</span>
          <strong className="gsa-bar-value">{number(row.value).toLocaleString('fr-FR')}</strong>
          {row.hint ? <span className="gsa-bar-hint">{row.hint}</span> : null}
          <progress className="gsa-bar-progress" max={max} value={number(row.value)} aria-label={`${row.label} : ${row.value}`} />
        </div>
      ))}
    </div>
  );
}

function HolidayForm({ form, setForm }) {
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="gsa-form-grid">
      <FormField label="Nom de la fête ou de l'événement" required className="gsa-form-full">
        <input className="form-control" value={form.name || ''} onChange={(event) => set('name', event.target.value)} placeholder="Fête de l'Indépendance, Aïd el-Fitr…" />
      </FormField>
      <FormField label="Catégorie" required>
        <select className="form-control" value={form.category || 'national'} onChange={(event) => set('category', event.target.value)}>
          <option value="national">National</option>
          <option value="religious">Religieux</option>
          <option value="special">Spécial</option>
        </select>
      </FormField>
      <FormField label="Année" required>
        <input className="form-control" type="number" value={form.year || new Date().getFullYear()} onChange={(event) => set('year', parseInt(event.target.value, 10) || new Date().getFullYear())} />
      </FormField>
      <FormField label="Date de début" required>
        <input
          className="form-control"
          type="date"
          value={form.startDate || ''}
          onChange={(event) => setForm((current) => ({
            ...current,
            startDate: event.target.value,
            endDate: current.endDate && current.endDate < event.target.value ? event.target.value : (current.endDate || event.target.value),
          }))}
        />
      </FormField>
      <FormField label="Date de fin">
        <input className="form-control" type="date" min={form.startDate || undefined} value={form.endDate || form.startDate || ''} onChange={(event) => set('endDate', event.target.value)} />
      </FormField>
      <FormField label="Coefficient de garde">
        <input className="form-control" type="number" step="0.1" min="1" max="3" value={form.multiplier || 1.5} onChange={(event) => set('multiplier', parseFloat(event.target.value) || 1.5)} />
      </FormField>
      <FormField label="Récurrence">
        <label className="gsa-check">
          <input type="checkbox" checked={Boolean(form.isRecurring)} onChange={(event) => set('isRecurring', event.target.checked)} />
          Récurrent chaque année
        </label>
      </FormField>
      <FormField label="Notes ou description" className="gsa-form-full">
        <textarea className="form-control form-control-textarea" value={form.notes || ''} onChange={(event) => set('notes', event.target.value)} placeholder="Précisions utiles au calcul des gardes…" />
      </FormField>
    </div>
  );
}

function HolidaysSection({ onOpenCreate, onEdit, onDelete, onSeedTunisia }) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [category, setCategory] = useState('all');
  const years = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
  const { data: holidaysData, isLoading } = useQuery({
    queryKey: ['admin-holidays', selectedYear],
    queryFn: () => adminAPI.getHolidays({ year: selectedYear }),
  });
  const holidays = holidaysData?.data?.data || holidaysData?.data || [];
  const visible = category === 'all' ? holidays : holidays.filter((item) => item.category === category);
  const filters = [
    { id: 'all', label: 'Tous', count: holidays.length },
    { id: 'national', label: 'Nationaux', count: holidays.filter((item) => item.category === 'national').length },
    { id: 'religious', label: 'Religieux', count: holidays.filter((item) => item.category === 'religious').length },
    { id: 'special', label: 'Spéciaux', count: holidays.filter((item) => item.category === 'special').length },
  ];
  const columns = [
    {
      key: 'name', label: 'Événement', strong: true, render: (item) => (
        <span className="gsa-name"><b>{item.name}</b>{item.notes ? <span>{item.notes}</span> : null}</span>
      ),
    },
    { key: 'category', label: 'Catégorie', render: (item) => <span className="gsa-word">{HOLIDAY_CATEGORY[item.category] || item.category || '—'}</span> },
    {
      key: 'period', label: 'Période', render: (item) => {
        const start = dateKey(item.start_date);
        const end = dateKey(item.end_date) || start;
        return <span className="gsa-span"><b>{start === end ? dateOnly(start) : `Du ${dateOnly(start)} au ${dateOnly(end)}`}</b><span>{start === end ? 'Un jour' : 'Période'}</span></span>;
      },
    },
    { key: 'recurring', label: 'Récurrence', render: (item) => <span className="gsa-word">{item.is_recurring ? 'Annuelle' : 'Ponctuelle'}</span> },
    { key: 'multiplier', label: 'Coeff.', num: true, render: (item) => `× ${number(item.multiplier || 1.5).toFixed(2)}` },
    {
      key: 'actions', label: 'Actions', align: 'right', render: (item) => (
        <div className="gsa-acts">
          <button type="button" className="gsa-icon-btn" onClick={() => onEdit(item)} aria-label={`Modifier ${item.name}`}><Pencil size={13} /></button>
          <button type="button" className="gsa-icon-btn is-danger" onClick={() => onDelete(item)} aria-label={`Supprimer ${item.name}`}><Trash2 size={13} /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="gsa-section">
      <GsPageHeader
        plain
        eyebrow="Calendrier officiel"
        title={`Jours et périodes fériés ${selectedYear}`}
        subtitle="Ce registre alimente les plannings spéciaux et le calcul des gardes majorées."
        actions={(
          <div className="gsa-tools">
            <select className="gsa-tool-sel" value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))} aria-label="Année">
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <button type="button" className="gs-btn" onClick={() => onSeedTunisia(selectedYear)}><RefreshCw size={13} /> Précharger la Tunisie</button>
            <button type="button" className="gs-btn is-primary" onClick={() => onOpenCreate(selectedYear)}><Plus size={13} /> Ajouter</button>
          </div>
        )}
        rail={(
          <GsStatRail>
            <GsStat label="Total" value={holidays.length} tone="seal" />
            <GsStat label="Nationaux" value={filters[1].count} />
            <GsStat label="Religieux" value={filters[2].count} />
            <GsStat label="Récurrents" value={holidays.filter((item) => item.is_recurring).length} />
          </GsStatRail>
        )}
      />
      <GsPanel flush title="Registre annuel" sub="La catégorie sert à filtrer ; elle ne change pas la valeur administrative de la date.">
        <GsFilterBar inset filters={filters} value={category} onChange={setCategory} />
        {isLoading ? (
          <div className="gsa-load"><GsSkeleton variant="rows" count={5} /></div>
        ) : (
          <GsTable
            label={`Jours fériés ${selectedYear}`}
            columns={columns}
            rows={visible}
            rowKey="id"
            empty={(
              <div className="gsa-load">
                <GsEmpty
                  icon={<CalendarDays size={24} />}
                  title={holidays.length ? 'Aucune date dans cette catégorie' : `Aucun jour férié configuré pour ${selectedYear}`}
                  hint={holidays.length ? 'Choisissez une autre catégorie.' : 'Préchargez les jours nationaux ou ajoutez une date manuellement.'}
                  actions={!holidays.length ? <button type="button" className="gs-btn is-primary" onClick={() => onOpenCreate(selectedYear)}>Ajouter une date</button> : null}
                />
              </div>
            )}
          />
        )}
      </GsPanel>
    </div>
  );
}

export default function SuperAdminDashboardView() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const establishmentFromUrl = searchParams.get('establishment');
  const requestedTabRef = useRef(null);

  const [selectedEstId, setSelectedEstId] = useState(establishmentFromUrl);
  const [activeTab, setActiveTab] = useState('overview');
  const [mainTab, setMainTab] = useState('establishments');
  const [modal, setModal] = useState(null);
  const [modalData, setModalData] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [estForm, setEstForm] = useState({});
  const [dirForm, setDirForm] = useState({});
  const [staffForm, setStaffForm] = useState({});
  const [pwdForm, setPwdForm] = useState({ newPassword: '', confirm: '' });
  const [holidayForm, setHolidayForm] = useState({});
  const [staffFilter, setStaffFilter] = useState({ search: '', roleCode: '', isActive: 'true', archived: '' });
  const [archiveForm, setArchiveForm] = useState({ reason: '' });
  const [histFilter, setHistFilter] = useState({ from: '', to: '', category: '' });
  const [salaryPeriod, setSalaryPeriod] = useState({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });
  const [estScope, setEstScope] = useState('all');
  const [estSearch, setEstSearch] = useState('');

  useEffect(() => {
    setSelectedEstId(establishmentFromUrl);
    const requested = requestedTabRef.current;
    if (requested && String(requested.establishmentId) === String(establishmentFromUrl)) {
      setActiveTab(requested.tab || 'overview');
      requestedTabRef.current = null;
    } else {
      setActiveTab('overview');
    }
  }, [establishmentFromUrl]);

  const inv = (...keys) => keys.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));

  const { data: governorates = [] } = useQuery({
    queryKey: ['governorates'],
    queryFn: () => adminAPI.getGovernorates().then((response) => response.data.data),
    staleTime: Infinity,
  });
  const { data: establishments = [], isLoading: loadingEsts } = useQuery({
    queryKey: ['establishments'],
    queryFn: () => establishmentsAPI.getAll().then((response) => response.data.data),
  });
  const { data: globalStats, isLoading: loadingStats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: () => adminAPI.getStats().then((response) => response.data.data),
    enabled: mainTab === 'stats',
    refetchInterval: 60000,
  });

  const selectedEst = useMemo(
    () => establishments.find((item) => String(item.id) === String(selectedEstId)) || null,
    [establishments, selectedEstId],
  );

  const { data: personnel = [], isLoading: loadingPersonnel } = useQuery({
    queryKey: ['personnel', selectedEstId, staffFilter],
    queryFn: () => establishmentsAPI.getPersonnel(selectedEstId, {
      isActive: staffFilter.isActive || undefined,
      roleCode: staffFilter.roleCode || undefined,
      search: staffFilter.search || undefined,
      archived: staffFilter.archived || undefined,
      limit: 100,
    }).then((response) => response.data.data),
    enabled: !!selectedEstId && activeTab === 'personnel',
  });
  const { data: director } = useQuery({
    queryKey: ['director', selectedEstId],
    queryFn: () => establishmentsAPI.getDirector(selectedEstId).then((response) => response.data.data),
    enabled: !!selectedEstId && (activeTab === 'director' || activeTab === 'overview'),
  });
  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['est-history', selectedEstId, histFilter],
    queryFn: () => establishmentsAPI.getHistory(selectedEstId, { limit: 50, ...histFilter }).then((response) => response.data.data),
    enabled: !!selectedEstId && activeTab === 'history',
  });
  const { data: salaryReport } = useQuery({
    queryKey: ['salary', modalData?.userId, salaryPeriod],
    queryFn: () => establishmentsAPI.getSalaryReport(modalData.userId, salaryPeriod).then((response) => response.data.data),
    enabled: !!modalData?.userId && modal === 'staff-card',
  });

  const useAppMutation = (fn, keys, message) => useMutation({
    mutationFn: fn,
    onSuccess: (response) => {
      toast.success(response.data.message || message);
      setModal(null);
      setConfirm(null);
      inv(...(Array.isArray(keys) ? keys : [keys]));
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Erreur'),
  });

  const createEst = useAppMutation((data) => establishmentsAPI.create(data), ['establishments'], 'Établissement créé');
  const updateEst = useAppMutation(({ id, ...data }) => establishmentsAPI.update(id, data), ['establishments'], 'Mis à jour');
  const deactivateEst = useAppMutation((id) => adminAPI.deactivateEst(id), ['establishments', 'admin-stats'], 'Établissement désactivé');
  const activateEst = useAppMutation(({ id, ...data }) => adminAPI.activateEst(id, data), ['establishments', 'admin-stats', 'director'], 'Établissement réactivé');
  const createDir = useAppMutation((data) => usersAPI.create(data), ['establishments', 'director'], 'Directeur créé');
  const updateDir = useAppMutation(({ id, ...data }) => establishmentsAPI.updateDirector(id, data), ['director', 'establishments'], 'Directeur mis à jour');
  const toggleDirStatus = useAppMutation((id) => adminAPI.toggleDirectorStatus(id), ['director', 'establishments'], 'Statut mis à jour');
  const resetDirPwd = useAppMutation(({ id, ...data }) => adminAPI.resetDirectorPwd(id, data), ['director'], 'Mot de passe réinitialisé');
  const removeStaff = useAppMutation((id) => establishmentsAPI.removePersonnel(id), ['personnel'], 'Compte désactivé');
  const updateStaff = useAppMutation(({ id, ...data }) => establishmentsAPI.updatePersonnel(id, data), ['personnel', 'salary'], 'Informations mises à jour');
  const archiveStaff = useAppMutation(({ id, reason }) => userArchiveAPI.archive(id, { reason }), ['personnel', 'establishments'], 'Compte archivé');
  const unarchiveStaff = useAppMutation((id) => userArchiveAPI.unarchive(id), ['personnel', 'establishments'], 'Compte réactivé');
  const createHoliday = useAppMutation((data) => adminAPI.createHoliday(data), ['admin-holidays'], 'Jour férié enregistré');
  const updateHoliday = useAppMutation(({ id, ...data }) => adminAPI.updateHoliday(id, data), ['admin-holidays'], 'Jour férié mis à jour');
  const deleteHoliday = useAppMutation((id) => adminAPI.deleteHoliday(id), ['admin-holidays'], 'Jour férié supprimé');
  const seedTunisiaHolidays = useAppMutation((year) => adminAPI.seedTunisiaHolidays({ year }), ['admin-holidays'], 'Jours fériés tunisiens préchargés !');

  const goToEst = useCallback((id) => {
    requestedTabRef.current = null;
    setSelectedEstId(id);
    setActiveTab('overview');
    setSearchParams({ establishment: id });
  }, [setSearchParams]);

  const goBack = useCallback(() => {
    requestedTabRef.current = null;
    setSelectedEstId(null);
    setActiveTab('overview');
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const goToEstTab = useCallback(({ establishmentId, tab }) => {
    if (!establishmentId) return;
    const requested = { establishmentId, tab: tab || 'overview' };
    requestedTabRef.current = requested;
    setMainTab('establishments');
    setSelectedEstId(establishmentId);
    setActiveTab(requested.tab);
    setSearchParams({ establishment: establishmentId });
  }, [setSearchParams]);

  const totalActive = establishments.filter((item) => item.is_active).length;
  const totalPersonnel = establishments.reduce((sum, item) => sum + (parseInt(item.user_count, 10) || 0), 0);
  const totalDirectors = establishments.filter((item) => item.director_id).length;
  const directorsMissing = establishments.length - totalDirectors;
  const establishmentFilters = [
    { id: 'all', label: 'Tous', count: establishments.length },
    { id: 'active', label: 'Actifs', count: totalActive },
    { id: 'inactive', label: 'Désactivés', count: establishments.length - totalActive },
    { id: 'no-director', label: 'Directeurs à nommer', count: directorsMissing, tone: directorsMissing ? 'alert' : undefined },
  ];
  const visibleEstablishments = useMemo(() => {
    const term = estSearch.trim().toLowerCase();
    return establishments.filter((item) => {
      const scopeMatches = estScope === 'all'
        || (estScope === 'active' && item.is_active)
        || (estScope === 'inactive' && !item.is_active)
        || (estScope === 'no-director' && !item.director_id);
      if (!scopeMatches) return false;
      if (!term) return true;
      return [item.name, item.name_ar, item.code, item.governorate, item.city, item.type]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    });
  }, [estSearch, estScope, establishments]);

  const establishmentColumns = [
    {
      key: 'name', label: 'Établissement', strong: true, render: (item) => (
        <span className="gsa-name"><b>{item.name}</b>{item.name_ar ? <span dir="rtl">{item.name_ar}</span> : null}</span>
      ),
    },
    { key: 'code', label: 'Code', render: (item) => <span className="gsa-code">{item.code}</span> },
    { key: 'type', label: 'Type', render: (item) => <span className="gsa-word">{EST_TYPE_LABEL[item.type] || item.type || '—'}</span> },
    {
      key: 'location', label: 'Localisation', render: (item) => (
        <span className={`gsa-name${item.governorate || item.city ? '' : ' is-void'}`}>
          <b>{[item.city, item.governorate].filter(Boolean).join(' · ') || 'Non renseignée'}</b>
          {item.delegation ? <span>{item.delegation}</span> : null}
        </span>
      ),
    },
    { key: 'user_count', label: 'Personnel', num: true, render: (item) => number(item.user_count) },
    { key: 'dept_count', label: 'Services', num: true, render: (item) => number(item.dept_count) },
    {
      key: 'director', label: 'Directeur', render: (item) => item.director_id ? (
        <span className="gsa-who">
          <Avatar firstName={item.director_first_name} lastName={item.director_last_name} size="xs" />
          <span className="gsa-word is-strong">{item.director_first_name} {item.director_last_name}</span>
        </span>
      ) : <GsBadge tone="alert" dot>À nommer</GsBadge>,
    },
    { key: 'state', label: 'État', render: (item) => <EstablishmentState active={item.is_active} /> },
    {
      key: 'actions', label: 'Actions', align: 'right', render: (item) => (
        <div className="gsa-acts">
          <button type="button" className="gs-btn is-quiet" onClick={() => goToEst(item.id)}>Gérer</button>
          <button type="button" className="gsa-icon-btn" onClick={() => { setEstForm(estToForm(item)); goToEst(item.id); setModal('edit-est'); }} aria-label={`Modifier ${item.name}`}><Pencil size={13} /></button>
          <button
            type="button"
            className="gsa-icon-btn is-danger"
            aria-label={item.is_active ? `Désactiver ${item.name}` : `Réactiver ${item.name}`}
            onClick={() => item.is_active
              ? setConfirm({ message: `Désactiver « ${item.name} » ?`, sub: 'Tous les comptes rattachés seront désactivés.', action: () => deactivateEst.mutate(item.id) })
              : setConfirm({ message: `Réactiver « ${item.name} » ?`, sub: 'Les comptes ne seront pas automatiquement réactivés.', action: () => activateEst.mutate({ id: item.id }), danger: false })}
          >
            <Power size={13} />
          </button>
        </div>
      ),
    },
  ];

  const closeModal = () => setModal(null);
  const openStaffCard = (staff) => { setModalData({ userId: staff.id, staff }); setModal('staff-card'); };
  const openStaffEdit = (staff) => {
    setStaffForm({
      baseSalary: staff.base_salary,
      hourlyRate: staff.hourly_rate,
      hireDate: staff.hire_date?.substring(0, 10),
      phone: staff.phone,
      speciality: staff.speciality,
      grade: staff.grade,
    });
    setModalData({ userId: staff.id, staff });
    setModal('edit-staff');
  };

  return (
    <div className="gsa-wrap">
      <GsPageHeader
        eyebrow={selectedEstId ? 'Administration · fiche établissement' : 'Administration nationale'}
        title={selectedEstId ? selectedEst?.name || 'Établissement' : 'Administration GardeSante'}
        subtitle={selectedEstId
          ? [selectedEst?.code, EST_TYPE_LABEL[selectedEst?.type] || selectedEst?.type, selectedEst?.governorate].filter(Boolean).join(' · ')
          : 'Pilotez les établissements, les référentiels et la conformité du réseau hospitalier.'}
        meta={selectedEstId ? [] : [{ key: 'admin', label: 'Super Admin', value: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || '—' }]}
        actions={selectedEstId ? (
          <button type="button" className="gs-btn" onClick={goBack}><ArrowLeft size={13} /> Établissements</button>
        ) : mainTab === 'establishments' ? (
          <button type="button" className="gs-btn is-primary" onClick={() => { setEstForm({}); setModal('create-est'); }}><Plus size={13} /> Nouvel établissement</button>
        ) : null}
        rail={!selectedEstId && mainTab === 'establishments' ? (
          <GsStatRail>
            <GsStat label="Établissements" value={loadingEsts ? null : establishments.length} tone="seal" hint={`${totalActive} actifs`} />
            <GsStat label="Personnel total" value={loadingEsts ? null : totalPersonnel} hint="Tous établissements" />
            <GsStat
              label="Directeurs à nommer"
              value={loadingEsts ? null : directorsMissing}
              tone={directorsMissing ? 'alert' : undefined}
              hint={`${totalDirectors} déjà nommés`}
              onClick={() => { setMainTab('establishments'); setEstScope('no-director'); }}
              title="Filtrer le registre sur les établissements sans directeur"
            />
          </GsStatRail>
        ) : null}
      >
        <GsTabRail
          label={selectedEstId ? 'Sections de l’établissement' : 'Sections de l’administration'}
          tabs={selectedEstId ? EST_TABS : MAIN_TABS}
          value={selectedEstId ? activeTab : mainTab}
          onChange={selectedEstId ? setActiveTab : setMainTab}
        />
      </GsPageHeader>

      <div className="gsa-tab-body">
        {!selectedEstId && mainTab === 'establishments' ? (
          <GsPanel flush title="Registre national des établissements" sub="Comparez la couverture territoriale, l'encadrement et les effectifs sur une même ligne.">
            <GsFilterBar
              inset
              filters={establishmentFilters}
              value={estScope}
              onChange={setEstScope}
              search={{ value: estSearch, onChange: setEstSearch, placeholder: 'Nom, code, ville ou gouvernorat', label: 'Rechercher un établissement' }}
            />
            {loadingEsts ? (
              <div className="gsa-load"><GsSkeleton variant="rows" count={6} /></div>
            ) : (
              <GsTable
                label="Établissements de la plateforme"
                columns={establishmentColumns}
                rows={visibleEstablishments}
                rowKey="id"
                flagged={(item) => !item.director_id}
                empty={(
                  <div className="gsa-load">
                    <GsEmpty
                      icon={<Hospital size={25} />}
                      title={establishments.length ? 'Aucun établissement ne correspond' : 'Aucun établissement'}
                      hint={establishments.length ? 'Modifiez la recherche ou les filtres du registre.' : 'Créez le premier établissement de la plateforme.'}
                      actions={establishments.length
                        ? <button type="button" className="gs-btn is-quiet" onClick={() => { setEstScope('all'); setEstSearch(''); }}><RefreshCw size={13} /> Tout afficher</button>
                        : <button type="button" className="gs-btn is-primary" onClick={() => { setEstForm({}); setModal('create-est'); }}><Plus size={13} /> Créer un établissement</button>}
                    />
                  </div>
                )}
              />
            )}
          </GsPanel>
        ) : null}

        {!selectedEstId && mainTab === 'holidays' ? (
          <HolidaysSection
            onOpenCreate={(year) => {
              setHolidayForm({ name: '', category: 'national', startDate: `${year}-01-01`, endDate: `${year}-01-01`, year, isRecurring: true, multiplier: 1.5, notes: '' });
              setModal('create-holiday');
            }}
            onEdit={(item) => {
              setHolidayForm({
                id: item.id,
                name: item.name,
                category: item.category,
                startDate: item.start_date?.substring(0, 10),
                endDate: item.end_date?.substring(0, 10),
                year: item.year,
                isRecurring: Boolean(item.is_recurring),
                multiplier: item.multiplier,
                notes: item.notes || '',
              });
              setModal('edit-holiday');
            }}
            onDelete={(item) => setConfirm({ message: `Supprimer « ${item.name} » ?`, sub: 'Ce jour férié sera retiré du calendrier.', action: () => deleteHoliday.mutate(item.id) })}
            onSeedTunisia={(year) => setConfirm({ message: `Précharger les 8 jours fériés nationaux tunisiens pour ${year} ?`, sub: 'Les jours fériés usuels seront automatiquement enregistrés.', action: () => seedTunisiaHolidays.mutate(year), danger: false })}
          />
        ) : null}
        {!selectedEstId && mainTab === 'referentiels' ? <ReferentielsSection /> : null}
        {!selectedEstId && mainTab === 'conformite' ? <ConformitePanel onNavigate={goToEstTab} /> : null}
        {!selectedEstId && mainTab === 'annuaire' ? <AnnuaireNationalPanel /> : null}
        {!selectedEstId && mainTab === 'notes' ? (
          <div className="gsa-section">
            <NoteComposer scopeLabel="à tous les directeurs de la plateforme" />
            <CirculaireDiffusionPanel />
            <NotesFeed />
          </div>
        ) : null}
        {!selectedEstId && mainTab === 'stats' ? (
          <div className="gsa-section">
            <PlatformActivitySection />
            <StatsSection stats={globalStats} loading={loadingStats} />
          </div>
        ) : null}

        {selectedEstId && selectedEst ? (
          <EstDetail
            est={selectedEst}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            director={director}
            personnel={personnel}
            loadingPersonnel={loadingPersonnel}
            history={history}
            loadingHistory={loadingHistory}
            histFilter={histFilter}
            onHistFilter={setHistFilter}
            staffFilter={staffFilter}
            onStaffFilter={setStaffFilter}
            onOpenCreateDir={() => { setDirForm({ establishmentId: selectedEstId }); setModal('create-dir'); }}
            onOpenEditDir={() => {
              setDirForm({ firstName: director?.first_name, lastName: director?.last_name, email: director?.email, phone: director?.phone, matricule: director?.matricule, baseSalary: director?.base_salary, hourlyRate: director?.hourly_rate, hireDate: director?.hire_date?.substring(0, 10) });
              setModal('edit-dir');
            }}
            onToggleDir={() => setConfirm({ message: director?.is_active ? `Désactiver ${director?.first_name} ${director?.last_name} ?` : `Réactiver ${director?.first_name} ${director?.last_name} ?`, action: () => toggleDirStatus.mutate(selectedEstId), danger: director?.is_active })}
            onResetDirPwd={() => { setPwdForm({ newPassword: '', confirm: '' }); setModal('reset-pwd'); }}
            onStaffCard={openStaffCard}
            onEditStaff={openStaffEdit}
            onRemoveStaff={(staff) => setConfirm({ message: `Désactiver ${staff.first_name} ${staff.last_name} ?`, action: () => removeStaff.mutate(staff.id) })}
            onArchiveStaff={(staff) => { setArchiveForm({ reason: '' }); setModalData({ userId: staff.id, staff }); setModal('archive-staff'); }}
            onUnarchiveStaff={(staff) => setConfirm({ message: `Réactiver le compte de ${staff.first_name} ${staff.last_name} ?`, sub: 'Le compte retrouvera exactement l’état qu’il avait avant l’archivage.', danger: false, action: () => unarchiveStaff.mutate(staff.id) })}
            onEditEst={() => { setEstForm(estToForm(selectedEst)); setModal('edit-est'); }}
            onToggleEst={() => selectedEst.is_active
              ? setConfirm({ message: `Désactiver « ${selectedEst.name} » ?`, sub: 'Tous les comptes seront désactivés.', action: () => deactivateEst.mutate(selectedEstId) })
              : setConfirm({ message: `Réactiver « ${selectedEst.name} » ?`, action: () => activateEst.mutate({ id: selectedEstId }), danger: false })}
            avatarSrc={(account) => account?.avatar_url || null}
          />
        ) : null}
      </div>

      {modal === 'create-est' ? (
        <DialogShell
          title="Nouvel établissement"
          onClose={closeModal}
          wide
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button
                type="button"
                className="gs-btn is-primary"
                disabled={createEst.isPending}
                onClick={() => {
                  if (!estForm.code || !estForm.name) return toast.error('Code et nom requis');
                  if (!estForm.governorate) return toast.error('Le gouvernorat est obligatoire');
                  if (!estForm.city) return toast.error('La ville est obligatoire');
                  createEst.mutate(estForm);
                }}
              >
                <Check size={13} /> {createEst.isPending ? 'Création…' : 'Créer'}
              </button>
            </>
          )}
        >
          <EstForm form={estForm} setForm={setEstForm} govList={governorates} />
        </DialogShell>
      ) : null}

      {modal === 'edit-est' ? (
        <DialogShell
          title={`Modifier — ${selectedEst?.name || ''}`}
          onClose={closeModal}
          wide
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-primary" onClick={() => updateEst.mutate({ id: selectedEstId, ...estForm })} disabled={updateEst.isPending}><Check size={13} /> {updateEst.isPending ? 'Enregistrement…' : 'Enregistrer'}</button>
            </>
          )}
        >
          <EstForm form={estForm} setForm={setEstForm} editing govList={governorates} />
        </DialogShell>
      ) : null}

      {modal === 'create-dir' ? (
        <DialogShell
          title="Créer un directeur"
          onClose={closeModal}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-primary" onClick={() => createDir.mutate({ ...dirForm, roleCode: 'director', establishmentId: selectedEstId })} disabled={createDir.isPending}><UserRound size={13} /> {createDir.isPending ? 'Création…' : 'Créer le directeur'}</button>
            </>
          )}
        >
          <div className="gsa-rule is-seal"><Hospital size={15} /><p>Le compte sera rattaché à <strong>{selectedEst?.name}</strong>.</p></div>
          <DirForm form={dirForm} setForm={setDirForm} />
        </DialogShell>
      ) : null}

      {modal === 'edit-dir' && director ? (
        <DialogShell
          title="Modifier le directeur"
          onClose={closeModal}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-primary" onClick={() => updateDir.mutate({ id: selectedEstId, ...dirForm })} disabled={updateDir.isPending}><Check size={13} /> {updateDir.isPending ? 'Enregistrement…' : 'Enregistrer'}</button>
            </>
          )}
        >
          <DirForm form={dirForm} setForm={setDirForm} editing />
        </DialogShell>
      ) : null}

      {modal === 'reset-pwd' ? (
        <DialogShell
          title="Réinitialiser le mot de passe"
          onClose={closeModal}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-primary" onClick={() => resetDirPwd.mutate({ id: selectedEstId, newPassword: pwdForm.newPassword })} disabled={resetDirPwd.isPending || pwdForm.newPassword !== pwdForm.confirm || pwdForm.newPassword.length < 8}><LockKeyhole size={13} /> {resetDirPwd.isPending ? 'Réinitialisation…' : 'Réinitialiser'}</button>
            </>
          )}
        >
          <p className="gsa-note">Définir un nouveau mot de passe pour <strong>{director?.first_name} {director?.last_name}</strong>.</p>
          <div className="gsa-form-grid">
            <FormField label="Nouveau mot de passe" required className="gsa-form-full"><input className="form-control" type="password" value={pwdForm.newPassword} onChange={(event) => setPwdForm((current) => ({ ...current, newPassword: event.target.value }))} placeholder="Minimum 8 caractères" /></FormField>
            <FormField label="Confirmer le mot de passe" required className="gsa-form-full"><input className="form-control" type="password" value={pwdForm.confirm} onChange={(event) => setPwdForm((current) => ({ ...current, confirm: event.target.value }))} placeholder="Répéter le mot de passe" /></FormField>
          </div>
          {pwdForm.confirm && pwdForm.newPassword !== pwdForm.confirm ? <div className="gsa-rule is-alert"><TriangleAlert size={15} /><p>Les mots de passe ne correspondent pas.</p></div> : null}
        </DialogShell>
      ) : null}

      {modal === 'archive-staff' && modalData.staff ? (
        <DialogShell
          title={`Archiver — ${modalData.staff.first_name} ${modalData.staff.last_name}`}
          onClose={closeModal}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-danger" onClick={() => archiveStaff.mutate({ id: modalData.staff.id, reason: archiveForm.reason })} disabled={archiveStaff.isPending}><Archive size={13} /> {archiveStaff.isPending ? 'Archivage…' : 'Archiver le compte'}</button>
            </>
          )}
        >
          <div className="gsa-rule is-alert"><Archive size={15} /><p>L’archivage bloque totalement le compte sans supprimer ses données. Il reste réversible et distinct d’une clôture.</p></div>
          <FormField label="Motif de l'archivage"><input className="form-control" autoFocus value={archiveForm.reason} onChange={(event) => setArchiveForm({ reason: event.target.value })} placeholder="Départ, suspension temporaire…" /></FormField>
        </DialogShell>
      ) : null}

      {modal === 'staff-card' && modalData.staff ? (
        <DialogShell title={`${modalData.staff.first_name} ${modalData.staff.last_name}`} onClose={() => { setModal(null); setModalData({}); }} wide>
          <StaffCard
            staff={modalData.staff}
            salaryReport={salaryReport}
            salaryPeriod={salaryPeriod}
            onPeriodChange={setSalaryPeriod}
            avatarSrc={(account) => account?.avatar_url || null}
            onEdit={() => openStaffEdit(modalData.staff)}
            onRemove={() => { setModal(null); setConfirm({ message: `Désactiver ${modalData.staff.first_name} ${modalData.staff.last_name} ?`, action: () => removeStaff.mutate(modalData.staff.id) }); }}
          />
        </DialogShell>
      ) : null}

      {modal === 'edit-staff' && modalData.staff ? (
        <DialogShell
          title={`Modifier — ${modalData.staff.first_name} ${modalData.staff.last_name}`}
          onClose={closeModal}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-primary" onClick={() => updateStaff.mutate({ id: modalData.userId, ...staffForm })} disabled={updateStaff.isPending}><Check size={13} /> {updateStaff.isPending ? 'Enregistrement…' : 'Enregistrer'}</button>
            </>
          )}
        >
          <StaffEditForm form={staffForm} setForm={setStaffForm} />
        </DialogShell>
      ) : null}

      {modal === 'create-holiday' ? (
        <DialogShell
          title="Ajouter un jour ou une période fériée"
          onClose={closeModal}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-primary" onClick={() => createHoliday.mutate(holidayForm)} disabled={createHoliday.isPending || !holidayForm.name?.trim() || !holidayForm.startDate}><Check size={13} /> {createHoliday.isPending ? 'Enregistrement…' : 'Enregistrer le jour férié'}</button>
            </>
          )}
        >
          <HolidayForm form={holidayForm} setForm={setHolidayForm} />
        </DialogShell>
      ) : null}

      {modal === 'edit-holiday' ? (
        <DialogShell
          title="Modifier le jour ou la période fériée"
          onClose={closeModal}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={closeModal}>Annuler</button>
              <button type="button" className="gs-btn is-primary" onClick={() => updateHoliday.mutate(holidayForm)} disabled={updateHoliday.isPending || !holidayForm.name?.trim() || !holidayForm.startDate}><Check size={13} /> {updateHoliday.isPending ? 'Enregistrement…' : 'Mettre à jour'}</button>
            </>
          )}
        >
          <HolidayForm form={holidayForm} setForm={setHolidayForm} />
        </DialogShell>
      ) : null}

      {confirm ? (
        <DialogShell
          title="Confirmer l'action"
          onClose={() => setConfirm(null)}
          footer={(
            <>
              <button type="button" className="gs-btn" onClick={() => setConfirm(null)}>Annuler</button>
              <button type="button" className={`gs-btn${confirm.danger === false ? ' is-primary' : ' is-danger'}`} onClick={() => confirm.action()}>Confirmer</button>
            </>
          )}
        >
          <div className={`gsa-confirm${confirm.danger === false ? ' is-safe' : ''}`}>
            <TriangleAlert size={21} />
            <div className="gsa-confirm-body"><strong>{confirm.message}</strong>{confirm.sub ? <p>{confirm.sub}</p> : null}</div>
          </div>
        </DialogShell>
      ) : null}
    </div>
  );
}

function EstDetail({ est, activeTab, onTabChange: _onTabChange, director, personnel, loadingPersonnel, history, loadingHistory, histFilter, onHistFilter, staffFilter, onStaffFilter, onOpenCreateDir, onOpenEditDir, onToggleDir, onResetDirPwd, onStaffCard, onEditStaff, onRemoveStaff, onArchiveStaff, onUnarchiveStaff, onEditEst, onToggleEst, avatarSrc }) {
  const infoRows = [
    ['Code', est.code, true],
    ['Type', EST_TYPE_LABEL[est.type] || est.type],
    ['Gouvernorat', est.governorate || '—'],
    ['Ville', est.city || '—'],
    ['Délégation', est.delegation || '—'],
    ['Code postal', est.postal_code || '—'],
    ['Adresse', est.address || '—'],
    ['Adresse détaillée', est.address_details || '—'],
    ['Coordonnées GPS', est.latitude != null && est.longitude != null ? `${est.latitude}, ${est.longitude}` : '—', true],
    ['Téléphone', est.phone || '—'],
    ['Email', est.email || '—'],
    ['Créé le', dateTime(est.created_at)],
  ];

  const personnelColumns = [
    {
      key: 'personnel', label: 'Personnel', strong: true, render: (staff) => (
        <span className="gsa-who">
          <Avatar firstName={staff.first_name} lastName={staff.last_name} avatarUrl={avatarSrc(staff)} size="xs" />
          <span className="gsa-name"><b>{staff.first_name} {staff.last_name}</b><span>{staff.email}</span></span>
        </span>
      ),
    },
    {
      key: 'role', label: 'Rôle', render: (staff) => (
        <span className="gsa-word is-strong">{staff.role_name || ROLE_LABELS[staff.role_code] || staff.role_code || '—'}{staff.secondary_role_name ? <span className="gsa-sub">+ {staff.secondary_role_name}</span> : null}</span>
      ),
    },
    {
      key: 'departments', label: 'Services', render: (staff) => {
        const departments = Array.isArray(staff.departments_detail) ? staff.departments_detail : [];
        return departments.length ? <span className="gsa-chips">{departments.map((department) => <span className="gsa-word" key={department.id}>{department.name}{department.isHead ? ' — chef' : ''}</span>)}</span> : <span className="gsa-word is-void">Aucun service</span>;
      },
    },
    { key: 'speciality', label: 'Spécialité', render: (staff) => <span className={`gsa-word${staff.speciality ? '' : ' is-void'}`}>{staff.speciality || '—'}</span> },
    { key: 'shifts', label: 'Gardes/mois', num: true, render: (staff) => number(staff.shifts_this_month) },
    { key: 'hours', label: 'Heures/mois', num: true, render: (staff) => `${fixedHours(staff.hours_this_month)}h` },
    { key: 'presence', label: 'Présence', render: (staff) => <Presence value={staff.last_activity_at || staff.last_login} /> },
    { key: 'state', label: 'État', render: (staff) => <AccountState user={staff} /> },
    {
      key: 'actions', label: 'Actions', align: 'right', render: (staff) => (
        <div className="gsa-acts">
          <button type="button" className="gsa-icon-btn" onClick={() => onStaffCard(staff)} aria-label={`Ouvrir la fiche de ${staff.first_name}`}><Eye size={13} /></button>
          <button type="button" className="gsa-icon-btn" onClick={() => onEditStaff(staff)} aria-label={`Modifier ${staff.first_name}`}><Pencil size={13} /></button>
          {staff.archived_at
            ? <button type="button" className="gsa-icon-btn" onClick={() => onUnarchiveStaff(staff)} aria-label="Réactiver le compte archivé"><ArchiveRestore size={13} /></button>
            : <button type="button" className="gsa-icon-btn" onClick={() => onArchiveStaff(staff)} aria-label="Archiver le compte"><Archive size={13} /></button>}
          {staff.is_active ? <button type="button" className="gsa-icon-btn is-danger" onClick={() => onRemoveStaff(staff)} aria-label="Désactiver le compte"><UserX size={13} /></button> : null}
        </div>
      ),
    },
  ];

  const historyColumns = [
    { key: 'created_at', label: 'Date', num: true, render: (event) => dateTime(event.created_at) },
    {
      key: 'description', label: 'Événement', strong: true, render: (event) => (
        <span className="gsa-desc">{event.description}{event.severity === 'warning' || event.severity === 'error' || event.severity === 'critical' ? <span className="gsa-sub"><GsBadge tone="alert">À examiner</GsBadge></span> : null}</span>
      ),
    },
    { key: 'actor', label: 'Auteur', render: (event) => <span className="gsa-word">{event.first_name ? `${event.first_name} ${event.last_name}` : 'Système'}</span> },
    { key: 'category', label: 'Catégorie', render: (event) => <span className="gsa-word">{event.category || '—'}</span> },
    { key: 'action', label: 'Action', render: (event) => <span className="gsa-code">{event.action || '—'}</span> },
  ];

  return (
    <div className="gsa-section">
      {activeTab === 'overview' ? (
        <div className="gsa-split">
          <GsPanel
            title="Informations"
            icon={<Building2 size={14} />}
            tools={(
              <div className="gsa-tools">
                <button type="button" className="gs-btn" onClick={onEditEst}><Pencil size={13} /> Modifier</button>
                <button type="button" className="gs-btn is-danger" onClick={onToggleEst}><Power size={13} /> {est.is_active ? 'Désactiver' : 'Réactiver'}</button>
              </div>
            )}
          >
            <dl className="gsa-def">
              {infoRows.map(([label, value, mono]) => <div key={label}><dt>{label}</dt><dd className={`${mono ? 'is-mono' : ''}${value === '—' ? ' is-void' : ''}`}>{value}</dd></div>)}
              <div><dt>Statut</dt><dd><EstablishmentState active={est.is_active} /></dd></div>
            </dl>
          </GsPanel>
          <div className="gsa-section">
            <GsPanel title="Capacité" icon={<Activity size={14} />}>
              <GsStatRail compact>
                <GsStat label="Personnel" value={number(est.user_count)} tone="seal" />
                <GsStat label="Services" value={number(est.dept_count)} />
              </GsStatRail>
            </GsPanel>
            <GsPanel
              title="Directeur"
              icon={<UserRound size={14} />}
              tools={!director ? <button type="button" className="gs-btn is-primary" onClick={onOpenCreateDir}><Plus size={13} /> Nommer</button> : null}
            >
              {director ? (
                <div className="gsa-ident">
                  <Avatar firstName={director.first_name} lastName={director.last_name} avatarUrl={avatarSrc(director)} size="lg" />
                  <div className="gsa-ident-body">
                    <h3>{director.first_name} {director.last_name}</h3>
                    <p>{director.email}</p>
                    <div className="gsa-ident-marks"><Presence value={director.last_activity_at || director.last_login} /><EstablishmentState active={director.is_active} /></div>
                  </div>
                </div>
              ) : (
                <GsEmpty icon={<UserRound size={23} />} title="Aucun directeur nommé" hint="Cet établissement ne peut pas administrer ses services tant que la direction n'est pas attribuée." actions={<button type="button" className="gs-btn is-primary" onClick={onOpenCreateDir}>Nommer un directeur</button>} />
              )}
            </GsPanel>
          </div>
        </div>
      ) : null}

      {activeTab === 'director' ? (
        <GsPanel title="Direction de l'établissement" icon={<UserRound size={14} />}>
          {director ? (
            <div className="gsa-section">
              <div className="gsa-ident">
                <Avatar firstName={director.first_name} lastName={director.last_name} avatarUrl={avatarSrc(director)} size="xl" />
                <div className="gsa-ident-body">
                  <h3>{director.first_name} {director.last_name}</h3>
                  <p>Directeur · {est.name}</p>
                  <div className="gsa-ident-marks"><Presence value={director.last_activity_at || director.last_login} /><EstablishmentState active={director.is_active} /></div>
                </div>
              </div>
              <dl className="gsa-def-pair gsa-def">
                {[
                  ['Email', director.email], ['Téléphone', director.phone || '—'], ['Matricule', director.matricule || '—'],
                  ['Embauche', director.hire_date ? dateOnly(director.hire_date) : '—'], ['Salaire de base', director.base_salary ? `${money(director.base_salary)} TND` : '—'],
                  ['Taux horaire', director.hourly_rate ? `${money(director.hourly_rate)} TND/h` : '—'], ['Dernière activité', dateTime(director.last_activity_at || director.last_login)], ['Créé le', dateTime(director.created_at)],
                ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value === '—' ? 'is-void' : ''}>{value}</dd></div>)}
              </dl>
              <div className="gsa-tools">
                <button type="button" className="gs-btn is-primary" onClick={onOpenEditDir}><Pencil size={13} /> Modifier</button>
                <button type="button" className="gs-btn" onClick={onResetDirPwd}><KeyRound size={13} /> Réinitialiser le mot de passe</button>
                <button type="button" className="gs-btn is-danger" onClick={onToggleDir}><Power size={13} /> {director.is_active ? 'Désactiver' : 'Réactiver'}</button>
              </div>
            </div>
          ) : (
            <GsEmpty icon={<UserRound size={25} />} title="Aucun directeur pour cet établissement" hint="Créez le compte qui administrera les services et le personnel de cet hôpital." actions={<button type="button" className="gs-btn is-primary" onClick={onOpenCreateDir}><Plus size={13} /> Créer un compte directeur</button>} />
          )}
        </GsPanel>
      ) : null}

      {activeTab === 'personnel' ? (
        <GsPanel flush title={`Personnel (${personnel.length})`} icon={<Users size={14} />}>
          <div className="gsa-filters">
            <FormField label="Recherche"><input className="form-control" type="search" placeholder="Nom, email, matricule…" value={staffFilter.search} onChange={(event) => onStaffFilter((current) => ({ ...current, search: event.target.value }))} /></FormField>
            <FormField label="Rôle"><select className="form-control" value={staffFilter.roleCode} onChange={(event) => onStaffFilter((current) => ({ ...current, roleCode: event.target.value }))}><option value="">Tous les rôles</option>{Object.entries(ROLE_LABELS).filter(([code]) => code !== 'director').map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></FormField>
            <FormField label="Statut"><select className="form-control" value={staffFilter.isActive} onChange={(event) => onStaffFilter((current) => ({ ...current, isActive: event.target.value }))}><option value="">Tous</option><option value="true">Actifs</option><option value="false">Inactifs</option></select></FormField>
            <FormField label="Archivage"><select className="form-control" value={staffFilter.archived} onChange={(event) => onStaffFilter((current) => ({ ...current, archived: event.target.value }))}><option value="">Tous</option><option value="false">Non archivés</option><option value="true">Archivés seulement</option></select></FormField>
          </div>
          {loadingPersonnel ? <div className="gsa-load"><GsSkeleton variant="rows" count={6} /></div> : (
            <GsTable
              label={`Personnel de ${est.name}`}
              columns={personnelColumns}
              rows={personnel}
              rowKey="id"
              flagged={(staff) => Boolean(staff.archived_at)}
              empty={<div className="gsa-load"><GsEmpty icon={<Users size={24} />} title="Aucun personnel ne correspond" hint="Élargissez les critères de recherche ou d'état du compte." /></div>}
            />
          )}
        </GsPanel>
      ) : null}

      {activeTab === 'history' ? (
        <GsPanel flush title="Journal d'activité" icon={<History size={14} />} tools={<GsBadge tone="seal" icon={<LockKeyhole size={11} />}>Registre immuable</GsBadge>}>
          <div className="gsa-filters">
            <FormField label="Du"><input className="form-control" type="date" value={histFilter.from} onChange={(event) => onHistFilter((current) => ({ ...current, from: event.target.value }))} /></FormField>
            <FormField label="Au"><input className="form-control" type="date" value={histFilter.to} onChange={(event) => onHistFilter((current) => ({ ...current, to: event.target.value }))} /></FormField>
            <FormField label="Catégorie"><select className="form-control" value={histFilter.category} onChange={(event) => onHistFilter((current) => ({ ...current, category: event.target.value }))}><option value="">Toutes</option><option value="auth">Authentification</option><option value="admin">Administration</option><option value="schedule">Planning</option><option value="shift">Garde</option><option value="absence">Absence</option></select></FormField>
          </div>
          {loadingHistory ? <div className="gsa-load"><GsSkeleton variant="rows" count={6} /></div> : (
            <GsTable label={`Historique de ${est.name}`} columns={historyColumns} rows={history} rowKey="id" empty={<div className="gsa-load"><GsEmpty icon={<History size={24} />} title="Aucun événement" hint="Aucune action ne correspond à la période et à la catégorie choisies." /></div>} />
          )}
        </GsPanel>
      ) : null}

      {activeTab === 'calendrier' ? <HospitalGuardCalendar establishmentId={est.id} title={`Gardes — ${est.name}`} /> : null}
      {activeTab === 'stats' ? <ScopedStatsPanel establishmentId={est.id} title={`Statistiques — ${est.name}`} /> : null}
      {activeTab === 'gardes' ? <EstablishmentOversightPanel establishmentId={est.id} establishmentName={est.name} /> : null}
    </div>
  );
}

function StatsSection({ stats, loading }) {
  if (loading) return <GsPanel><GsSkeleton variant="rows" count={6} /></GsPanel>;
  if (!stats) return null;
  const establishments = stats.establishments || {};
  const users = stats.users || {};
  const byGovernorate = stats.byGovernorate || [];
  const evolution = stats.evolution || {};
  const recentLogins = stats.recentLogins || [];
  const recentEstablishments = stats.recentEstablishments || [];
  const typeData = [
    { label: 'Hôpitaux', value: number(establishments.hospitals) },
    { label: 'Cliniques', value: number(establishments.clinics) },
    { label: 'Instituts', value: number(establishments.institutes) },
  ].filter((item) => item.value > 0);
  const roleData = [
    { label: 'Médecins seniors', value: number(users.senior_doctors) },
    { label: 'Résidents', value: number(users.residents) },
    { label: 'Surveillants', value: number(users.supervisors) },
    { label: 'Chefs de service', value: number(users.dept_heads) },
  ];
  const loginColumns = [
    { key: 'user', label: 'Utilisateur', strong: true, render: (account) => <span className="gsa-who"><Avatar firstName={account.first_name} lastName={account.last_name} avatarUrl={account.avatar_url} size="xs" /><span className="gsa-name"><b>{account.first_name} {account.last_name}</b><span>{account.email}</span></span></span> },
    { key: 'role', label: 'Rôle', render: (account) => <span className="gsa-word">{account.role_name || ROLE_LABELS[account.role_code] || account.role_code}</span> },
    { key: 'establishment_name', label: 'Établissement' },
    { key: 'governorate', label: 'Gouvernorat', render: (account) => account.governorate || '—' },
    { key: 'presence', label: 'Présence', render: (account) => <Presence value={account.last_activity_at || account.last_login} /> },
  ];
  const recentColumns = [
    { key: 'name', label: 'Établissement', strong: true, render: (item) => <span className="gsa-name"><b>{item.name}</b><span className="gsa-code">{item.code}</span></span> },
    { key: 'type', label: 'Type', render: (item) => EST_TYPE_LABEL[item.type] || item.type },
    { key: 'governorate', label: 'Gouvernorat', render: (item) => item.governorate || '—' },
    { key: 'director', label: 'Directeur', render: (item) => item.dir_first ? `${item.dir_first} ${item.dir_last}` : <GsBadge tone="alert">Non nommé</GsBadge> },
    { key: 'state', label: 'État', render: (item) => <EstablishmentState active={item.is_active} /> },
    { key: 'created_at', label: 'Créé le', num: true, render: (item) => dateTime(item.created_at) },
  ];

  return (
    <div className="gsa-section">
      <GsPanel title="Annuaire national" icon={<Hospital size={14} />}>
        <GsStatRail>
          <GsStat label="Établissements" value={number(establishments.total)} tone="seal" hint={`+${number(establishments.new_last_30d)} sur 30 jours`} />
          <GsStat label="Actifs" value={number(establishments.active)} tone="duty" />
          <GsStat label="Désactivés" value={number(establishments.inactive)} />
          <GsStat label="Directeurs" value={number(users.directors)} />
        </GsStatRail>
      </GsPanel>
      <GsPanel title="Utilisateurs" icon={<Users size={14} />}>
        <GsStatRail>
          <GsStat label="Personnel total" value={number(users.total)} tone="seal" />
          <GsStat label="En ligne" value={number(users.online_now)} tone="duty" hint="Activité dans les 5 minutes" />
          <GsStat label="Connectés aujourd'hui" value={number(users.connected_today)} />
          <GsStat label="Chefs de service" value={number(users.dept_heads)} />
        </GsStatRail>
      </GsPanel>
      <div className="gsa-split">
        <GsPanel title="Évolution des établissements" sub="Douze derniers mois" icon={<BarChart3 size={14} />}><BarChart data={evolution.establishments || []} /></GsPanel>
        <GsPanel title="Connexions" sub="Trente derniers jours" icon={<Wifi size={14} />}><LineChart data={evolution.logins || []} /></GsPanel>
      </div>
      <div className="gsa-split">
        <GsPanel title="Répartition par gouvernorat" icon={<MapPin size={14} />}><Distribution rows={byGovernorate.map((item) => ({ label: item.governorate, value: item.establishments, hint: `${number(item.users)} personnel` }))} /></GsPanel>
        <GsPanel title="Répartition du réseau" icon={<Building2 size={14} />}>
          <div className="gsa-split gsa-split-compact"><Distribution rows={typeData} /><Distribution rows={roleData} duty /></div>
        </GsPanel>
      </div>
      <GsPanel flush title="Dernières connexions" icon={<Activity size={14} />}><GsTable label="Dernières connexions" columns={loginColumns} rows={recentLogins.slice(0, 10)} rowKey="id" empty={<div className="gsa-load"><GsEmpty title="Aucune connexion récente" /></div>} /></GsPanel>
      <GsPanel flush title="Établissements récents" icon={<Hospital size={14} />}><GsTable label="Établissements récents" columns={recentColumns} rows={recentEstablishments} rowKey="id" empty={<div className="gsa-load"><GsEmpty title="Aucun établissement récent" /></div>} /></GsPanel>
    </div>
  );
}

function StaffCard({ staff, salaryReport, salaryPeriod, onPeriodChange, avatarSrc, onEdit, onRemove }) {
  const shifts = salaryReport?.shifts || {};
  const salary = salaryReport?.salary || {};
  return (
    <div className="gsa-section">
      <div className="gsa-ident">
        <Avatar firstName={staff.first_name} lastName={staff.last_name} avatarUrl={avatarSrc(staff)} size="xl" />
        <div className="gsa-ident-body">
          <h3>{staff.first_name} {staff.last_name}</h3>
          <p>{staff.role_name || ROLE_LABELS[staff.role_code] || staff.role_code || '—'}</p>
          <div className="gsa-ident-marks">
            <Presence value={staff.last_activity_at || staff.last_login} />
            <AccountState user={staff} />
            {staff.is_on_leave ? <GsBadge tone="alert">En congé</GsBadge> : null}
          </div>
        </div>
      </div>
      <div className="gsa-split">
        <GsPanel title="Informations" icon={<Info size={14} />}>
          <dl className="gsa-def">{[
            ['Email', staff.email], ['Téléphone', staff.phone || '—'], ['Matricule', staff.matricule || '—'],
            ['Spécialité', staff.speciality || '—'], ['Grade', staff.grade || '—'], ['Services', staff.departments || '—'],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value === '—' ? 'is-void' : ''}>{value}</dd></div>)}</dl>
        </GsPanel>
        <GsPanel title="Carrière" icon={<Stethoscope size={14} />}>
          <dl className="gsa-def">{[
            ['Embauche', staff.hire_date ? dateOnly(staff.hire_date) : '—'],
            ['Ancienneté', salaryReport?.user?.seniority ? `${salaryReport.user.seniority.years}a ${salaryReport.user.seniority.months}m` : '—'],
            ['Salaire de base', staff.base_salary ? `${money(staff.base_salary)} TND` : '—'],
            ['Taux horaire', staff.hourly_rate ? `${money(staff.hourly_rate)} TND/h` : '—'],
            ['Dernière activité', dateTime(staff.last_activity_at || staff.last_login)],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value === '—' ? 'is-void' : ''}>{value}</dd></div>)}</dl>
        </GsPanel>
      </div>
      <GsPanel
        title="Rapport mensuel"
        icon={<BarChart3 size={14} />}
        tools={(
          <div className="gsa-tools">
            <select className="gsa-tool-sel" value={salaryPeriod.month} onChange={(event) => onPeriodChange((current) => ({ ...current, month: parseInt(event.target.value, 10) }))}>{MONTH_NAMES.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select>
            <select className="gsa-tool-sel" value={salaryPeriod.year} onChange={(event) => onPeriodChange((current) => ({ ...current, year: parseInt(event.target.value, 10) }))}>{[2023, 2024, 2025, 2026].map((year) => <option key={year} value={year}>{year}</option>)}</select>
          </div>
        )}
      >
        {salaryReport ? (
          <GsStatRail>
            <GsStat label="Gardes" value={number(shifts.total_shifts)} tone="seal" />
            <GsStat label="Heures" value={fixedHours(shifts.total_hours)} unit="h" />
            <GsStat label="Heures extra" value={fixedHours(shifts.extra_hours)} unit="h" />
            <GsStat label="Salaire base" value={money(salary.baseSalary)} unit="TND" />
            <GsStat label="Prime" value={money(salary.extraPay)} unit="TND" />
            <GsStat label="Total estimé" value={money(salary.totalSalary)} unit="TND" tone="duty" />
          </GsStatRail>
        ) : <GsSkeleton variant="rail" count={6} />}
      </GsPanel>
      <div className="gsa-tools">
        <button type="button" className="gs-btn is-primary" onClick={onEdit}><Pencil size={13} /> Modifier</button>
        {staff.is_active ? <button type="button" className="gs-btn is-danger" onClick={onRemove}><UserX size={13} /> Désactiver</button> : null}
      </div>
    </div>
  );
}

function estToForm(establishment) {
  return {
    name: establishment.name,
    nameAr: establishment.name_ar,
    type: establishment.type,
    address: establishment.address,
    city: establishment.city,
    phone: establishment.phone,
    email: establishment.email,
    governorate: establishment.governorate,
    delegation: establishment.delegation,
    postalCode: establishment.postal_code,
    addressDetails: establishment.address_details,
    latitude: establishment.latitude,
    longitude: establishment.longitude,
  };
}

function EstForm({ form, setForm, editing = false, govList }) {
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="gsa-form-grid">
      {!editing ? <FormField label="Code unique" required><input className="form-control" placeholder="CHU-TUN" value={form.code || ''} onChange={(event) => set('code', event.target.value.toUpperCase())} /></FormField> : null}
      <FormField label="Type"><select className="form-control" value={form.type || 'hospital'} onChange={(event) => set('type', event.target.value)}><option value="hospital">Hôpital</option><option value="clinic">Clinique</option><option value="institute">Institut</option></select></FormField>
      <FormField label="Nom en français" required className={editing ? 'gsa-form-full' : ''}><input className="form-control" placeholder="CHU de Tunis" value={form.name || ''} onChange={(event) => set('name', event.target.value)} /></FormField>
      <FormField label="Nom en arabe"><input className="form-control gsa-rtl" placeholder="مستشفى جامعي" value={form.nameAr || ''} onChange={(event) => set('nameAr', event.target.value)} /></FormField>
      <FormField label="Gouvernorat" required className="gsa-form-full"><GovSelect value={form.governorate || ''} onChange={(value) => set('governorate', value)} govList={govList} /></FormField>
      <FormField label="Ville" required><input className="form-control" placeholder="Tunis" value={form.city || ''} onChange={(event) => set('city', event.target.value)} /></FormField>
      <FormField label="Délégation"><input className="form-control" placeholder="Bab Souika" value={form.delegation || ''} onChange={(event) => set('delegation', event.target.value)} /></FormField>
      <FormField label="Code postal"><input className="form-control" placeholder="1006" value={form.postalCode || ''} onChange={(event) => set('postalCode', event.target.value)} /></FormField>
      <FormField label="Téléphone"><input className="form-control" placeholder="+216 71…" value={form.phone || ''} onChange={(event) => set('phone', event.target.value)} /></FormField>
      <FormField label="Email" className="gsa-form-full"><input className="form-control" type="email" placeholder="contact@chu.tn" value={form.email || ''} onChange={(event) => set('email', event.target.value)} /></FormField>
      <FormField label="Adresse" className="gsa-form-full"><input className="form-control" placeholder="Boulevard 9 Avril 1938, n° 12" value={form.address || ''} onChange={(event) => set('address', event.target.value)} /></FormField>
      <FormField label="Adresse détaillée" className="gsa-form-full"><textarea className="form-control form-control-textarea" placeholder="Repères, accès, bâtiment…" value={form.addressDetails || ''} onChange={(event) => set('addressDetails', event.target.value)} /></FormField>
      <FormField label="Latitude"><input className="form-control" type="number" step="0.000001" min="30" max="38" placeholder="36.806389" value={form.latitude ?? ''} onChange={(event) => set('latitude', event.target.value)} /></FormField>
      <FormField label="Longitude"><input className="form-control" type="number" step="0.000001" min="7" max="12.5" placeholder="10.181667" value={form.longitude ?? ''} onChange={(event) => set('longitude', event.target.value)} /></FormField>
      <div className="gsa-rule gsa-form-full"><MapPin size={15} /><p>Le gouvernorat, la ville et l'adresse servent à localiser l'établissement. Les coordonnées GPS sont facultatives et doivent être renseignées ensemble.</p></div>
    </div>
  );
}

function DirForm({ form, setForm, editing = false }) {
  const [showPassword, setShowPassword] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="gsa-form-grid">
      <FormField label="Prénom" required><input className="form-control" value={form.firstName || ''} onChange={(event) => set('firstName', event.target.value)} /></FormField>
      <FormField label="Nom" required><input className="form-control" value={form.lastName || ''} onChange={(event) => set('lastName', event.target.value)} /></FormField>
      <FormField label="Email" required className="gsa-form-full"><input className="form-control" type="email" value={form.email || ''} onChange={(event) => set('email', event.target.value)} /></FormField>
      {!editing ? (
        <FormField label="Mot de passe" required className="gsa-form-full">
          <div className="gsa-secret">
            <input className="form-control" type={showPassword ? 'text' : 'password'} value={form.password || ''} onChange={(event) => set('password', event.target.value)} />
            <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>{showPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </FormField>
      ) : null}
      <FormField label="Téléphone"><input className="form-control" value={form.phone || ''} onChange={(event) => set('phone', event.target.value)} /></FormField>
      <FormField label="Matricule"><input className="form-control" placeholder="DIR-001" value={form.matricule || ''} onChange={(event) => set('matricule', event.target.value)} /></FormField>
      <FormField label="Date d'embauche"><input className="form-control" type="date" value={form.hireDate || ''} onChange={(event) => set('hireDate', event.target.value)} /></FormField>
      <FormField label="Salaire de base (TND)"><input className="form-control" type="number" value={form.baseSalary || ''} onChange={(event) => set('baseSalary', event.target.value)} /></FormField>
      <FormField label="Taux horaire (TND/h)"><input className="form-control" type="number" value={form.hourlyRate || ''} onChange={(event) => set('hourlyRate', event.target.value)} /></FormField>
    </div>
  );
}

function StaffEditForm({ form, setForm }) {
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="gsa-form-grid">
      <FormField label="Téléphone"><input className="form-control" value={form.phone || ''} onChange={(event) => set('phone', event.target.value)} /></FormField>
      <FormField label="Spécialité"><input className="form-control" value={form.speciality || ''} onChange={(event) => set('speciality', event.target.value)} /></FormField>
      <FormField label="Grade"><input className="form-control" value={form.grade || ''} onChange={(event) => set('grade', event.target.value)} /></FormField>
      <FormField label="Date d'embauche"><input className="form-control" type="date" value={form.hireDate || ''} onChange={(event) => set('hireDate', event.target.value)} /></FormField>
      <FormField label="Salaire de base (TND)"><input className="form-control" type="number" value={form.baseSalary || ''} onChange={(event) => set('baseSalary', event.target.value)} /></FormField>
      <FormField label="Taux horaire (TND/h)"><input className="form-control" type="number" value={form.hourlyRate || ''} onChange={(event) => set('hourlyRate', event.target.value)} /></FormField>
    </div>
  );
}
