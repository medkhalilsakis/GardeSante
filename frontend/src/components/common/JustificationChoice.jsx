import React, { useId } from 'react';
import { Check, X } from 'lucide-react';

/* Deux qualifications qui s'opposent : un motif est retenu, ou il ne l'est pas.
   C'est un état, pas une catégorie — le service pour ce qui est en règle, le
   degré haut de l'alerte pour ce qui est fautif. Les couleurs figées d'origine
   restaient claires en thème sombre et le badge s'effaçait sur son fond. */
const OPTIONS = [
  {
    value: true,
    label: 'Justifiée',
    description: 'Un motif valable ou un justificatif existe.',
    color: 'var(--gs-duty)',
    background: 'var(--gs-duty-wash)',
  },
  {
    value: false,
    label: 'Non justifiée',
    description: 'Aucun motif valable ou justificatif n’est retenu.',
    color: 'var(--gs-alert-strong)',
    background: 'var(--gs-alert-wash)',
  },
];

export function JustificationBadge({ value, emptyLabel = 'Non renseignée' }) {
  if (typeof value !== 'boolean') {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: 999,
        fontSize: 11, fontWeight: 700, color: 'var(--gs-ink-faint)', background: 'var(--gs-paper-alt)',
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
      /* Le suffixe `35` collé à la couleur ne tenait que parce qu'elle était un
         hexadécimal. Avec un jeton, il faut un mélange. */
      border: `1px solid color-mix(in srgb, ${option.color} 34%, transparent)`, whiteSpace: 'nowrap',
    }}>
      {value ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <X size={12} strokeWidth={3} aria-hidden="true" />}
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
        {label}{required && <span style={{ color: 'var(--gs-alert-strong)' }}> *</span>}
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
              border: `1px solid ${selected ? option.color : 'var(--gs-rule)'}`,
              background: selected ? option.background : 'var(--gs-paper)',
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
                <span style={{ display: 'block', color: selected ? option.color : 'var(--gs-ink)', fontSize: 13, fontWeight: 800 }}>
                  {subject} {option.label.toLowerCase()}
                </span>
                <span style={{ display: 'block', marginTop: 2, color: 'var(--gs-ink-faint)', fontSize: 10.5, lineHeight: 1.35 }}>
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
