import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Ambulance,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  Filter,
  GripVertical,
  Hash,
  Layers3,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Stethoscope,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { schedulesAPI } from '../../../api';
import Avatar from '../../../components/common/Avatar';
import './HospitalStaffPicker.css';

const PAGE_SIZE = 500;
const MAX_STAFF = 5000;
const EMPTY_STAFF = [];

const CATEGORY_META = {
  medical: { label: 'Personnel médical', shortLabel: 'Médical', icon: Stethoscope },
  auxiliary: { label: 'Personnel auxiliaire', shortLabel: 'Auxiliaire', icon: Ambulance },
  administrative: { label: 'Personnel administratif', shortLabel: 'Administratif', icon: BriefcaseBusiness },
  unknown: { label: 'Type à renseigner', shortLabel: 'À renseigner', icon: AlertCircle },
};

const QUICK_FILTERS = [
  { id: 'all', label: 'Tout', icon: UsersRound },
  { id: 'own', label: 'Mon service', icon: Building2 },
  { id: 'other', label: 'Autres services', icon: Layers3 },
  { id: 'medical', label: 'Médical', icon: Stethoscope },
  { id: 'auxiliary', label: 'Auxiliaire', icon: Ambulance },
  { id: 'administrative', label: 'Administratif', icon: BriefcaseBusiness },
];

const frenchCollator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr')
  .trim();

const getCategory = (member = {}) => {
  const category = member.personnel_category || member.personnelCategory;
  return CATEGORY_META[category] ? category : 'unknown';
};

const getFunctionName = (member = {}) => {
  const candidates = [
    member.function_name,
    member.functionName,
    member.job_title,
    member.jobTitle,
    member.secondary_role_name,
    member.secondaryRoleName,
    member.role_name,
    member.roleName,
  ];
  return candidates.find((value) => typeof value === 'string' && value.trim())?.trim()
    || 'Fonction à renseigner';
};

const getTechnicalRole = (member = {}) => member.role_name || member.roleName || '';

const getJobTitleId = (member = {}) => member.job_title_id || member.jobTitleId || null;

const getDepartments = (member = {}) => {
  if (Array.isArray(member.departments) && member.departments.length) {
    return member.departments.filter((department) => department?.id || department?.name);
  }
  if (member.dept_id || member.deptId || member.dept_name || member.deptName) {
    return [{
      id: member.dept_id || member.deptId || null,
      name: member.dept_name || member.deptName || 'Service non renseigné',
      isPrimary: true,
    }];
  }
  return [];
};

const getPrimaryDepartment = (member = {}) => {
  const departments = getDepartments(member);
  return departments.find((department) => department.isPrimary || department.is_primary)
    || departments[0]
    || null;
};

const belongsToDepartment = (member, departmentId) => {
  if (!departmentId) return false;
  if (member.belongs_to_priority_department === true || member.belongsToPriorityDepartment === true) return true;
  return getDepartments(member).some((department) => department.id === departmentId);
};

const requiresLoan = (member, ownDeptId) => {
  if (typeof member.requires_loan === 'boolean') return member.requires_loan;
  if (typeof member.requiresLoan === 'boolean') return member.requiresLoan;
  const departments = getDepartments(member);
  return Boolean(ownDeptId && departments.length && !belongsToDepartment(member, ownDeptId));
};

const compareMembers = (left, right) => {
  const functionComparison = frenchCollator.compare(getFunctionName(left), getFunctionName(right));
  if (functionComparison) return functionComparison;
  const lastNameComparison = frenchCollator.compare(
    left.last_name || left.lastName || '',
    right.last_name || right.lastName || '',
  );
  if (lastNameComparison) return lastNameComparison;
  return frenchCollator.compare(left.first_name || left.firstName || '', right.first_name || right.firstName || '');
};

const unwrapStaffResponse = (response) => {
  const payload = response?.data || {};
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return { rows, total: Number(payload.total ?? rows.length) };
};

async function fetchAllHospitalStaff(ownDeptId) {
  const staff = [];
  let offset = 0;
  let total = 0;

  do {
    const response = await schedulesAPI.getHospitalStaff({
      priorityDeptId: ownDeptId || undefined,
      limit: PAGE_SIZE,
      offset,
    });
    const page = unwrapStaffResponse(response);
    total = page.total;
    staff.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length < PAGE_SIZE || page.rows.length === 0) break;
  } while (staff.length < total && staff.length < MAX_STAFF);

  const uniqueStaff = [...new Map(staff.map((member) => [member.id, member])).values()];
  return {
    staff: uniqueStaff.slice(0, MAX_STAFF),
    total,
    truncated: uniqueStaff.length < total,
  };
}

function CategoryBadge({ category }) {
  const meta = CATEGORY_META[category] || CATEGORY_META.unknown;
  const Icon = meta.icon;
  return (
    <span className={`hsp-category hsp-category--${category}`}>
      <Icon size={12} aria-hidden="true" />
      {meta.shortLabel}
    </span>
  );
}

function StaffCard({ member, ownDeptId, ownDeptName, onSelect, onDragStart, justAdded, index }) {
  const firstName = member.first_name || member.firstName || '';
  const lastName = member.last_name || member.lastName || '';
  const fullName = `${lastName} ${firstName}`.trim() || 'Personnel sans nom';
  const functionName = getFunctionName(member);
  const technicalRole = getTechnicalRole(member);
  const category = getCategory(member);
  const departments = getDepartments(member);
  const primaryDepartment = getPrimaryDepartment(member);
  const isOwn = belongsToDepartment(member, ownDeptId);
  const isExternal = requiresLoan(member, ownDeptId);
  const serviceName = isOwn
    ? (ownDeptName || primaryDepartment?.name || 'Votre service')
    : (primaryDepartment?.name || 'Sans service');
  const extraDepartmentCount = Math.max(departments.length - 1, 0);
  const showTechnicalRole = technicalRole && normalizeText(technicalRole) !== normalizeText(functionName);

  const normalizedMember = { ...member, function_name: functionName };
  const handleDragStart = (event) => {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/json', JSON.stringify(normalizedMember));
    event.dataTransfer.setData('text/plain', `staff:${member.id}`);
    onDragStart?.(normalizedMember);
  };

  return (
    <button
      type="button"
      className={`hsp-staff-card${justAdded ? ' is-added' : ''}`}
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelect?.(normalizedMember)}
      aria-label={`Ajouter ${fullName}, ${functionName}`}
      style={{ '--hsp-item-index': Math.min(index, 10) }}
    >
      <span className="hsp-staff-card__drag" title="Glisser vers le tableur" aria-hidden="true">
        <GripVertical size={16} />
      </span>
      <Avatar
        avatarUrl={member.avatar_url || member.avatarUrl}
        firstName={firstName}
        lastName={lastName}
        size="md"
        className="hsp-staff-card__avatar"
      />
      <span className="hsp-staff-card__content">
        <span className="hsp-staff-card__identity">
          <span className="hsp-staff-card__name" title={fullName}>{fullName}</span>
          {isExternal && <span className="hsp-loan-badge">Autre service</span>}
          {member.is_on_leave && <span className="hsp-leave-badge">En congé</span>}
        </span>
        <span className="hsp-staff-card__function" title={functionName}>
          <BadgeCheck size={15} aria-hidden="true" />
          {functionName}
        </span>
        <span className="hsp-staff-card__metadata">
          <CategoryBadge category={category} />
          <span className="hsp-metadata-item" title={departments.map((department) => department.name).join(', ')}>
            <Building2 size={12} aria-hidden="true" />
            <span>{serviceName}</span>
            {extraDepartmentCount > 0 && <strong>+{extraDepartmentCount}</strong>}
          </span>
          {member.matricule && (
            <span className="hsp-metadata-item hsp-metadata-item--matricule">
              <Hash size={12} aria-hidden="true" />
              {member.matricule}
            </span>
          )}
        </span>
        {showTechnicalRole && <span className="hsp-access-role">Accès plateforme : {technicalRole}</span>}
      </span>
      <span className="hsp-staff-card__add" title="Ajouter au planning" aria-hidden="true">
        {justAdded ? <Check size={17} /> : <Plus size={17} />}
      </span>
    </button>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, count, tone, priority = false }) {
  return (
    <div className={`hsp-section__header hsp-section__header--${tone}`}>
      <span className="hsp-section__icon"><Icon size={17} aria-hidden="true" /></span>
      <span className="hsp-section__heading">
        <span className="hsp-section__title-row">
          <strong>{title}</strong>
          {priority && <span className="hsp-priority-badge"><CheckCircle2 size={12} /> Prioritaire</span>}
        </span>
        {subtitle && <span>{subtitle}</span>}
      </span>
      <span className="hsp-section__count">{count}</span>
    </div>
  );
}

function StaffList({ members, ...cardProps }) {
  const justAddedId = cardProps.justAdded;
  return (
    <div className="hsp-staff-list">
      {members.map((member, index) => (
        <StaffCard
          key={member.id}
          member={member}
          index={index}
          {...cardProps}
          justAdded={justAddedId === member.id}
        />
      ))}
    </div>
  );
}

export default function HospitalStaffPicker({
  open,
  onClose,
  onSelect,
  onDragStart,
  ownDeptId,
  title = 'Ajouter du personnel',
  excludeUserIds = [],
  requiredJobTitleId = null,
  requiredFunctionName = '',
}) {
  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [functionFilter, setFunctionFilter] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [sessionAddedIds, setSessionAddedIds] = useState(() => new Set());
  const [lastAddedId, setLastAddedId] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);

  const staffQuery = useQuery({
    queryKey: ['hospital-staff-picker', ownDeptId || 'all'],
    queryFn: () => fetchAllHospitalStaff(ownDeptId),
    enabled: open,
    staleTime: 60000,
    retry: 1,
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setSessionAddedIds(new Set());
    setLastAddedId(null);
    setAnnouncement('');

    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 80);
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setFunctionFilter('');
  }, [open, requiredJobTitleId, requiredFunctionName]);

  useEffect(() => () => window.clearTimeout(feedbackTimerRef.current), []);

  const rawStaff = staffQuery.data?.staff || EMPTY_STAFF;
  const excludeSet = useMemo(() => {
    const values = excludeUserIds instanceof Set ? [...excludeUserIds] : (excludeUserIds || []);
    return new Set(values);
  }, [excludeUserIds]);

  const ownDeptName = useMemo(() => {
    for (const member of rawStaff) {
      const ownDepartment = getDepartments(member).find((department) => department.id === ownDeptId);
      if (ownDepartment?.name) return ownDepartment.name;
    }
    return '';
  }, [rawStaff, ownDeptId]);

  const availableStaff = useMemo(() => rawStaff.filter((member) => {
    if (excludeSet.has(member.id) || sessionAddedIds.has(member.id)) return false;
    if (requiredJobTitleId) return String(getJobTitleId(member) || '') === String(requiredJobTitleId);
    if (requiredFunctionName) {
      return normalizeText(getFunctionName(member)) === normalizeText(requiredFunctionName);
    }
    return true;
  }), [rawStaff, excludeSet, sessionAddedIds, requiredJobTitleId, requiredFunctionName]);

  const departmentOptions = useMemo(() => {
    const departments = new Map();
    availableStaff.forEach((member) => {
      getDepartments(member).forEach((department) => {
        if (department.id) departments.set(department.id, department.name || 'Service sans nom');
      });
    });
    return [...departments.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => {
        if (left.id === ownDeptId) return -1;
        if (right.id === ownDeptId) return 1;
        return frenchCollator.compare(left.name, right.name);
      });
  }, [availableStaff, ownDeptId]);

  const functionOptions = useMemo(() => [...new Set(availableStaff.map(getFunctionName))]
    .sort((left, right) => frenchCollator.compare(left, right)), [availableStaff]);

  const quickCounts = useMemo(() => {
    const counts = { all: availableStaff.length, own: 0, other: 0, medical: 0, auxiliary: 0, administrative: 0 };
    availableStaff.forEach((member) => {
      const isOwn = belongsToDepartment(member, ownDeptId);
      const hasDepartment = getDepartments(member).length > 0;
      const category = getCategory(member);
      if (isOwn) counts.own += 1;
      else if (hasDepartment) counts.other += 1;
      if (counts[category] !== undefined) counts[category] += 1;
    });
    return counts;
  }, [availableStaff, ownDeptId]);

  const filteredStaff = useMemo(() => {
    const searchTerm = normalizeText(search);
    return availableStaff.filter((member) => {
      const category = getCategory(member);
      const isOwn = belongsToDepartment(member, ownDeptId);
      const departments = getDepartments(member);

      if (quickFilter === 'own' && !isOwn) return false;
      if (quickFilter === 'other' && (isOwn || departments.length === 0)) return false;
      if (['medical', 'auxiliary', 'administrative'].includes(quickFilter) && category !== quickFilter) return false;
      if (departmentFilter && !departments.some((department) => department.id === departmentFilter)) return false;
      if (categoryFilter && category !== categoryFilter) return false;
      if (functionFilter && getFunctionName(member) !== functionFilter) return false;

      if (searchTerm) {
        const searchable = normalizeText([
          member.first_name,
          member.last_name,
          `${member.first_name || ''} ${member.last_name || ''}`,
          `${member.last_name || ''} ${member.first_name || ''}`,
          member.matricule,
          getFunctionName(member),
          getTechnicalRole(member),
          ...departments.map((department) => department.name),
        ].join(' '));
        if (!searchable.includes(searchTerm)) return false;
      }
      return true;
    });
  }, [availableStaff, search, quickFilter, departmentFilter, categoryFilter, functionFilter, ownDeptId]);

  const groupedStaff = useMemo(() => {
    const own = [];
    const otherMedical = [];
    const auxiliary = [];
    const administrative = [];
    const unknown = [];

    filteredStaff.forEach((member) => {
      if (belongsToDepartment(member, ownDeptId)) {
        own.push(member);
        return;
      }
      const category = getCategory(member);
      if (category === 'medical') otherMedical.push(member);
      else if (category === 'auxiliary') auxiliary.push(member);
      else if (category === 'administrative') administrative.push(member);
      else unknown.push(member);
    });

    const medicalByDepartment = new Map();
    otherMedical.sort(compareMembers).forEach((member) => {
      const department = getPrimaryDepartment(member);
      const key = department?.id || '__without_department__';
      if (!medicalByDepartment.has(key)) {
        medicalByDepartment.set(key, { id: key, name: department?.name || 'Sans service', members: [] });
      }
      medicalByDepartment.get(key).members.push(member);
    });

    return {
      own: own.sort(compareMembers),
      otherMedical: [...medicalByDepartment.values()].sort((left, right) => frenchCollator.compare(left.name, right.name)),
      auxiliary: auxiliary.sort(compareMembers),
      administrative: administrative.sort(compareMembers),
      unknown: unknown.sort(compareMembers),
    };
  }, [filteredStaff, ownDeptId]);

  const activeFilterCount = [quickFilter !== 'all', departmentFilter, categoryFilter, functionFilter].filter(Boolean).length;

  const clearFilters = () => {
    setQuickFilter('all');
    setDepartmentFilter('');
    setCategoryFilter('');
    setFunctionFilter('');
  };

  const handleSelect = useCallback((member) => {
    const fullName = `${member.last_name || member.lastName || ''} ${member.first_name || member.firstName || ''}`.trim();
    setSessionAddedIds((current) => new Set(current).add(member.id));
    setLastAddedId(member.id);
    setAnnouncement(`${fullName || 'Personnel'} ajouté au tableur.`);
    onSelect?.(member);
    window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setLastAddedId(null), 900);
  }, [onSelect]);

  const renderStaffList = (members) => (
    <StaffList
      members={members}
      ownDeptId={ownDeptId}
      ownDeptName={ownDeptName}
      onSelect={handleSelect}
      onDragStart={onDragStart}
      justAdded={lastAddedId}
    />
  );

  if (!open) return null;

  const noAvailableStaff = rawStaff.length > 0 && availableStaff.length === 0;
  const hasResults = filteredStaff.length > 0;

  return (
    <div className="hsp-root">
      <div className="hsp-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <aside
        ref={dialogRef}
        className="hsp-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hospital-staff-picker-title"
        aria-busy={staffQuery.isLoading}
      >
        <header className="hsp-header">
          <div className="hsp-header__topline">
            <div className="hsp-title-block">
              <span className="hsp-eyebrow"><UserRound size={14} /> Sélection du personnel</span>
              <h2 id="hospital-staff-picker-title">{title}</h2>
              <p>
                {staffQuery.isLoading
                  ? 'Chargement des profils…'
                  : `${availableStaff.length} disponible${availableStaff.length !== 1 ? 's' : ''} dans l’établissement`}
              </p>
            </div>
            <button type="button" className="hsp-icon-button" onClick={onClose} aria-label="Fermer">
              <X size={20} />
            </button>
          </div>

          <div className="hsp-search-row">
            <div className="hsp-search">
              <Search size={18} aria-hidden="true" />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nom, matricule, fonction ou service"
                aria-label="Rechercher un membre du personnel"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} aria-label="Effacer la recherche">
                  <X size={16} />
                </button>
              )}
            </div>
            <button
              type="button"
              className={`hsp-filter-toggle${showAdvancedFilters ? ' is-active' : ''}`}
              onClick={() => setShowAdvancedFilters((current) => !current)}
              aria-expanded={showAdvancedFilters}
              aria-controls="hospital-staff-advanced-filters"
            >
              <Filter size={17} />
              <span>Filtres</span>
              {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
            </button>
          </div>

          {requiredFunctionName && (
            <div className="hsp-required-function">
              <BadgeCheck size={16} aria-hidden="true" />
              <span>Fonction requise</span>
              <strong>{requiredFunctionName}</strong>
              <small>Seuls les profils compatibles sont affichés.</small>
            </div>
          )}

          <div className="hsp-quick-filters" role="group" aria-label="Filtres rapides">
            {QUICK_FILTERS.map((filter) => {
              const Icon = filter.icon;
              return (
                <button
                  key={filter.id}
                  type="button"
                  className={quickFilter === filter.id ? 'is-active' : ''}
                  onClick={() => setQuickFilter(filter.id)}
                  aria-pressed={quickFilter === filter.id}
                >
                  <Icon size={14} />
                  <span>{filter.label}</span>
                  <strong>{quickCounts[filter.id] || 0}</strong>
                </button>
              );
            })}
          </div>
        </header>

        {showAdvancedFilters && (
          <section id="hospital-staff-advanced-filters" className="hsp-advanced-filters">
            <div className="hsp-advanced-filters__heading">
              <div>
                <strong>Affiner la liste</strong>
                <span>{activeFilterCount ? `${activeFilterCount} filtre${activeFilterCount > 1 ? 's' : ''} actif${activeFilterCount > 1 ? 's' : ''}` : 'Tous les profils'}</span>
              </div>
              {activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters}>
                  <RotateCcw size={14} /> Réinitialiser
                </button>
              )}
            </div>
            <div className="hsp-filter-grid">
              <label>
                <span>Service</span>
                <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                  <option value="">Tous les services</option>
                  {departmentOptions.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.id === ownDeptId ? `Mon service · ${department.name}` : department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Type du personnel</span>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="">Tous les types</option>
                  <option value="medical">Personnel médical</option>
                  <option value="auxiliary">Personnel auxiliaire</option>
                  <option value="administrative">Personnel administratif</option>
                  <option value="unknown">Type à renseigner</option>
                </select>
              </label>
              <label className="hsp-filter-grid__function">
                <span>Fonction</span>
                <select value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value)}>
                  <option value="">Toutes les fonctions</option>
                  {functionOptions.map((functionName) => (
                    <option key={functionName} value={functionName}>{functionName}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        )}

        <main className="hsp-results">
          {staffQuery.isLoading ? (
            <div className="hsp-loading" aria-label="Chargement du personnel">
              {[0, 1, 2, 3, 4].map((item) => <span key={item} className="hsp-skeleton" />)}
            </div>
          ) : staffQuery.isError ? (
            <div className="hsp-empty-state hsp-empty-state--error">
              <AlertCircle size={30} />
              <strong>Impossible de charger le personnel</strong>
              <span>{staffQuery.error?.response?.data?.message || 'Le service est momentanément indisponible.'}</span>
              <button type="button" onClick={() => staffQuery.refetch()}>
                <RefreshCw size={15} /> Réessayer
              </button>
            </div>
          ) : noAvailableStaff ? (
            <div className="hsp-empty-state">
              <CheckCircle2 size={32} />
              <strong>{requiredFunctionName ? `Aucun profil disponible pour « ${requiredFunctionName} »` : 'Tout le personnel est déjà ajouté'}</strong>
              <span>{requiredFunctionName ? 'Vérifiez les fonctions attribuées aux comptes ou ajoutez un autre poste au canevas.' : 'Les profils présents dans le tableur sont masqués de cette liste.'}</span>
            </div>
          ) : !hasResults ? (
            <div className="hsp-empty-state">
              <Search size={30} />
              <strong>Aucun profil ne correspond</strong>
              <span>Modifiez la recherche ou les filtres sélectionnés.</span>
              <button type="button" onClick={() => { setSearch(''); clearFilters(); }}>
                <RotateCcw size={15} /> Tout réinitialiser
              </button>
            </div>
          ) : (
            <>
              {groupedStaff.own.length > 0 && (
                <section className="hsp-section">
                  <SectionHeader icon={Building2} title="Votre service" subtitle={ownDeptName || 'Service du planning'} count={groupedStaff.own.length} tone="own" priority />
                  {renderStaffList(groupedStaff.own)}
                </section>
              )}

              {groupedStaff.otherMedical.length > 0 && (
                <section className="hsp-section">
                  <SectionHeader
                    icon={Stethoscope}
                    title="Autres services médicaux"
                    subtitle="Personnel rattaché aux autres services"
                    count={groupedStaff.otherMedical.reduce((total, group) => total + group.members.length, 0)}
                    tone="medical"
                  />
                  <div className="hsp-department-groups">
                    {groupedStaff.otherMedical.map((group) => (
                      <div key={group.id} className="hsp-department-group">
                        <div className="hsp-department-group__header">
                          <span><Building2 size={13} /> {group.name}</span>
                          <strong>{group.members.length}</strong>
                        </div>
                        {renderStaffList(group.members)}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {groupedStaff.auxiliary.length > 0 && (
                <section className="hsp-section">
                  <SectionHeader icon={Ambulance} title="Personnel auxiliaire" subtitle="Soutien logistique et opérationnel" count={groupedStaff.auxiliary.length} tone="auxiliary" />
                  {renderStaffList(groupedStaff.auxiliary)}
                </section>
              )}

              {groupedStaff.administrative.length > 0 && (
                <section className="hsp-section">
                  <SectionHeader icon={BriefcaseBusiness} title="Personnel administratif" subtitle="Administration et fonctions transversales" count={groupedStaff.administrative.length} tone="administrative" />
                  {renderStaffList(groupedStaff.administrative)}
                </section>
              )}

              {groupedStaff.unknown.length > 0 && (
                <section className="hsp-section">
                  <SectionHeader icon={AlertCircle} title="Informations à compléter" subtitle="Profils hérités sans type de personnel" count={groupedStaff.unknown.length} tone="unknown" />
                  {renderStaffList(groupedStaff.unknown)}
                </section>
              )}

              {staffQuery.data?.truncated && (
                <div className="hsp-limit-notice">
                  <AlertCircle size={15} />
                  {MAX_STAFF} profils affichés sur {staffQuery.data.total}. Affinez les données du personnel pour réduire la liste.
                </div>
              )}
            </>
          )}
        </main>

        <footer className="hsp-footer">
          <div>
            <strong>{sessionAddedIds.size}</strong>
            <span>ajout{sessionAddedIds.size !== 1 ? 's' : ''} pendant cette sélection</span>
          </div>
          <button type="button" onClick={onClose}><Check size={16} /> Terminer</button>
        </footer>
        <span className="hsp-sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
      </aside>
    </div>
  );
}
