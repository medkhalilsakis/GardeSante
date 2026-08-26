import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Pencil, Plus, Power, Search, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { departmentsAPI, jobTitlesAPI, usersAPI } from '../../api';
import Avatar from '../../components/common/Avatar';
import { GsBadge, GsEmpty, GsPageHeader, GsPanel, GsSkeleton, GsTable } from '../../components/gs';
import { useAuthStore } from '../../store';
import { useTranslation } from '../../utils/helpers';
import './users.css';

const PERSONNEL_TYPES = [
  { value: '', label: 'Tous les types' },
  { value: 'medical', label: 'Personnel médical' },
  { value: 'administrative', label: 'Personnel administratif' },
  { value: 'auxiliary', label: 'Personnel auxiliaire' },
];

const PERSONNEL_TYPE_LABELS = {
  medical: 'Personnel médical',
  administrative: 'Personnel administratif',
  auxiliary: 'Personnel auxiliaire',
};

const ROLES_REQUIRING_DEPARTMENT = new Set([
  'department_head',
  'service_supervisor',
  'senior_doctor',
  'resident',
]);
const HOSPITAL_WIDE_ROLES = new Set(['general_supervisor', 'director', 'hospital_admin', 'super_admin']);

const personName = (person) => `${person?.first_name || ''} ${person?.last_name || ''}`.trim();
const primaryDepartment = (person) => (person?.departments || []).find((d) => d.isPrimary || d.is_primary) || (person?.departments || [])[0];
const roleLabel = (person, t) => person?.role_name || t(`roles.${person?.role_code}`) || person?.role_code || 'Non renseigne';
const assignmentLabel = (person, t) => (person?.role_code === 'autre' && person?.job_title
  ? person.job_title
  : roleLabel(person, t));

export default function UsersPage() {
  const { hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ roleCode: '', personnelType: '', departmentId: '', isActive: '' });
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users', search, filters, page],
    queryFn: () => usersAPI.getAll({ search, ...filters, page, limit: 20 }).then((r) => r.data),
    placeholderData: (previous) => previous,
  });
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsAPI.getAll().then((r) => r.data.data || []) });
  const canEdit = hasPermission('users.create') || hasPermission('users.update');
  const { data: roleCatalog = { roles: [], secondaryRoles: [] } } = useQuery({
    queryKey: ['roles-available'],
    queryFn: () => usersAPI.rolesAvailable().then((r) => ({
      roles: r.data.data || [],
      secondaryRoles: r.data.secondaryRoles || [],
    })),
    staleTime: 120000,
    enabled: canEdit,
  });
  const { data: jobTitles = [] } = useQuery({ queryKey: ['job-titles', 'all'], queryFn: () => jobTitlesAPI.getAll().then((r) => r.data.data || []), staleTime: 120000, enabled: canEdit });
  const availableRoles = roleCatalog.roles;

  const users = usersData?.data || [];
  const pagination = usersData?.pagination || {};
  const updateUser = useMutation({
    mutationFn: ({ id, ...data }) => usersAPI.update(id, data),
    onSuccess: (response) => { toast.success(response.data.message || 'Utilisateur mis a jour'); setSelectedUser(null); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (error) => toast.error(error.response?.data?.message || 'Modification impossible'),
  });
  const createUser = useMutation({
    mutationFn: (data) => usersAPI.create(data),
    onSuccess: (response) => { toast.success(response.data.message || 'Compte cree'); setShowCreate(false); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (error) => toast.error(error.response?.data?.message || 'Creation impossible'),
  });
  const toggleActive = useMutation({
    mutationFn: ({ id, active }) => (active ? usersAPI.activate(id) : usersAPI.deactivate(id)),
    onSuccess: (response) => { toast.success(response.data.message || 'Statut mis a jour'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (error) => toast.error(error.response?.data?.message || 'Statut impossible a modifier'),
  });

  const roleOptions = useMemo(() => [{ value: '', label: 'Tous les roles' }, ...availableRoles.map((role) => ({ value: role.code, label: role.name || role.code }))], [availableRoles]);
  const setFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const hasFilters = Boolean(search || Object.values(filters).some(Boolean));
  const reset = () => { setSearch(''); setFilters({ roleCode: '', personnelType: '', departmentId: '', isActive: '' }); setPage(1); };

  const columns = useMemo(() => [
    { key: 'person', label: 'Personnel', strong: true, render: (person) => <span className="gsup-person"><Avatar avatarUrl={person.avatar_url} firstName={person.first_name} lastName={person.last_name} size="sm" /><span className="gsup-person-copy"><strong>{personName(person) || 'Personnel sans nom'}</strong><small>{[person.matricule, person.email].filter(Boolean).join(' - ') || 'Coordonnees non renseignees'}</small></span></span> },
    { key: 'role', label: 'Rôle / fonction', render: (person) => <span className="gsup-taxonomy"><strong>{assignmentLabel(person, t)}</strong><small>{person.role_code === 'autre' ? 'Profil sans accès plateforme' : person.secondary_role_name || person.job_title || person.speciality || 'Rôle d’accès'}</small></span> },
    { key: 'personnel_category_label', label: 'Type de personnel', render: (person) => <span className="gsup-taxonomy"><strong>{person.personnel_category_label || 'Non classe'}</strong></span> },
    { key: 'department', label: 'Service', render: (person) => <span className="gsup-taxonomy"><strong>{primaryDepartment(person)?.name || 'Tous services'}</strong><small>{primaryDepartment(person)?.code || ''}</small></span> },
    { key: 'state', label: 'Etat', render: (person) => <span className="gsup-taxonomy"><GsBadge tone={person.is_active ? 'duty' : 'quiet'} dot>{person.is_active ? 'Actif' : 'Desactive'}</GsBadge>{person.is_on_leave ? <small>En conge</small> : null}</span> },
    { key: 'actions', label: 'Actions', align: 'right', render: (person) => <span className="gsup-actions">{hasPermission('users.update') ? <button type="button" className="gsup-icon-btn" title="Modifier" aria-label={`Modifier ${personName(person)}`} onClick={() => setSelectedUser(person)}><Pencil size={14} /></button> : null}{hasPermission('users.update') ? <button type="button" className="gsup-icon-btn is-danger" title={person.is_active ? 'Desactiver' : 'Reactiver'} aria-label={person.is_active ? `Desactiver ${personName(person)}` : `Reactiver ${personName(person)}`} disabled={toggleActive.isPending} onClick={() => toggleActive.mutate({ id: person.id, active: !person.is_active })}><Power size={14} /></button> : null}</span> },
  ], [hasPermission, t, toggleActive]);

  return (
    <div className="gsup-wrap">
      <GsPageHeader eyebrow="Administration des comptes" title={t('nav.users') || 'Personnel et comptes'} subtitle="Un registre unique pour comparer les roles, les fonctions, les services et l etat des comptes." meta={[{ label: 'Resultats', value: Number(pagination.total || 0) }, { label: 'Page', value: `${page} / ${pagination.totalPages || 1}` }]} actions={hasPermission('users.create') ? <button type="button" className="gs-btn is-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Ajouter un compte</button> : null} />
      <GsPanel title="Criteres du registre" sub="La recherche porte sur le nom, le courriel et le matricule." tools={hasFilters ? <button type="button" className="gs-btn is-quiet" onClick={reset}><X size={14} /> Reinitialiser</button> : null}>
        <div className="gsup-filter-panel"><div className="gsup-filter-grid">
          <label className="gsup-field"><span>Recherche</span><span className="gsup-search"><Search size={14} /><input type="search" value={search} placeholder="Nom, courriel ou matricule" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />{search ? <button type="button" aria-label="Effacer la recherche" onClick={() => { setSearch(''); setPage(1); }}><X size={13} /></button> : null}</span></label>
          <label className="gsup-field"><span>Role d acces</span><select className="form-control" value={filters.roleCode} onChange={(event) => setFilter('roleCode', event.target.value)}>{roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="gsup-field"><span>Type de personnel</span><select className="form-control" value={filters.personnelType} onChange={(event) => setFilter('personnelType', event.target.value)}>{PERSONNEL_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="gsup-field"><span>Service</span><select className="form-control" value={filters.departmentId} onChange={(event) => setFilter('departmentId', event.target.value)}><option value="">Tous les services</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label className="gsup-field"><span>Etat</span><select className="form-control" value={filters.isActive} onChange={(event) => setFilter('isActive', event.target.value)}><option value="">Tous</option><option value="true">Actifs</option><option value="false">Desactives</option></select></label>
        </div></div>
      </GsPanel>
      <GsPanel title="Registre du personnel" sub={`${pagination.total || 0} personne(s) selon les criteres actuels`} flush>
        {isLoading ? <div className="gsup-filter-panel"><GsSkeleton variant="rows" count={7} /></div> : <GsTable columns={columns} rows={users} rowKey="id" label="Registre du personnel" empty={<GsEmpty icon={<UserRound size={27} />} title="Aucun personnel trouve" hint={hasFilters ? 'Modifiez ou reinitialisez les criteres pour elargir le registre.' : 'Aucun compte n est accessible dans votre perimetre.'} actions={hasFilters ? <button type="button" className="gs-btn" onClick={reset}>Afficher tout</button> : null} />} />}
      </GsPanel>
      {pagination.totalPages > 1 ? <nav className="gsup-pagination" aria-label="Pagination du personnel"><button type="button" className="gsup-page-btn" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="Page precedente"><ChevronLeft size={15} /></button><span>Page <b className="gs-num">{page}</b> sur <b className="gs-num">{pagination.totalPages}</b></span><button type="button" className="gsup-page-btn" onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))} disabled={page === pagination.totalPages} aria-label="Page suivante"><ChevronRight size={15} /></button></nav> : null}
      {selectedUser ? <UserEditModal user={selectedUser} departments={departments} roles={availableRoles} secondaryRoles={roleCatalog.secondaryRoles} jobTitles={jobTitles} onClose={() => setSelectedUser(null)} onSubmit={(payload) => updateUser.mutate({ id: selectedUser.id, ...payload })} loading={updateUser.isPending} /> : null}
      {showCreate ? <UserEditModal departments={departments} roles={availableRoles} secondaryRoles={roleCatalog.secondaryRoles} jobTitles={jobTitles} onClose={() => setShowCreate(false)} onSubmit={(payload) => createUser.mutate(payload)} loading={createUser.isPending} create /> : null}
    </div>
  );
}

function UserEditModal({ user, departments, roles, secondaryRoles, jobTitles, onClose, onSubmit, loading, create = false }) {
  const firstAssignment = user?.job_title_id
    ? `job:${user.job_title_id}`
    : user?.role_code
      ? `role:${user.role_code}`
      : roles[0]?.code
        ? `role:${roles[0].code}`
        : jobTitles[0]?.id
          ? `job:${jobTitles[0].id}`
          : '';
  const [form, setForm] = useState(() => ({ firstName: user?.first_name || '', lastName: user?.last_name || '', email: user?.email || '', phone: user?.phone || '', matricule: user?.matricule || '', grade: user?.grade || '', preferredLanguage: user?.preferred_language || 'fr', assignment: firstAssignment, secondaryRoleCode: user?.secondary_role_code || '', departmentId: primaryDepartment(user)?.id || '' }));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const selectedJobId = form.assignment.startsWith('job:') ? form.assignment.slice(4) : '';
  const selectedJob = jobTitles.find((title) => title.id === selectedJobId);
  const selectedRoleCode = form.assignment.startsWith('role:') ? form.assignment.slice(5) : 'autre';
  const isHospitalWide = HOSPITAL_WIDE_ROLES.has(selectedRoleCode);
  const requiresDepartment = ROLES_REQUIRING_DEPARTMENT.has(selectedRoleCode) || selectedJob?.category === 'medical';
  const currentRoleMissing = user?.role_code && user.role_code !== 'autre' && !roles.some((role) => role.code === user.role_code);
  const groupedJobs = Object.entries(PERSONNEL_TYPE_LABELS).map(([category, label]) => ({
    category,
    label,
    options: jobTitles.filter((title) => title.category === category),
  })).filter((group) => group.options.length > 0);
  const changeAssignment = (value) => {
    const nextRoleCode = value.startsWith('role:') ? value.slice(5) : 'autre';
    setForm((current) => ({
      ...current,
      assignment: value,
      departmentId: HOSPITAL_WIDE_ROLES.has(nextRoleCode) ? '' : current.departmentId,
      secondaryRoleCode: nextRoleCode === 'department_head' ? current.secondaryRoleCode : '',
    }));
  };
  const submit = (event) => {
    event.preventDefault();
    const { assignment, ...values } = form;
    const roleCode = assignment.startsWith('role:') ? assignment.slice(5) : 'autre';
    const jobTitleId = assignment.startsWith('job:') ? assignment.slice(4) : null;
    onSubmit({
      ...values,
      roleCode,
      jobTitleId,
      secondaryRoleCode: roleCode === 'department_head' ? values.secondaryRoleCode || null : null,
      departmentId: HOSPITAL_WIDE_ROLES.has(roleCode) ? null : values.departmentId || null,
    });
  };
  return <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !loading && onClose()}><div className="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="gsup-modal-title"><div className="modal-header"><div><span className="gs-eyebrow">{create ? 'Nouveau compte' : 'Fiche du personnel'}</span><h2 className="modal-title" id="gsup-modal-title">{create ? 'Ajouter un compte' : `Modifier - ${personName(user)}`}</h2></div><button type="button" className="gs-btn is-quiet" onClick={onClose} disabled={loading} aria-label="Fermer"><X size={18} /></button></div><form onSubmit={submit}><div className="modal-body gsup-modal-body"><div className="gsup-modal-note">Choisissez directement le rôle d’accès ou la fonction métier. Une fonction sans accès reste enregistrée avec le rôle technique attendu par le serveur, sans exposer « Autre Personnel » dans l’interface.</div><div className="gsup-modal-grid"><label className="gsup-field"><span>Prénom *</span><input className="form-control" value={form.firstName} onChange={(event) => set('firstName', event.target.value)} required /></label><label className="gsup-field"><span>Nom *</span><input className="form-control" value={form.lastName} onChange={(event) => set('lastName', event.target.value)} required /></label><label className="gsup-field"><span>Courriel *</span><input type="email" className="form-control" value={form.email} onChange={(event) => set('email', event.target.value)} required /></label><label className="gsup-field"><span>Téléphone</span><input className="form-control" value={form.phone} onChange={(event) => set('phone', event.target.value)} /></label><label className="gsup-field"><span>Matricule</span><input className="form-control" value={form.matricule} onChange={(event) => set('matricule', event.target.value)} /></label><label className="gsup-field"><span>Grade</span><input className="form-control" value={form.grade} onChange={(event) => set('grade', event.target.value)} /></label><label className="gsup-field gsup-assignment"><span>Rôle ou fonction *</span><select className="form-control" value={form.assignment} onChange={(event) => changeAssignment(event.target.value)} required><option value="">Choisir un rôle ou une fonction</option><optgroup label="Rôles avec accès plateforme">{currentRoleMissing ? <option value={`role:${user.role_code}`}>{roleLabel(user, (key) => key)} — rôle actuel</option> : null}{roles.map((role) => <option key={role.id || role.code} value={`role:${role.code}`}>{role.name || role.code}</option>)}</optgroup>{groupedJobs.map((group) => <optgroup key={group.category} label={group.label}>{group.options.map((title) => <option key={title.id} value={`job:${title.id}`}>{title.name}</option>)}</optgroup>)}</select><small className="gsup-field-help">{selectedJob ? `${selectedJob.category_label || PERSONNEL_TYPE_LABELS[selectedJob.category]} · profil sans accès` : 'Ce choix détermine les droits et le type de personnel.'}</small></label>{selectedRoleCode === 'department_head' && secondaryRoles.length ? <label className="gsup-field"><span>Métier du chef</span><select className="form-control" value={form.secondaryRoleCode} onChange={(event) => set('secondaryRoleCode', event.target.value)}><option value="">Non précisé</option>{secondaryRoles.map((role) => <option key={role.id || role.code} value={role.code}>{role.name || role.code}</option>)}</select></label> : null}<label className="gsup-field"><span>Service{requiresDepartment ? ' *' : ''}</span><select className="form-control" value={isHospitalWide ? '' : form.departmentId} onChange={(event) => set('departmentId', event.target.value)} required={requiresDepartment} disabled={isHospitalWide}><option value="">{isHospitalWide ? 'Périmètre hôpital — aucun service' : 'Aucun service'}</option>{departments.filter((department) => department.is_active !== false).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>{requiresDepartment ? <small className="gsup-field-help">Le personnel médical doit être rattaché à un service.</small> : null}</label></div></div><div className="modal-footer"><button type="button" className="gs-btn" onClick={onClose} disabled={loading}>Annuler</button><button type="submit" className="gs-btn is-primary" disabled={loading}>{loading ? 'Enregistrement…' : create ? 'Créer le compte' : 'Enregistrer'}</button></div></form></div></div>;
}
