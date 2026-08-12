import React, { useState } from 'react';

/**
 * Carte portfolio d'un agent
 * Affiche : identité, rôle, avatar, stats rapides et indicateurs (congés en cours, absences)
 */
export default function StaffPortfolioCard({ agent, onClick, style }) {
  const [imgError, setImgError] = useState(false);

  const initials = `${agent.first_name?.[0] || ''}${agent.last_name?.[0] || ''}`.toUpperCase();
  const hasActiveLeaves = agent.active_leaves_count > 0;
  const hasAbsences = agent.shift_absences_count > 0;

  const avatarStyle = {
    width: 56,
    height: 56,
    borderRadius: '50%',
    backgroundColor: 'var(--border-subtle)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 18,
    color: 'var(--text-muted)',
    flexShrink: 0
  };

  const cardStyle = {
    backgroundColor: 'var(--bg-card)',
    borderRadius: 'var(--border-radius-lg)',
    padding: '16px',
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start',
    cursor: onClick ? 'pointer' : 'default',
    border: '1px solid var(--border-subtle)',
    transition: 'box-shadow 0.2s, transform 0.15s',
    position: 'relative',
    ...style
  };

  return (
    <div
      style={cardStyle}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-xl)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Avatar */}
      <div style={avatarStyle}>
        {agent.avatar_url && !imgError ? (
          <img
            src={agent.avatar_url}
            alt={`${agent.first_name} ${agent.last_name}`}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          initials
        )}
      </div>

      {/* Infos */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)', marginBottom: 2, color: 'var(--text-primary)' }}>
          {agent.first_name} {agent.last_name}
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 6 }}>
          {agent.role_name}
          {agent.grade ? ` · ${agent.grade}` : ''}
          {agent.speciality ? ` · ${agent.speciality}` : ''}
        </div>
        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginBottom: 8 }}>
          {agent.establishment_name}
          {agent.departments?.length > 0 ? ` · ${agent.departments.map(d => d.departmentName).join(', ')}` : ''}
        </div>

        {/* Stats + badges */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-primary)', fontWeight: 600 }}>
            🕐 {agent.total_shifts || 0} gardes
          </span>
          {hasActiveLeaves && (
            <span style={{
              fontSize: 'var(--font-xs)',
              backgroundColor: '#FEF3C7',
              color: '#D97706',
              borderRadius: 8,
              padding: '1px 8px',
              fontWeight: 600
            }}>
              🌴 Congé en cours
            </span>
          )}
          {hasAbsences && (
            <span style={{
              fontSize: 'var(--font-xs)',
              backgroundColor: '#FEE2E2',
              color: '#DC2626',
              borderRadius: 8,
              padding: '1px 8px',
              fontWeight: 600
            }}>
              ⚠️ {agent.shift_absences_count} absence{agent.shift_absences_count > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
