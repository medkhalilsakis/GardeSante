import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { historyAPI } from '../../api';
import { useAuthStore } from '../../store';
import Avatar from '../../components/common/Avatar';

// ── Métadonnées visuelles par action ─────────────────────────
const ACTION_META = {
  login:              { icon: '🔑', color: '#059669', label: 'Connexion' },
  logout:             { icon: '🚪', color: '#6B7280', label: 'Déconnexion' },
  profile_update:     { icon: '✏️',  color: '#6366F1', label: 'Profil modifié' },
  profile_approved:   { icon: '✅', color: '#059669', label: 'Profil approuvé' },
  profile_rejected:   { icon: '❌', color: '#EF4444', label: 'Profil refusé' },
  password_change:    { icon: '🔒', color: '#D97706', label: 'Mot de passe changé' },
  avatar_upload:      { icon: '📷', color: '#0891B2', label: 'Photo mise à jour' },
  avatar_delete:      { icon: '🗑️', color: '#EF4444', label: 'Photo supprimée' },
  absence_create:     { icon: '📋', color: '#7C3AED', label: 'Absence créée' },
  absence_approve:    { icon: '✔️', color: '#059669', label: 'Absence approuvée' },
  shift_create:       { icon: '🕐', color: '#1B4FCA', label: 'Garde créée' },
  schedule_publish:   { icon: '📅', color: '#059669', label: 'Planning publié' },
  account_created:    { icon: '👤', color: '#0891B2', label: 'Compte créé' },
  account_deactivated:{ icon: '🚫', color: '#EF4444', label: 'Compte clôturé' },
};

const getActionMeta = (action) =>
  ACTION_META[action] || { icon: '📌', color: '#6B7280', label: action };

const SEVERITY_COLOR = {
  info:     'var(--text-muted)',
  warning:  '#D97706',
  error:    '#EF4444',
  critical: '#9B1C1C',
};

const CATEGORY_LABELS = {
  auth:     '🔑 Authentification',
  profile:  '👤 Profil',
  schedule: '📅 Planning',
  absence:  '📋 Absences',
  shift:    '🕐 Gardes',
  admin:    '🛡️ Administration',
  general:  '📌 Général',
};

// ── Formatage date ────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ── Ligne de log ──────────────────────────────────────────────
function LogRow({ entry, showUser = false }) {
  const [open, setOpen] = useState(false);
  const meta = getActionMeta(entry.action);
  const hasExtra = entry.metadata && Object.keys(entry.metadata).length > 0;

  return (
    <div style={{
      borderBottom: '1px solid var(--border-subtle)',
      padding: '12px 0',
      cursor: hasExtra ? 'pointer' : 'default',
    }} onClick={() => hasExtra && setOpen(o => !o)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Icône action */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: `${meta.color}18`, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 16,
        }}>
          {meta.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Ligne principale */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {showUser && entry.first_name && (
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                {entry.first_name} {entry.last_name}
              </span>
            )}
            <span style={{
              background: `${meta.color}18`, color: meta.color,
              borderRadius: 6, padding: '1px 8px', fontSize: 11, fontWeight: 700,
            }}>
              {meta.label}
            </span>
            {entry.category && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {CATEGORY_LABELS[entry.category] || entry.category}
              </span>
            )}
            {entry.severity !== 'info' && (
              <span style={{ fontSize: 11, color: SEVERITY_COLOR[entry.severity], fontWeight: 600 }}>
                ⚠️ {entry.severity}
              </span>
            )}
          </div>

          {/* Description */}
          {entry.description && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '3px 0 0', lineHeight: 1.4 }}>
              {entry.description}
            </p>
          )}

          {/* Méta */}
          <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🕐 {fmtDate(entry.created_at)}</span>
            {entry.ip_address && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🌐 {entry.ip_address}</span>
            )}
            {showUser && entry.establishment_name && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🏥 {entry.establishment_name}</span>
            )}
            {hasExtra && (
              <span style={{ fontSize: 11, color: 'var(--color-primary-light)' }}>
                {open ? '▲ Masquer détails' : '▼ Voir détails'}
              </span>
            )}
          </div>

          {/* Détails JSON */}
          {open && hasExtra && (
            <div style={{
              marginTop: 8, background: 'var(--bg-elevated)',
              borderRadius: 8, padding: '10px 14px',
              border: '1px solid var(--border-subtle)',
              fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {JSON.stringify(entry.metadata, null, 2)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Filtres ───────────────────────────────────────────────────
function Filters({ filters, onChange, categories, showUserSearch = false, users = [], onUserChange, selectedUserId }) {
  return (
    <div style={{
      display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20,
      background: 'var(--bg-elevated)', borderRadius: 10, padding: 14,
      border: '1px solid var(--border-subtle)',
    }}>
      {showUserSearch && (
        <select value={selectedUserId} onChange={e => onUserChange(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-default)',
            background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, minWidth: 200 }}>
          <option value="">Tous les utilisateurs</option>
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.first_name} {u.last_name} — {u.role_name}</option>
          ))}
        </select>
      )}
      <select value={filters.category || ''} onChange={e => onChange({ ...filters, category: e.target.value })}
        style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-default)',
          background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }}>
        <option value="">Toutes catégories</option>
        {categories.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>)}
      </select>
      <input type="date" value={filters.from || ''} onChange={e => onChange({ ...filters, from: e.target.value })}
        style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-default)',
          background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }}
        title="Depuis" />
      <input type="date" value={filters.to || ''} onChange={e => onChange({ ...filters, to: e.target.value })}
        style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-default)',
          background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }}
        title="Jusqu'à" />
      <button onClick={() => { onChange({}); onUserChange?.(''); }} style={{
        padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-default)',
        background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
      }}>↺ Réinitialiser</button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PAGE PRINCIPALE
// ══════════════════════════════════════════════════════════════
export default function HistoryPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.roleCode === 'super_admin';

  const [page,          setPage]          = useState(1);
  const [filters,       setFilters]       = useState({});
  const [selectedUser,  setSelectedUser]  = useState('');
  const [tab,           setTab]           = useState('mine'); // 'mine' | 'all'

  const { data: cats = [] } = useQuery({
    queryKey: ['history-cats'],
    queryFn: () => historyAPI.getCategories().then(r => r.data.data),
  });

  const { data: usersList = [] } = useQuery({
    queryKey: ['history-users-list'],
    queryFn: () => historyAPI.getUsersList().then(r => r.data.data),
    enabled: isSuperAdmin,
  });

  // Mon historique
  const { data: myData, isLoading: myLoading } = useQuery({
    queryKey: ['history-mine', page, filters],
    queryFn: () => historyAPI.getMine({ page, limit: 30, ...filters }).then(r => r.data),
    enabled: tab === 'mine',
  });

  // Historique global (super admin)
  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ['history-all', page, filters, selectedUser],
    queryFn: () => historyAPI.getAll({ page, limit: 40, userId: selectedUser || undefined, ...filters }).then(r => r.data),
    enabled: tab === 'all' && isSuperAdmin,
  });

  const isLoading = tab === 'mine' ? myLoading : allLoading;
  const result    = tab === 'mine' ? myData    : allData;
  const logs      = result?.data || [];
  const total     = result?.pagination?.total || 0;
  const totalPages = Math.ceil(total / (tab === 'mine' ? 30 : 40));

  const handleFiltersChange = (f) => { setFilters(f); setPage(1); };
  const handleUserChange    = (id) => { setSelectedUser(id); setPage(1); };

  // Utilisateur sélectionné pour l'en-tête
  const selUser = selectedUser ? usersList.find(u => u.id === selectedUser) : null;

  return (
    <div>
      {/* En-tête */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            background: 'linear-gradient(135deg,#1B4FCA,#6366F1)', borderRadius: 12,
            padding: 12, display: 'flex',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
              <polyline points="12,6 12,12 16,14"/>
            </svg>
          </div>
          <div>
            <h1 className="page-title" style={{ marginBottom: 0 }}>Historique des activités</h1>
            <p className="page-subtitle">Journal complet, en lecture seule · {total} entrée{total > 1 ? 's' : ''}</p>
          </div>
        </div>
      </div>

      {/* Onglets (super admin seulement) */}
      {isSuperAdmin && (
        <div style={{
          display: 'flex', gap: 4, background: 'var(--bg-elevated)',
          borderRadius: 10, padding: 4, marginBottom: 20, width: 'fit-content',
        }}>
          {[
            { id: 'mine', label: '👤 Mon historique' },
            { id: 'all',  label: '🛡️ Tous les utilisateurs' },
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setPage(1); setFilters({}); }} style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 'var(--font-sm)', fontFamily: 'inherit',
              background: tab === t.id ? 'var(--color-primary)' : 'transparent',
              color: tab === t.id ? '#fff' : 'var(--text-secondary)',
              transition: 'all 0.2s',
            }}>{t.label}</button>
          ))}
        </div>
      )}

      {/* Infos user sélectionné (admin) */}
      {tab === 'all' && selUser && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 16px',
          marginBottom: 16, border: '1px solid var(--border-subtle)',
        }}>
          <Avatar avatarUrl={selUser.avatar_url} firstName={selUser.first_name} lastName={selUser.last_name} size="md" />
          <div>
            <p style={{ fontWeight: 700, margin: 0 }}>{selUser.first_name} {selUser.last_name}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {selUser.role_name} · 🏥 {selUser.establishment_name}
            </p>
          </div>
        </div>
      )}

      {/* Filtres */}
      <Filters
        filters={filters}
        onChange={handleFiltersChange}
        categories={cats}
        showUserSearch={tab === 'all' && isSuperAdmin}
        users={usersList}
        onUserChange={handleUserChange}
        selectedUserId={selectedUser}
      />

      {/* Bandeau lecture seule */}
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
        borderRadius: 8, padding: '8px 14px', marginBottom: 16,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          <strong>Lecture seule</strong> — L'historique ne peut pas être modifié ni supprimé.
        </p>
      </div>

      {/* Liste */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-default)',
        borderRadius: 12, padding: '4px 20px',
      }}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 12px' }}>
              <path d="M21 12a9 9 0 11-6.219-8.56"/>
            </svg>
            Chargement de l'historique…
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <p style={{ fontSize: 42, marginBottom: 12 }}>📋</p>
            <p style={{ color: 'var(--text-muted)' }}>
              {Object.values(filters).some(Boolean) ? 'Aucun résultat pour ces filtres' : 'Aucune activité enregistrée pour le moment'}
            </p>
          </div>
        ) : (
          logs.map(entry => (
            <LogRow key={entry.id} entry={entry} showUser={tab === 'all'} />
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            ← Précédent
          </button>
          <span style={{ lineHeight: '36px', fontSize: 13, color: 'var(--text-muted)' }}>
            Page {page} / {totalPages} · {total} entrée{total > 1 ? 's' : ''}
          </span>
          <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            Suivant →
          </button>
        </div>
      )}
    </div>
  );
}
