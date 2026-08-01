import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersAPI, jobTitlesAPI } from '../../api';
import toast from 'react-hot-toast';

/**
 * UnifiedRoleSelect
 * Un seul dropdown avec recherche qui regroupe :
 *   - Les roles systeme (avec acces plateforme)
 *   - Les titres de poste (role "Autre" - sans acces)
 *
 * Props:
 *   roleCode    : string  - code du role systeme selectionne
 *   jobTitleId  : UUID    - id du titre de poste selectionne (si role=autre)
 *   onChange    : ({ roleCode, jobTitleId, label }) => void
 *   required    : bool
 */

const SYSTEM_ROLE_COLORS = {
  director:           { bg: '#EFF6FF', color: '#1D4ED8', icon: '👔' },
  general_supervisor: { bg: '#F0FDF4', color: '#15803D', icon: '🛡️' },
  department_head:    { bg: '#FEF3C7', color: '#B45309', icon: '⭐' },
  service_supervisor: { bg: '#FDF2F8', color: '#9333EA', icon: '🔹' },
  senior_doctor:      { bg: '#F0F9FF', color: '#0284C7', icon: '👨‍⚕️' },
  resident:           { bg: '#F8FAFC', color: '#64748B', icon: '🩺' },
  autre:              { bg: '#F1F5F9', color: '#475569', icon: '👤' },
};

const JT_CAT_COLORS = {
  medical:   { bg: '#EFF6FF', color: '#3B82F6' },
  surgical:  { bg: '#FEF3C7', color: '#D97706' },
  nursing:   { bg: '#ECFDF5', color: '#059669' },
  admin:     { bg: '#F5F3FF', color: '#7C3AED' },
  technical: { bg: '#F0F9FF', color: '#0891B2' },
  other:     { bg: '#F3F4F6', color: '#6B7280' },
};

const JT_CAT_LABELS = {
  medical:   'Medical',
  surgical:  'Chirurgical',
  nursing:   'Paramedical',
  admin:     'Administratif',
  technical:  'Technique / Logistique',
  other:     'Autre',
};

export default function UnifiedRoleSelect({ roleCode, jobTitleId, onChange, required }) {
  const qc = useQueryClient();
  const wrapperRef = useRef(null);

  const [open,      setOpen]      = useState(false);
  const [search,    setSearch]    = useState('');
  const [tab,       setTab]       = useState('all');   // 'all' | 'roles' | 'titles'
  const [addMode,   setAddMode]   = useState(false);
  const [newTitle,  setNewTitle]  = useState({ name: '', category: 'other' });

  // Roles systeme disponibles
  const { data: rolesData } = useQuery({
    queryKey: ['roles-available'],
    queryFn: () => usersAPI.rolesAvailable().then(r => r.data.data),
    staleTime: 120000,
  });
  const systemRoles = rolesData || [];

  // Titres de poste
  const { data: titlesData } = useQuery({
    queryKey: ['job-titles', 'all'],
    queryFn: () => jobTitlesAPI.getAll().then(r => r.data.data),
    staleTime: 60000,
  });
  const jobTitles = titlesData || [];

  // Creer titre custom
  const createMut = useMutation({
    mutationFn: (d) => jobTitlesAPI.create(d),
    onSuccess: (res) => {
      toast.success('Titre ajoute');
      qc.invalidateQueries(['job-titles']);
      const jt = res.data.data;
      onChange({ roleCode: 'autre', jobTitleId: jt.id, label: jt.name });
      setAddMode(false);
      setNewTitle({ name: '', category: 'other' });
      setOpen(false);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  // Fermer si clic dehors
  useEffect(() => {
    const h = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false); setAddMode(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Libelle affiché dans le trigger
  const getDisplayLabel = () => {
    if (!roleCode) return null;
    if (roleCode !== 'autre') {
      const r = systemRoles.find(r => r.code === roleCode);
      return r ? { label: r.name, icon: SYSTEM_ROLE_COLORS[roleCode]?.icon || '👤', type: 'role', code: roleCode } : null;
    }
    if (jobTitleId) {
      const jt = jobTitles.find(t => t.id === jobTitleId);
      return jt ? { label: jt.name, cat: jt.category, type: 'title' } : null;
    }
    return { label: 'Autre Personnel', icon: '👤', type: 'role', code: 'autre' };
  };

  const display = getDisplayLabel();

  // Filtrage
  const q = search.toLowerCase();
  const filtRoles = systemRoles.filter(r =>
    (tab === 'all' || tab === 'roles') && (!q || r.name.toLowerCase().includes(q))
  );
  const filtTitles = jobTitles.filter(t =>
    (tab === 'all' || tab === 'titles') && (!q || t.name.toLowerCase().includes(q))
  );

  // Grouper les titres par categorie
  const titlesByCategory = {};
  filtTitles.forEach(t => {
    if (!titlesByCategory[t.category]) titlesByCategory[t.category] = [];
    titlesByCategory[t.category].push(t);
  });

  const baseInput = {
    width: '100%', padding: '8px 12px', borderRadius: 8, boxSizing: 'border-box',
    border: '1px solid var(--border-default)', background: 'var(--bg-input)',
    color: 'var(--text-primary)', fontSize: 13, outline: 'none',
  };

  const hasSelection = !!roleCode;
  const isEmpty = filtRoles.length === 0 && filtTitles.length === 0 && !addMode;

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${open ? 'var(--color-primary)' : (required && !hasSelection ? 'var(--color-danger)' : 'var(--border-default)')}`,
          background: 'var(--bg-input)', transition: 'border-color .15s', minHeight: 40,
        }}
      >
        {display ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {display.type === 'role' ? (
              <>
                <span style={{ fontSize: 15 }}>{display.icon}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: SYSTEM_ROLE_COLORS[display.code]?.bg || '#F3F4F6',
                  color: SYSTEM_ROLE_COLORS[display.code]?.color || '#374151',
                  flexShrink: 0,
                }}>
                  Role
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {display.label}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 15 }}>📋</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: JT_CAT_COLORS[display.cat]?.bg || '#F3F4F6',
                  color: JT_CAT_COLORS[display.cat]?.color || '#374151',
                  flexShrink: 0,
                }}>
                  {JT_CAT_LABELS[display.cat] || 'Titre'}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {display.label}
                </span>
              </>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            — Selectionner un role ou un titre de poste —
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hasSelection && (
            <span
              onClick={e => { e.stopPropagation(); onChange({ roleCode: null, jobTitleId: null, label: null }); }}
              style={{ color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
              title="Effacer"
            >x</span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : '', transition: 'transform .2s' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-card)', borderRadius: 10, zIndex: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,.18)', border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }}>
          {/* Recherche */}
          <div style={{ padding: '10px 10px 0' }}>
            <div style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="Rechercher (ex: Surveillant, ORL, Ambulancier...)"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                style={{ ...baseInput, paddingLeft: 32 }}
              />
            </div>
          </div>

          {/* Onglets */}
          <div style={{ display: 'flex', gap: 4, padding: '8px 10px 6px', borderBottom: '1px solid var(--border-subtle)' }}>
            {[
              { id: 'all',    label: 'Tout' },
              { id: 'roles',  label: 'Roles systeme' },
              { id: 'titles', label: 'Titres de poste' },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{
                  padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  border: 'none', cursor: 'pointer',
                  background: tab === t.id ? 'var(--color-primary)' : 'var(--bg-elevated)',
                  color: tab === t.id ? '#fff' : 'var(--text-secondary)',
                  transition: 'all .15s',
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Liste */}
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {isEmpty ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Aucun resultat pour "{search}".{' '}
                <button onClick={() => { setAddMode(true); setNewTitle(n => ({ ...n, name: search })); setTab('titles'); }}
                  style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                  + Ajouter ce titre
                </button>
              </div>
            ) : (
              <>
                {/* Roles systeme */}
                {filtRoles.length > 0 && (
                  <div>
                    <div style={{
                      padding: '6px 12px 3px', fontSize: 10, fontWeight: 800,
                      color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase',
                      background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      Roles avec acces plateforme
                    </div>
                    {filtRoles.map(r => {
                      const isSelected = roleCode === r.code && !jobTitleId;
                      const colors = SYSTEM_ROLE_COLORS[r.code] || { bg: '#F3F4F6', color: '#374151', icon: '👤' };
                      return (
                        <div
                          key={r.id}
                          onClick={() => { onChange({ roleCode: r.code, jobTitleId: null, label: r.name }); setOpen(false); setSearch(''); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                            cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
                            background: isSelected ? 'rgba(27,79,202,.06)' : 'transparent',
                            transition: 'background .1s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(27,79,202,.06)' : 'transparent'; }}
                        >
                          <span style={{ fontSize: 16 }}>{colors.icon}</span>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                            background: colors.bg, color: colors.color,
                          }}>
                            Role
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{r.name}</div>
                            {r.code === 'autre' && (
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Choisissez un titre de poste ci-dessous</div>
                            )}
                          </div>
                          {isSelected && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Titres de poste par categorie */}
                {Object.entries(titlesByCategory).map(([cat, titles]) => (
                  <div key={cat}>
                    <div style={{
                      padding: '6px 12px 3px', fontSize: 10, fontWeight: 800,
                      color: JT_CAT_COLORS[cat]?.color || '#6B7280',
                      letterSpacing: '.08em', textTransform: 'uppercase',
                      background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)',
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: JT_CAT_COLORS[cat]?.color, flexShrink: 0 }} />
                      {JT_CAT_LABELS[cat] || cat}
                      <span style={{ fontWeight: 400, opacity: .6 }}>({titles.length})</span>
                    </div>
                    {titles.map(t => {
                      const isSelected = jobTitleId === t.id;
                      const colors = JT_CAT_COLORS[t.category] || { bg: '#F3F4F6', color: '#374151' };
                      return (
                        <div
                          key={t.id}
                          onClick={() => { onChange({ roleCode: 'autre', jobTitleId: t.id, label: t.name }); setOpen(false); setSearch(''); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                            cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
                            background: isSelected ? 'rgba(27,79,202,.06)' : 'transparent',
                            transition: 'background .1s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'rgba(27,79,202,.06)' : 'transparent'; }}
                        >
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                            background: colors.bg, color: colors.color,
                          }}>
                            {JT_CAT_LABELS[t.category] || t.category}
                          </span>
                          <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{t.name}</span>
                          {isSelected && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Ajouter un titre custom */}
          {addMode ? (
            <div style={{ padding: '12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Nouveau titre (sans acces plateforme)
              </div>
              <input
                type="text"
                placeholder="Nom du titre..."
                value={newTitle.name}
                onChange={e => setNewTitle(n => ({ ...n, name: e.target.value }))}
                style={{ ...baseInput, marginBottom: 8 }}
                autoFocus
              />
              <select value={newTitle.category} onChange={e => setNewTitle(n => ({ ...n, category: e.target.value }))}
                style={{ ...baseInput, marginBottom: 10 }}>
                {Object.entries(JT_CAT_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => createMut.mutate(newTitle)}
                  disabled={!newTitle.name.trim() || createMut.isPending}
                  style={{
                    flex: 1, padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 13,
                    opacity: !newTitle.name.trim() || createMut.isPending ? 0.5 : 1,
                  }}>
                  {createMut.isPending ? 'Ajout...' : '+ Ajouter'}
                </button>
                <button onClick={() => setAddMode(false)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-default)',
                    background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13,
                  }}>
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)' }}>
              <button onClick={() => setAddMode(true)}
                style={{
                  width: '100%', padding: 8, borderRadius: 8,
                  border: '1px dashed var(--color-primary)', background: 'rgba(27,79,202,.04)',
                  color: 'var(--color-primary)', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Ajouter un titre de poste personnalise
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
