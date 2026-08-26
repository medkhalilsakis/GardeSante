import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { schedulesAPI, staffLoansAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import { GsBadge, GsEmpty, GsFilterBar, GsPanel, GsSkeleton } from '../../../components/gs';
import { frenchRange } from '../../../utils/frenchDates';
import '../staff-loans.css';

const LOAN_HARD_LIMIT = 100;
const dateRange = (start, end) => frenchRange(start, end) || 'Période non renseignée';

export default function ScheduleLoanPicker({ onSelect }) {
  const [search, setSearch] = useState('');
  const [onlyWithLoans, setOnlyWithLoans] = useState(false);
  const { data: scheduleResponse, isLoading: schedulesLoading } = useQuery({ queryKey: ['schedules', 'loan-picker'], queryFn: () => schedulesAPI.getAll({ limit: 100 }) });
  const { data: loanResponse, isLoading: loansLoading } = useQuery({ queryKey: ['staff-loans', 'picker'], queryFn: () => staffLoansAPI.getAll({}), refetchInterval: 60000 });
  const schedules = useMemo(() => scheduleResponse?.data?.data || [], [scheduleResponse]);
  const loans = useMemo(() => loanResponse?.data?.data || [], [loanResponse]);
  const schedulesById = useMemo(() => {
    const map = new Map();
    schedules.forEach((schedule) => map.set(schedule.id, {
      id: schedule.id,
      name: schedule.name || 'Planning sans nom',
      departmentName: schedule.department_name || 'Service non renseigné',
      departmentId: schedule.department_id,
      startDate: schedule.start_date,
      endDate: schedule.end_date,
      state: schedule.state,
      status: schedule.status,
      mine: true,
      total: 0,
      pending: 0,
      toDecide: 0,
    }));
    loans.forEach((loan) => {
      if (!loan.schedule_id) return;
      const current = map.get(loan.schedule_id) || {
        id: loan.schedule_id,
        name: loan.schedule_name || 'Planning d’un autre service',
        departmentName: loan.schedule_department_name || loan.requesting_department_name || 'Service non renseigné',
        departmentId: null,
        startDate: loan.schedule_start,
        endDate: loan.schedule_end,
        state: loan.schedule_state,
        status: loan.schedule_status,
        mine: false,
        total: 0,
        pending: 0,
        toDecide: 0,
      };
      current.total += 1;
      if (loan.status === 'pending') {
        current.pending += 1;
        if (loan.is_incoming) current.toDecide += 1;
      }
      map.set(loan.schedule_id, current);
    });
    return [...map.values()].sort((a, b) => (b.toDecide - a.toDecide) || (b.pending - a.pending) || String(b.startDate || '').localeCompare(String(a.startDate || '')));
  }, [loans, schedules]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('fr');
    return schedulesById.filter((schedule) => {
      if (onlyWithLoans && schedule.total === 0) return false;
      if (!term) return true;
      return `${schedule.name} ${schedule.departmentName}`.toLocaleLowerCase('fr').includes(term);
    });
  }, [onlyWithLoans, schedulesById, search]);
  const loading = schedulesLoading || loansLoading;
  const focusCount = schedulesById.reduce((total, schedule) => total + schedule.toDecide, 0);

  return (
    <GsPanel
      title="Choisir une garde"
      sub="Ouvrez une garde pour consulter ses demandes ou demander un agent d’un autre service."
      icon={<ClipboardList size={16} />}
    >
      <GsFilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Nom de la garde ou service' }}
        end={<label className="gsloan-check"><input type="checkbox" checked={onlyWithLoans} onChange={(event) => setOnlyWithLoans(event.target.checked)} /> Avec des prêts uniquement</label>}
      />
      {focusCount > 0 ? <div className="gsloan-inline-alert"><GsBadge tone="alert" dot>{focusCount} demande(s) à décider</GsBadge><span>Les gardes concernées sont placées en tête de liste.</span></div> : null}
      {loading ? <GsSkeleton variant="rows" count={5} /> : null}
      {!loading && filtered.length === 0 ? <GsEmpty bare title={search || onlyWithLoans ? 'Aucune garde ne correspond aux critères' : 'Aucune garde accessible'} hint={search || onlyWithLoans ? 'Réinitialisez les critères pour élargir la liste.' : 'Un planning doit exister avant de pouvoir gérer un prêt.'} /> : null}
      {!loading && filtered.length > 0 ? <div className="gsloan-schedule-list">{filtered.map((schedule) => <button type="button" className={`gsloan-schedule${schedule.toDecide ? ' is-alert' : ''}`} key={schedule.id} onClick={() => onSelect(schedule)}><span className="gsloan-schedule-copy"><span className="gsloan-schedule-title"><strong>{schedule.name}</strong><PlanningStateBadge state={schedule.state} status={schedule.status} startDate={schedule.startDate} endDate={schedule.endDate} size="sm" />{!schedule.mine ? <GsBadge tone="seal">Autre service</GsBadge> : null}</span><small>{schedule.departmentName} · {dateRange(schedule.startDate, schedule.endDate)}</small></span><span className="gsloan-schedule-counts">{schedule.toDecide ? <GsBadge tone="alert" dot>{schedule.toDecide} à décider</GsBadge> : null}{schedule.pending - schedule.toDecide > 0 ? <GsBadge tone="alert">{schedule.pending - schedule.toDecide} en attente</GsBadge> : null}<GsBadge tone={schedule.total ? 'duty' : 'quiet'}>{schedule.total} prêt{schedule.total > 1 ? 's' : ''}</GsBadge><ArrowRight size={16} aria-hidden="true" /></span></button>)}</div> : null}
      {loans.length >= LOAN_HARD_LIMIT ? <p className="gsloan-footnote">Les compteurs portent sur les {LOAN_HARD_LIMIT} prêts les plus récents. Le détail d’une garde est toujours rechargé séparément.</p> : null}
    </GsPanel>
  );
}
