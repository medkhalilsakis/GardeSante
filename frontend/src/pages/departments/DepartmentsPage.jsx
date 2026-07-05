import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { departmentsAPI, usersAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, getInitials } from '../../utils/helpers';
import toast from 'react-hot-toast';

export default function DepartmentsPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments-full'],
    queryFn: () => departmentsAPI.getAll().then(r => r.data.data),
  });

  const canCreate = hasPermission('departments.create');
  const canUpdate = hasPermission('departments.update');

  // Département sélectionné → charger ses membres
  const { data: deptDetail, isLoading: loadingDetail } = useQuery({
    queryKey: ['department', selected?.id],
    queryFn: () => departmentsAPI.getOne(selected.id).then(r => r.data.data),
    enabled: !!selected?.id,
  });

  const removeMemberMutation = useMutation({
    mutationFn: ({ deptId, userId }) => departmentsAPI.removeMember(deptId, userId),
    onSuccess: () => { toast.success('Membre retiré'); qc.invalidateQueries(['department', selected?.id]); },
  });

  const typeColors = {
    emergency: '#EF4444',
    surgery: '#6366F1',
    icu: '#F59E0B',
    internal: '#10B981',
    pediatrics: '#0EA5E9',
    radiology: '#8B5CF6',
    other: '#64748B',
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nav.departments')}</h1>
          <p className="page-subtitle">{departments.length} service(s) configuré(s)</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Nouveau service
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '320px 1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
        {/* Liste des services */}
        <div style={selected ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'contents' }}>
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: selected ? 72 : 130, borderRadius: 12 }} />
            ))
          ) : (
            departments.map(dept => {
              const color = typeColors[dept.department_type] || typeColors.other;
              const isSelected = selected?.id === dept.id;
              return (
                <div
                  key={dept.id}
                  className="card"
                  onClick={() => setSelected(isSelected ? null : dept)}
                  style={{
                    cursor: 'pointer',
                    borderColor: isSelected ? 'var(--color-primary)' : 'var(--border-subtle)',
                    background: isSelected ? 'var(--color-primary-10)' : 'var(--bg-card)',
                    transition: 'all var(--transition-fast)',
                  }}
                >
                  <div style={{ padding: selected ? '12px 16px' : '16px 20px' }}>
                    {!selected && (
                      <div style={{ height: 4, background: color, borderRadius: 2, marginBottom: 14, marginLeft: -20, marginRight: -20, marginTop: -16 }} />
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: selected ? 32 : 42, height: selected ? 32 : 42,
                        borderRadius: 10, background: `${color}20`, color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: selected ? 14 : 18, flexShrink: 0,
                      }}>
                        {dept.code?.substring(0, 2)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: selected ? 'var(--font-sm)' : 'var(--font-md)', marginBottom: 2 }}>
                          {dept.name}
                        </p>
                        {dept.name_ar && (
                          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', direction: 'rtl', textAlign: 'right' }}>{dept.name_ar}</p>
                        )}
                        {!selected && (
                          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                            {dept.head_count || 0} médecin(s) · {dept.code}
                          </p>
                        )}
                      </div>
                      {dept.is_active ? (
                        <span className="badge badge-active" style={{ fontSize: 9 }}>Actif</span>
                      ) : (
                        <span className="badge badge-cancelled" style={{ fontSize: 9 }}>Inactif</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Détail du département sélectionné */}
        {selected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Infos */}
            <div className="card" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <h2 style={{ fontSize: 'var(--font-2xl)', fontWeight: 800, color: 'var(--text-primary)' }}>{selected.name}</h2>
                  {selected.name_ar && <p style={{ color: 'var(--text-muted)', direction: 'rtl' }}>{selected.name_ar}</p>}
                </div>
                <button className="btn btn-ghost btn-icon" onClick={() => setSelected(null)}>✕</button>
              </div>
              <div className="form-row">
                {[
                  { label: 'Code', value: selected.code },
                  { label: 'Type', value: selected.department_type },
                  { label: 'Étage', value: selected.floor || '—' },
                  { label: 'Aile', value: selected.wing || '—' },
                  { label: 'Capacité lits', value: selected.bed_count ?? '—' },
                  { label: 'Garde minimale', value: selected.min_guard_count ? `${selected.min_guard_count} médecin(s)` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>{label}</p>
                    <p style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--font-sm)' }}>{value ?? '—'}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Membres */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Membres du service</h3>
                {canUpdate && (
                  <AddMemberButton deptId={selected.id} onSuccess={() => qc.invalidateQueries(['department', selected.id])} />
                )}
              </div>
              {loadingDetail ? (
                <div style={{ padding: 20 }}>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                      <div className="skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                      <div className="skeleton" style={{ height: 14, flex: 1 }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  {(deptDetail?.members || []).map(member => (
                    <div key={member.id} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <div className="avatar avatar-sm" style={{ background: 'var(--color-primary-10)', color: 'var(--color-primary-light)' }}>
                        {getInitials(member.first_name, member.last_name)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 600, fontSize: 'var(--font-sm)', color: 'var(--text-primary)' }}>
                          Dr. {member.first_name} {member.last_name}
                        </p>
                        <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)' }}>
                          {member.grade} {member.speciality ? `· ${member.speciality}` : ''}
                          {member.is_head && <span style={{ color: 'var(--color-warning)', marginLeft: 6, fontWeight: 700 }}>★ Chef</span>}
                        </p>
                      </div>
                      {canUpdate && !member.is_head && (
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => removeMemberMutation.mutate({ deptId: selected.id, userId: member.id })}
                          title="Retirer du service"
                          style={{ color: 'var(--color-danger)' }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {(!deptDetail?.members?.length) && (
                    <p style={{ padding: '24px 20px', color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                      Aucun membre dans ce service
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <CreateDepartmentModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); qc.invalidateQueries(['departments-full']); qc.invalidateQueries(['departments']); }}
        />
      )}
    </div>
  );
}

function AddMemberButton({ deptId, onSuccess }) {
  const [show, setShow] = useState(false);
  const [userId, setUserId] = useState('');
  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users-flat'],
    queryFn: () => usersAPI.getAll({ limit: 200 }).then(r => r.data.data),
    enabled: show,
  });

  const addMutation = useMutation({
    mutationFn: () => departmentsAPI.addMember(deptId, { userId }),
    onSuccess: () => { toast.success('Membre ajouté'); setShow(false); setUserId(''); onSuccess(); },
    onError: (err) => toast.error(err.response?.data?.message || 'Erreur'),
  });

  if (!show) return (
    <button className="btn btn-primary btn-sm" onClick={() => setShow(true)}>+ Ajouter</button>
  );

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <select className="form-control" style={{ fontSize: 'var(--font-xs)', width: 220 }} value={userId} onChange={e => setUserId(e.target.value)}>
        <option value="">Choisir un médecin</option>
        {allUsers.map(u => <option key={u.id} value={u.id}>Dr. {u.first_name} {u.last_name}</option>)}
      </select>
      <button className="btn btn-success btn-sm" onClick={() => addMutation.mutate()} disabled={!userId || addMutation.isPending}>✓</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setShow(false)}>✕</button>
    </div>
  );
}

function CreateDepartmentModal({ onClose, onSuccess }) {
  const { user } = useAuthStore();
  const [form, setForm] = useState({ name: '', nameAr: '', code: '', departmentType: 'other', floor: '', bedCount: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await departmentsAPI.create({ ...form, establishmentId: user.establishmentId });
      toast.success('Service créé');
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur');
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2 className="modal-title">Nouveau service hospitalier</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Nom (FR) *</label>
                <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">الاسم (AR)</label>
                <input className="form-control" value={form.nameAr} onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))} dir="rtl" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Code *</label>
                <input className="form-control" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} maxLength={10} required />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-control" value={form.departmentType} onChange={e => setForm(f => ({ ...f, departmentType: e.target.value }))}>
                  {['emergency','surgery','icu','internal','pediatrics','radiology','other'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Étage</label>
                <input className="form-control" value={form.floor} onChange={e => setForm(f => ({ ...f, floor: e.target.value }))} placeholder="Ex: 2ème" />
              </div>
              <div className="form-group">
                <label className="form-label">Nb. lits</label>
                <input type="number" className="form-control" value={form.bedCount} onChange={e => setForm(f => ({ ...f, bedCount: e.target.value }))} min={0} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Création...' : 'Créer le service'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
