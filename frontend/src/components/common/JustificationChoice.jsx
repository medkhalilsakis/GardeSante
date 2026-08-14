import React, { useId } from 'react';

const OPTIONS = [
  {
    value: true,
    label: 'Justifiée',
    description: 'Un motif valable ou un justificatif existe.',
    color: '#059669',
    background: 'rgba(16, 185, 129, .10)',
  },
  {
    value: false,
    label: 'Non justifiée',
    description: 'Aucun motif valable ou justificatif n’est retenu.',
    color: '#DC2626',
    background: 'rgba(239, 68, 68, .10)',
  },
];

export function JustificationBadge({ value, emptyLabel = 'Non renseignée' }) {
  if (typeof value !== 'boolean') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999,
        fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-elevated)',
        whiteSpace: 'nowrap',
      }}>
        {emptyLabel}
      </span>
    );
  }

  const option = OPTIONS.find((item) => item.value === value);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, color: option.color, background: option.background,
      border: `1px solid ${option.color}35`, whiteSpace: 'nowrap',
    }}>
      <span aria-hidden="true">{value ? '✓' : '✕'}</span>
      {option.label}
    </span>
  );
}

export default function JustificationChoice({
  value,
  onChange,
  subject = 'Absence',
  label = 'Qualification',
  required = false,
  disabled = false,
}) {
  const generatedName = useId();

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} disabled={disabled}>
      <legend className="form-label" style={{ marginBottom: 7 }}>
        {label}{required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      </legend>
      <div role="radiogroup" aria-label={`${label} de ${subject.toLowerCase()}`} style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 8,
      }}>
        {OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <label key={String(option.value)} style={{
              display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 12px',
              borderRadius: 9, cursor: disabled ? 'not-allowed' : 'pointer',
              border: `1px solid ${selected ? option.color : 'var(--border-default)'}`,
              background: selected ? option.background : 'var(--bg-card)',
              opacity: disabled ? 0.6 : 1,
            }}>
              <input
                type="radio"
                name={generatedName}
                checked={selected}
                onChange={() => onChange(option.value)}
                required={required}
                style={{ marginTop: 2, accentColor: option.color }}
              />
              <span>
                <span style={{ display: 'block', color: selected ? option.color : 'var(--text-primary)', fontSize: 13, fontWeight: 800 }}>
                  {subject} {option.label.toLowerCase()}
                </span>
                <span style={{ display: 'block', marginTop: 2, color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.35 }}>
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
