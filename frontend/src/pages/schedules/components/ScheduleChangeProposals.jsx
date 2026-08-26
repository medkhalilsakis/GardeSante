import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { scheduleBuilderAPI } from '../../../api';
import { shortFrenchDate } from '../../../utils/frenchDates';
import './ScheduleChangeProposals.css';

const markedDays = (shifts) => Object.entries(shifts || {})
  .filter(([, value]) => value === true || (String(value ?? '').trim() && String(value).trim().charAt(0).toUpperCase() !== 'R'))
  .map(([date]) => date)
  .sort();

const STATUS_LABELS = { pending: 'En attente', accepted: 'Acceptée', rejected: 'Refusée' };
const statusTone = (status) => (status === 'accepted' ? 'duty' : 'alert');
const formatProposalDate = (value) => {
  const key = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? shortFrenchDate(key, true) : key;
};

export default function ScheduleChangeProposals({ scheduleId, onClose }) {
  const qc = useQueryClient();
  const [comments, setComments] = useState({});
  const [busy, setBusy] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['schedule-change-proposals', scheduleId],
    queryFn: () => scheduleBuilderAPI.getChangeProposals(scheduleId),
    enabled: !!scheduleId,
  });
  const proposals = data?.data?.data || data?.data || [];

  const decide = async (proposal, decision) => {
    const comment = (comments[proposal.id] || '').trim();
    if (decision === 'rejected' && !comment) {
      toast.error('Le motif du refus est obligatoire.');
      return;
    }
    setBusy(proposal.id);
    try {
      await scheduleBuilderAPI.decideProposal(scheduleId, proposal.id, { decision, comment });
      toast.success(decision === 'accepted' ? 'Proposition acceptée et appliquée.' : 'Refus envoyé au surveillant.');
      qc.invalidateQueries({ queryKey: ['schedule-change-proposals', scheduleId] });
      qc.invalidateQueries({ queryKey: ['schedule-detail', scheduleId] });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Impossible de traiter la proposition.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="gscp-backdrop" role="presentation" onClick={onClose}>
      <div className="gscp-dialog" role="dialog" aria-modal="true" aria-label="Propositions de modification" onClick={(event) => event.stopPropagation()}>
        <header className="gscp-header">
          <div>
            <h2>Propositions de modification</h2>
            <p>Consultez les changements proposés et répondez au surveillant.</p>
          </div>
          <button type="button" className="gscp-close gs-btn is-quiet" onClick={onClose} aria-label="Fermer"><X size={16} /></button>
        </header>
        {isLoading ? <p className="gscp-state">Chargement…</p> : null}
        {!isLoading && !proposals.length ? <p className="gscp-state">Aucune proposition pour ce planning.</p> : null}
        {!isLoading && proposals.length ? (
          <div className="gscp-list">
            {proposals.map((proposal) => {
              const status = proposal.status || 'pending';
              const rows = proposal.proposal?.rows || [];
              const daysByRow = rows.filter((row) => row.userId).map((row) => ({
                id: row.userId,
                name: `${row.lastName || ''} ${row.firstName || ''}`.trim(),
                days: markedDays(row.shifts).map(formatProposalDate),
              }));
              return (
                <article className="gscp-proposal" key={proposal.id}>
                  <div className="gscp-proposal-head">
                    <div><strong>{proposal.first_name} {proposal.last_name}</strong><time dateTime={proposal.created_at}>{formatProposalDate(proposal.created_at)}</time></div>
                    <span className={`gscp-status is-${statusTone(status)}`}>{STATUS_LABELS[status] || status}</span>
                  </div>
                  {proposal.comment ? <p className="gscp-comment"><b>Message du surveillant :</b> {proposal.comment}</p> : null}
                  <details className="gscp-details">
                    <summary>Voir les modifications proposées ({rows.length} ligne{rows.length > 1 ? 's' : ''})</summary>
                    <div className="gscp-days">
                      {daysByRow.map((row, index) => <div className="gscp-day-row" key={row.id || index}><b>{row.name || 'Personnel'}</b><span>{row.days.join(', ') || 'aucun jour sélectionné'}</span></div>)}
                    </div>
                  </details>
                  {status === 'pending' ? (
                    <div className="gscp-decision">
                      <textarea value={comments[proposal.id] || ''} onChange={(event) => setComments((current) => ({ ...current, [proposal.id]: event.target.value }))} placeholder="Message au surveillant — motif obligatoire en cas de refus" rows="2" />
                      <div className="gscp-actions">
                        <button type="button" className="gs-btn is-danger" disabled={busy === proposal.id} onClick={() => decide(proposal, 'rejected')}>Refuser</button>
                        <button type="button" className="gs-btn is-primary" disabled={busy === proposal.id} onClick={() => decide(proposal, 'accepted')}>Accepter</button>
                      </div>
                    </div>
                  ) : proposal.decision_comment ? <p className="gscp-comment"><b>Réponse :</b> {proposal.decision_comment}</p> : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
