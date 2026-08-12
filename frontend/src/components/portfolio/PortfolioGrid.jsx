import React from 'react';
import StaffPortfolioCard from './StaffPortfolioCard';

/**
 * Grille portfolio responsive
 * @param {object[]} agents - Liste des agents
 * @param {Function} onCardClick - Callback quand une carte est cliquée (reçoit l'agent)
 * @param {string} emptyMessage - Message si la grille est vide
 */
export default function PortfolioGrid({ agents, onCardClick, emptyMessage = 'Aucun personnel trouvé.' }) {
  if (!agents || agents.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '40px 20px',
        color: 'var(--text-muted)',
        fontSize: 'var(--font-sm)'
      }}>
        👤 {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
      gap: '12px'
    }}>
      {agents.map((agent) => (
        <StaffPortfolioCard
          key={agent.id}
          agent={agent}
          onClick={onCardClick ? () => onCardClick(agent) : undefined}
        />
      ))}
    </div>
  );
}
