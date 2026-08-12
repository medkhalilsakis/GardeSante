import React from 'react';

/**
 * Badge affichant l'état dérivé d'un planning
 * États : brouillon | soumis | en_cours | terminé
 *
 * `state` est facultatif : quand le serveur a déjà calculé l'état via la fonction
 * SQL planning_state(), on l'affiche tel quel plutôt que de le redériver côté client.
 */
export default function PlanningStateBadge({ state: stateProp, status, startDate, endDate, size = 'md' }) {
  // Dériver l'état comme la fonction SQL planning_state()
  const getState = () => {
    if (status === 'draft') return 'brouillon';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);

    if (today < start) return 'soumis';
    if (today >= start && today <= end) return 'en_cours';
    return 'termine';
  };

  const state = stateProp || getState();

  const config = {
    brouillon: {
      label: 'Brouillon',
      labelAr: 'مسودة',
      color: '#8B5CF6',
      bg: '#F3F1FF',
      borderColor: '#E0D7FF'
    },
    soumis: {
      // Un planning envoyé est effectif : il n'y a plus d'approbation à
      // attendre, il est « en vigueur » jusqu'à sa date de début.
      label: 'En vigueur',
      labelAr: 'ساري',
      color: '#3B82F6',
      bg: '#EFF6FF',
      borderColor: '#DBEAFE'
    },
    en_cours: {
      label: 'En cours',
      labelAr: 'جاري',
      color: '#10B981',
      bg: '#ECFDF5',
      borderColor: '#D1FAE5'
    },
    termine: {
      label: 'Terminé',
      labelAr: 'منتهي',
      color: '#6B7280',
      bg: '#F9FAFB',
      borderColor: '#E5E7EB'
    }
  };

  const { label, color, bg, borderColor } = config[state] || config.brouillon;

  const sizeStyles = {
    sm: { fontSize: 'var(--font-xs)', padding: '2px 8px', height: '20px' },
    md: { fontSize: 'var(--font-sm)', padding: '4px 10px', height: '24px' },
    lg: { fontSize: 'var(--font-sm)', padding: '6px 12px', height: '28px' }
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontWeight: 600,
        borderRadius: '12px',
        backgroundColor: bg,
        color: color,
        border: `1px solid ${borderColor}`,
        whiteSpace: 'nowrap',
        ...sizeStyles[size]
      }}
    >
      {label}
    </span>
  );
}
