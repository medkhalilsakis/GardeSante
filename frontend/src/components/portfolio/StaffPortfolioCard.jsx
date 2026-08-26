import React from 'react';
import { ChevronRight } from 'lucide-react';
import Avatar from '../common/Avatar';
import { GsBadge } from '../gs';

const nameOf = (agent) => `${agent?.first_name || ''} ${agent?.last_name || ''}`.trim() || 'Personnel sans nom';
const departmentsOf = (agent) => (agent?.departments || []).map((department) => department.departmentName || department.name).filter(Boolean).join(', ');

export default function StaffPortfolioCard({ agent, onClick }) {
  const name = nameOf(agent);
  const departments = departmentsOf(agent);
  const hasActiveLeaves = Number(agent?.active_leaves_count || 0) > 0;
  const absenceCount = Number(agent?.shift_absences_count || 0);

  return (
    <button type="button" className="gsport-card" onClick={onClick} disabled={!onClick}>
      <Avatar avatarUrl={agent?.avatar_url} firstName={agent?.first_name} lastName={agent?.last_name} size="lg" />
      <span className="gsport-card-copy">
        <strong>{name}</strong>
        <small>{[agent?.role_name, agent?.job_title, agent?.grade].filter(Boolean).join(' · ') || 'Fonction non renseignée'}</small>
        <small>{[agent?.establishment_name, departments].filter(Boolean).join(' · ') || 'Service non renseigné'}</small>
        <span className="gsport-card-meta">
          {hasActiveLeaves ? <GsBadge tone="alert" dot>En congé</GsBadge> : null}
          {absenceCount > 0 ? <GsBadge tone="alert" dot>{absenceCount} absence{absenceCount > 1 ? 's' : ''}</GsBadge> : null}
          {!hasActiveLeaves && absenceCount === 0 ? <span>Situation sans signalement</span> : null}
        </span>
      </span>
      {onClick ? <ChevronRight className="gsport-card-arrow" size={16} aria-hidden="true" /> : null}
    </button>
  );
}
