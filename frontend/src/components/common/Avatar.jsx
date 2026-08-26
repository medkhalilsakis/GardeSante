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

/* La teinte d'un avatar est une identité, pas un état : elle ne dit rien de la
   personne, elle la distingue seulement de la suivante. C'est exactement ce que
   porte l'échelle `--gs-id-*`, qui s'inverse avec le thème — les sept paires
   figées d'origine restaient claires en thème sombre, où les initiales
   s'effaçaient sur leur pastille. Dix créneaux au lieu de sept : deux initiales
   voisines se ressemblent moins souvent.

   Les noms de jetons sont écrits en entier, jamais construits par gabarit : la
   garde `check-tokens.sh` lit le source, et un nom assemblé lui apparaîtrait
   comme un jeton inconnu. */
const ID_TONES = [
  'var(--gs-id-1)', 'var(--gs-id-2)', 'var(--gs-id-3)', 'var(--gs-id-4)', 'var(--gs-id-5)',
  'var(--gs-id-6)', 'var(--gs-id-7)', 'var(--gs-id-8)', 'var(--gs-id-9)', 'var(--gs-id-10)',
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
  const tone = ID_TONES[code % ID_TONES.length];
  return { bg: `color-mix(in srgb, ${tone} 14%, var(--gs-paper))`, fg: tone };
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
  // On mémorise l'URL qui a échoué, pas un simple booléen : l'erreur se
  // réinitialise ainsi d'elle-même dès que `avatarUrl` change. Avec un booléen,
  // un échec restait collé au composant — après l'upload d'une photo de profil,
  // la nouvelle URL arrivait bien mais l'avatar continuait d'afficher les
  // initiales tant que le composant n'était pas démonté.
  const [failedUrl, setFailedUrl] = useState(null);
  const imgError = !!avatarUrl && failedUrl === avatarUrl;
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
    // Construire l'URL absolue. Les URL déjà autoportantes (http, blob et
    // surtout `data:`, produite par FileReader pour l'aperçu local avant
    // upload) ne doivent JAMAIS être préfixées, sinon l'image est cassée.
    let fullUrl = avatarUrl;
    if (!/^(https?:|blob:|data:)/i.test(avatarUrl)) {
      fullUrl = `${API_BASE}${avatarUrl}`;
    }
    return (
      <div style={base} className={className} onClick={onClick}>
        <img
          src={fullUrl}
          alt={initials || 'Avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setFailedUrl(avatarUrl)}
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
    <div style={{ ...base, background: 'var(--gs-paper-alt)', color: 'var(--gs-ink-faint)' }}
      className={className} onClick={onClick}>
      <PersonIcon size={icon} />
    </div>
  );
}
