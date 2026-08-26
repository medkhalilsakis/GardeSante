import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Search, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulesAPI, staffLoansAPI } from '../../../api';
import { useAuthStore } from '../../../store';
import Avatar from '../../../components/common/Avatar';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';
import { GsBadge, GsEmpty, GsPanel, GsSkeleton } from '../../../components/gs';
import { frenchRange, longFrenchDate } from '../../../utils/frenchDates';
import '../staff-loans.css';

const STATUS_META = {
  pending: { label: 'En attente', tone: 'alert' },
  approved: { label: 'Accepté', tone: 'duty' },
  auto_approved: { label: 'Auto-accepté', tone: 'duty' },
  rejected: { label: 'Refusé', tone: 'quiet' },
};

const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const personName = (person) => `${person?.staff_last_name || person?.last_name || ''} ${person?.staff_first_name || person?.first_name || ''}`.trim() || 'Personnel';

export default function ScheduleLoanBoard({ garde, onBack }) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isChef = user?.roleCode === 'department_head';
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState(null);
  const [shiftDate, setShiftDate] = useState(() => {
    const today = todayKey();
    if (garde.startDate && today < garde.startDate) return garde.startDate;
    if (garde.endDate && today > garde.endDate) return garde.startDate || today;
    return today;
  });

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(staffSearch.trim()), 300);
    return () => clearTimeout(handle);
  }, [staffSearch]);

  const { data: loanResponse, isLoading } = useQuery({
    queryKey: ['staff-loans', 'board', garde.id],
    queryFn: () => staffLoansAPI.getAll({ scheduleId: garde.id }),
    refetchInterval: 60000,
  });
  const loans = useMemo(() => loanResponse?.data?.data || [], [loanResponse]);
  const { data: staffResponse, isFetching: searching } = useQuery({
    queryKey: ['hospital-staff', 'loan-request', debounced],
    queryFn: () => schedulesAPI.getHospitalStaff({ search: debounced, limit: 25 }),
    enabled: formOpen && debounced.length >= 2,
  });
  const candidates = useMemo(() => staffResponse?.data?.data || [], [staffResponse]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['staff-loans'] });
    queryClient.invalidateQueries({ queryKey: ['staff-loans-page'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const decide = useMutation({
    mutationFn: ({ id, decision, reason: decisionReason }) => staffLoansAPI.decide(id, { decision, reason: decisionReason || undefined }),
    onSuccess: (response, variables) => {
      toast.success(response?.data?.message || (variables.decision === 'approved' ? 'Demande acceptée' : 'Demande refusée'));
      setRejecting(null);
      setReason('');
      refresh();
      queryClient.invalidateQueries({ queryKey: ['schedule-detail'] });
    },
    onError: (error) => toast.error(error?.response?.data?.message || 'Échec de la décision'),
  });
  const request = useMutation({
    mutationFn: () => staffLoansAPI.request({ staffUserId: picked.id, scheduleId: garde.id, shiftDate }),
    onSuccess: (response) => {
      toast.success(response?.data?.message || 'Demande de prêt envoyée');
      setPicked(null);
      setStaffSearch('');
      setFormOpen(false);
      refresh();
    },
    onError: (error) => toast.error(error?.response?.data?.message || 'Échec de la demande de prêt'),
  });

  const incoming = loans.filter((loan) => loan.is_incoming);
  const outgoing = loans.filter((loan) => !loan.is_incoming);
  const toDecide = incoming.filter((loan) => loan.status === 'pending').length;
  const dateOutOfRange = Boolean(shiftDate && ((garde.startDate && shiftDate < garde.startDate) || (garde.endDate && shiftDate > garde.endDate)));
  const closeForm = () => { setFormOpen(false); setPicked(null); setStaffSearch(''); };

  const renderLoan = (loan) => {
    const name = personName(loan);
    const rejectingThis = rejecting?.id === loan.id;
    const status = STATUS_META[loan.status] || { label: loan.status || 'État inconnu', tone: 'quiet' };
    return (
      <article className="gsloan-record" key={loan.id} data-status={loan.status}>
        <div className="gsloan-record-main">
          <div className="gsloan-record-copy">
            <strong>{name}</strong>
            <small>{loan.is_incoming ? `Demandé par ${`${loan.requester_first_name || ''} ${loan.requester_last_name || ''}`.trim() || 'un chef'} · ${loan.requesting_department_name || 'service non renseigné'}` : `Service propriétaire : ${loan.owner_department_name || 'non renseigné'}`} · garde du {longFrenchDate(String(loan.shift_date || '').slice(0, 10))}</small>
            {loan.response_reason ? <p>Motif : {loan.response_reason}</p> : null}
          </div>
          <GsBadge tone={status.tone} dot={loan.status === 'pending'}>{status.label}</GsBadge>
          {loan.is_incoming && loan.status === 'pending' && !rejectingThis ? <div className="gsloan-record-actions"><button type="button" className="gs-btn is-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: loan.id, decision: 'approved' })}>Accepter</button><button type="button" className="gs-btn is-danger" disabled={decide.isPending} onClick={() => { setRejecting({ id: loan.id, name }); setReason(''); }}>Refuser</button></div> : null}
        </div>
        {rejectingThis ? <div className="gsloan-reject"><p>En cas de refus, la ligne de {name} sera retirée du tableur demandeur sans changer l’état du planning.</p><input className="form-control" autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motif du refus (optionnel)" /><div className="gsloan-record-actions"><button type="button" className="gs-btn" onClick={() => { setRejecting(null); setReason(''); }}>Annuler</button><button type="button" className="gs-btn is-danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: loan.id, decision: 'rejected', reason })}>{decide.isPending ? 'Envoi…' : 'Confirmer le refus'}</button></div></div> : null}
      </article>
    );
  };

  return (
    <div className="gsloan-board">
      <GsPanel>
        <div className="gsloan-board-head">
          <button type="button" className="gs-btn is-quiet" onClick={onBack}><ArrowLeft size={14} /> Changer de garde</button>
          <div className="gsloan-board-title"><div><strong>{garde.name}</strong><PlanningStateBadge state={garde.state} status={garde.status} startDate={garde.startDate} endDate={garde.endDate} size="sm" /></div><small>{garde.departmentName} · {frenchRange(garde.startDate, garde.endDate) || 'Période non renseignée'}{toDecide ? ` · ${toDecide} demande(s) à décider` : ''}</small></div>
          {isChef && garde.mine && !formOpen ? <button type="button" className="gs-btn is-primary" onClick={() => setFormOpen(true)}><Plus size={14} /> Demander un prêt</button> : null}
        </div>
      </GsPanel>

      {isChef && garde.mine && formOpen ? <GsPanel title="Demander un agent d’un autre service" sub="La demande est envoyée au chef du service propriétaire, qui accepte ou refuse." tools={<button type="button" className="gs-btn is-quiet" onClick={closeForm} aria-label="Fermer le formulaire"><X size={15} /></button>} tone="duty"><div className="gsloan-request-grid"><div className="gsloan-request-person"><label className="gsloan-field"><span>Agent</span>{picked ? <div className="gsloan-picked"><Avatar avatarUrl={picked.avatar_url} firstName={picked.first_name} lastName={picked.last_name} size="sm" /><div><strong>{personName(picked)}</strong><small>{picked.dept_name || 'Sans service'}{picked.role_name ? ` · ${picked.role_name}` : ''}</small></div><button type="button" className="gs-btn is-quiet" onClick={() => setPicked(null)}>Changer</button></div> : <><div className="gsloan-search"><Search size={14} /><input type="search" value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} placeholder="Nom, prénom ou matricule" /></div>{debounced.length >= 2 ? <div className="gsloan-candidates">{searching ? <span>Recherche…</span> : null}{!searching && candidates.length === 0 ? <span>Aucun agent trouvé.</span> : null}{candidates.map((candidate) => <button type="button" key={candidate.id} onClick={() => setPicked(candidate)}><Avatar avatarUrl={candidate.avatar_url} firstName={candidate.first_name} lastName={candidate.last_name} size="xs" /><span><strong>{personName(candidate)}</strong><small>{candidate.dept_name || 'Sans service'}{candidate.role_name ? ` · ${candidate.role_name}` : ''}</small></span>{garde.departmentId && candidate.dept_id === garde.departmentId ? <GsBadge tone="quiet">Votre service</GsBadge> : null}</button>)}</div> : null}</>}</label></div><label className="gsloan-field"><span>Journée de garde</span><input className="form-control" type="date" value={shiftDate} min={garde.startDate || undefined} max={garde.endDate || undefined} onChange={(event) => setShiftDate(event.target.value)} /><small className={dateOutOfRange ? 'is-alert' : ''}>{dateOutOfRange ? 'Date hors de la période du planning.' : frenchRange(garde.startDate, garde.endDate)}</small></label></div><div className="gsloan-form-actions"><button type="button" className="gs-btn" onClick={closeForm}>Annuler</button><button type="button" className="gs-btn is-primary" disabled={!picked || !shiftDate || dateOutOfRange || request.isPending} onClick={() => request.mutate()}>{request.isPending ? 'Envoi…' : 'Envoyer la demande'}</button></div></GsPanel> : null}

      <GsPanel title="Prêts de cette garde" sub={`${loans.length} demande(s), dont ${toDecide} à traiter.`}>
        {isLoading ? <GsSkeleton variant="rows" count={4} /> : null}
        {!isLoading && loans.length === 0 ? <GsEmpty bare icon={<UserRound size={26} />} title="Aucun prêt sur cette garde" hint={isChef && garde.mine ? 'Utilisez « Demander un prêt » pour sélectionner un agent.' : 'Aucune demande ne vous concerne sur ce planning.'} /> : null}
        {incoming.length ? <section className="gsloan-group"><header><strong>Reçues — votre décision</strong><small>Agents de votre service demandés par un autre chef.</small></header><div className="gsloan-records">{incoming.map(renderLoan)}</div></section> : null}
        {outgoing.length ? <section className="gsloan-group"><header><strong>Envoyées — suivi</strong><small>Agents demandés à un autre service pour cette garde.</small></header><div className="gsloan-records">{outgoing.map(renderLoan)}</div></section> : null}
      </GsPanel>
    </div>
  );
}
