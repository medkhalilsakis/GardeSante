import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersAPI, departmentsAPI } from '../../api';
import { useAuthStore } from '../../store';
import { useTranslation, getInitials, formatDate, getStatusBadgeClass } from '../../utils/helpers';
import toast from 'react-hot-toast';

export default function UsersPage() {
  const { user, hasPermission } = useAuthStore();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ roleCode: '', departmentId: '', isActive: '' });
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users', search, filters, page],
    queryFn: () => usersAPI.getAll({ search, ...filters, page, limit: 20 }).then(r => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsAPI.getAll().then(r => r.data.data),
  });

  const users = usersData?.data || [];
  const pagination = usersData?.pagination || {};

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }) => usersAPI.update(id, { isActive }),
    onSuccess: () => { toast.success('Utilisateur mis à jour'); qc.invalidateQueries(['users']); },
  });

  const roleOptions = [
    { value: '', label: 'Tous les rôles' },
    { value: 'hospital_admin', label: 'Administrateur' },
    { value: 'director', label: 'Directeur' },
    { value: 'general_supervisor', label: 'Surveillant Général' },
    { value: 'department_head', label: 'Chef de Service' },
    { value: 'service_supervisor', label: 'Surveillant de Service' },
    { value: 'senior_doctor', label: 'Médecin Senior' },
    { value: 'resident', label: 'Résident' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('nav.users')}</h1>
          <p className="page-subtitle">{pagination.total || 0} utilisateur(s)</p>
        </div>
        {hasPermission('users.create') && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Ajouter un utilisateur
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="card mb-6" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className="form-control"
              style={{ paddingLeft: 40 }}
              placeholder={t('common.search')}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
          <select className="form-control" style={{ width: 'auto' }} value={filters.roleCode} onChange={e => setFilters(f => ({ ...f, roleCode: e.target.value }))}>
            {roleOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className="form-control" style={{ width: 'auto' }} value={filters.departmentId} onChange={e => setFilters(f => ({ ...f, departmentId: e.target.value }))}>
            <option value="">Tous les services</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="form-control" style={{ width: 'auto' }} value={filters.isActive} onChange={e => setFilters(f => ({ ...f, isActive: e.target.value }))}>
            <option value="">Tous</option>
            <option value="true">Actifs</option>
            <option value="false">Désactivés</option>
          </select>
        </div>
      </div>

      {/* Grille d'utilisateurs */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 120, borderRadius: 12 }} />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="card" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
          Aucun utilisateur trouvé
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {users.map(u => (
            <div key={u.id} className="card" style={{ padding: '16px 20px', opacity: u.is_active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div className="avatar avatar-lg" style={{
                  background: 'var(--color-primary-10)', color: 'var(--color-primary-light)',
                  fontSize: 'var(--font-lg)', fontWeight: 800, flexShrink: 0,
                }}>
                  {getInitials(u.first_name, u.last_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                    {u.first_name} {u.last_name}
                  </p>
                  <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {u.matricule} · {u.email}
                  </p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{
                      background: 'var(--color-primary-10)', color: 'var(--color-primary-light)',
                      fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    }}>
                      {t(`roles.${u.role_code}`)}
                    </span>
                    {u.speciality && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px', background: 'var(--bg-elevated)', borderRadius: 4 }}>
                        {u.speciality}
                      </span>
                    )}
                    {u.is_on_leave && <span className="badge badge-warning" style={{ fontSize: 9 }}>En congé</span>}
                    {!u.is_active && <span className="badge badge-cancelled" style={{ fontSize: 9 }}>Désactivé</span>}
                  </div>
                </div>
                {hasPermission('users.update') && (
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => setSelectedUser(u)}
                    title="Modifier"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="pagination" style={{ justifyContent: 'center', marginTop: 24 }}>
          <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>←</button>
          <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-sm)', padding: '0 12px' }}>
            Page {page} / {pagination.totalPages}
          </span>
          <button className="pagination-btn" onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))} disabled={page === pagination.totalPages}>→</button>
        </div>
      )}
    </div>
  );
}
