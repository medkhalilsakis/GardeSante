import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowLeftRight, Check, X } from 'lucide-react';
import { staffLoansAPI } from '../../../api';
import { GsBadge, GsEmpty, GsFilterBar, GsPanel, GsSkeleton } from '../../../components/gs';
import { longFrenchDate } from '../../../utils/frenchDates';
import '../../staff-loans/staff-loans.css';

const STATUS_META = {
  pending: { label: 'En attente', tone: 'alert' },
  approved: { label: 'Accepté', tone: 'duty' },
  auto_approved: { label: 'Auto-accepté', tone: 'duty' },
  rejected: { label: 'Refusé', tone: 'quiet' },
};

const personName = (loan) => `${loan?.staff_last_name || ''} ${loan?.staff_first_name || ''}`.trim() || 'Personnel';

export default function StaffLoansPanel({ compact = false, focusId = null }) {
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState('incoming');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const triedFocus = useRef(null);
  const { data, isLoading } = useQuery({
    queryKey: ['staff-loans', direction],
    queryFn: () => staffLoansAPI.getAll({ direction }).then((response) => response.data?.data || []),
    refetchInterval: 60000,
  });
  const loans = useMemo(() => data || [], [data]);

  useEffect(() => {
    if (!focusId || isLoading || triedFocus.current === focusId) return;
    if (loans.some((loan) => loan.id === focusId)) {
      triedFocus.current = focusId;
    } else if (direction === 'incoming') {
      triedFocus.current = focusId;
      setDirection('outgoing');
    }
  }, [direction, focusId, isLoading, loans]);

  const decide = useMutation({
    mutationFn: ({ id, decision, reason: decisionReason }) => staffLoansAPI.decide(id, { decision, reason: decisionReason || undefined }),
    onSuccess: (response, variables) => {
      toast.success(response?.data?.message || (variables.decision === 'approved' ? 'Demande acceptée' : 'Demande refusée'));
      setRejecting(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: ['staff-loans'] });
      queryClient.invalidateQueries({ queryKey: ['staff-loans-page'] });
      queryClient.invalidateQueries({ queryKey: ['schedule-detail'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => toast.error(error?.response?.data?.message || 'Échec de la décision'),
  });
  const pendingIncoming = loans.filter((loan) => loan.status === 'pending' && loan.is_incoming);
  const shown = compact ? loans.filter((loan) => loan.status === 'pending') : loans;

  return (
    <GsPanel
      title="Prêts de personnel inter-service"
      sub={direction === 'incoming' ? 'Agents de votre service demandés par un autre chef.' : 'Agents que votre service a demandés à un autre service.'}
      icon={<ArrowLeftRight size={16} />}
      tools={pendingIncoming.length ? <GsBadge tone="alert" dot>{pendingIncoming.length} à décider</GsBadge> : null}
    >
      <GsFilterBar
        label="Sens des prêts"
        filters={[{ id: 'incoming', label: 'Reçues' }, { id: 'outgoing', label: 'Envoyées' }]}
        value={direction}
        onChange={setDirection}
      />
      {isLoading ? <GsSkeleton variant="rows" count={3} /> : null}
      {!isLoading && shown.length === 0 ? <GsEmpty bare title={direction === 'incoming' ? 'Aucune demande reçue' : 'Aucune demande envoyée'} hint={compact ? 'Aucune demande en attente dans ce sens.' : 'Les demandes apparaîtront ici dès qu’un chef de service sollicitera un agent.'} /> : null}
      {!isLoading && shown.length > 0 ? <div className="gsloan-records">{shown.map((loan) => {
        const meta = STATUS_META[loan.status] || { label: loan.status || 'État inconnu', tone: 'quiet' };
        const isFocused = Boolean(focusId && loan.id === focusId);
        const isRejecting = rejecting?.id === loan.id;
        return <article className="gsloan-record" data-status={loan.status} data-focus={isFocused ? 'true' : undefined} key={loan.id}><div className="gsloan-record-main"><div className="gsloan-record-copy"><strong>{personName(loan)}</strong><small>{loan.is_incoming ? `Demandé par ${`${loan.requester_first_name || ''} ${loan.requester_last_name || ''}`.trim() || 'un chef'} · ${loan.requesting_department_name || 'service non renseigné'}` : `Service propriétaire : ${loan.owner_department_name || 'service non renseigné'}`} · garde du {longFrenchDate(String(loan.shift_date || '').slice(0, 10))}</small>{loan.response_reason ? <p>Motif : {loan.response_reason}</p> : null}</div><GsBadge tone={meta.tone} dot={loan.status === 'pending'}>{meta.label}</GsBadge>{loan.is_incoming && loan.status === 'pending' && !isRejecting ? <div className="gsloan-record-actions"><button type="button" className="gs-btn is-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: loan.id, decision: 'approved' })}><Check size={13} /> Accepter</button><button type="button" className="gs-btn is-danger" disabled={decide.isPending} onClick={() => { setRejecting({ id: loan.id }); setReason(''); }}><X size={13} /> Refuser</button></div> : null}</div>{isFocused ? <div className="gsloan-focus-label">Demande ouverte depuis une notification</div> : null}{isRejecting ? <div className="gsloan-reject"><p>En refusant, la ligne de {personName(loan)} sera retirée du tableur du service demandeur.</p><input className="form-control" autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motif du refus (optionnel)" /><div className="gsloan-record-actions"><button type="button" className="gs-btn" onClick={() => { setRejecting(null); setReason(''); }}>Annuler</button><button type="button" className="gs-btn is-danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: loan.id, decision: 'rejected', reason })}>Confirmer le refus</button></div></div> : null}</article>;
      })}</div> : null}
    </GsPanel>
  );
}
