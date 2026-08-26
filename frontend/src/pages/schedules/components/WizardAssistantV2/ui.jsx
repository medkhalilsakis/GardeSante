/**
 * Briques d'interface partagées par l'Assistant V2 (Lot 7).
 *
 * Reprend les conventions déjà en place dans le dashboard : styles en ligne,
 * jetons du thème (`--gs-paper`, `--gs-ink`…), pas de librairie UI
 * supplémentaire. Regroupées ici pour que chaque étape reste lisible.
 */
import { Check } from 'lucide-react';

export const card = {
  background: 'var(--gs-paper)',
  border: '1px solid var(--gs-rule)',
  borderRadius: 16,
  padding: 18,
};

export const input = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--gs-rule)',
  background: 'var(--gs-paper-alt)',
  color: 'var(--gs-ink)',
  fontSize: 13,
};

/* Deux degrés d'un même axe : ce qui empêche d'avancer, et ce qui prévient.
   L'alerte appuyée est le degré haut du système, l'alerte simple le degré bas ;
   il n'existe pas de jeton rouge, et il ne doit pas en exister — une anomalie
   bloquante n'est pas d'une autre nature qu'un avertissement, elle est plus
   grave. */
export const SEVERITY_COLOR = { error: 'var(--gs-alert-strong)', warning: 'var(--gs-alert)' };

export const Section = ({ title, hint, right, children }) => (
  <div style={{ ...card, marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hint ? 4 : 14 }}>
      <div style={{ fontFamily: 'var(--gs-display)', fontSize: 15, fontWeight: 700, letterSpacing: '-.015em', color: 'var(--gs-ink)', flex: 1 }}>{title}</div>
      {right}
    </div>
    {hint && (
      <div style={{ fontSize: 12, color: 'var(--gs-ink-faint)', marginBottom: 14 }}>{hint}</div>
    )}
    {children}
  </div>
);

export const Btn = ({ children, onClick, variant = 'primary', disabled, style, title }) => {
  const palette = {
    primary: { background: 'var(--gs-seal)', color: 'var(--gs-on-tone)', border: 'none' },
    ghost: { background: 'transparent', color: 'var(--gs-ink)', border: '1px solid var(--gs-rule)' },
    danger: { background: 'var(--gs-alert-strong)', color: 'var(--gs-on-tone)', border: 'none' },
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...palette,
        padding: '9px 16px',
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
};

export const Field = ({ label, children, width }) => (
  <label style={{ display: 'block', width }}>
    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--gs-ink-faint)', marginBottom: 4 }}>
      {label}
    </span>
    {children}
  </label>
);

/** Une métrique de l'écran de choix (couverture, équité…). */
export const Metric = ({ label, value, suffix = '', tone }) => (
  <div style={{ ...card, padding: 14, textAlign: 'center', flex: 1, minWidth: 110 }}>
    <div style={{ fontFamily: 'var(--gs-data)', fontSize: 22, fontWeight: 700, color: tone || 'var(--gs-ink)' }}>
      {value}{suffix}
    </div>
    <div style={{ fontSize: 11, color: 'var(--gs-ink-faint)', marginTop: 2, fontWeight: 600 }}>{label}</div>
  </div>
);

/** Fil d'étapes : purement indicatif, cliquable vers les étapes déjà franchies. */
export const Steps = ({ steps, current, onGo }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
    {steps.map((label, i) => (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {i > 0 && <div style={{ width: 26, height: 2, background: 'var(--gs-rule)' }} />}
        <div
          onClick={() => i < current && onGo?.(i)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: i < current ? 'pointer' : 'default',
            opacity: i > current ? 0.45 : 1,
          }}
        >
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: i < current ? 'var(--gs-duty)' : i === current ? 'var(--gs-seal)' : 'var(--gs-rule)',
            color: i <= current ? 'var(--gs-on-tone)' : 'var(--gs-ink-faint)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 12,
          }}>
            {i < current ? <Check size={13} strokeWidth={3} /> : i + 1}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: i === current ? 'var(--gs-seal)' : 'var(--gs-ink-faint)' }}>
            {label}
          </span>
        </div>
      </div>
    ))}
  </div>
);
