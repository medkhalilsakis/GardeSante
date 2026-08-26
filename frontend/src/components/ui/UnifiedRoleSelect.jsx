import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersAPI, jobTitlesAPI } from '../../api';
import toast from 'react-hot-toast';

/**
 * UnifiedRoleSelect
 * Un seul dropdown avec recherche qui regroupe :
 *   - Les roles systeme (avec acces plateforme)
 *   - Les fonctions métier du personnel
 *
 * Le panneau est rendu dans un PORTAIL positionne en `fixed` : il n'est donc
 * jamais rogne par le `overflow: auto` de la modale qui l'accueille, et il se
 * retourne vers le haut quand la place manque en bas. C'est ce qui evitait de
 * devoir scroller la modale pour voir la liste des roles.
 *
 * Props:
 *   roleCode    : string  - code du role systeme selectionne
 *   jobTitleId  : UUID    - id du titre de poste selectionne (si role=autre)
 *   onChange    : ({ roleCode, jobTitleId, label }) => void
 *   required    : bool
 *   currentRole : { code, name } - rôle déjà affecté, même s'il n'est pas
 *                 créable par l'acteur (édition de son propre profil, etc.)
 *
 * ── Harmonisation couleurs et typographie ──
 * La structure et le balisage ne changent pas ; seules les couleurs bougent.
 *
 * Les huit rôles portaient chacun sa propre paire de teintes inventées. Or la
 * pastille dit toujours le même mot — « Accès » — et le nom du rôle est écrit
 * juste à côté : les huit coloris ne distinguaient rien que le texte ne disait
 * déjà, et deux d'entre eux se lisaient comme un avertissement. Le sceau de la
 * plate-forme suffit, et il est juste : cette pastille signale un accès à la
 * plate-forme, rien d'autre.
 *
 * Les trois familles de fonction, elles, sont une vraie taxinomie. Elles
 * reprennent à l'identique les teintes d'identité déjà employées par le
 * sélecteur de personnel, pour qu'une même famille garde sa couleur d'un écran
 * à l'autre.
 *
 * Retiré au passage : le `outline: 'none'` du champ de recherche et des deux
 * champs d'ajout. Posé en style en ligne, il battait l'anneau de focus du
 * calque de jetons — le panneau vivant dans un portail, plus rien ne signalait
 * au clavier où l'on se trouvait.
 */

// Le pictogramme de chaque rôle. Il ne porte plus de couleur : la pastille
// « Accès » est du sceau pour tous, puisqu'elle dit la même chose pour tous.
const SYSTEM_ROLE_ICONS = {
  director:           '👔',
  hospital_admin:     '🏛️',
  general_supervisor: '🛡️',
  department_head:    '⭐',
  service_supervisor: '🔹',
  senior_doctor:      '👨‍⚕️',
  resident:           '🩺',
  observer:           '👁️',
};

// Une ligne d'explication par role : la liste se lit sans avoir a deviner ce
// que recouvre chaque intitule.
const SYSTEM_ROLE_HINTS = {
  director:           'Direction de l\'etablissement',
  hospital_admin:     'Administration de l\'etablissement',
  general_supervisor: 'Surveillant general de l\'hopital',
  department_head:    'Titre cumulable avec un role metier (ex. medecin senior)',
  service_supervisor: 'Plusieurs surveillants possibles pour un meme service',
  senior_doctor:      'Medecin senior du service',
  resident:           'Medecin resident / interne',
  observer:           'Consultation seule',
};

// Les trois familles de fonction, aux mêmes teintes d'identité que dans le
// sélecteur de personnel. Aucune n'est un ton d'état : une famille de métier
// n'est ni une alerte, ni un service en cours.
const JT_CAT_COLORS = {
  medical:        { bg: 'color-mix(in srgb, var(--gs-id-6) 12%, transparent)', color: 'var(--gs-id-6)' },
  administrative: { bg: 'color-mix(in srgb, var(--gs-id-3) 12%, transparent)', color: 'var(--gs-id-3)' },
  auxiliary:      { bg: 'color-mix(in srgb, var(--gs-id-7) 12%, transparent)', color: 'var(--gs-id-7)' },
};

// Ce que porte la pastille commune à tous les rôles systèmes.
const ACCESS_CHIP = { bg: 'var(--gs-seal-wash)', color: 'var(--gs-seal)' };

const JT_CAT_LABELS = {
  medical:   'Personnel médical',
  administrative: 'Personnel administratif',
  auxiliary: 'Personnel auxiliaire',
};

const normalizeCategory = (category) => {
  if (['medical', 'paramedical'].includes(category)) return 'medical';
  if (category === 'administrative') return 'administrative';
  return 'auxiliary';
};

// Hauteur des zones fixes du panneau (recherche + onglets + pied de page).
const PANEL_CHROME = 152;

export default function UnifiedRoleSelect({ roleCode, jobTitleId, onChange, required, currentRole }) {
  const qc = useQueryClient();
  const wrapperRef = useRef(null);
  const dropRef    = useRef(null);

  const [open,      setOpen]      = useState(false);
  const [search,    setSearch]    = useState('');
  const [tab,       setTab]       = useState('all');   // 'all' | 'roles' | 'titles'
  const [addMode,   setAddMode]   = useState(false);
  const [newTitle,  setNewTitle]  = useState({ name: '', category: 'auxiliary' });
  const [pos,       setPos]       = useState(null);

  // Roles systeme disponibles
  const { data: rolesData } = useQuery({
    queryKey: ['roles-available'],
    queryFn: () => usersAPI.rolesAvailable().then(r => r.data.data),
    staleTime: 120000,
  });
  const availableSystemRoles = rolesData || [];
  const systemRoles = currentRole?.code
    && currentRole.code !== 'autre'
    && !availableSystemRoles.some((role) => role.code === currentRole.code)
    ? [...availableSystemRoles, {
        id: `current-${currentRole.code}`,
        code: currentRole.code,
        name: currentRole.name || currentRole.code,
      }]
    : availableSystemRoles;

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
      setNewTitle({ name: '', category: 'auxiliary' });
      setOpen(false);
    },
    onError: (e) => toast.error(e.response?.data?.message || 'Erreur'),
  });

  // ── Positionnement du panneau (portail : coordonnees viewport) ──
  const measure = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const r  = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const spaceBelow = vh - r.bottom - 12;
    const spaceAbove = r.top - 12;
    // On se retourne vers le haut seulement si le bas est vraiment trop juste.
    const flip  = spaceBelow < 320 && spaceAbove > spaceBelow;
    const avail = Math.max(240, Math.min(560, flip ? spaceAbove : spaceBelow));
    const width = Math.min(Math.max(r.width, 340), vw - 24);
    setPos({
      left:   Math.max(12, Math.min(r.left, vw - width - 12)),
      width,
      top:    r.bottom + 6,
      bottom: vh - r.top + 6,
      flip,
      listMax: Math.max(180, avail - PANEL_CHROME),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    // `capture: true` pour capter aussi le scroll interne de la modale.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  // Fermer si clic dehors (le panneau vit dans un portail : il faut tester les
  // deux noeuds, sinon un clic dans la liste refermerait le menu) ou sur Echap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapperRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false); setAddMode(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setAddMode(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Libelle affiché dans le trigger
  const getDisplayLabel = () => {
    if (!roleCode) return null;
    if (roleCode !== 'autre') {
      const r = systemRoles.find(r => r.code === roleCode);
      return r ? { label: r.name, icon: SYSTEM_ROLE_ICONS[roleCode] || '👤', type: 'role', code: roleCode } : null;
    }
    if (jobTitleId) {
      const jt = jobTitles.find(t => t.id === jobTitleId);
      return jt ? { label: jt.name, cat: jt.category, type: 'title' } : null;
    }
    return null;
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
    const category = normalizeCategory(t.category);
    if (!titlesByCategory[category]) titlesByCategory[category] = [];
    titlesByCategory[category].push({ ...t, category });
  });

  const baseInput = {
    width: '100%', padding: '8px 12px', borderRadius: 8, boxSizing: 'border-box',
    border: '1px solid var(--gs-rule)', background: 'var(--gs-paper-alt)',
    color: 'var(--gs-ink)', fontSize: 13,
  };

  // En-tete de section, colle en haut pendant le defilement de la liste : on
  // sait toujours dans quel groupe on se trouve.
  const stickyHeader = {
    position: 'sticky', top: 0, zIndex: 2,
    padding: '6px 12px 5px', fontFamily: 'var(--gs-display)', fontSize: 10, fontWeight: 800,
    letterSpacing: '.14em', textTransform: 'uppercase',
    background: 'var(--gs-paper-alt)', borderBottom: '1px solid var(--gs-rule)',
  };

  const hasSelection = !!roleCode;
  const isEmpty = filtRoles.length === 0 && filtTitles.length === 0 && !addMode;

  const panel = (
    <div
      ref={dropRef}
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        width: pos?.width ?? 340,
        ...(pos?.flip ? { bottom: pos.bottom } : { top: pos?.top ?? 0 }),
        background: 'var(--gs-paper)', borderRadius: 10, zIndex: 3000,
        boxShadow: 'var(--gs-shadow-lift)', border: '1px solid var(--gs-rule)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {/* Recherche */}
      <div style={{ padding: '10px 10px 0' }}>
        <div style={{ position: 'relative' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--gs-ink-faint)' }}>
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

      {/* Onglets — le compteur evite de scroller pour savoir ce qu'il y a */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 10px 6px', borderBottom: '1px solid var(--gs-rule)' }}>
        {[
          { id: 'all',    label: 'Tout',            n: systemRoles.length + jobTitles.length },
          { id: 'roles',  label: 'Accès plateforme', n: systemRoles.length },
          { id: 'titles', label: 'Fonctions', n: jobTitles.length },
        ].map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            style={{
              padding: '3px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              background: tab === t.id ? 'var(--gs-seal)' : 'var(--gs-paper-alt)',
              color: tab === t.id ? '#fff' : 'var(--gs-ink-soft)',
              transition: 'all .15s',
            }}>
            {t.label} <span style={{ opacity: .65, fontWeight: 600 }}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* Liste */}
      <div style={{ maxHeight: pos?.listMax ?? 320, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {isEmpty ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--gs-ink-faint)', fontSize: 13 }}>
            Aucun resultat pour "{search}".{' '}
            <button type="button" onClick={() => { setAddMode(true); setNewTitle(n => ({ ...n, name: search })); setTab('titles'); }}
              style={{ color: 'var(--gs-seal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
              + Ajouter cette fonction
            </button>
          </div>
        ) : (
          <>
            {/* Roles systeme */}
            {filtRoles.length > 0 && (
              <div>
                <div style={{ ...stickyHeader, color: 'var(--gs-ink-faint)' }}>
                  Responsabilités avec accès plateforme
                  <span style={{ fontWeight: 400, opacity: .6 }}> ({filtRoles.length})</span>
                </div>
                {filtRoles.map(r => {
                  const isSelected = roleCode === r.code && !jobTitleId;
                  return (
                    <div
                      key={r.id}
                      onClick={() => { onChange({ roleCode: r.code, jobTitleId: null, label: r.name }); setOpen(false); setSearch(''); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                        cursor: 'pointer', borderBottom: '1px solid var(--gs-rule)',
                        background: isSelected ? 'var(--gs-seal-wash)' : 'transparent',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--gs-paper-alt)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'var(--gs-seal-wash)' : 'transparent'; }}
                    >
                      <span style={{ fontSize: 16 }}>{SYSTEM_ROLE_ICONS[r.code] || '👤'}</span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                        background: ACCESS_CHIP.bg, color: ACCESS_CHIP.color,
                      }}>
                        Accès
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: 'var(--gs-ink)', fontWeight: 500 }}>{r.name}</div>
                        {SYSTEM_ROLE_HINTS[r.code] && (
                          <div style={{ fontSize: 10, color: 'var(--gs-ink-faint)' }}>{SYSTEM_ROLE_HINTS[r.code]}</div>
                        )}
                      </div>
                      {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gs-seal)" strokeWidth="3">
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
                  ...stickyHeader,
                  color: JT_CAT_COLORS[cat]?.color || 'var(--gs-ink-faint)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: JT_CAT_COLORS[cat]?.color, flexShrink: 0 }} />
                  {JT_CAT_LABELS[cat] || cat}
                  <span style={{ fontWeight: 400, opacity: .6 }}>({titles.length})</span>
                </div>
                {titles.map(t => {
                  const isSelected = jobTitleId === t.id;
                  const colors = JT_CAT_COLORS[t.category] || { bg: 'var(--gs-paper-alt)', color: 'var(--gs-ink-soft)' };
                  return (
                    <div
                      key={t.id}
                      onClick={() => { onChange({ roleCode: 'autre', jobTitleId: t.id, label: t.name }); setOpen(false); setSearch(''); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        cursor: 'pointer', borderBottom: '1px solid var(--gs-rule)',
                        background: isSelected ? 'var(--gs-seal-wash)' : 'transparent',
                        transition: 'background .1s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'var(--gs-paper-alt)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isSelected ? 'var(--gs-seal-wash)' : 'transparent'; }}
                    >
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                        background: colors.bg, color: colors.color,
                      }}>
                        {JT_CAT_LABELS[t.category] || t.category}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--gs-ink)' }}>{t.name}</span>
                      {isSelected && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gs-seal)" strokeWidth="3">
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

      {/* Ajouter une fonction personnalisée */}
      {addMode ? (
        <div style={{ padding: '12px', borderTop: '1px solid var(--gs-rule)', background: 'var(--gs-paper-alt)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gs-ink-soft)', marginBottom: 8 }}>
            Nouvelle fonction du personnel
          </div>
          <input
            type="text"
            placeholder="Nom de la fonction..."
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
              type="button"
              onClick={() => createMut.mutate(newTitle)}
              disabled={!newTitle.name.trim() || createMut.isPending}
              style={{
                flex: 1, padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'var(--gs-seal)', color: '#fff', fontWeight: 700, fontSize: 13,
                fontFamily: 'inherit',
                opacity: !newTitle.name.trim() || createMut.isPending ? 0.5 : 1,
              }}>
              {createMut.isPending ? 'Ajout...' : '+ Ajouter'}
            </button>
            <button type="button" onClick={() => setAddMode(false)}
              style={{
                padding: '8px 14px', borderRadius: 8, border: '1px solid var(--gs-rule)',
                background: 'transparent', color: 'var(--gs-ink-soft)', cursor: 'pointer',
                fontSize: 13, fontFamily: 'inherit',
              }}>
              Annuler
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--gs-rule)' }}>
          <button type="button" onClick={() => setAddMode(true)}
            style={{
              width: '100%', padding: 8, borderRadius: 8,
              border: '1px dashed var(--gs-seal)', background: 'var(--gs-seal-wash)',
              color: 'var(--gs-seal)', cursor: 'pointer', fontWeight: 700, fontSize: 12,
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Ajouter une fonction personnalisée
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Trigger */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${open ? 'var(--gs-seal)' : (required && !hasSelection ? 'var(--gs-alert)' : 'var(--gs-rule)')}`,
          background: 'var(--gs-paper-alt)', transition: 'border-color .15s', minHeight: 40,
        }}
      >
        {display ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            {display.type === 'role' ? (
              <>
                <span style={{ fontSize: 15 }}>{display.icon}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: ACCESS_CHIP.bg,
                  color: ACCESS_CHIP.color,
                  flexShrink: 0,
                }}>
                  Role
                </span>
                <span style={{ fontSize: 13, color: 'var(--gs-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {display.label}
                </span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 15 }}>📋</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                  background: JT_CAT_COLORS[display.cat]?.bg || 'var(--gs-paper-alt)',
                  color: JT_CAT_COLORS[display.cat]?.color || 'var(--gs-ink-soft)',
                  flexShrink: 0,
                }}>
                  {JT_CAT_LABELS[display.cat] || 'Titre'}
                </span>
                <span style={{ fontSize: 13, color: 'var(--gs-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {display.label}
                </span>
              </>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--gs-ink-faint)' }}>
            — Selectionner un role ou un titre de poste —
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {hasSelection && (
            <span
              onClick={e => { e.stopPropagation(); onChange({ roleCode: null, jobTitleId: null, label: null }); }}
              style={{ color: 'var(--gs-ink-faint)', fontSize: 14, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
              title="Effacer"
            >x</span>
          )}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ color: 'var(--gs-ink-faint)', transform: open ? 'rotate(180deg)' : '', transition: 'transform .2s' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* Panneau — rendu hors de la modale pour ne pas etre rogne par son scroll */}
      {open && createPortal(panel, document.body)}
    </div>
  );
}
