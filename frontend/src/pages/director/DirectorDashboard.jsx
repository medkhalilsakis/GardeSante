/**
 * Direction — administrer l'organisation de l'hôpital
 * ═══════════════════════════════════════════════════
 * Cet écran ne surveille pas la garde du jour : c'est le rôle de `/supervision`.
 * Ici, le directeur répond à une seule question de fond — **qui encadre quoi** —
 * et c'est la seule chose que lui seul peut réparer : un service sans chef ne
 * peut pas produire de planning.
 *
 * D'où l'ordre de l'écran : l'encadrement d'abord (services, manques), puis
 * l'effectif, puis ce qui se passe aujourd'hui en une ligne. Les deux listes
 * deviennent des registres : un service et un agent se lisent en comparant des
 * colonnes.
 *
 * Les taxonomies perdent leurs pastilles colorées. Un rôle, une catégorie de
 * personnel, un type de service ne sont pas des états : ce sont des valeurs de
 * colonne, et l'en-tête de colonne les nomme déjà. Les sept couleurs de rôle et
 * les trois couleurs de catégorie codées en dur disparaissent donc, sans qu'un
 * `tone` sémantique soit détourné pour les remplacer.
 *
 * Rien n'a changé côté données : mêmes requêtes, mêmes clés de cache, mêmes
 * douze mutations, mêmes règles de validation.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus, Pencil, Trash2, X, Info, AlertTriangle, RotateCcw, Building2, Users, UserPlus,
} from 'lucide-react';
import { departmentsAPI, usersAPI, jobTitlesAPI, directorOverviewAPI } from '../../api';
import UnifiedRoleSelect from '../../components/ui/UnifiedRoleSelect';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ScopedStatsPanel from '../../components/statistics/ScopedStatsPanel';
import StaffLoanStatsPanel from '../../components/statistics/StaffLoanStatsPanel';
import LeavesPanel from './components/LeavesPanel';
import StaffHistoryPanel from './components/StaffHistoryPanel';
import DirectorOverviewPanel from './components/DirectorOverviewPanel';
import ContextBadge from '../../components/layout/ContextBadge';
import {
  GsPageHeader, GsPanel, GsStat, GsStatRail, GsTabRail,
  GsTable, GsBadge, GsFilterBar, GsEmpty, GsSkeleton,
} from '../../components/gs';
import { fullFrenchDate } from '../../utils/frenchDates';
import { useAuthStore } from '../../store';
import toast from 'react-hot-toast';
import './director.css';

// Le surveillant général couvre l'hôpital entier : il n'appartient à aucun
// service et ne peut donc être ni chef ni surveillant d'un service. Le serveur
// refuse déjà ces affectations (hospital-wide-roles.js) ; on le retire aussi
// des listes de candidats pour ne pas proposer une action vouée à échouer.
const HOSPITAL_WIDE_ROLES = ['general_supervisor'];
const deptCandidates = (members) =>
  (members || []).filter((m) => !HOSPITAL_WIDE_ROLES.includes(m.role_code));

const ROLES_NEED_DEPT = ['department_head', 'service_supervisor', 'senior_doctor', 'resident'];

const DEPT_TYPE_LABELS = {
  emergency: 'Urgences', surgery: 'Chirurgie', icu: 'Réanimation',
  internal: 'Médecine interne', pediatrics: 'Pédiatrie',
  radiology: 'Radiologie', other: 'Autre',
};

// Libellés de repli : le serveur envoie `personnel_category_label` la plupart du
// temps, mais pas sur les comptes anciens.
const PERSONNEL_TYPE_LABELS = {
  medical: 'Personnel médical',
  administrative: 'Personnel administratif',
  auxiliary: 'Personnel auxiliaire',
};

const TABS = [
  { id: 'overview',    label: "Vue d'ensemble", path: '/director' },
  { id: 'departments', label: 'Services',      path: '/director/services' },
  { id: 'staff',       label: 'Personnel',     path: '/director/personnel' },
  { id: 'conges',      label: 'Congés',        path: '/director/conges' },
  { id: 'calendrier',  label: 'Calendrier',    path: '/director/calendrier' },
  { id: 'stats',       label: 'Statistiques',  path: '/director/statistiques' },
  { id: 'loan-stats',  label: 'Prêts de personnel', path: '/director/prets' },
  { id: 'historique',  label: 'Historique',    path: '/director/historique' },
];

const EMPTY_STAFF_FILTER = {
  search: '', roleCode: '', personnelType: '', isActive: '', departmentId: '', canLogin: '',
};

const pad = (n) => String(n).padStart(2, '0');
/** Clé du jour en heure locale : `new Date().toISOString()` décale d'un jour. */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Comparaison insensible à la casse et aux accents. */
const norm = (s) => String(s || '')
  .toLowerCase()
  // « Réanimation » doit se trouver en tapant « reanimation » : NFD sépare la
  // lettre de son accent, la propriété Unicode retire l'accent.
  .normalize('NFD')
  .replace(/\p{Diacritic}/gu, '');

/**
 * `supervisors` est agrégé par le backend ; `supervisor_id` reste renseigné avec
 * le premier pour compatibilité. Un service peut en compter plusieurs.
 */
const supervisorsOf = (dept) => {
  if (Array.isArray(dept?.supervisors)) return dept.supervisors;
  if (dept?.supervisor_id) {
    return [{
      id: dept.supervisor_id,
      firstName: dept.supervisor_first_name,
      lastName: dept.supervisor_last_name,
    }];
  }
  return [];
};

/**
 * Restrictions du registre des services. Au module et non dans le composant :
 * l'ensemble ne dépend d'aucun état, et `useMemo` peut alors le déclarer en
 * dépendance sans se recalculer à chaque frappe.
 */
const SCOPE_OF = {
  all:      () => true,
  noHead:   (d) => !d.head_id,
  noSuperv: (d) => supervisorsOf(d).length === 0,
  empty:    (d) => Number(d.member_count || 0) === 0,
};

/**
 * Coque de modale — celle de la plateforme (`index.css`), et non les cinq
 * variantes réécrites à la main que cet écran portait. Ajoute la fermeture au
 * clavier, qui manquait : une modale qu'on ne peut fermer qu'à la souris n'est
 * pas utilisable au clavier.
 */
const DirModal = ({ title, onClose, wide = false, footer, children }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`modal${wide ? ' modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button type="button" className="gsd-icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={14} strokeWidth={2.2} />
          </button>
        </div>
        <div className="modal-body gsd-modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

/** Un champ : son libellé, le contrôle, et la règle qui s'y applique. */
const Fld = ({ label, required = false, hint, hintTone, children }) => (
  <label className="gsd-field">
    <span>{label}{required ? <b className="gsd-req">*</b> : null}</span>
    {children}
    {hint ? <small className={hintTone === 'alert' ? 'gsd-hint is-alert' : 'gsd-hint'}>{hint}</small> : null}
  </label>
);

// ════════════════════════════════════════════════════════════
// DIRECTION
// ════════════════════════════════════════════════════════════
export default function DirectorDashboard() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const { section } = useParams();
  const navigate = useNavigate();

  const activeTab = section === 'personnel'  ? 'staff'
                  : section === 'services'   ? 'departments'
                  : section === 'calendrier' ? 'calendrier'
                  : section === 'statistiques' ? 'stats'
                  : section === 'prets'      ? 'loan-stats'
                  : section === 'conges'     ? 'conges'
                  : section === 'historique' ? 'historique'
                  : 'overview';

  useEffect(() => {
    if (section === 'notes') navigate('/notes', { replace: true });
    if (section === 'gardes') navigate('/shifts', { replace: true });
  }, [section, navigate]);

  // ── État des modals ──────────────────────────────────────
  const [deptModal,       setDeptModal]       = useState(null);
  const [headModal,       setHeadModal]       = useState(null);
  const [supervModal,     setSupervModal]     = useState(null);
  const [migrationDept,   setMigrationDept]   = useState(null);
  const [migrationTarget, setMigrationTarget] = useState('');
  const [userModal,       setUserModal]       = useState(null);
  const [staffFilter,     setStaffFilter]     = useState(EMPTY_STAFF_FILTER);
  const [deptForm,        setDeptForm]        = useState({});
  const [userForm,        setUserForm]        = useState({});
  const [selectedUserId,  setSelectedUserId]  = useState('');
  // Restriction du registre des services : le manque d'encadrement est ce que
  // le directeur vient chercher, il doit pouvoir l'isoler.
  const [deptScope,       setDeptScope]       = useState('all');
  const [deptSearch,      setDeptSearch]      = useState('');

  const eid = user?.establishmentId;

  // ── Requêtes ─────────────────────────────────────────────
  const { data: departments = [], isLoading: loadingDepts } = useQuery({
    queryKey: ['departments', eid],
    queryFn: () => departmentsAPI.getAll().then((r) => r.data.data),
  });

  const { data: staffData, isLoading: loadingStaff } = useQuery({
    queryKey: ['users', eid, staffFilter],
    queryFn: () => usersAPI.getAll({
      search: staffFilter.search || undefined,
      roleCode: staffFilter.roleCode || undefined,
      personnelType: staffFilter.personnelType || undefined,
      departmentId: staffFilter.departmentId || undefined,
      isActive: staffFilter.isActive !== '' ? staffFilter.isActive : undefined,
      // `canLogin` est déjà géré côté serveur (users.controller.js:116) : il
      // permet à la vue d'ensemble d'ouvrir « comptes sans accès plateforme »
      // sur une liste réellement filtrée.
      canLogin: staffFilter.canLogin !== '' ? staffFilter.canLogin : undefined,
      limit: 500,
    }).then((r) => r.data),
  });
  const staff = staffData?.data || [];

  // Totaux de l'établissement. La rangée de mesures annonce « Personnel » : elle
  // ne doit donc pas suivre les filtres de l'onglet Personnel, ni être plafonnée
  // par la pagination. Même clé de cache que `DirectorOverviewPanel` —
  // react-query mutualise l'appel, il n'y en a qu'un.
  const { data: overview } = useQuery({
    queryKey: ['director-overview'],
    queryFn: () => directorOverviewAPI.get().then((r) => r.data?.data),
    staleTime: 60_000,
  });

  const { data: availableRoles = [] } = useQuery({
    queryKey: ['roles-available'],
    queryFn: () => usersAPI.rolesAvailable().then((r) => r.data.data),
  });
  // Rôles métier cumulables avec le titre « Chef de service ». Clé distincte de
  // ['roles-available'] : ce cache est partagé avec UnifiedRoleSelect, qui ne
  // lit que `data` — deux queryFn sur une même clé se marcheraient dessus.
  const { data: secondaryRoles = [] } = useQuery({
    queryKey: ['roles-secondary'],
    queryFn: () => usersAPI.rolesAvailable().then((r) => r.data.secondaryRoles || []),
    staleTime: 120000,
  });
  const { data: jobTitles = [] } = useQuery({
    queryKey: ['job-titles', 'all'],
    queryFn: () => jobTitlesAPI.getAll().then((r) => r.data.data),
  });

  // Membres du service sélectionné (pour désigner chef/surveillant)
  const { data: deptDetail } = useQuery({
    queryKey: ['department', headModal || supervModal],
    queryFn: () => departmentsAPI.getOne(headModal || supervModal).then((r) => r.data.data),
    enabled: !!(headModal || supervModal),
  });

  // ── Mutations ────────────────────────────────────────────
  // react-query v5 attend un objet de filtres. Passé en tableau (signature v4),
  // `queryKey` vaut `undefined` : aucun filtre n'est appliqué et c'est TOUT le
  // cache de l'application qui est invalidé à chaque création de service ou de
  // compte — les onglets Congés, Calendrier, Statistiques et Historique
  // rechargeaient sans raison.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['departments', eid] });
    qc.invalidateQueries({ queryKey: ['users', eid] });
    // Désigner un chef ou clôturer un compte change les chiffres de la vue
    // d'ensemble : sans cette ligne, la rangée de mesures et la liste des
    // services sans chef resteraient sur leurs anciennes valeurs une minute.
    qc.invalidateQueries({ queryKey: ['director-overview'] });
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
    // `id` est le second argument que react-query passe à onError : c'est
    // exactement ce qui a été muté. L'ancienne version relisait l'identifiant
    // dans `e.config.url` — une chaîne d'URL qui n'existe plus si la requête
    // échoue avant d'être émise (réseau coupé), et la modale de migration ne
    // s'ouvrait alors jamais.
    onError: (e, id) => {
      if (e.response?.data?.code === 'DEPARTMENT_HAS_MEMBERS') {
        const dept = departments.find((d) => d.id === id);
        if (dept) setMigrationDept(dept);
      }
      toast.error(e.response?.data?.message || 'Erreur');
    },
  });
  const migrateDept = useMutation({
    mutationFn: () => departmentsAPI.migrateAndDeactivate(migrationDept.id, migrationTarget),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Personnel migré et service désactivé');
      setMigrationDept(null); setMigrationTarget(''); invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Migration impossible'),
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
  const updateUser = useMutation({
    mutationFn: ({ id, ...data }) => usersAPI.update(id, data),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Informations mises à jour');
      setUserModal(null); setUserForm({}); invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Modification impossible'),
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
      // `wing` est bien persisté par le serveur (departments.controller.js:139)
      // mais n'était pas relu ici : le champ « Aile / Bâtiment » revenait vide à
      // chaque ouverture, et comme l'update fait un COALESCE, envoyer un champ
      // vide ne l'effaçait pas — la valeur devenait impossible à corriger.
      wing: dept.wing,
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

  const selectedTitle = jobTitles.find((t) => t.id === userForm.jobTitleId);
  const personnelNeedsDept = ROLES_NEED_DEPT.includes(userForm.roleCode)
    || ['medical', 'paramedical'].includes(selectedTitle?.category);
  // Rôle transversal (surveillant général) : aucun service, comme le directeur.
  const roleIsHospitalWide = HOSPITAL_WIDE_ROLES.includes(userForm.roleCode);

  const openEditUser = (staffMember) => {
    const primaryDepartment = (staffMember.departments || []).find((d) => d.isPrimary || d.is_primary)
      || (staffMember.departments || [])[0];
    setUserForm({
      firstName: staffMember.first_name || '',
      lastName: staffMember.last_name || '',
      firstNameAr: staffMember.first_name_ar || '',
      lastNameAr: staffMember.last_name_ar || '',
      email: staffMember.email || '',
      phone: staffMember.phone || '',
      matricule: staffMember.matricule || '',
      grade: staffMember.grade || '',
      preferredLanguage: staffMember.preferred_language || 'fr',
      roleCode: staffMember.role_code || null,
      jobTitleId: staffMember.job_title_id || null,
      secondaryRoleCode: staffMember.secondary_role_code || null,
      departmentId: primaryDepartment?.id || '',
    });
    setUserModal(staffMember);
  };

  const submitUser = () => {
    if (!userForm.firstName || !userForm.lastName || !userForm.email || !userForm.roleCode) {
      return toast.error('Prénom, nom, courriel et rôle ou fonction sont obligatoires');
    }
    if (userForm.roleCode === 'autre' && !userForm.jobTitleId) {
      return toast.error('Veuillez choisir une fonction du personnel.');
    }
    if (personnelNeedsDept && !userForm.departmentId) {
      return toast.error('Le personnel médical ou paramédical doit être affecté à un service.');
    }
    // Le champ service est masqué pour les rôles transversaux, mais il peut
    // rester renseigné si le rôle a été changé après coup : on le neutralise
    // ici, sinon le serveur refuserait la création en 400.
    if (roleIsHospitalWide) {
      const { departmentId: _departmentId, ...rest } = userForm;
      return userModal === 'create'
        ? createUser.mutate(rest)
        : updateUser.mutate({ id: userModal.id, ...rest, departmentId: null });
    }
    if (userModal === 'create') createUser.mutate(userForm);
    else updateUser.mutate({ id: userModal.id, ...userForm });
  };

  /**
   * Le filtre est remis à zéro avant d'appliquer celui demandé : sinon un clic
   * sur « Personnel médical » se cumulerait avec un service resté sélectionné,
   * et la liste ne montrerait pas le nombre annoncé.
   */
  const openStaff = (filter) => {
    setStaffFilter({ ...EMPTY_STAFF_FILTER, ...filter });
    navigate('/director/personnel');
  };

  const openDepartments = (scope) => {
    setDeptScope(scope);
    // La recherche est effacée avec le filtre : une mesure cliquable doit ouvrir
    // exactement l'ensemble qu'elle annonce.
    setDeptSearch('');
    navigate('/director/services');
  };

  // ── Mesures ──────────────────────────────────────────────
  // Les totaux de personnel viennent de `/director/overview`, décomptés en SQL
  // sur tout l'établissement. Ils étaient auparavant dérivés de `staff`,
  // c'est-à-dire de la liste FILTRÉE et plafonnée à 500 lignes : filtrer sur
  // « Urgences » faisait chuter « Personnel total » de 17 à 4. Le repli sur la
  // liste garde un chiffre affiché le temps du premier chargement.
  const totalStaff    = overview?.staff?.total        ?? staff.length;
  const activeStaff   = overview?.staff?.active       ?? staff.filter((u) => u.is_active).length;
  const withLogin     = overview?.staff?.withLogin    ?? staff.filter((u) => u.can_login).length;
  const withoutLogin  = overview?.staff?.withoutLogin;
  const closedStaff   = overview?.staff?.suspended    ?? (staff.length - staff.filter((u) => u.is_active).length);

  // L'encadrement se compte sur la liste réellement affichée par l'onglet
  // Services, et non sur l'agrégat du serveur : une mesure cliquable doit
  // ouvrir un écran dont la longueur est exactement le chiffre annoncé.
  const noHeadCount   = departments.filter(SCOPE_OF.noHead).length;
  const noSupervCount = departments.filter(SCOPE_OF.noSuperv).length;

  const onDutyToday   = overview?.planning?.staffOnDutyToday;
  const coveredToday  = overview?.planning?.departmentsCoveredToday;
  const onLeaveToday  = overview?.leaves?.ongoing;

  // ── Registre des services ────────────────────────────────
  const searchedDepts = useMemo(() => {
    const q = norm(deptSearch);
    if (!q) return departments;
    return departments.filter((d) => {
      const head = `${d.head_first_name || ''} ${d.head_last_name || ''}`;
      const type = DEPT_TYPE_LABELS[d.department_type] || d.department_type || '';
      return [d.name, d.name_ar, d.code, type, head].some((v) => norm(v).includes(q));
    });
  }, [departments, deptSearch]);

  const shownDepts = useMemo(
    () => searchedDepts.filter(SCOPE_OF[deptScope] || SCOPE_OF.all),
    [searchedDepts, deptScope]
  );

  // Le compteur d'un filtre annonce ce qu'il RESTERA après application : il se
  // calcule donc sur l'ensemble déjà cherché, pas sur la liste entière.
  const deptFilters = [
    { id: 'all',      label: 'Tous',             count: searchedDepts.length },
    { id: 'noHead',   label: 'Sans chef',        count: searchedDepts.filter(SCOPE_OF.noHead).length, tone: 'alert', title: 'Un service sans chef ne peut pas produire de planning' },
    { id: 'noSuperv', label: 'Sans surveillant', count: searchedDepts.filter(SCOPE_OF.noSuperv).length },
    { id: 'empty',    label: 'Sans personnel',   count: searchedDepts.filter(SCOPE_OF.empty).length },
  ];

  const deptColumns = [
    {
      key: 'code', label: 'Code', width: 84,
      // Un code de service est un identifiant : il passe au registre comme un
      // matricule, mais reste aligné à gauche — c'est une clé, pas une quantité.
      render: (d) => <span className="gsd-code">{d.code}</span>,
    },
    {
      key: 'name', label: 'Service',
      render: (d) => (
        <div className="gsd-name">
          <b>{d.name}</b>
          {d.name_ar ? <span dir="rtl">{d.name_ar}</span> : null}
        </div>
      ),
    },
    {
      key: 'type', label: 'Type',
      render: (d) => (
        <span className="gsd-word">{DEPT_TYPE_LABELS[d.department_type] || d.department_type || '—'}</span>
      ),
    },
    {
      key: 'where', label: 'Localisation',
      // `wing` était persisté et modifiable, mais ne s'affichait nulle part.
      render: (d) => {
        const parts = [d.floor, d.wing].filter(Boolean);
        return parts.length
          ? <span className="gsd-word">{parts.join(' · ')}</span>
          : <span className="gsd-word is-void">Non renseignée</span>;
      },
    },
    {
      key: 'head', label: 'Chef de service',
      render: (d) => (d.head_id ? (
        <div className="gsd-name">
          <b>{d.head_first_name} {d.head_last_name}</b>
          <span>Chef de service</span>
        </div>
      ) : (
        <button
          type="button"
          className="gsd-fill is-alert"
          onClick={() => { setSelectedUserId(''); setHeadModal(d.id); }}
        >
          <Plus size={11} strokeWidth={2.6} /> Désigner
        </button>
      )),
    },
    {
      key: 'sup', label: 'Surveillants',
      render: (d) => {
        const sup = supervisorsOf(d);
        return (
          <div className="gsd-chips">
            {sup.map((s) => (
              <span key={s.id} className="gsd-chip">
                {s.firstName} {s.lastName}
                <button
                  type="button"
                  className="gsd-chip-off"
                  aria-label={`Retirer ${s.firstName} ${s.lastName} des surveillants`}
                  title="Retirer ce surveillant"
                  onClick={() => {
                    if (window.confirm(`Retirer ${s.firstName} ${s.lastName} des surveillants de « ${d.name} » ?`)) {
                      removeSuperv.mutate({ deptId: d.id, userId: s.id });
                    }
                  }}
                >
                  <X size={10} strokeWidth={2.8} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className="gsd-fill"
              onClick={() => { setSelectedUserId(''); setSupervModal(d.id); }}
            >
              <Plus size={11} strokeWidth={2.6} /> {sup.length ? 'Ajouter' : 'Désigner'}
            </button>
          </div>
        );
      },
    },
    {
      key: 'members', label: 'Effectif', num: true, width: 88,
      render: (d) => Number(d.member_count || 0),
    },
    {
      key: 'acts', label: '', align: 'right',
      render: (d) => (
        <div className="gsd-acts">
          <button type="button" className="gsd-icon-btn" title="Modifier ce service" onClick={() => openEditDept(d)}>
            <Pencil size={13} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="gsd-icon-btn is-danger"
            title="Désactiver ce service"
            onClick={() => {
              if (Number(d.member_count) > 0) { setMigrationDept(d); setMigrationTarget(''); }
              else if (window.confirm(`Désactiver le service « ${d.name} » ?`)) deleteDept.mutate(d.id);
            }}
          >
            <Trash2 size={13} strokeWidth={2} />
          </button>
        </div>
      ),
    },
  ];

  // ── Registre du personnel ────────────────────────────────
  const staffFilterActive = Object.values(staffFilter).some((v) => v !== '');

  const staffColumns = [
    {
      key: 'matricule', label: 'Matricule', width: 104,
      render: (u) => (u.matricule
        ? <span className="gsd-code">{u.matricule}</span>
        : <span className="gsd-word is-void">—</span>),
    },
    {
      key: 'name', label: 'Nom',
      render: (u) => (
        <div className="gsd-name">
          <b>{u.first_name} {u.last_name}</b>
          {u.email ? <span>{u.email}</span> : null}
        </div>
      ),
    },
    {
      key: 'role', label: 'Rôle / Fonction',
      // Sept couleurs de rôle avaient été inventées ici. Un rôle n'est pas un
      // état : la colonne le nomme, le texte suffit.
      render: (u) => (
        <div className="gsd-name">
          <b>{u.role_name || u.role_code || '—'}</b>
          {u.job_title ? <span>{u.job_title}</span> : null}
          {u.secondary_role_name ? (
            <span className="gsd-sub is-seal" title="Rôle métier cumulé avec le titre de chef de service">
              + {u.secondary_role_name}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'depts', label: 'Service(s)',
      render: (u) => {
        const depts = Array.isArray(u.departments) ? u.departments : [];
        if (!depts.length) return <span className="gsd-word is-void">Aucun service</span>;
        return (
          <div className="gsd-chips">
            {depts.map((d) => (
              <span
                key={d.id}
                className="gsd-chip"
                data-head={d.isHead ? '' : undefined}
                title={d.isHead ? `Chef du service ${d.name}` : d.name}
              >
                {d.name}
                {d.isHead ? <i>chef</i> : null}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      key: 'category', label: 'Type du personnel',
      render: (u) => {
        const label = u.personnel_category_label || PERSONNEL_TYPE_LABELS[u.personnel_category];
        return label
          ? <span className="gsd-word">{label}</span>
          : <span className="gsd-word is-void">Non renseigné</span>;
      },
    },
    {
      key: 'access', label: 'Accès',
      render: (u) => (u.can_login
        ? <span className="gsd-word">Plateforme</span>
        : <span className="gsd-word is-void">Sans accès</span>),
    },
    {
      key: 'state', label: 'Statut',
      render: (u) => (
        <GsBadge tone={u.is_active ? 'duty' : 'quiet'} dot>
          {u.is_active ? 'Actif' : 'Clôturé'}
        </GsBadge>
      ),
    },
    {
      key: 'acts', label: '', align: 'right',
      render: (u) => (
        <div className="gsd-acts">
          <button type="button" className="gs-btn is-quiet" onClick={() => openEditUser(u)}>
            <Pencil size={12} strokeWidth={2} /> Modifier
          </button>
          {u.id !== user?.id && (u.is_active ? (
            <button
              type="button"
              className="gs-btn is-danger"
              onClick={() => {
                if (window.confirm(`Clôturer le compte de ${u.first_name} ${u.last_name} ?`)) deactivate.mutate(u.id);
              }}
            >
              Clôturer
            </button>
          ) : (
            <button type="button" className="gs-btn is-quiet" onClick={() => activate.mutate(u.id)}>
              <RotateCcw size={12} strokeWidth={2} /> Réactiver
            </button>
          ))}
        </div>
      ),
    },
  ];

  const currentSupervisors = supervisorsOf(departments.find((d) => d.id === supervModal));

  return (
    <div className="gsd-wrap">
      {/* Appartenance — hôpital dirigé et service(s) de rattachement. */}
      <ContextBadge variant="header" />

      {/* Le nom de l'hôpital n'est pas répété dans le surtitre : le badge de
          contexte et la barre latérale le portent déjà. */}
      <GsPageHeader
        eyebrow="Direction · tous les services"
        title="Gestion de l'hôpital"
        subtitle="Cet écran administre l'organisation — services, encadrement, comptes et congés. La garde du jour se surveille depuis « Supervision de l'hôpital »."
        meta={[
          { key: 'jour', label: 'Journée du', value: fullFrenchDate(todayKey()) },
          { key: 'dir', label: 'Directeur', value: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || '—' },
        ]}
        rail={(
          <GsStatRail>
            <GsStat
              label="Services"
              value={loadingDepts ? null : departments.length}
              tone="seal"
              onClick={() => openDepartments('all')}
              title="Ouvrir le registre des services"
            />
            <GsStat
              label="Sans chef"
              value={loadingDepts ? null : noHeadCount}
              tone={noHeadCount > 0 ? 'alert' : undefined}
              hint="Ne peuvent pas produire de planning"
              onClick={() => openDepartments('noHead')}
            />
            <GsStat
              label="Sans surveillant"
              value={loadingDepts ? null : noSupervCount}
              onClick={() => openDepartments('noSuperv')}
            />
            <GsStat
              label="Personnel"
              value={totalStaff}
              hint={`${activeStaff} actifs`}
              onClick={() => openStaff({})}
            />
            <GsStat
              label="Comptes plateforme"
              value={withLogin}
              hint={withoutLogin === undefined ? undefined : `${withoutLogin} sans accès`}
              onClick={() => openStaff({ canLogin: 'true' })}
            />
            <GsStat
              label="Comptes clôturés"
              value={closedStaff}
              onClick={() => openStaff({ isActive: 'false' })}
            />
            {/* Lu sur le tableur, pas sur la table `shifts` : c'est le même
                décompte que « Supervision de l'hôpital ». Non cliquable — aucun
                écran de cette page n'ouvre exactement cette liste. */}
            <GsStat
              label="De service aujourd'hui"
              value={onDutyToday}
              tone="duty"
              unit="agents"
              hint={coveredToday === undefined ? undefined : `${coveredToday} service(s) couvert(s) sur ${departments.length}`}
            />
            <GsStat label="En congé aujourd'hui" value={onLeaveToday} hint="Absences en cours" />
          </GsStatRail>
        )}
      >
        <GsTabRail
          label="Sections de la direction"
          tabs={TABS}
          value={activeTab}
          onChange={(id) => {
            const tab = TABS.find((t) => t.id === id);
            if (tab) navigate(tab.path);
          }}
        />
      </GsPageHeader>

      <div className="gsd-tab-body">
        {/* ══ VUE D'ENSEMBLE ══ */}
        {activeTab === 'overview' && (
          <DirectorOverviewPanel
            onGoTo={(path) => navigate(path)}
            onOpenStaff={openStaff}
            onDesignateHead={(id) => { setSelectedUserId(''); setHeadModal(id); }}
            onDesignateSuperv={(id) => { setSelectedUserId(''); setSupervModal(id); }}
          />
        )}

        {/* ══ SERVICES ══ */}
        {activeTab === 'departments' && (
          <GsPanel
            flush
            icon={<Building2 size={14} strokeWidth={2} />}
            title="Registre des services"
            sub="Un service sans chef ne peut pas produire de planning ; un service peut compter plusieurs surveillants."
            tools={(
              <button type="button" className="gs-btn is-primary" onClick={() => { setDeptForm({}); setDeptModal('create'); }}>
                <Plus size={13} strokeWidth={2.4} /> Nouveau service
              </button>
            )}
          >
            <GsFilterBar
              inset
              label="Restreindre les services"
              filters={deptFilters}
              value={deptScope}
              onChange={setDeptScope}
              search={{
                value: deptSearch,
                onChange: setDeptSearch,
                placeholder: 'Nom, code, type ou chef',
                label: 'Rechercher un service',
              }}
            />

            {loadingDepts ? (
              <div className="gsd-load"><GsSkeleton variant="rows" count={4} /></div>
            ) : (
              <GsTable
                label="Services de l'hôpital"
                columns={deptColumns}
                rows={shownDepts}
                rowKey="id"
                flagged={(d) => !d.head_id}
                empty={departments.length === 0 ? (
                  <div className="gsd-load">
                    <GsEmpty
                      icon={<Building2 size={24} strokeWidth={1.6} />}
                      title="Aucun service dans cet hôpital"
                      hint="Tant qu'aucun service n'existe, aucun planning de garde ne peut être créé."
                      actions={(
                        <button type="button" className="gs-btn is-primary" onClick={() => { setDeptForm({}); setDeptModal('create'); }}>
                          Créer le premier service
                        </button>
                      )}
                    />
                  </div>
                ) : (
                  <div className="gsd-load">
                    <GsEmpty
                      title="Aucun service ne correspond"
                      hint={`${departments.length} service(s) existent, mais aucun ne passe le filtre et la recherche en cours.`}
                      actions={(
                        <button type="button" className="gs-btn is-quiet" onClick={() => { setDeptScope('all'); setDeptSearch(''); }}>
                          <RotateCcw size={13} strokeWidth={2} /> Tout afficher
                        </button>
                      )}
                    />
                  </div>
                )}
              />
            )}
          </GsPanel>
        )}

        {/* ══ PERSONNEL ══ */}
        {activeTab === 'staff' && (
          <GsPanel
            flush
            icon={<Users size={14} strokeWidth={2} />}
            title="Registre du personnel"
            sub="Un compte clôturé reste consultable : l'historique d'un agent ne s'efface pas."
            tools={(
              <button type="button" className="gs-btn is-primary" onClick={() => { setUserForm({}); setUserModal('create'); }}>
                <UserPlus size={13} strokeWidth={2.2} /> Nouveau compte
              </button>
            )}
          >
            <div className="gsd-filters">
              <label className="gsd-field">
                <span>Recherche</span>
                <input
                  type="search"
                  className="form-control"
                  placeholder="Nom, matricule ou courriel"
                  value={staffFilter.search}
                  onChange={(e) => setStaffFilter((f) => ({ ...f, search: e.target.value }))}
                />
              </label>
              <label className="gsd-field">
                <span>Rôle d'accès</span>
                <select
                  className="form-control"
                  value={staffFilter.roleCode}
                  onChange={(e) => setStaffFilter((f) => ({ ...f, roleCode: e.target.value }))}
                >
                  <option value="">Tous les rôles</option>
                  {availableRoles.map((r) => <option key={r.id} value={r.code}>{r.name}</option>)}
                </select>
              </label>
              <label className="gsd-field">
                <span>Type du personnel</span>
                <select
                  className="form-control"
                  value={staffFilter.personnelType || ''}
                  onChange={(e) => setStaffFilter((f) => ({ ...f, personnelType: e.target.value }))}
                >
                  <option value="">Tous les types</option>
                  <option value="medical">Personnel médical</option>
                  <option value="administrative">Personnel administratif</option>
                  <option value="auxiliary">Personnel auxiliaire</option>
                </select>
              </label>
              <label className="gsd-field">
                <span>Service</span>
                <select
                  className="form-control"
                  value={staffFilter.departmentId}
                  onChange={(e) => setStaffFilter((f) => ({ ...f, departmentId: e.target.value }))}
                >
                  <option value="">Tous les services</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="gsd-field">
                <span>Statut</span>
                <select
                  className="form-control"
                  value={staffFilter.isActive}
                  onChange={(e) => setStaffFilter((f) => ({ ...f, isActive: e.target.value }))}
                >
                  <option value="">Tous statuts</option>
                  <option value="true">Actifs</option>
                  <option value="false">Clôturés</option>
                </select>
              </label>
              {/* Accès plateforme : la vue d'ensemble ouvre cet onglet avec ce
                  filtre déjà posé. Sans ce sélecteur, le directeur verrait une
                  liste restreinte sans savoir pourquoi ni comment revenir. */}
              <label className="gsd-field">
                <span>Accès plateforme</span>
                <select
                  className="form-control"
                  value={staffFilter.canLogin}
                  onChange={(e) => setStaffFilter((f) => ({ ...f, canLogin: e.target.value }))}
                >
                  <option value="">Tous accès</option>
                  <option value="true">Avec accès</option>
                  <option value="false">Sans accès</option>
                </select>
              </label>
              <div className="gsd-filters-reset">
                <button
                  type="button"
                  className="gs-btn is-quiet"
                  disabled={!staffFilterActive}
                  onClick={() => setStaffFilter(EMPTY_STAFF_FILTER)}
                >
                  <RotateCcw size={13} strokeWidth={2} /> Réinitialiser
                </button>
              </div>
            </div>

            {loadingStaff ? (
              <div className="gsd-load"><GsSkeleton variant="rows" count={5} /></div>
            ) : (
              <GsTable
                label="Personnel de l'hôpital"
                columns={staffColumns}
                rows={staff}
                rowKey="id"
                empty={(
                  <div className="gsd-load">
                    <GsEmpty
                      icon={<Users size={24} strokeWidth={1.6} />}
                      title={staffFilterActive ? 'Aucun agent ne correspond' : 'Aucun compte enregistré'}
                      hint={staffFilterActive
                        ? `Sur ${totalStaff} agent(s) de l'hôpital, aucun ne passe les filtres en cours.`
                        : "Créez le premier compte pour que l'hôpital puisse produire des plannings."}
                      actions={staffFilterActive ? (
                        <button type="button" className="gs-btn is-quiet" onClick={() => setStaffFilter(EMPTY_STAFF_FILTER)}>
                          <RotateCcw size={13} strokeWidth={2} /> Réinitialiser les filtres
                        </button>
                      ) : (
                        <button type="button" className="gs-btn is-primary" onClick={() => { setUserForm({}); setUserModal('create'); }}>
                          Créer un compte
                        </button>
                      )}
                    />
                  </div>
                )}
              />
            )}
          </GsPanel>
        )}

        {/* ══ CONGÉS ══ */}
        {activeTab === 'conges' && <LeavesPanel />}

        {/* ══ CALENDRIER (lecture seule) ══ */}
        {activeTab === 'calendrier' && (
          <div className="gsd-section">
            <p className="gsd-note">
              Lecture seule, sur les tableurs de garde de tous les services de l'hôpital.
              Les affectations se modifient dans le service qui les a produites.
            </p>
            <HospitalGuardCalendar title="Calendrier des gardes de l'hôpital" />
          </div>
        )}

        {/* ══ STATISTIQUES ══ */}
        {activeTab === 'stats' && (
          <div className="gsd-section">
            <ScopedStatsPanel title="Statistiques de l'hôpital" />
          </div>
        )}

        {/* ══ PRÊTS DE PERSONNEL ══ */}
        {activeTab === 'loan-stats' && (
          <div className="gsd-section">
            <p className="gsd-note">
              Vue de l'établissement. La décision sur un prêt appartient au chef du service
              qui prête : elle se prend depuis « Prêts de personnel ».
            </p>
            <StaffLoanStatsPanel title="Prêts de personnel — statistiques de l'hôpital" />
          </div>
        )}

        {/* ══ HISTORIQUE (immuable) ══ */}
        {activeTab === 'historique' && <StaffHistoryPanel />}
      </div>

      {/* ══ MODALE : créer / modifier un service ══ */}
      {deptModal && (
        <DirModal
          wide
          title={deptModal === 'create' ? 'Nouveau service' : `Modifier — ${deptModal.name}`}
          onClose={() => { setDeptModal(null); setDeptForm({}); }}
          footer={(
            <>
              <button type="button" className="gs-btn is-quiet" onClick={() => { setDeptModal(null); setDeptForm({}); }}>
                Annuler
              </button>
              <button
                type="button"
                className="gs-btn is-primary"
                onClick={submitDept}
                disabled={createDept.isPending || updateDept.isPending}
              >
                {(createDept.isPending || updateDept.isPending) ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </>
          )}
        >
          <div className="gsd-modal-grid">
            <Fld label="Code" required hint={deptModal !== 'create' ? 'Le code ne se modifie pas après création.' : undefined}>
              <input
                className="form-control"
                value={deptForm.code || ''}
                onChange={(e) => setDeptForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="URG, CHI, MED…"
                disabled={deptModal !== 'create'}
              />
            </Fld>
            <Fld label="Type">
              <select
                className="form-control"
                value={deptForm.departmentType || 'other'}
                onChange={(e) => setDeptForm((f) => ({ ...f, departmentType: e.target.value }))}
              >
                <option value="emergency">Urgences</option>
                <option value="surgery">Chirurgie</option>
                <option value="icu">Réanimation</option>
                <option value="internal">Médecine interne</option>
                <option value="pediatrics">Pédiatrie</option>
                <option value="radiology">Radiologie</option>
                <option value="other">Autre</option>
              </select>
            </Fld>
            <Fld label="Nom (français)" required>
              <input
                className="form-control"
                value={deptForm.name || ''}
                onChange={(e) => setDeptForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Urgences"
              />
            </Fld>
            <Fld label="Nom (arabe)">
              <input
                className="form-control"
                dir="rtl"
                value={deptForm.nameAr || ''}
                onChange={(e) => setDeptForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="المستعجلات"
              />
            </Fld>
            <Fld label="Étage">
              <input
                className="form-control"
                value={deptForm.floor || ''}
                onChange={(e) => setDeptForm((f) => ({ ...f, floor: e.target.value }))}
                placeholder="RDC, 1er, 2e…"
              />
            </Fld>
            <Fld label="Aile / Bâtiment">
              <input
                className="form-control"
                value={deptForm.wing || ''}
                onChange={(e) => setDeptForm((f) => ({ ...f, wing: e.target.value }))}
                placeholder="Bâtiment A…"
              />
            </Fld>
            <Fld label="Téléphone">
              <input
                className="form-control"
                value={deptForm.phone || ''}
                onChange={(e) => setDeptForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+216 71 …"
              />
            </Fld>
            <Fld label="Nombre de lits">
              <input
                type="number"
                min="0"
                className="form-control"
                value={deptForm.bedCount || ''}
                onChange={(e) => setDeptForm((f) => ({ ...f, bedCount: e.target.value }))}
              />
            </Fld>
            <Fld label="Gardes minimum par jour" hint="Sert de seuil aux contrôles du tableur.">
              <input
                type="number"
                min="1"
                max="20"
                className="form-control"
                value={deptForm.minGuardCount || 1}
                onChange={(e) => setDeptForm((f) => ({ ...f, minGuardCount: e.target.value }))}
              />
            </Fld>
          </div>
        </DirModal>
      )}

      {/* ══ MODALE : désigner le chef de service ══ */}
      {headModal && (
        <DirModal
          title="Désigner le chef de service"
          onClose={() => setHeadModal(null)}
          footer={(
            <>
              <button type="button" className="gs-btn is-quiet" onClick={() => setHeadModal(null)}>Annuler</button>
              <button
                type="button"
                className="gs-btn is-primary"
                disabled={!selectedUserId || setHead.isPending}
                onClick={() => { setHead.mutate({ deptId: headModal, userId: selectedUserId }); setSelectedUserId(''); }}
              >
                {setHead.isPending ? 'En cours…' : 'Confirmer'}
              </button>
            </>
          )}
        >
          <div className="gsd-rule is-seal">
            <Info size={14} strokeWidth={2} aria-hidden="true" />
            <p>
              Un service n'a qu'<strong>un seul chef</strong>. Le rôle de la personne choisie est
              mis à jour automatiquement, et elle devient responsable des plannings du service.
            </p>
          </div>

          <Fld label="Personnel du service" required>
            <select className="form-control" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
              <option value="">— Choisir —</option>
              {deptCandidates(deptDetail?.members).map((m) => (
                <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.role_name})</option>
              ))}
            </select>
          </Fld>

          {!deptDetail?.members?.length && (
            <div className="gsd-rule is-alert">
              <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
              <p>
                Ce service n'a encore <strong>aucun membre</strong> : affectez d'abord du personnel
                depuis le registre du personnel, puis revenez désigner son chef.
              </p>
            </div>
          )}
        </DirModal>
      )}

      {/* ══ MODALE : désigner un surveillant ══ */}
      {supervModal && (
        <DirModal
          title="Désigner un surveillant de service"
          onClose={() => setSupervModal(null)}
          footer={(
            <>
              <button type="button" className="gs-btn is-quiet" onClick={() => setSupervModal(null)}>Annuler</button>
              <button
                type="button"
                className="gs-btn is-primary"
                disabled={!selectedUserId || setSuperv.isPending}
                onClick={() => { setSuperv.mutate({ deptId: supervModal, userId: selectedUserId }); setSelectedUserId(''); }}
              >
                {setSuperv.isPending ? 'En cours…' : 'Confirmer'}
              </button>
            </>
          )}
        >
          <div className="gsd-rule is-seal">
            <Info size={14} strokeWidth={2} aria-hidden="true" />
            <p>
              Un service peut compter <strong>plusieurs surveillants</strong>. Désigner une personne
              ici l'<strong>ajoute</strong> à la liste sans retirer le rôle aux surveillants en place —
              le retrait se fait depuis le registre des services.
            </p>
          </div>

          {currentSupervisors.length > 0 && (
            <div className="gsd-standing">
              <span>Surveillants actuels ({currentSupervisors.length})</span>
              <div className="gsd-chips">
                {currentSupervisors.map((s) => (
                  <span key={s.id} className="gsd-chip">{s.firstName} {s.lastName}</span>
                ))}
              </div>
            </div>
          )}

          <Fld label="Personnel du service" required>
            <select className="form-control" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
              <option value="">— Choisir —</option>
              {deptCandidates(deptDetail?.members).map((m) => (
                <option key={m.id} value={m.id}>{m.first_name} {m.last_name} ({m.role_name})</option>
              ))}
            </select>
          </Fld>
        </DirModal>
      )}

      {/* ══ MODALE : créer / modifier un compte ══ */}
      {userModal && (
        <DirModal
          wide
          title={userModal === 'create' ? 'Créer un compte' : `Modifier — ${userModal.first_name} ${userModal.last_name}`}
          onClose={() => { setUserModal(null); setUserForm({}); }}
          footer={(
            <>
              <button type="button" className="gs-btn is-quiet" onClick={() => { setUserModal(null); setUserForm({}); }}>
                Annuler
              </button>
              <button
                type="button"
                className="gs-btn is-primary"
                onClick={submitUser}
                disabled={createUser.isPending || updateUser.isPending}
              >
                {userModal === 'create'
                  ? (createUser.isPending ? 'Création…' : 'Créer le compte')
                  : (updateUser.isPending ? 'Enregistrement…' : 'Enregistrer')}
              </button>
            </>
          )}
        >
          {userModal === 'create' && (
            <div className="gsd-rule is-seal">
              <Info size={14} strokeWidth={2} aria-hidden="true" />
              <div>
                <p>
                  Choisissez un <strong>rôle d'accès</strong> pour ouvrir un compte sur la plateforme,
                  ou une <strong>fonction du personnel</strong> (ambulancier, ORL, pharmacien…) pour
                  inscrire un agent sans accès.
                </p>
                <p>Mot de passe initial : <strong>GardeSante@2025</strong>.</p>
              </div>
            </div>
          )}

          <div className="gsd-modal-grid">
            <Fld label="Prénom" required>
              <input className="form-control" value={userForm.firstName || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, firstName: e.target.value }))} />
            </Fld>
            <Fld label="Nom" required>
              <input className="form-control" value={userForm.lastName || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, lastName: e.target.value }))} />
            </Fld>
            <Fld label="Prénom (arabe)">
              <input className="form-control" dir="rtl" value={userForm.firstNameAr || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, firstNameAr: e.target.value }))} />
            </Fld>
            <Fld label="Nom (arabe)">
              <input className="form-control" dir="rtl" value={userForm.lastNameAr || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, lastNameAr: e.target.value }))} />
            </Fld>
            <Fld label="Courriel" required>
              <input type="email" className="form-control" value={userForm.email || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))} />
            </Fld>
            <Fld label="Téléphone">
              <input className="form-control" value={userForm.phone || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, phone: e.target.value }))} />
            </Fld>
            <Fld label="Matricule">
              <input className="form-control" value={userForm.matricule || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, matricule: e.target.value }))} />
            </Fld>
            <Fld label="Grade">
              <input className="form-control" value={userForm.grade || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, grade: e.target.value }))} />
            </Fld>
            <Fld label="Langue de l'interface">
              <select
                className="form-control"
                value={userForm.preferredLanguage || 'fr'}
                onChange={(e) => setUserForm((f) => ({ ...f, preferredLanguage: e.target.value }))}
              >
                <option value="fr">Français</option>
                <option value="ar">العربية</option>
              </select>
            </Fld>
          </div>

          {/* Rôle d'accès + fonction du personnel — champ unifié avec recherche */}
          <div className="gsd-field">
            <span>Rôle d'accès ou fonction du personnel<b className="gsd-req">*</b></span>
            <UnifiedRoleSelect
              roleCode={userForm.roleCode || null}
              jobTitleId={userForm.jobTitleId || null}
              currentRole={userModal !== 'create' ? { code: userModal.role_code, name: userModal.role_name } : null}
              required
              onChange={({ roleCode: rc, jobTitleId: jid }) => {
                setUserForm((f) => ({
                  ...f,
                  roleCode: rc || null,
                  jobTitleId: jid || null,
                  // Changer le rôle principal invalide un éventuel rôle secondaire
                  secondaryRoleCode: rc === 'department_head' ? f.secondaryRoleCode : null,
                }));
              }}
            />
            {userForm.roleCode === 'autre' && !userForm.jobTitleId && (
              <small className="gsd-hint is-alert">
                Choisissez une fonction du personnel (ambulancier, médecin interne…).
              </small>
            )}
          </div>

          {/* « Chef de service » est un TITRE, pas un métier : on garde la
              possibilité de cumuler le titre avec un vrai rôle métier. */}
          {userForm.roleCode === 'department_head' && (
            <div className="gsd-rule">
              <Info size={14} strokeWidth={2} aria-hidden="true" />
              <div>
                <p>
                  <strong>« Chef de service » est un titre, pas un métier.</strong> Vous pouvez
                  indiquer le rôle métier réel de cette personne — par exemple un médecin sénior qui
                  est chef de service. Ce rôle secondaire n'ouvre aucun accès supplémentaire.
                </p>
                <label className="gsd-rule-field">
                  <select
                    className="form-control"
                    value={userForm.secondaryRoleCode || ''}
                    onChange={(e) => setUserForm((f) => ({ ...f, secondaryRoleCode: e.target.value || null }))}
                  >
                    <option value="">— Aucun rôle secondaire —</option>
                    {(secondaryRoles || []).map((r) => (
                      <option key={r.id} value={r.code}>{r.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* Service — masqué pour les rôles transversaux : le surveillant
              général couvre tout l'hôpital, comme le directeur. */}
          {roleIsHospitalWide ? (
            <div className="gsd-rule is-seal">
              <Info size={14} strokeWidth={2} aria-hidden="true" />
              <p>
                Le <strong>surveillant général</strong> couvre l'hôpital entier, comme le directeur :
                il n'est rattaché à <strong>aucun service</strong>.
              </p>
            </div>
          ) : (
            <Fld
              label={personnelNeedsDept ? 'Service' : 'Service (optionnel)'}
              required={personnelNeedsDept}
              hint={personnelNeedsDept
                ? 'Ce rôle exige un service. Un seul chef par service, mais plusieurs surveillants sont possibles.'
                : undefined}
              hintTone={personnelNeedsDept && !userForm.departmentId ? 'alert' : undefined}
            >
              <select
                className="form-control"
                value={userForm.departmentId || ''}
                onChange={(e) => setUserForm((f) => ({ ...f, departmentId: e.target.value }))}
              >
                <option value="">— Choisir un service —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Fld>
          )}
        </DirModal>
      )}

      {/* ══ MODALE : migrer le personnel avant désactivation ══ */}
      {migrationDept && (
        <DirModal
          title={`Migrer le personnel de ${migrationDept.name}`}
          onClose={() => setMigrationDept(null)}
          footer={(
            <>
              <button type="button" className="gs-btn is-quiet" onClick={() => setMigrationDept(null)}>Annuler</button>
              <button
                type="button"
                className="gs-btn is-danger"
                disabled={!migrationTarget || migrateDept.isPending}
                onClick={() => migrateDept.mutate()}
              >
                {migrateDept.isPending ? 'Migration…' : 'Migrer et désactiver'}
              </button>
            </>
          )}
        >
          <div className="gsd-rule is-alert">
            <AlertTriangle size={14} strokeWidth={2} aria-hidden="true" />
            <p>
              Ce service compte <strong>{migrationDept.member_count}</strong> agent(s). Ils doivent
              tous être affectés à un autre service avant la désactivation — aucun agent ne reste
              sans service.
            </p>
          </div>

          <Fld label="Service de destination" required>
            <select className="form-control" value={migrationTarget} onChange={(e) => setMigrationTarget(e.target.value)}>
              <option value="">— Choisir le service cible —</option>
              {departments.filter((d) => d.id !== migrationDept.id).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Fld>
        </DirModal>
      )}
    </div>
  );
}
