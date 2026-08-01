import React, { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

const SIZE_MAP = {
  xs:    { px: 24,  font: 9,  icon: 12 },
  sm:    { px: 32,  font: 11, icon: 15 },
  md:    { px: 40,  font: 13, icon: 18 },
  lg:    { px: 52,  font: 16, icon: 22 },
  xl:    { px: 72,  font: 22, icon: 30 },
  '2xl': { px: 96,  font: 28, icon: 40 },
};

// Palette déterministe selon les initiales
const COLORS = [
  { bg: '#EFF3FF', fg: '#1B4FCA' },
  { bg: '#ECFDF5', fg: '#059669' },
  { bg: '#FFFBEB', fg: '#D97706' },
  { bg: '#EEF2FF', fg: '#6366F1' },
  { bg: '#FDF2F8', fg: '#DB2777' },
  { bg: '#ECFEFF', fg: '#0891B2' },
  { bg: '#F5F3FF', fg: '#7C3AED' },
];

// Icône personne SVG par défaut (quand même pas d'initiales)
const PersonIcon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

function pickColor(firstName, lastName) {
  const code = ((firstName?.[0] || '').charCodeAt(0) || 0)
             + ((lastName?.[0]  || '').charCodeAt(0) || 0);
  return COLORS[code % COLORS.length];
}

/**
 * Composant Avatar universel
 * - Photo si disponible, sinon initiales colorées, sinon icône personne
 * - Fallback React-controlled (pas de manipulation DOM directe)
 * - Tailles : xs · sm · md · lg · xl · 2xl
 */
export default function Avatar({
  avatarUrl,
  firstName,
  lastName,
  size = 'md',
  style = {},
  onClick,
  className = '',
}) {
  const [imgError, setImgError] = useState(false);
  const { px, font, icon } = SIZE_MAP[size] || SIZE_MAP.md;

  const initials = ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase();
  const { bg, fg } = pickColor(firstName, lastName);

  const base = {
    width:          px,
    height:         px,
    borderRadius:   '50%',
    flexShrink:     0,
    overflow:       'hidden',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    fontWeight:     700,
    fontSize:       font,
    cursor:         onClick ? 'pointer' : 'default',
    userSelect:     'none',
    transition:     'opacity 0.2s, transform 0.15s',
    ...style,
  };

  // ── Cas 1 : URL disponible et pas d'erreur ────────────────
  if (avatarUrl && !imgError) {
    // Construire l'URL absolue
    let fullUrl = avatarUrl;
    if (!avatarUrl.startsWith('http') && !avatarUrl.startsWith('blob')) {
      fullUrl = `${API_BASE}${avatarUrl}`;
    }
    return (
      <div style={base} className={className} onClick={onClick}>
        <img
          src={fullUrl}
          alt={initials || 'Avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  // ── Cas 2 : Pas d'image — initiales ──────────────────────
  if (initials) {
    return (
      <div style={{ ...base, background: bg, color: fg }} className={className} onClick={onClick}>
        {initials}
      </div>
    );
  }

  // ── Cas 3 : Aucune info — icône personne générique ────────
  return (
    <div style={{ ...base, background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
      className={className} onClick={onClick}>
      <PersonIcon size={icon} />
    </div>
  );
}
