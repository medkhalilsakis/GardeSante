/**
 * Demandes de prêt de personnel — vue du chef de service.
 *
 * Deux sens :
 *   • « Reçues » : un autre chef veut affecter un agent de MON service à sa
 *     garde. J'accepte (la ligne redevient normale chez lui) ou je refuse
 *     (sa ligne est retirée automatiquement, son planning reste tel quel).
 *   • « Envoyées » : les agents que j'ai empruntés et leur état d'approbation.
 *
 * Composant neuf et autonome : il ne modifie aucun écran existant, il s'ajoute.
 */
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { staffLoansAPI } from '../../../api';

const STATUS_META = {
  pending:       { label: 'En attente',    bg: 'rgba(249,115,22,.12)', color: '#9A3412', dot: '#F97316' },
  approved:      { label: 'Accepté',       bg: 'rgba(16,185,129,.12)', color: '#065F46', dot: '#10B981' },
  auto_approved: { label: 'Auto-accepté',  bg: 'rgba(59,130,246,.12)', color: '#1E40AF', dot: '#3B82F6' },
  rejected:      { label: 'Refusé',        bg: 'rgba(239,68,68,.12)',  color: '#991B1B', dot: '#EF4444' },
};

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20,
      background: m.bg, color: m.color, fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.dot }} />
      {m.label}
    </span>
  );
}

/**
 * @param {boolean} compact  N'affiche que les demandes en attente.
 * @param {string}  focusId  Demande à mettre en évidence — renseigné quand la
 *                           page est ouverte depuis une notification. Sans lui,
 *                           le comportement du panneau est strictement inchangé.
 */
export default function StaffLoansPanel({ compact = false, focusId = null }) {
  const qc = useQueryClient();
  const [direction, setDirection] = useState('incoming');
  const [rejecting, setRejecting] = useState(null); // { id, name }
  const [reason, setReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['staff-loans', direction],
    queryFn: () => staffLoansAPI.getAll({ direction }).then((r) => r.data?.data || []),
    refetchInterval: 60000,
  });
  const loans = data || [];

  // Notification de prêt : la demande visée n'est pas forcément dans le sens
  // affiché par défaut. Si elle est absente des « Reçues », on bascule une
  // seule fois sur les « Envoyées ». La garde `triedRef` est indispensable :
  // sans elle, une demande introuvable dans les deux sens (notification
  // orpheline — il en existe en base) renverrait l'utilisateur hors de l'onglet
  // « Reçues » à chaque clic, le rendant impossible à consulter.
  const triedRef = useRef(null);
  useEffect(() => {
    if (!focusId || isLoading) return;
    if (triedRef.current === focusId) return;
    if (loans.some((l) => l.id === focusId)) { triedRef.current = focusId; return; }
    if (direction === 'incoming') {
      triedRef.current = focusId;
      setDirection('outgoing');
    }
  }, [focusId, isLoading, loans, direction]);

  const decide = useMutation({
    mutationFn: ({ id, decision, reason: why }) => staffLoansAPI.decide(id, { decision, reason: why || undefined }),
    onSuccess: (res, vars) => {
      toast.success(res?.data?.message || (vars.decision === 'approved' ? 'Demande acceptée' : 'Demande refusée'));
      setRejecting(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['staff-loans'] });
      qc.invalidateQueries({ queryKey: ['schedule-detail'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de la décision'),
  });

  const pendingIncoming = loans.filter((l) => l.status === 'pending' && l.is_incoming);
  const shown = compact ? loans.filter((l) => l.status === 'pending') : loans;

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
            Prêts de personnel inter-service
            {direction === 'incoming' && pendingIncoming.length > 0 && (
              <span style={{ marginLeft: 8, background: '#EF4444', color: '#fff', borderRadius: 20, padding: '1px 8px', fontSize: 10, fontWeight: 800 }}>
                {pendingIncoming.length}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {direction === 'incoming'
              ? 'Agents de votre service qu\'un autre chef souhaite affecter à sa garde.'
              : 'Agents que vous avez empruntés à un autre service.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-elevated)', padding: 4, borderRadius: 10 }}>
          {[{ id: 'incoming', label: 'Reçues' }, { id: 'outgoing', label: 'Envoyées' }].map((t) => (
            <button key={t.id} onClick={() => setDirection(t.id)} style={{
              padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
              background: direction === t.id ? 'var(--color-primary)' : 'transparent',
              color: direction === t.id ? '#fff' : 'var(--text-secondary)',
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {isLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0' }}>Chargement…</div>}

      {!isLoading && shown.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '14px 0', textAlign: 'center' }}>
          {direction === 'incoming' ? 'Aucune demande reçue.' : 'Aucune demande envoyée.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map((l) => {
          const staffName = `${l.staff_last_name || ''} ${l.staff_first_name || ''}`.trim() || 'Personnel';
          const isRejectingThis = rejecting?.id === l.id;
          const isFocused = !!focusId && l.id === focusId;
          return (
            <div key={l.id} style={{
              border: isFocused ? '2px solid var(--color-primary)' : '1px solid var(--border-subtle)',
              borderRadius: 11, padding: '11px 13px',
              background: l.status === 'pending' ? 'rgba(249,115,22,.05)' : 'var(--bg-elevated)',
              boxShadow: isFocused ? '0 0 0 4px var(--color-primary-10)' : 'none',
            }}>
              {isFocused && (
                <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-primary)', marginBottom: 6, letterSpacing: '.03em' }}>
                  DEMANDE ISSUE DE VOTRE NOTIFICATION
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{staffName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {l.is_incoming
                      ? <>Demandé par {`${l.requester_first_name || ''} ${l.requester_last_name || ''}`.trim() || 'un chef'} · service {l.requesting_department_name}</>
                      : <>Service propriétaire : {l.owner_department_name}</>}
                    {' · '}garde du {fmt(l.shift_date)}
                  </div>
                  {l.response_reason && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontStyle: 'italic' }}>
                      Motif : {l.response_reason}
                    </div>
                  )}
                </div>
                <Badge status={l.status} />
                {l.is_incoming && l.status === 'pending' && !isRejectingThis && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: l.id, decision: 'approved' })}
                      style={{ padding: '6px 13px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: '#10B981', color: '#fff' }}>
                      Accepter
                    </button>
                    <button
                      disabled={decide.isPending}
                      onClick={() => { setRejecting({ id: l.id, name: staffName }); setReason(''); }}
                      style={{ padding: '6px 13px', borderRadius: 9, border: '1px solid #FECACA', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: 'transparent', color: '#B91C1C' }}>
                      Refuser
                    </button>
                  </div>
                )}
              </div>

              {isRejectingThis && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-subtle)' }}>
                  <div style={{ fontSize: 11, color: '#B91C1C', fontWeight: 600, marginBottom: 6 }}>
                    En refusant, la ligne de {staffName} sera retirée du tableur du service demandeur.
                    Son planning de garde reste publié ou en brouillon, tel qu'il est.
                  </div>
                  <input
                    autoFocus
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Motif du refus (optionnel)"
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border-subtle)', fontSize: 12, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                  />
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => { setRejecting(null); setReason(''); }}
                      style={{ padding: '6px 13px', borderRadius: 9, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: 'transparent', color: 'var(--text-secondary)' }}>
                      Annuler
                    </button>
                    <button
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ id: l.id, decision: 'rejected', reason })}
                      style={{ padding: '6px 13px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: '#EF4444', color: '#fff' }}>
                      {decide.isPending ? 'Envoi…' : 'Confirmer le refus'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
