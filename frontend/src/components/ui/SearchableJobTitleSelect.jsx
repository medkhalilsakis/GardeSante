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

/* Six catégories de titres de poste : de la distinction, pas un état. Les
   couleurs d'identité `--gs-id-*` sont faites pour ça et suivent le thème. On
   écarte `--gs-id-1/2/4`, identiques au cachet, au service et à l'alerte en
   thème clair : une catégorie ne doit jamais se lire comme un état. */
const CAT_COLORS = {
  medical:   { bg: 'color-mix(in srgb, var(--gs-id-8) 14%, transparent)',      color: 'var(--gs-id-8)' },
  surgical:  { bg: 'color-mix(in srgb, var(--gs-id-10) 14%, transparent)',     color: 'var(--gs-id-10)' },
  nursing:   { bg: 'color-mix(in srgb, var(--gs-id-5) 14%, transparent)',      color: 'var(--gs-id-5)' },
  admin:     { bg: 'color-mix(in srgb, var(--gs-id-3) 14%, transparent)',      color: 'var(--gs-id-3)' },
  technical: { bg: 'color-mix(in srgb, var(--gs-id-6) 14%, transparent)',      color: 'var(--gs-id-6)' },
  other:     { bg: 'color-mix(in srgb, var(--gs-ink-faint) 14%, transparent)', color: 'var(--gs-ink-soft)' },
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

  /* Pas de `outline: 'none'` : un style en ligne bat toutes les règles, et le
     champ était le seul de la plateforme à n'avoir aucun repère au clavier. */
  const inputSt = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid var(--gs-rule)', background: 'var(--gs-paper-alt)',
    color: 'var(--gs-ink)', fontSize: 13, boxSizing: 'border-box',
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', ...style }}>
      {/* ── Champ declencheur ─────────────────────────────────── */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${open ? 'var(--gs-seal)' : (required && !value ? 'var(--gs-alert-strong)' : 'var(--gs-rule)')}`,
          background: 'var(--gs-paper-alt)',
          transition: 'border-color .15s',
        }}
      >
        {selected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
              background: CAT_COLORS[selected.category]?.bg || CAT_COLORS.other.bg,
              color: CAT_COLORS[selected.category]?.color || CAT_COLORS.other.color,
              flexShrink: 0,
            }}>
              {CATEGORIES.find(c => c.id === selected.category)?.label || selected.category}
            </span>
            <span style={{ fontSize: 13, color: 'var(--gs-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.name}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--gs-ink-faint)' }}>{placeholder}</span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {value && (
            <span
              onClick={e => { e.stopPropagation(); onChange(null, null); }}
              style={{ color: 'var(--gs-ink-faint)', fontSize: 14, lineHeight: 1, padding: '0 2px', cursor: 'pointer' }}
              title="Effacer"
            >
              x
            </span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--gs-ink-faint)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : '' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* ── Dropdown ──────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: 'var(--gs-paper)', borderRadius: 10, zIndex: 500,
          boxShadow: 'var(--gs-shadow-lift)', border: '1px solid var(--gs-rule)',
          overflow: 'hidden',
        }}>
          {/* Barre de recherche */}
          <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--gs-rule)' }}>
            <div style={{ position: 'relative' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gs-ink-faint)' }}>
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
          <div style={{ display: 'flex', gap: 4, padding: '6px 10px', overflowX: 'auto', borderBottom: '1px solid var(--gs-rule)' }}>
            {CATEGORIES.map(c => (
              <button key={c.id} onClick={() => setActiveCat(c.id)}
                style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  border: 'none', cursor: 'pointer', flexShrink: 0,
                  background: activeCat === c.id ? 'var(--gs-seal)' : 'var(--gs-paper-alt)',
                  color: activeCat === c.id ? 'var(--gs-on-tone)' : 'var(--gs-ink-soft)',
                  transition: 'all .15s',
                }}>
                {c.label}
              </button>
            ))}
          </div>

          {/* Liste */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
                Chargement...
              </div>
            ) : filtered.length === 0 && !addMode ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
                Aucun titre trouve.{' '}
                <button onClick={() => { setAddMode(true); setNewTitle(n => ({ ...n, name: search })); }}
                  style={{ color: 'var(--gs-seal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                  + Ajouter "{search}"
                </button>
              </div>
            ) : (
              filtered.map(t => (
                <div key={t.id} onClick={() => { onChange(t.id, t.name); setOpen(false); setSearch(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    cursor: 'pointer', borderBottom: '1px solid var(--gs-rule)',
                    background: t.id === value ? 'var(--gs-seal-wash)' : 'transparent',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--gs-paper-alt)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = t.id === value ? 'var(--gs-seal-wash)' : 'transparent'; }}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                    background: CAT_COLORS[t.category]?.bg || CAT_COLORS.other.bg,
                    color: CAT_COLORS[t.category]?.color || CAT_COLORS.other.color,
                  }}>
                    {CATEGORIES.find(c => c.id === t.category)?.label || t.category}
                  </span>
                  <span style={{ flex: 1, fontSize: 13, color: 'var(--gs-ink)' }}>{t.name}</span>
                  {t.id === value && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gs-seal)" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </div>
              ))
            )}
          </div>

          {/* ── Formulaire ajout titre custom ─────────────────── */}
          {addMode ? (
            <div style={{ padding: '12px', borderTop: '1px solid var(--gs-rule)', background: 'var(--gs-paper-alt)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-soft)', marginBottom: 8 }}>
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
                    background: 'var(--gs-seal)', color: 'var(--gs-on-tone)', fontWeight: 700, fontSize: 13,
                    opacity: !newTitle.name.trim() || createMut.isPending ? 0.5 : 1,
                  }}
                >
                  {createMut.isPending ? 'Ajout...' : '+ Ajouter'}
                </button>
                <button
                  onClick={() => setAddMode(false)}
                  style={{
                    padding: '8px 14px', borderRadius: 8, border: '1px solid var(--gs-rule)',
                    background: 'transparent', color: 'var(--gs-ink-soft)', cursor: 'pointer', fontSize: 13,
                  }}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '8px 12px', borderTop: '1px solid var(--gs-rule)' }}>
              <button
                onClick={() => setAddMode(true)}
                style={{
                  width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--gs-seal)',
                  background: 'var(--gs-seal-wash)', color: 'var(--gs-seal)', cursor: 'pointer',
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
