import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { departmentsAPI, usersAPI, jobTitlesAPI } from '../../api';
import UnifiedRoleSelect from '../../components/ui/UnifiedRoleSelect';
import NoteComposer from '../../components/notes/NoteComposer';
import NotesFeed from '../../components/notes/NotesFeed';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ScopedStatsPanel from '../../components/statistics/ScopedStatsPanel';
import StaffLoanStatsPanel from '../../components/statistics/StaffLoanStatsPanel';
import LeavesPanel from './components/LeavesPanel';
import HospitalGuardsPanel from './components/HospitalGuardsPanel';
import StaffHistoryPanel from './components/StaffHistoryPanel';
import ContextBadge from '../../components/layout/ContextBadge';
import { useAuthStore } from '../../store';
import toast from 'react-hot-toast';

// ─── Icônes SVG légères ──────────────────────────────────────
const Icon = ({ path, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d={path} />
  </svg>
);
const PlusIcon   = () => <Icon path="M12 5v14M5 12h14" />;
const EditIcon   = () => <Icon path="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />;
const TrashIcon  = () => <Icon path="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;
const UserIcon   = () => <Icon path="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />;
const BuildingIcon = () => <Icon path="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10" />;
const ShieldIcon = () => <Icon path="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />;
const CheckIcon  = () => <Icon path="M20 6L9 17l-5-5" />;
const XIcon      = () => <Icon path="M18 6L6 18M6 6l12 12" />;

// Le surveillant général couvre l'hôpital entier : il n'appartient à aucun
// service et ne peut donc être ni chef ni surveillant d'un service. Le serveur
// refuse déjà ces affectations (hospital-wide-roles.js) ; on le retire aussi
// des listes de candidats pour ne pas proposer une action vouée à échouer.
const HOSPITAL_WIDE_ROLES = ['general_supervisor'];
const deptCandidates = (members) =>
  (members || []).filter(m => !HOSPITAL_WIDE_ROLES.includes(m.role_code));

// ─── KPI Card ────────────────────────────────────────────────
const KpiCard = ({ icon, label, value, sub, color }) => (
  <div style={{
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--border-radius)', padding: 'var(--space-5)',
    display: 'flex', flexDirection: 'column', gap: 8,
    borderTop: `3px solid ${color}`,
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{value ?? '—'}</div>
      <div style={{ background: `${color}20`, color, borderRadius: 8, padding: 8 }}>{icon}</div>
    </div>
    <div style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</div>
    {sub && <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>{sub}</div>}
  </div>
);

// ─── Badge rôle ──────────────────────────────────────────────
const roleBadgeStyle = {
  director:           { bg: '#1B4FCA22', color: '#1B4FCA' },
  hospital_admin:     { bg: '#7C3AED22', color: '#7C3AED' },
  general_supervisor: { bg: '#059669 22', color: '#059669' },
  department_head:    { bg: '#D97706 22', color: '#D97706' },
  service_supervisor: { bg: '#0891B222', color: '#0891B2' },
  senior_doctor:      { bg: '#DB277722', color: '#DB2777' },
  resident:           { bg: '#71717A22', color: '#71717A' },
};
const RoleBadge = ({ code, name }) => {
  const s = roleBadgeStyle[code] || { bg: '#33333322', color: '#999' };
  return (
    <span style={{
      background: s.bg, color: s.color, border: `1px solid ${s.color}33`,
      borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700,
      whiteSpace: 'nowrap',
    }}>
      {name || code}
    </span>
  );
};

// ─── Modal générique ─────────────────────────────────────────
const Modal = ({ title, onClose, children, wide }) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 16,
  }} onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{
      background: 'var(--bg-card)', borderRadius: 12, width: '100%',
      maxWidth: wide ? 700 : 480, maxHeight: '90vh', overflow: 'auto',
      boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
    }}>
      <div style={{
        padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <h3 style={{ margin: 0, fontSize: 'var(--font-md)', fontWeight: 700 }}>{title}</h3>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-muted)', padding: 4,
        }}><XIcon /></button>
      </div>
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  </div>
);

// ─── Champ de formulaire ─────────────────────────────────────
const Field = ({ label, required, children }) => (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
      {label}{required && <span style={{ color: 'var(--color-danger)', marginLeft: 4 }}>*</span>}
    </label>
    {children}
  </div>
);
const Input = (props) => (
  <input {...props} style={{
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-default)',
    borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
    fontSize: 'var(--font-sm)', outline: 'none', boxSizing: 'border-box',
    ...props.style,
  }} />
);
const Select = ({ children, ...props }) => (
  <select {...props} style={{
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border-default)',
    borderRadius: 8, padding: '8px 12px', color: 'var(--text-primary)',
    fontSize: 'var(--font-sm)', outline: 'none', boxSizing: 'border-box',
  }}>
    {children}
  </select>
);

// ════════════════════════════════════════════════════════════
// DASHBOARD DIRECTEUR
// ════════════════════════════════════════════════════════════
export default function DirectorDashboard() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const { section } = useParams();
  const navigate = useNavigate();

  const activeTab = section === 'personnel'  ? 'staff'
                  : section === 'services'   ? 'departments'
                  : section === 'notes'      ? 'notes'
                  : section === 'calendrier' ? 'calendrier'
                  : section === 'statistiques' ? 'stats'
                  : section === 'prets'      ? 'loan-stats'
                  : section === 'conges'     ? 'conges'
                  : section === 'gardes'     ? 'gardes'
                  : section === 'historique' ? 'historique'
                  : 'overview';

  // ── État des modals ──────────────────────────────────────
  const [deptModal,       setDeptModal]       = useState(null);
  const [headModal,       setHeadModal]       = useState(null);
  const [supervModal,     setSupervModal]     = useState(null);
  const [userModal,       setUserModal]       = useState(null);
  const [staffFilter,     setStaffFilter]     = useState({ search: '', roleCode: '', isActive: '', departmentId: '' });
  const [deptForm,        setDeptForm]        = useState({});
  const [userForm,        setUserForm]        = useState({});
  const [selectedUserId,  setSelectedUserId]  = useState('');

  const eid = user?.establishmentId;

  // ── Requêtes ─────────────────────────────────────────────
  const { data: departments = [], isLoading: loadingDepts } = useQuery({
    queryKey: ['departments', eid],
    queryFn: () => departmentsAPI.getAll().then(r => r.data.data),
  });

  const { data: staffData } = useQuery({
    queryKey: ['users', eid, staffFilter],
    queryFn: () => usersAPI.getAll({
      search: staffFilter.search || undefined,
      roleCode: staffFilter.roleCode || undefined,
      departmentId: staffFilter.departmentId || undefined,
      isActive: staffFilter.isActive !== '' ? staffFilter.isActive : undefined,
    }).then(r => r.data),
  });
  const staff = staffData?.data || [];

  const { data: availableRoles = [] } = useQuery({
    queryKey: ['roles-available'],
    queryFn: () => usersAPI.rolesAvailable().then(r => r.data.data),
  });
  // Rôles métier cumulables avec le titre « Chef de service ». Clé distincte de
  // ['roles-available'] : ce cache est partagé avec UnifiedRoleSelect, qui ne
  // lit que `data` — deux queryFn sur une même clé se marcheraient dessus.
  const { data: secondaryRoles = [] } = useQuery({
    queryKey: ['roles-secondary'],
    queryFn: () => usersAPI.rolesAvailable().then(r => r.data.secondaryRoles || []),
    staleTime: 120000,
  });
  const { data: jobTitles = [] } = useQuery({
    queryKey: ['job-titles', 'all'],
    queryFn: () => jobTitlesAPI.getAll().then(r => r.data.data),
  });

  // Membres du service sélectionné (pour désigner chef/surveillant)
  const { data: deptDetail } = useQuery({
    queryKey: ['department', headModal || supervModal],
    queryFn: () => departmentsAPI.getOne(headModal || supervModal).then(r => r.data.data),
    enabled: !!(headModal || supervModal),
  });

  // ── Mutations ────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries(['departments', eid]);
    qc.invalidateQueries(['users', eid]);
  };

  const createDept = useMutation({
    mutationFn: (d) => departmentsAPI.create(d),
    onSuccess: () => { toast.success('Service créé'); setDeptModal(null); setDeptForm({}); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const updateDept = useMutation({
    mutationFn: ({ id, ...d }) => departmentsAPI.update(id, d),
    onSuccess: () => { toast.success('Service mis à jour'); setDeptModal(null); setDeptForm({}); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const deleteDept = useMutation({
    mutationFn: (id) => departmentsAPI.delete(id),
    onSuccess: () => { toast.success('Service désactivé'); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const setHead = useMutation({
    mutationFn: ({ deptId, userId }) => departmentsAPI.setHead(deptId, userId),
    onSuccess: () => { toast.success('Chef de service désigné'); setHeadModal(null); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const setSuperv = useMutation({
    mutationFn: ({ deptId, userId }) => departmentsAPI.setSupervisor(deptId, userId),
    onSuccess: () => { toast.success('Surveillant désigné'); setSupervModal(null); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  // Un service peut compter PLUSIEURS surveillants : on retire donc une
  // personne précise, sans toucher aux autres surveillants du service.
  const removeSuperv = useMutation({
    mutationFn: ({ deptId, userId }) => departmentsAPI.removeSupervisor(deptId, userId),
    onSuccess: () => { toast.success('Surveillant retiré'); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const createUser = useMutation({
    mutationFn: (d) => usersAPI.create(d),
    onSuccess: (res) => { toast.success(res.data.message || 'Compte créé'); setUserModal(null); setUserForm({}); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const deactivate = useMutation({
    mutationFn: (id) => usersAPI.deactivate(id),
    onSuccess: () => { toast.success('Compte clôturé'); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });
  const activate = useMutation({
    mutationFn: (id) => usersAPI.activate(id),
    onSuccess: () => { toast.success('Compte réactivé'); invalidate(); },
    onError:   (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  // ── Handlers formulaires ─────────────────────────────────
  const openEditDept = (dept) => {
    setDeptForm({
      name: dept.name, nameAr: dept.name_ar, code: dept.code,
      departmentType: dept.department_type, floor: dept.floor,
      phone: dept.phone, bedCount: dept.bed_count, minGuardCount: dept.min_guard_count,
    });
    setDeptModal(dept);
  };

  const submitDept = () => {
    if (!deptForm.name || !deptForm.code) return toast.error('Nom et code requis');
    if (deptModal === 'create') {
      createDept.mutate(deptForm);
    } else {
      updateDept.mutate({ id: deptModal.id, ...deptForm });
    }
  };

  const ROLES_NEED_DEPT = ['department_head', 'service_supervisor', 'senior_doctor', 'resident'];
  const selectedTitle = jobTitles.find(t => t.id === userForm.jobTitleId);
  const personnelNeedsDept = ROLES_NEED_DEPT.includes(userForm.roleCode)
    || ['medical', 'paramedical'].includes(selectedTitle?.category);
  // Rôle transversal (surveillant général) : aucun service, comme le directeur.
  const roleIsHospitalWide = HOSPITAL_WIDE_ROLES.includes(userForm.roleCode);
  const submitUser = () => {
    if (!userForm.firstName || !userForm.lastName || !userForm.email || !userForm.roleCode) {
      return toast.error('Prenom, Nom, Email et Role/Titre sont obligatoires');
    }
    if (userForm.roleCode === 'autre' && !userForm.jobTitleId) {
      return toast.error('Veuillez choisir un titre de poste pour le role "Autre Personnel".');
    }
    if (personnelNeedsDept && !userForm.departmentId) {
      return toast.error('Le personnel medical ou paramedical doit obligatoirement etre affecte a un service.');
    }
    // Le champ service est masqué pour les rôles transversaux, mais il peut
    // rester renseigné si le rôle a été changé après coup : on le neutralise
    // ici, sinon le serveur refuserait la création en 400.
    if (roleIsHospitalWide) {
      const { departmentId, ...rest } = userForm;
      return createUser.mutate(rest);
    }
    createUser.mutate(userForm);
  };

  // ── Statistiques rapides ─────────────────────────────────
  const totalStaff  = staff.length;
  const activeStaff = staff.filter(u => u.is_active).length;
  const withLogin   = staff.filter(u => u.can_login).length;

  const DEPT_TYPE_LABELS = {
    emergency: 'Urgences', surgery: 'Chirurgie', icu: 'Réanimation',
    internal: 'Médecine interne', pediatrics: 'Pédiatrie',
    radiology: 'Radiologie', other: 'Autre',
  };

  return (
    <div>
      {/* Appartenance — hôpital dirigé et service(s) de rattachement. */}
      <ContextBadge variant="header" />

      {/* ── En-tête ── */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{
              background: 'linear-gradient(135deg,#1B4FCA,#6366F1)',
              borderRadius: 10, padding: 8, display: 'flex',
            }}>
              <BuildingIcon />
            </div>
            <div>
              <h1 className="page-title" style={{ marginBottom: 0 }}>
                Tableau de bord — Direction
              </h1>
              <p style={{ margin: 0, fontSize: 'var(--font-sm)', color: 'var(--color-primary-light)', fontWeight: 600 }}>
                🏥 {user?.establishmentName}
              </p>
            </div>
          </div>
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            Bienvenue, {user?.firstName} {user?.lastName} · Directeur
          </p>
        </div>
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <KpiCard icon={<BuildingIcon />} label="Services actifs" value={departments.length}
          sub="dans votre établissement" color="var(--color-primary)" />
        <KpiCard icon={<UserIcon />} label="Personnel total" value={totalStaff}
          sub={`${activeStaff} actifs`} color="var(--color-success)" />
        <KpiCard icon={<ShieldIcon />} label="Comptes plateforme" value={withLogin}
          sub="avec accès connecté" color="var(--color-info)" />
        <KpiCard icon={<UserIcon />} label="Comptes clôturés" value={totalStaff - activeStaff}
          sub="à réactiver si besoin" color="var(--color-danger)" />
      </div>

      {/* ── Onglets ── */}
      <div style={{
        display: 'flex', gap: 4, background: 'var(--bg-elevated)',
        borderRadius: 10, padding: 4, marginBottom: 'var(--space-6)', width: 'fit-content',
        flexWrap: 'wrap',
      }}>
        {[
          { id: 'overview',     label: '📊 Vue d\'ensemble', path: '/director' },
          { id: 'departments',  label: '🏥 Services',         path: '/director/services' },
          { id: 'staff',        label: '👤 Personnel',        path: '/director/personnel' },
          { id: 'gardes',       label: '🛡️ Gardes',           path: '/director/gardes' },
          { id: 'conges',       label: '🏖️ Congés',           path: '/director/conges' },
          { id: 'notes',        label: '📢 Notes',            path: '/director/notes' },
          { id: 'calendrier',   label: '📅 Calendrier',       path: '/director/calendrier' },
          { id: 'stats',        label: '📊 Statistiques',     path: '/director/statistiques' },
          { id: 'loan-stats',   label: '🤝 Prêts personnel',  path: '/director/prets' },
          { id: 'historique',   label: '🕓 Historique',       path: '/director/historique' },
        ].map(t => (
          <button key={t.id} onClick={() => navigate(t.path)} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 'var(--font-sm)', fontFamily: 'inherit',
            background: activeTab === t.id ? 'var(--color-primary)' : 'transparent',
            color: activeTab === t.id ? '#fff' : 'var(--text-secondary)',
            transition: 'all 0.2s',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ TAB : SERVICES ══ */}
      {/* ══ TAB : VUE D'ENSEMBLE ══ */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 'var(--space-5)' }}>
          <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/director/services')}>
            <div className="card-header">
              <h3 className="card-title"><BuildingIcon /> Services</h3>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-primary)' }}>{departments.length}</span>
            </div>
            <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', margin: '8px 0 0' }}>
              {departments.filter(d => d.head_id).length} avec chef de service · {departments.filter(d => !d.head_id).length} sans chef
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-primary-light)', marginTop: 8 }}>→ Gérer les services</p>
          </div>
          <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/director/personnel')}>
            <div className="card-header">
              <h3 className="card-title"><UserIcon /> Personnel</h3>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--color-success)' }}>{totalStaff}</span>
            </div>
            <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', margin: '8px 0 0' }}>
              {activeStaff} actifs · {withLogin} avec accès plateforme
            </p>
            <p style={{ fontSize: 11, color: 'var(--color-primary-light)', marginTop: 8 }}>→ Gérer le personnel</p>
          </div>
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <BuildingIcon /> Gestion des Services
            </h3>
            <button className="btn btn-primary" onClick={() => { setDeptForm({}); setDeptModal('create'); }}>
              <PlusIcon /> Nouveau service
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            {loadingDepts ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement…</div>
            ) : departments.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Aucun service. Créez le premier service de votre hôpital.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                    {['Code','Service','Type','Étage','Chef de Service','Surveillants','Personnel','Actions'].map(h => (
                      <th key={h} style={{
                        padding: '10px 16px', textAlign: 'left', fontSize: 11,
                        fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
                        letterSpacing: '0.05em', whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {departments.map(dept => (
                    <tr key={dept.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          fontFamily: 'monospace', fontSize: 12, fontWeight: 700,
                          background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 4,
                          color: 'var(--color-primary)',
                        }}>{dept.code}</span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>{dept.name}</div>
                        {dept.name_ar && <div style={{ fontSize: 11, color: 'var(--text-muted)', direction: 'rtl' }}>{dept.name_ar}</div>}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {DEPT_TYPE_LABELS[dept.department_type] || dept.department_type || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                        {dept.floor || '—'}
                      </td>
                      {/* Chef */}
                      <td style={{ padding: '12px 16px' }}>
                        {dept.head_id ? (
                          <div>
                            <div style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {dept.head_first_name} {dept.head_last_name}
                            </div>
                            <RoleBadge code={dept.head_role_code} name="Chef" />
                          </div>
                        ) : (
                          <button style={{
                            fontSize: 11, padding: '3px 10px', borderRadius: 6,
                            border: '1px dashed var(--color-warning)', background: 'transparent',
                            color: 'var(--color-warning)', cursor: 'pointer', fontFamily: 'inherit',
                          }} onClick={() => setHeadModal(dept.id)}>
                            + Désigner
                          </button>
                        )}
                      </td>
                      {/* Surveillants — plusieurs possibles pour un même service */}
                      <td style={{ padding: '12px 16px' }}>
                        {(() => {
                          // `supervisors` est agrégé par le backend ; `supervisor_id`
                          // reste renseigné avec le premier pour compatibilité.
                          const sup = Array.isArray(dept.supervisors) ? dept.supervisors
                            : (dept.supervisor_id
                              ? [{ id: dept.supervisor_id, firstName: dept.supervisor_first_name, lastName: dept.supervisor_last_name }]
                              : []);
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                              {sup.map(s => (
                                <span key={s.id} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 6,
                                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                                  background: 'var(--color-info-10, #0EA5E920)', color: 'var(--color-info)',
                                }}>
                                  {s.firstName} {s.lastName}
                                  <span
                                    title="Retirer ce surveillant"
                                    onClick={() => {
                                      if (window.confirm(`Retirer ${s.firstName} ${s.lastName} des surveillants de "${dept.name}" ?`))
                                        removeSuperv.mutate({ deptId: dept.id, userId: s.id });
                                    }}
                                    style={{ cursor: 'pointer', opacity: .65, fontWeight: 800, lineHeight: 1 }}
                                  >×</span>
                                </span>
                              ))}
                              <button style={{
                                fontSize: 11, padding: '3px 10px', borderRadius: 6,
                                border: '1px dashed var(--color-info)', background: 'transparent',
                                color: 'var(--color-info)', cursor: 'pointer', fontFamily: 'inherit',
                              }} onClick={() => setSupervModal(dept.id)}>
                                {sup.length ? '+ Ajouter' : '+ Désigner'}
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span style={{
                          fontWeight: 700, fontSize: 'var(--font-sm)',
                          color: 'var(--color-primary)',
                        }}>{dept.member_count || 0}</span>
                      </td>
                      {/* Actions */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button title="Modifier" onClick={() => openEditDept(dept)} style={{
                            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                            borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--text-secondary)',
                          }}><EditIcon /></button>
                          <button title="Désigner chef" onClick={() => setHeadModal(dept.id)} style={{
                            background: '#D9770620', border: '1px solid #D97706 44',
                            borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: '#D97706',
                          }}><UserIcon /></button>
                          <button title="Désactiver" onClick={() => {
                            if (window.confirm(`Désactiver le service "${dept.name}" ?`)) deleteDept.mutate(dept.id);
                          }} style={{
                            background: 'var(--color-danger-10)', border: '1px solid var(--color-danger-30)',
                            borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: 'var(--color-danger)',
                          }}><TrashIcon /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB : PERSONNEL ══ */}
      {activeTab === 'staff' && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              <UserIcon /> Personnel & Gestion des Comptes
            </h3>
            <button className="btn btn-primary" onClick={() => { setUserForm({}); setUserModal('create'); }}>
              <PlusIcon /> Nouveau compte
            </button>
          </div>

          {/* Filtres */}
          <div style={{
            padding: '12px 20px', display: 'flex', gap: 12, flexWrap: 'wrap',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <input placeholder="🔍 Rechercher…" value={staffFilter.search}
              onChange={e => setStaffFilter(f => ({ ...f, search: e.target.value }))}
              style={{
                flex: 1, minWidth: 200, background: 'var(--bg-input)', border: '1px solid var(--border-default)',
                borderRadius: 8, padding: '7px 12px', color: 'var(--text-primary)', fontSize: 'var(--font-sm)',
                outline: 'none',
              }} />
            <Select value={staffFilter.roleCode}
              onChange={e => setStaffFilter(f => ({ ...f, roleCode: e.target.value }))}
              style={{ width: 180 }}>
              <option value="">Tous les rôles</option>
              {availableRoles.map(r => (
                <option key={r.id} value={r.code}>{r.name}</option>
              ))}
            </Select>
            <Select value={staffFilter.departmentId}
              onChange={e => setStaffFilter(f => ({ ...f, departmentId: e.target.value }))}
              style={{ width: 190 }}>
              <option value="">Tous les services</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select value={staffFilter.isActive}
              onChange={e => setStaffFilter(f => ({ ...f, isActive: e.target.value }))}
              style={{ width: 150 }}>
              <option value="">Tous statuts</option>
              <option value="true">Actifs</option>
              <option value="false">Clôturés</option>
            </Select>
          </div>

          <div style={{ overflowX: 'auto' }}>
            {staff.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                Aucun résultat
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                    {['Matricule','Nom','Rôle','Service(s)','Spécialité','Accès','Statut','Actions'].map(h => (
                      <th key={h} style={{
                        padding: '10px 16px', textAlign: 'left', fontSize: 11,
                        fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: u.is_active ? 1 : 0.55 }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                        {u.matricule || '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)' }}>
                          {u.first_name} {u.last_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.email}</div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <RoleBadge code={u.role_code} name={u.role_name} />
                        {/* « Chef de service » est un titre : le rôle métier réel
                            s'affiche à côté quand il est renseigné. */}
                        {u.secondary_role_name && (
                          <div style={{ marginTop: 4 }}>
                            <span style={{
                              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                              background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                              border: '1px dashed var(--border-default)',
                            }} title="Rôle métier cumulé avec le titre de chef de service">
                              + {u.secondary_role_name}
                            </span>
                          </div>
                        )}
                      </td>
                      {/* Service(s) d'appartenance */}
                      <td style={{ padding: '12px 16px' }}>
                        {(() => {
                          const depts = Array.isArray(u.departments) ? u.departments : [];
                          if (!depts.length) {
                            return <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Aucun service</span>;
                          }
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                              {depts.map(d => (
                                <span key={d.id} style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                                  background: d.isHead ? '#FEF3C7' : 'var(--bg-elevated)',
                                  color: d.isHead ? '#B45309' : 'var(--text-secondary)',
                                }} title={d.isHead ? `Chef du service ${d.name}` : d.name}>
                                  {d.isHead && '⭐'}{d.name}
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: 'var(--font-xs)', color: 'var(--text-secondary)' }}>
                        {u.speciality || '—'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {u.can_login ? (
                          <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 700 }}>✓ Connecté</span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sans accès</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                          background: u.is_active ? '#05966920' : '#EF444420',
                          color: u.is_active ? '#059669' : '#EF4444',
                        }}>
                          {u.is_active ? '● Actif' : '○ Clôturé'}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {u.id !== user?.id && (
                          u.is_active ? (
                            <button onClick={() => {
                              if (window.confirm(`Clôturer le compte de ${u.first_name} ${u.last_name} ?`))
                                deactivate.mutate(u.id);
                            }} style={{
                              fontSize: 11, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                              background: 'var(--color-danger-10)', border: '1px solid var(--color-danger-30)',
                              color: 'var(--color-danger)', fontFamily: 'inherit', fontWeight: 600,
                            }}>Clôturer</button>
                          ) : (
                            <button onClick={() => activate.mutate(u.id)} style={{
                              fontSize: 11, padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                              background: '#05966920', border: '1px solid #05966944',
                              color: '#059669', fontFamily: 'inherit', fontWeight: 600,
                            }}>Réactiver</button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══ MODAL : Créer / Modifier Service ══ */}
      {deptModal && (
        <Modal title={deptModal === 'create' ? 'Nouveau service' : `Modifier — ${deptModal.name}`}
          onClose={() => { setDeptModal(null); setDeptForm({}); }} wide>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Code" required>
              <Input value={deptForm.code || ''} onChange={e => setDeptForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="URG, CHI, MED…" disabled={deptModal !== 'create'} />
            </Field>
            <Field label="Type">
              <Select value={deptForm.departmentType || 'other'}
                onChange={e => setDeptForm(f => ({ ...f, departmentType: e.target.value }))}>
                <option value="emergency">Urgences</option>
                <option value="surgery">Chirurgie</option>
                <option value="icu">Réanimation / ICU</option>
                <option value="internal">Médecine interne</option>
                <option value="pediatrics">Pédiatrie</option>
                <option value="radiology">Radiologie</option>
                <option value="other">Autre</option>
              </Select>
            </Field>
            <Field label="Nom (français)" required>
              <Input value={deptForm.name || ''} onChange={e => setDeptForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Urgences" />
            </Field>
            <Field label="Nom (arabe)">
              <Input value={deptForm.nameAr || ''} onChange={e => setDeptForm(f => ({ ...f, nameAr: e.target.value }))}
                placeholder="المستعجلات" dir="rtl" />
            </Field>
            <Field label="Étage / Localisation">
              <Input value={deptForm.floor || ''} onChange={e => setDeptForm(f => ({ ...f, floor: e.target.value }))}
                placeholder="RDC, 1er, 2e…" />
            </Field>
            <Field label="Aile / Bâtiment">
              <Input value={deptForm.wing || ''} onChange={e => setDeptForm(f => ({ ...f, wing: e.target.value }))}
                placeholder="Bâtiment A…" />
            </Field>
            <Field label="Téléphone">
              <Input value={deptForm.phone || ''} onChange={e => setDeptForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+213 21 …" />
            </Field>
            <Field label="Nb. lits">
              <Input type="number" min="0" value={deptForm.bedCount || ''} onChange={e => setDeptForm(f => ({ ...f, bedCount: e.target.value }))} />
            </Field>
          </div>
          <Field label="Gardes min. par jour">
            <Input type="number" min="1" max="20" value={deptForm.minGuardCount || 1}
              onChange={e => setDeptForm(f => ({ ...f, minGuardCount: e.target.value }))}
              style={{ width: 120 }} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={() => { setDeptModal(null); setDeptForm({}); }}>Annuler</button>
            <button className="btn btn-primary"
              onClick={submitDept}
              disabled={createDept.isPending || updateDept.isPending}>
              {(createDept.isPending || updateDept.isPending) ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ MODAL : Désigner Chef de Service ══ */}
      {headModal && (
        <Modal title="Désigner le Chef de Service" onClose={() => setHeadModal(null)}>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', marginBottom: 16 }}>
            Sélectionnez l'acteur qui sera Chef de Service. Son rôle sera automatiquement mis à jour.
          </p>
          <Field label="Personnel du service" required>
            <Select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
              <option value="">— Choisir —</option>
              {deptCandidates(deptDetail?.members).map(m => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name} ({m.role_name})
                </option>
              ))}
            </Select>
          </Field>
          {!deptDetail?.members?.length && (
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--color-warning)', marginTop: 8 }}>
              ⚠️ Ce service n'a pas encore de membres. Ajoutez d'abord du personnel.
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={() => setHeadModal(null)}>Annuler</button>
            <button className="btn btn-primary"
              disabled={!selectedUserId || setHead.isPending}
              onClick={() => { setHead.mutate({ deptId: headModal, userId: selectedUserId }); setSelectedUserId(''); }}>
              {setHead.isPending ? 'En cours…' : 'Confirmer'}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ MODAL : Désigner Surveillant ══ */}
      {supervModal && (
        <Modal title="Désigner un Surveillant de Service" onClose={() => setSupervModal(null)}>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Sélectionnez l'acteur qui sera Surveillant de ce service.
          </p>
          <div style={{
            background: 'var(--color-info-10, #0EA5E915)', border: '1px solid var(--color-info-30, #0EA5E940)',
            borderRadius: 8, padding: '8px 12px', marginBottom: 16,
            fontSize: 'var(--font-xs)', color: 'var(--color-info)',
          }}>
            ℹ️ Un service ne peut avoir qu'<strong>un seul chef</strong>, mais il peut compter
            <strong> plusieurs surveillants</strong>. Désigner une personne ici l'<strong>ajoute</strong> à
            la liste sans retirer le rôle aux surveillants déjà en place.
          </div>
          {/* Surveillants déjà en place */}
          {(() => {
            const dept = departments.find(d => d.id === supervModal);
            const sup  = Array.isArray(dept?.supervisors) ? dept.supervisors : [];
            if (!sup.length) return null;
            return (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Surveillants actuels ({sup.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {sup.map(s => (
                    <span key={s.id} style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20,
                      background: 'var(--bg-elevated)', color: 'var(--text-primary)',
                    }}>{s.firstName} {s.lastName}</span>
                  ))}
                </div>
              </div>
            );
          })()}
          <Field label="Personnel du service" required>
            <Select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
              <option value="">— Choisir —</option>
              {deptCandidates(deptDetail?.members).map(m => (
                <option key={m.id} value={m.id}>
                  {m.first_name} {m.last_name} ({m.role_name})
                </option>
              ))}
            </Select>
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={() => setSupervModal(null)}>Annuler</button>
            <button className="btn btn-primary"
              disabled={!selectedUserId || setSuperv.isPending}
              onClick={() => { setSuperv.mutate({ deptId: supervModal, userId: selectedUserId }); setSelectedUserId(''); }}>
              {setSuperv.isPending ? 'En cours…' : 'Confirmer'}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ MODAL : Créer un compte ══ */}
      {userModal === 'create' && (
        <Modal title="Créer un compte" onClose={() => { setUserModal(null); setUserForm({}); }} wide>
          <div style={{
            background: 'var(--color-primary-10)', border: '1px solid var(--color-primary-20)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 20,
            fontSize: 'var(--font-xs)', color: 'var(--color-primary-light)',
          }}>
            ℹ️ Selectionnez un <strong>role</strong> (avec acces plateforme) ou un <strong>titre de poste</strong> (ambulancier, ORL, pharmacien...) dans le champ ci-dessous.
            Le mot de passe initial sera <strong>GardeSante@2025</strong> — les titres de poste n'ont pas d'acces plateforme.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Prénom" required>
              <Input value={userForm.firstName || ''} onChange={e => setUserForm(f => ({ ...f, firstName: e.target.value }))} />
            </Field>
            <Field label="Nom" required>
              <Input value={userForm.lastName || ''} onChange={e => setUserForm(f => ({ ...f, lastName: e.target.value }))} />
            </Field>
            <Field label="Prénom (arabe)">
              <Input value={userForm.firstNameAr || ''} onChange={e => setUserForm(f => ({ ...f, firstNameAr: e.target.value }))} dir="rtl" />
            </Field>
            <Field label="Nom (arabe)">
              <Input value={userForm.lastNameAr || ''} onChange={e => setUserForm(f => ({ ...f, lastNameAr: e.target.value }))} dir="rtl" />
            </Field>
            <Field label="Email" required>
              <Input type="email" value={userForm.email || ''} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))} />
            </Field>
            <Field label="Téléphone">
              <Input value={userForm.phone || ''} onChange={e => setUserForm(f => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Matricule">
              <Input value={userForm.matricule || ''} onChange={e => setUserForm(f => ({ ...f, matricule: e.target.value }))} />
            </Field>
          </div>

          {/* Role + Titre de poste — champ unifie avec recherche */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Rôle / Titre de poste <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <UnifiedRoleSelect
              roleCode={userForm.roleCode || null}
              jobTitleId={userForm.jobTitleId || null}
              required
              onChange={({ roleCode: rc, jobTitleId: jid }) => {
                setUserForm(f => ({
                  ...f,
                  roleCode:   rc  || null,
                  jobTitleId: jid || null,
                  // Changer le role principal invalide un eventuel role secondaire
                  secondaryRoleCode: rc === 'department_head' ? f.secondaryRoleCode : null,
                }));
              }}
            />
            {userForm.roleCode === 'autre' && !userForm.jobTitleId && (
              <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4, fontWeight: 600 }}>
                Veuillez choisir un titre de poste specifique (ex: Ambulancier, Medecin Interne...).
              </div>
            )}
          </div>

          {/* Role secondaire — « Chef de service » est un TITRE, pas un metier.
              On garde donc la possibilite de cumuler le titre avec un vrai role
              metier (medecin senior, resident...). Purement descriptif. */}
          {userForm.roleCode === 'department_head' && (
            <div style={{
              marginBottom: 16, padding: '10px 14px',
              background: '#FEF3C7', border: '1px solid #F59E0B55', borderRadius: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 'var(--font-xs)', fontWeight: 700, color: '#92400E' }}>
                  ⭐ « Chef de service » est un titre, pas un poste
                </span>
                <span style={{ fontSize: 10, color: '#B45309', fontWeight: 600 }}>Optionnel</span>
              </div>
              <div style={{ fontSize: 11, color: '#92400E', marginBottom: 8 }}>
                Choisissez le <strong>rôle métier</strong> réel de cette personne (ex : médecin sénior qui est chef de service). Le rôle secondaire n'ouvre aucun accès supplémentaire.
              </div>
              <Select
                value={userForm.secondaryRoleCode || ''}
                onChange={e => setUserForm(f => ({ ...f, secondaryRoleCode: e.target.value || null }))}
                style={{ width: '100%', background: '#FFF' }}
              >
                <option value="">— Aucun rôle secondaire —</option>
                {(secondaryRoles || []).map(r => (
                  <option key={r.id} value={r.code}>{r.name}</option>
                ))}
              </Select>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Grade">
              <Input value={userForm.grade || ''} onChange={e => setUserForm(f => ({ ...f, grade: e.target.value }))} />
            </Field>
            <Field label="Langue interface">
              <Select value={userForm.preferredLanguage || 'fr'} onChange={e => setUserForm(f => ({ ...f, preferredLanguage: e.target.value }))}>
                <option value="fr">Français</option>
                <option value="ar">العربية</option>
              </Select>
            </Field>
          </div>
          {/* Service — pleine largeur si requis. Masqué pour les rôles
              transversaux : le surveillant général couvre tout l'hôpital. */}
          {roleIsHospitalWide ? (
            <div style={{
              background: 'var(--color-info-10, #0EA5E915)', border: '1px solid var(--color-info-30, #0EA5E940)',
              borderRadius: 8, padding: '10px 14px',
              fontSize: 'var(--font-xs)', color: 'var(--color-info)',
            }}>
              ℹ️ Le <strong>surveillant général</strong> couvre l'hôpital entier, comme le directeur :
              il n'est rattaché à <strong>aucun service</strong>.
            </div>
          ) : (
          <Field
            label={personnelNeedsDept ? 'Service (obligatoire *)' : 'Service (optionnel)'}
            required={personnelNeedsDept}
          >
            <Select
              value={userForm.departmentId || ''}
              onChange={e => setUserForm(f => ({ ...f, departmentId: e.target.value }))}
              style={{ borderColor: personnelNeedsDept && !userForm.departmentId ? 'var(--color-danger)' : undefined }}
            >
              <option value="">— Choisir un service —</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            {personnelNeedsDept && (
              <div style={{ fontSize: 11, color: '#F59E0B', marginTop: 4, fontWeight: 600 }}>
                Ce role necessite un service. Un seul chef de service par service, mais plusieurs surveillants sont possibles.
              </div>
            )}
          </Field>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
            <button className="btn btn-secondary" onClick={() => { setUserModal(null); setUserForm({}); }}>Annuler</button>
            <button className="btn btn-primary" onClick={submitUser} disabled={createUser.isPending}>
              {createUser.isPending ? 'Création…' : 'Créer le compte'}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ TAB : NOTES & CIRCULAIRES ══ */}
      {activeTab === 'notes' && (
        <div>
          <NoteComposer scopeLabel="tout le personnel de l'hôpital" />
          <NotesFeed />
        </div>
      )}

      {/* ══ TAB : CALENDRIER HÔPITAL (lecture seule) ══ */}
      {activeTab === 'calendrier' && (
        <HospitalGuardCalendar title="Calendrier des gardes de l'hôpital" />
      )}

      {/* ══ TAB : STATISTIQUES DE L'HÔPITAL ══ */}
      {activeTab === 'stats' && (
        <ScopedStatsPanel title="Statistiques de l'hôpital" />
      )}

      {/* ══ TAB : STATISTIQUES DES PRÊTS DE PERSONNEL ══ */}
      {activeTab === 'loan-stats' && (
        <StaffLoanStatsPanel title="Prêts de personnel — statistiques de l'hôpital" />
      )}

      {/* ══ TAB : GARDES DE L'HÔPITAL (lecture seule) ══ */}
      {activeTab === 'gardes' && <HospitalGuardsPanel />}

      {/* ══ TAB : CONGÉS DU PERSONNEL ══ */}
      {activeTab === 'conges' && <LeavesPanel />}

      {/* ══ TAB : HISTORIQUE DU PERSONNEL (immuable) ══ */}
      {activeTab === 'historique' && <StaffHistoryPanel />}
    </div>
  );
}




