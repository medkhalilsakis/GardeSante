import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange, Plus } from 'lucide-react';
import HospitalGuardCalendar from '../../components/calendar/HospitalGuardCalendar';
import ContextBadge from '../../components/layout/ContextBadge';
import { GsPageHeader } from '../../components/gs';
import { useAuthStore } from '../../store';
import './shifts.css';

export default function ShiftsPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const isDepartmentHead = user?.roleCode === 'department_head';

  return (
    <div className="gshifts-page gs-clamp">
      <ContextBadge variant="header" />
      <GsPageHeader
        eyebrow="Registre hospitalier"
        title="Gardes de l'hôpital"
        subtitle="Tous les services sont visibles par défaut. Les filtres du calendrier permettent d'isoler un service ou un état de planning."
        meta={[
          { icon: <CalendarRange size={14} />, value: 'Consultation mensuelle' },
          { value: 'Lecture seule' },
        ]}
        actions={isDepartmentHead ? (
          <button
            type="button"
            className="gs-btn is-primary"
            onClick={() => navigate('/chef-de-service?tab=schedules&view=new')}
          >
            <Plus size={15} /> Créer un planning
          </button>
        ) : null}
      />

      <section className="gshifts-calendar gs-card" aria-label="Calendrier hospitalier des gardes">
        <HospitalGuardCalendar title="Calendrier des gardes — tous les services" />
      </section>
    </div>
  );
}
