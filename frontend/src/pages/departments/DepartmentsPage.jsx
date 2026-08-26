import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Plus, Power, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { departmentsAPI, usersAPI } from '../../api';
import Avatar from '../../components/common/Avatar';
import { GsBadge, GsEmpty, GsPageHeader, GsPanel, GsSkeleton } from '../../components/gs';
import { useAuthStore } from '../../store';
import { useTranslation } from '../../utils/helpers';
import './departments.css';

const DEPARTMENT_TYPES = [
  { value: 'emergency', label: 'Urgences' },
  { value: 'surgery', label: 'Chirurgie' },
  { value: 'icu', label: 'Soins intensifs' },
  { value: 'internal', label: 'Médecine interne' },
  { value: 'pediatrics', label: 'Pédiatrie' },
  { value: 'radiology', label: 'Radiologie' },
  { value: 'other', label: 'Autre' },
];

const typeLabel = (code) => DEPARTMENT_TYPES.find((type) => type.value === code)?.label || code || 'Non renseigné';
const memberName = (member) => `${member?.first_name || ''} ${member?.last_name || ''}`.trim();

export default function DepartmentsPage() {
  const { hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [migrationSource, setMigrationSource] = useState(null);

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments-full'],
    queryFn: () => departmentsAPI.getAll().then((response) => response.data.data || []),
  });
  const selected = departments.find((department) => department.id === selectedId) || null;
  const canCreate = hasPermission('departments.create');
  const canUpdate = hasPermission('departments.update');

  const { data: departmentDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['department', selectedId],
    queryFn: () => departmentsAPI.getOne(selectedId).then((response) => response.data.data),
    enabled: Boolean(selectedId),
  });

  const refreshDepartments = () => {
    queryClient.invalidateQueries({ queryKey: ['departments-full'] });
    queryClient.invalidateQueries({ queryKey: ['departments'] });
  };

  const removeMember = useMutation({
    mutationFn: ({ departmentId, userId }) => departmentsAPI.removeMember(departmentId, userId),
    onSuccess: () => {
      toast.success('Membre retiré du service');
      queryClient.invalidateQueries({ queryKey: ['department', selectedId] });
      refreshDepartments();
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Retrait impossible'),
  });

  return (
    <div className="gsdept-wrap">
      <GsPageHeader
        eyebrow="Organisation hospitalière"
        title={t('nav.departments') || 'Gestion des services'}
        subtitle="Consultez l’effectif, les responsables et les paramètres de chaque service. Toute fermeture migre d’abord le personnel."
        meta={[
          { label: 'Services actifs', value: departments.length },
          { label: 'Personnel rattaché', value: departments.reduce((total, department) => total + Number(department.member_count || 0), 0) },
        ]}
        actions={canCreate ? <button type="button" className="gs-btn is-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Nouveau service</button> : null}
      />

      <div className={`gsdept-layout${selected ? '' : ' is-empty'}`}>
        <div className="gsdept-list" aria-label="Liste des services">
          {isLoading ? <GsSkeleton variant="block" count={6} /> : departments.map((department) => (
            <button
              key={department.id}
              type="button"
              className="gsdept-item"
              aria-current={selected?.id === department.id}
              onClick={() => setSelectedId(selected?.id === department.id ? null : department.id)}
            >
              <span className="gsdept-item-top">
                <span className="gsdept-code">{String(department.code || 'SV').slice(0, 3)}</span>
                <span className="gsdept-copy">
                  <strong>{department.name}</strong>
                  <small>{typeLabel(department.department_type)} · {Number(department.member_count || 0)} membre(s)</small>
                </span>
                <GsBadge tone="duty" dot>Actif</GsBadge>
              </span>
              <span className="gsdept-copy">
                <small>{department.head_first_name ? `Chef : ${department.head_first_name} ${department.head_last_name || ''}` : 'Chef non désigné'}</small>
                <small>{Number(department.supervisor_count || 0)} surveillant(s) de service</small>
              </span>
            </button>
          ))}
          {!isLoading && departments.length === 0 ? <GsEmpty icon={<Building2 size={27} />} title="Aucun service actif" hint="Créez le premier service de l’établissement pour organiser le personnel." /> : null}
        </div>

        {selected ? (
          <GsPanel className="gsdept-detail" flush>
            <div className="gsdept-detail-head">
              <div className="gsdept-detail-title">
                <span className="gs-eyebrow">{selected.code || 'Service'}</span>
                <h2>{selected.name}</h2>
                <p>{selected.name_ar || typeLabel(selected.department_type)}</p>
              </div>
              <div className="gsdept-member-actions">
                {canUpdate ? <button type="button" className="gs-btn is-alert" onClick={() => setMigrationSource(selected)}><Power size={14} /> Désactiver</button> : null}
                <button type="button" className="gsdept-close" onClick={() => setSelectedId(null)} aria-label="Fermer le détail"><X size={15} /></button>
              </div>
            </div>

            <div className="gsdept-facts">
              {[
                ['Type', typeLabel(selected.department_type)],
                ['Étage', selected.floor || 'Non renseigné'],
                ['Aile', selected.wing || 'Non renseignée'],
                ['Capacité', selected.bed_count != null ? `${selected.bed_count} lit(s)` : 'Non renseignée'],
                ['Garde minimale', selected.min_guard_count != null ? `${selected.min_guard_count} personne(s)` : 'Non renseignée'],
                ['Téléphone', selected.phone || 'Non renseigné'],
              ].map(([label, value]) => <div className="gsdept-fact" key={label}><span>{label}</span><strong>{value}</strong></div>)}
            </div>

            <div className="gsdept-members">
              <div className="gsdept-detail-head">
                <div className="gsdept-detail-title"><h2>Membres du service</h2><p>{Number(departmentDetail?.member_count || 0)} personnel(s) actif(s)</p></div>
                {canUpdate ? <AddMemberControl departmentId={selected.id} members={departmentDetail?.members || []} onSuccess={() => { queryClient.invalidateQueries({ queryKey: ['department', selected.id] }); refreshDepartments(); }} /> : null}
              </div>
              {detailLoading ? <div className="gsdept-empty"><GsSkeleton variant="rows" count={4} /></div> : (departmentDetail?.members || []).map((member) => (
                <div className="gsdept-member" key={member.id}>
                  <Avatar avatarUrl={member.avatar_url} firstName={member.first_name} lastName={member.last_name} size="sm" />
                  <div className="gsdept-member-copy">
                    <strong>{memberName(member) || 'Personnel sans nom'}</strong>
                    <small>{[member.role_name, member.grade, member.speciality].filter(Boolean).join(' · ') || 'Fonction non renseignée'}</small>
                  </div>
                  {member.is_head ? <GsBadge tone="seal" dot>Chef de service</GsBadge> : null}
                  {canUpdate && !member.is_head ? <button type="button" className="gsdept-close" title="Retirer du service" aria-label={`Retirer ${memberName(member)}`} disabled={removeMember.isPending} onClick={() => removeMember.mutate({ departmentId: selected.id, userId: member.id })}><UserMinus size={14} /></button> : null}
                </div>
              ))}
              {!detailLoading && !(departmentDetail?.members || []).length ? <div className="gsdept-empty"><GsEmpty bare icon={<UsersRound size={25} />} title="Aucun membre dans ce service" hint="Ajoutez un personnel existant ou créez son compte depuis la gestion du personnel." /></div> : null}
            </div>
          </GsPanel>
        ) : null}
      </div>

      {showCreate ? <CreateDepartmentModal onClose={() => setShowCreate(false)} onSuccess={() => { setShowCreate(false); refreshDepartments(); }} /> : null}
      {migrationSource ? <MigrateDepartmentModal source={migrationSource} departments={departments} onClose={() => setMigrationSource(null)} onSuccess={() => { setMigrationSource(null); setSelectedId(null); refreshDepartments(); }} /> : null}
    </div>
  );
}

function AddMemberControl({ departmentId, members, onSuccess }) {
  const [expanded, setExpanded] = useState(false);
  const [userId, setUserId] = useState('');
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['all-users-flat'],
    queryFn: () => usersAPI.getAll({ limit: 200, isActive: 'true' }).then((response) => response.data.data || []),
    enabled: expanded,
  });
  const candidates = users.filter((user) => user.role_code !== 'general_supervisor' && !memberIds.has(user.id));
  const addMember = useMutation({
    mutationFn: () => departmentsAPI.addMember(departmentId, { userId }),
    onSuccess: () => {
      toast.success('Membre ajouté au service');
      setUserId('');
      setExpanded(false);
      onSuccess();
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Ajout impossible'),
  });

  if (!expanded) return <button type="button" className="gs-btn is-primary" onClick={() => setExpanded(true)}><UserPlus size={14} /> Ajouter</button>;
  return (
    <div className="gsdept-add">
      <select className="form-control" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={isLoading}>
        <option value="">{isLoading ? 'Chargement…' : 'Choisir un personnel'}</option>
        {candidates.map((user) => <option key={user.id} value={user.id}>{memberName(user)} · {user.job_title || user.role_name || user.role_code}</option>)}
      </select>
      <button type="button" className="gsdept-close" aria-label="Confirmer l’ajout" disabled={!userId || addMember.isPending} onClick={() => addMember.mutate()}><Check size={15} /></button>
      <button type="button" className="gsdept-close" aria-label="Annuler l’ajout" onClick={() => { setExpanded(false); setUserId(''); }}><X size={15} /></button>
    </div>
  );
}

function CreateDepartmentModal({ onClose, onSuccess }) {
  const { user } = useAuthStore();
  const [form, setForm] = useState({ name: '', nameAr: '', code: '', departmentType: 'other', floor: '', wing: '', phone: '', bedCount: '', minGuardCount: '1' });
  const createDepartment = useMutation({
    mutationFn: (payload) => departmentsAPI.create(payload),
    onSuccess: () => { toast.success('Service créé'); onSuccess(); },
    onError: (error) => toast.error(error.response?.data?.message || 'Création impossible'),
  });
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    createDepartment.mutate({
      ...form,
      establishmentId: user?.establishmentId,
      bedCount: form.bedCount === '' ? null : Number(form.bedCount),
      minGuardCount: form.minGuardCount === '' ? null : Number(form.minGuardCount),
    });
  };
  return <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !createDepartment.isPending && onClose()}><div className="modal modal-lg" role="dialog" aria-modal="true" aria-labelledby="gsdept-create-title"><div className="modal-header"><div><span className="gs-eyebrow">Organisation hospitalière</span><h2 className="modal-title" id="gsdept-create-title">Nouveau service</h2></div><button type="button" className="gsdept-close" onClick={onClose} disabled={createDepartment.isPending} aria-label="Fermer"><X size={16} /></button></div><form onSubmit={submit}><div className="modal-body gsdept-modal-body"><div className="gsdept-modal-grid"><label className="gsdept-field"><span>Nom en français *</span><input className="form-control" value={form.name} onChange={(event) => set('name', event.target.value)} required /></label><label className="gsdept-field"><span>Nom en arabe</span><input className="form-control" dir="rtl" value={form.nameAr} onChange={(event) => set('nameAr', event.target.value)} /></label><label className="gsdept-field"><span>Code *</span><input className="form-control" maxLength={10} value={form.code} onChange={(event) => set('code', event.target.value.toUpperCase())} required /></label><label className="gsdept-field"><span>Type</span><select className="form-control" value={form.departmentType} onChange={(event) => set('departmentType', event.target.value)}>{DEPARTMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="gsdept-field"><span>Étage</span><input className="form-control" value={form.floor} onChange={(event) => set('floor', event.target.value)} /></label><label className="gsdept-field"><span>Aile</span><input className="form-control" value={form.wing} onChange={(event) => set('wing', event.target.value)} /></label><label className="gsdept-field"><span>Téléphone</span><input className="form-control" value={form.phone} onChange={(event) => set('phone', event.target.value)} /></label><label className="gsdept-field"><span>Nombre de lits</span><input type="number" min="0" className="form-control" value={form.bedCount} onChange={(event) => set('bedCount', event.target.value)} /></label><label className="gsdept-field"><span>Effectif minimal de garde</span><input type="number" min="1" className="form-control" value={form.minGuardCount} onChange={(event) => set('minGuardCount', event.target.value)} /></label></div></div><div className="modal-footer"><button type="button" className="gs-btn" onClick={onClose} disabled={createDepartment.isPending}>Annuler</button><button type="submit" className="gs-btn is-primary" disabled={createDepartment.isPending}>{createDepartment.isPending ? 'Création…' : 'Créer le service'}</button></div></form></div></div>;
}

function MigrateDepartmentModal({ source, departments, onClose, onSuccess }) {
  const [targetDepartmentId, setTargetDepartmentId] = useState('');
  const targets = departments.filter((department) => department.id !== source.id && department.is_active !== false);
  const migrate = useMutation({
    mutationFn: () => departmentsAPI.migrateAndDeactivate(source.id, targetDepartmentId),
    onSuccess: (response) => { toast.success(response.data.message || 'Personnel migré et service désactivé'); onSuccess(); },
    onError: (error) => toast.error(error.response?.data?.message || 'Migration impossible'),
  });
  const submit = (event) => { event.preventDefault(); migrate.mutate(); };
  return <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !migrate.isPending && onClose()}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="gsdept-migrate-title"><div className="modal-header"><div><span className="gs-eyebrow">Fermeture contrôlée</span><h2 className="modal-title" id="gsdept-migrate-title">Désactiver {source.name}</h2></div><button type="button" className="gsdept-close" onClick={onClose} disabled={migrate.isPending} aria-label="Fermer"><X size={16} /></button></div><form onSubmit={submit}><div className="modal-body gsdept-modal-body"><div className="gsdept-migrate"><strong>Le service ne sera désactivé qu’après la migration de tout son personnel.</strong><span>Le statut de chef n’est pas transféré automatiquement. Les membres rejoignent le service de destination, puis le service source devient inactif.</span></div><label className="gsdept-field"><span>Service de destination *</span><select className="form-control" value={targetDepartmentId} onChange={(event) => setTargetDepartmentId(event.target.value)} required><option value="">Choisir un autre service</option>{targets.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>{targets.length === 0 ? <div className="gsdept-migrate"><strong>Aucun service de destination disponible.</strong><span>Créez ou activez un autre service avant de fermer celui-ci.</span></div> : null}</div><div className="modal-footer"><button type="button" className="gs-btn" onClick={onClose} disabled={migrate.isPending}>Annuler</button><button type="submit" className="gs-btn is-alert" disabled={!targetDepartmentId || migrate.isPending}>{migrate.isPending ? 'Migration…' : 'Migrer et désactiver'}</button></div></form></div></div>;
}
