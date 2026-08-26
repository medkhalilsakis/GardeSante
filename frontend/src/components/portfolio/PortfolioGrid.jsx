import React from 'react';
import { UsersRound } from 'lucide-react';
import { GsEmpty } from '../gs';
import StaffPortfolioCard from './StaffPortfolioCard';

export default function PortfolioGrid({ agents, onCardClick, emptyMessage = 'Aucun personnel trouvé.' }) {
  if (!agents || agents.length === 0) {
    return <GsEmpty icon={<UsersRound size={26} strokeWidth={1.6} />} title={emptyMessage} hint="Aucun membre ne correspond aux critères actuels." />;
  }

  return (
    <div className="gsport-grid" aria-label="Personnel du service">
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
