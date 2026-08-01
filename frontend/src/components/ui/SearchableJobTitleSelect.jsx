import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { jobTitlesAPI } from '../../api';
import toast from 'react-hot-toast';

const CATEGORIES = [
  { id: '',          label: 'Toutes' },
  { id: 'medical',   label: 'Medical' },
  { id: 'surgical',  label: 'Chirurgical' },
  { id: 'nursing',   label: 'Paramedical' },
  { id: 'admin',     label: 'Administratif' },
  { id: 'technical', label: 'Technique' },
  { id: 'other',     label: 'Autre' },
];

const CAT_COLORS = {
  medical:   { bg: '#EFF6FF', color: '#3B82F6' },
  surgical:  { bg: '#FEF3C7', color: '#D97706' },
  nursing:   { bg: '#ECFDF5', color: '#059669' },
  admin:     { bg: '#F5F3FF', color: '#7C3AED' },
  technical: { bg: '#F0F9FF', color: '#0891B2' },
  other:     { bg: '#F3F4F6', color: '#6B7280' },
};

/**
 * SearchableJobTitleSelect
 *
 * Props:
 *   value       : UUID du job_title selectionne (ou null)
 *   onChange    : (id, name) => void
 *   placeholder : string
 *   required    : bool
 *   style       : object (optionnel, applique au wrapper)
 */
export default function SearchableJobTitleSelect({ value, onChange, placeholder = 'Rechercher un titre...', required, style }) {
  const qc = useQueryClient();
  const wrapperRef = useRef(null);

  const [open,        setOpen]        = useState(false);
  const [search,      setSearch]      = useState('');
  const [activeCat,   setActiveCat]   = useState('');
  const [addMode,     setAddMode]      = useState(false);
  const [newTitle,    setNewTitle]    = useState({ name: '', category: 'other' });

  // ── Charger les titres de poste ──────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['job-titles', activeCat],
    queryFn:  () => jobTitlesAPI.getAll({ category: activeCat || undefined }).then(r => r.data.data),
    staleTime: 60000,
  });
  const allTitles = data || [];

  // ── Filtrage local par recherche ─────────────────────────────
  const filtered = allTitles.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase())
  );

  // ── Titre selectionne (pour l'affichage) ─────────────────────
  const selected = allTitles.find(t => t.id === value) || null;

  // ── Mutation : creer un titre custom ─────────────────────────
  const createMut = useMutation({
    mutationFn: (d) => jobTitlesAPI.create(d),
    onSuccess: (res) => {
      toast.success('Titre ajoute avec succes');
      qc.invalidateQueries(['job-titles']);
      onChange(res.data.data.id, res.data.data.name);
      setAddMode(false);
      setNewTitle({ name: '', category: 'other' });
      setOpen(false);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  // ── Fermer si clic en dehors ──────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setAddMode(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const inputSt = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid var(--border-default)', background: 'var(--bg-input)',
    color: 'var(--text-primary)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', ...style }}>
      {/* ── Champ declencheur ─────────────────────────────────── */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${open ? 'var(--color-primary)' : (required && !value ? 'var(--color-danger)' : 'var(--border-default)')}`,
          background: 'var(--bg-input)',
          transition: 'border-color .15s',
        }}
      >
        {selected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
              background: CAT_COLORS[selected.category]?.bg || '#F3F4F6',
              color: CAT_COLORS[selected.category]?.color || '#6B7280',
              flexShrink: 0,
            }}>
              {CATEGORIES.find(c => c.id === selected.category)?.label || selected.category}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.name}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{placeholder}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {value && (
            <span
              onClick={e => { e.stopPropagation(); onChange(null, null); }}
              style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}
              title="Effacer"
            >
              x
            </span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--text-muted)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : '' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* ── Dropdown ──────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--bg-card)', borderRadius: 10, zIndex: 500,
          boxShadow: '0 8px 32px rgba(0,0,0,.18)', border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
        }}>
          {/* Barre de recherche */}
          <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="Rechercher..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...inputSt, paddingLeft: 32 }}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Filtres par categorie */}
          <div style={{ display: 'flex', gap: 4, padding: '6px 10px', overflowX: 'auto', borderBottom: '1px solid var(--border-subtle)' }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setActiveCat(c.id)}
                style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: activeCat === c.id ? 'var(--color-primary)' : 'var(--bg-elevated)',
                  color: activeCat === c.id ? '#fff' : 'var(--text-secondary)',
                  transition: 'all .15s',
                }}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Liste */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Chargement...
              </div>
            ) : filtered.length === 0 && !addMode ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Aucun titre trouve.{' '}
                <button onClick={() => { setAddMode(true); setNewTitle(n => ({ ...n, name: search })); }}
                  style={{ color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  + Ajouter "{search}"
                </button>
              </div>
            ) : (
              filtered.map(t => (
                <div key={t.id} onClick={() => { onChange(t.id, t.name); setOpen(false); setSearch(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)',
                    background: t.id === value ? 'rgba(27,79,202,.06)' : 'transparent',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = t.id === value ? 'rgba(27,79,202,.06)' : 'transparent'; }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                    background: CAT_COLORS[t.category]?.bg || '#F3F4F6',
                    color: CAT_COLORS[t.category]?.color || '#6B7280',
                  }}>
                    {CATEGORIES.find(c => c.id === t.category)?.label || t.category}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{t.name}</span>
                  {t.id === value && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
              ))
            )}
          </div>

          {/* ── Formulaire ajout titre custom ─────────────────── */}
          {addMode ? (
            <div style={{ padding: '12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Nouveau titre de poste (sans acces plateforme)
              </div>
              <input
                type="text"
                placeholder="Nom du titre..."
                value={newTitle.name}
                onChange={e => setNewTitle(n => ({ ...n, name: e.target.value }))}
                style={{ ...inputSt, marginBottom: 8 }}
                autoFocus
              />
              <select
                value={newTitle.category}
                onChange={e => setNewTitle(n => ({ ...n, category: e.target.value }))}
                style={{ ...inputSt, marginBottom: 10 }}
              >
                {CATEGORIES.filter(c => c.id).map(c => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => createMut.mutate(newTitle)}
                  disabled={!newTitle.name.trim() || createMut.isPending}
                  style={{
                    flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'var(--color-primary)', color: '#fff', fontWeight: 700, fontSize: 13,
                    opacity: !newTitle.name.trim() || createMut.isPending ? 0.5 : 1,
                  }}
                >
                  {createMut.isPending ? 'Ajout...' : '+ Ajouter'}
                </button>
                <button
                  onClick={() => setAddMode(false)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border-default)',
                    background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13,
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)' }}>
              <button
                onClick={() => setAddMode(true)}
                style={{
                  width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--color-primary)',
                  background: 'rgba(27,79,202,.04)', color: 'var(--color-primary)', cursor: 'pointer',
                  fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Ajouter un nouveau titre
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
