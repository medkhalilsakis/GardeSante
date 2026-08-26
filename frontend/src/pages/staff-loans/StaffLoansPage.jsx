import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, BellRing, ClipboardList, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '../../store';
import { staffLoansAPI } from '../../api';
import ContextBadge from '../../components/layout/ContextBadge';
import { GsEmpty, GsPageHeader, GsPanel, GsStat, GsStatRail, GsTabRail } from '../../components/gs';
import StaffLoansPanel from '../schedules/components/StaffLoansPanel';
import StaffLoansOverview from '../supervision/components/StaffLoansOverview';
import ScheduleLoanPicker from './components/ScheduleLoanPicker';
import ScheduleLoanBoard from './components/ScheduleLoanBoard';
import './staff-loans.css';

const DECIDERS = ['department_head'];
const WATCHERS = ['general_supervisor', 'director', 'hospital_admin'];

export default function StaffLoansPage() {
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const canDecide = DECIDERS.includes(user?.roleCode);
  const isWatcher = WATCHERS.includes(user?.roleCode);
  const [view, setView] = useState(focusId ? 'all' : 'by-schedule');
  const [schedule, setSchedule] = useState(null);

  const { data: incoming } = useQuery({
    queryKey: ['staff-loans-page', 'incoming'],
    queryFn: () => staffLoansAPI.getAll({ direction: 'incoming' }).then((response) => response.data?.data || []),
    enabled: canDecide,
    refetchInterval: 60000,
  });
  const { data: outgoing } = useQuery({
    queryKey: ['staff-loans-page', 'outgoing'],
    queryFn: () => staffLoansAPI.getAll({ direction: 'outgoing' }).then((response) => response.data?.data || []),
    enabled: canDecide,
    refetchInterval: 60000,
  });
  const inList = incoming || [];
  const outList = outgoing || [];
  const pendingIn = inList.filter((loan) => loan.status === 'pending').length;
  const pendingOut = outList.filter((loan) => loan.status === 'pending').length;
  const focusFound = Boolean(focusId && [...inList, ...outList].some((loan) => loan.id === focusId));
  const focusLoading = canDecide && (!incoming || !outgoing);

  return (
    <div className="gsloan-wrap">
      <ContextBadge variant="header" />
      <GsPageHeader
        eyebrow="Coordination inter-service"
        title="Prêts de personnel"
        subtitle={canDecide ? 'Traitez les demandes reçues et suivez les agents prêtés à votre service.' : 'Consultez les mouvements de personnel entre les services de votre établissement.'}
        meta={canDecide ? [{ label: 'Demandes visibles', value: inList.length + outList.length }, { label: 'Focus', value: focusId ? (focusFound ? 'trouvé' : focusLoading ? 'recherche' : 'absent') : 'aucun' }] : []}
        rail={canDecide ? <GsStatRail><GsStat label="Reçues en attente" value={pendingIn} tone={pendingIn ? 'alert' : undefined} /><GsStat label="Envoyées en attente" value={pendingOut} /><GsStat label="Demandes reçues" value={inList.length} /><GsStat label="Demandes envoyées" value={outList.length} /></GsStatRail> : null}
      >
        {canDecide ? <GsTabRail label="Vues des prêts" tabs={[{ id: 'by-schedule', label: 'Par garde', icon: <ClipboardList size={14} /> }, { id: 'all', label: 'Tous les prêts', icon: <ArrowLeftRight size={14} /> }]} value={view} onChange={(next) => { setView(next); if (next === 'by-schedule') setSchedule(null); }} /> : null}
      </GsPageHeader>

      {focusId ? <div className={`gsloan-notice${focusFound ? '' : ' is-alert'}`}><BellRing size={15} aria-hidden="true" /><span>{focusFound ? 'La demande issue de votre notification est mise en évidence ci-dessous.' : focusLoading ? 'Recherche de la demande liée à votre notification…' : 'La demande liée à cette notification n’est plus disponible. Les autres demandes restent consultables.'}</span></div> : null}

      {canDecide ? (
        view === 'by-schedule'
          ? (schedule ? <ScheduleLoanBoard garde={schedule} onBack={() => setSchedule(null)} /> : <ScheduleLoanPicker onSelect={setSchedule} />)
          : <StaffLoansPanel focusId={focusId} />
      ) : isWatcher ? (
        <StaffLoansOverview focusId={focusId} />
      ) : (
        <GsPanel><GsEmpty bare icon={<ShieldAlert size={27} />} title="Prêts non accessibles" hint="La coordination des prêts est réservée aux chefs de service et à la supervision de l’établissement." /></GsPanel>
      )}
    </div>
  );
}
