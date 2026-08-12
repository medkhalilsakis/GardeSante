/**
 * Briques d'interface partagées par l'Assistant V2 (Lot 7).
 *
 * Reprend les conventions déjà en place dans le dashboard : styles en ligne,
 * variables CSS du thème (`--bg-card`, `--text-primary`…), pas de librairie UI
 * supplémentaire. Regroupées ici pour que chaque étape reste lisible.
 */

export const card = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 16,
  padding: 18,
};

export const input = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-input, var(--bg-card))',
  color: 'var(--text-primary)',
  fontSize: 13,
};

export const SEVERITY_COLOR = { error: '#DC2626', warning: '#D97706' };

export const Section = ({ title, hint, right, children }) => (
  <div style={{ ...card, marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hint ? 4 : 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', flex: 1 }}>{title}</div>
      {right}
    </div>
    {hint && (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>{hint}</div>
    )}
    {children}
  </div>
);

export const Btn = ({ children, onClick, variant = 'primary', disabled, style }) => {
  const palette = {
    primary: { background: 'var(--color-primary)', color: '#fff', border: 'none' },
    ghost: { background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' },
    danger: { background: '#DC2626', color: '#fff', border: 'none' },
  }[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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
    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
      {label}
    </span>
    {children}
  </label>
);

/** Une métrique de l'écran de choix (couverture, équité…). */
export const Metric = ({ label, value, suffix = '', tone }) => (
  <div style={{ ...card, padding: 14, textAlign: 'center', flex: 1, minWidth: 110 }}>
    <div style={{ fontSize: 22, fontWeight: 900, color: tone || 'var(--text-primary)' }}>
      {value}{suffix}
    </div>
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 600 }}>{label}</div>
  </div>
);

/** Fil d'étapes : purement indicatif, cliquable vers les étapes déjà franchies. */
export const Steps = ({ steps, current, onGo }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22, flexWrap: 'wrap' }}>
    {steps.map((label, i) => (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {i > 0 && <div style={{ width: 26, height: 2, background: 'var(--border-subtle)' }} />}
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
            background: i < current ? '#10B981' : i === current ? 'var(--color-primary)' : 'var(--border-subtle)',
            color: i <= current ? '#fff' : 'var(--text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 12,
          }}>
            {i < current ? '✓' : i + 1}
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: i === current ? 'var(--color-primary)' : 'var(--text-muted)' }}>
            {label}
          </span>
        </div>
      </div>
    ))}
  </div>
);
