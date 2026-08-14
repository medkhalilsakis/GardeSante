import React from 'react';
import { useNavigate } from 'react-router-dom';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ContextBadge from '../../components/layout/ContextBadge';
import { useAuthStore } from '../../store';

export default function ShiftsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isDepartmentHead = user?.roleCode === 'department_head';

  return (
    <div>
      <ContextBadge variant="header" />
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Gardes de l'hôpital</h1>
          <p className="page-subtitle">Tous les services sont affichés par défaut. Utilisez les filtres pour isoler un service.</p>
        </div>
        {isDepartmentHead && (
          <button className="btn btn-primary" onClick={() => navigate('/chef-de-service')}>
            + Ajouter une garde
          </button>
        )}
      </div>
      <HospitalGuardCalendar title="Calendrier des gardes — tous les services" />
    </div>
  );
}
