/**
 * Interface de prêt d'UNE garde (point 4) — seconde étape, après le sélecteur.
 *
 * Tout est borné à la garde choisie :
 *   • ses prêts reçus (à décider : accepter / refuser) et envoyés (suivi),
 *   • le formulaire de demande, dont `scheduleId` est celui de cette garde.
 *
 * C'est ici que `staffLoansAPI.request` est enfin branché : jusqu'à présent un
 * prêt ne naissait qu'implicitement, quand un chef ajoutait au tableur un agent
 * d'un autre service. Le chemin implicite reste intact — celui-ci s'ajoute.
 *
 * La décision reste au chef du service propriétaire (règle II) : les boutons
 * n'apparaissent que sur les demandes reçues, exactement comme dans le panneau
 * existant, qui n'est pas modifié.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { schedulesAPI, staffLoansAPI } from '../../../api';
import { useAuthStore } from '../../../store';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';

const STATUS_META = {
  pending:       { label: 'En attente',   bg: 'rgba(249,115,22,.12)', color: '#9A3412', dot: '#F97316' },
  approved:      { label: 'Accepté',      bg: 'rgba(16,185,129,.12)', color: '#065F46', dot: '#10B981' },
  auto_approved: { label: 'Auto-accepté', bg: 'rgba(59,130,246,.12)', color: '#1E40AF', dot: '#3B82F6' },
  rejected:      { label: 'Refusé',       bg: 'rgba(239,68,68,.12)',  color: '#991B1B', dot: '#EF4444' },
};

const fmt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

/** Jour local en YYYY-MM-DD — `toISOString()` décalerait d'un jour. */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

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

export default function ScheduleLoanBoard({ garde, onBack }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const isChef = user?.roleCode === 'department_head';

  const [rejecting, setRejecting] = useState(null); // { id, name }
  const [reason, setReason] = useState('');

  // Formulaire de demande
  const [formOpen, setFormOpen] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState(null);
  const [shiftDate, setShiftDate] = useState(() => {
    const t = todayKey();
    if (garde.startDate && t < garde.startDate) return garde.startDate;
    if (garde.endDate && t > garde.endDate) return garde.startDate || t;
    return t;
  });

  useEffect(() => {
    const h = setTimeout(() => setDebounced(staffSearch.trim()), 300);
    return () => clearTimeout(h);
  }, [staffSearch]);

  const { data: loanRes, isLoading } = useQuery({
    queryKey: ['staff-loans', 'board', garde.id],
    queryFn: () => staffLoansAPI.getAll({ scheduleId: garde.id }),
    refetchInterval: 60000,
  });
  const loans = useMemo(() => loanRes?.data?.data || [], [loanRes]);

  // Personnel de l'hôpital — deux caractères minimum pour ne pas tirer tout
  // l'effectif à l'ouverture du formulaire.
  const { data: staffRes, isFetching: searching } = useQuery({
    queryKey: ['hospital-staff', 'loan-request', debounced],
    queryFn: () => schedulesAPI.getHospitalStaff({ search: debounced, limit: 25 }),
    enabled: formOpen && debounced.length >= 2,
  });
  const candidates = useMemo(() => staffRes?.data?.data || [], [staffRes]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['staff-loans'] });
    // Les compteurs en tête de page vivent sur une clé distincte, que le socket
    // n'invalide pas : on les rafraîchit explicitement après notre propre action.
    qc.invalidateQueries({ queryKey: ['staff-loans-page'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const decide = useMutation({
    mutationFn: ({ id, decision, reason: why }) => staffLoansAPI.decide(id, { decision, reason: why || undefined }),
    onSuccess: (res, vars) => {
      toast.success(res?.data?.message || (vars.decision === 'approved' ? 'Demande acceptée' : 'Demande refusée'));
      setRejecting(null);
      setReason('');
      refresh();
      qc.invalidateQueries({ queryKey: ['schedule-detail'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de la décision'),
  });

  const request = useMutation({
    mutationFn: () => staffLoansAPI.request({
      staffUserId: picked.id,
      scheduleId: garde.id,
      shiftDate,
    }),
    onSuccess: (res) => {
      toast.success(res?.data?.message || 'Demande de prêt envoyée');
      setPicked(null);
      setStaffSearch('');
      setFormOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de la demande de prêt'),
  });

  const incoming = loans.filter((l) => l.is_incoming);
  const outgoing = loans.filter((l) => !l.is_incoming);
  const toDecide = incoming.filter((l) => l.status === 'pending').length;

  const dateOutOfRange = Boolean(
    shiftDate && ((garde.startDate && shiftDate < garde.startDate) || (garde.endDate && shiftDate > garde.endDate)),
  );

  const renderLoan = (l) => {
    const staffName = `${l.staff_last_name || ''} ${l.staff_first_name || ''}`.trim() || 'Personnel';
    const isRejectingThis = rejecting?.id === l.id;
    return (
      <div key={l.id} style={{
        border: '1px solid var(--border-subtle)', borderRadius: 11, padding: '11px 13px',
        background: l.status === 'pending' ? 'rgba(249,115,22,.05)' : 'var(--bg-elevated)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 190 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{staffName}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {l.is_incoming
                ? <>Demandé par {`${l.requester_first_name || ''} ${l.requester_last_name || ''}`.trim() || 'un chef'} · service {l.requesting_department_name}</>
                : <>Service propriétaire : {l.owner_department_name}</>}
              {' · '}journée du {fmt(l.shift_date)}
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
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* En-tête de la garde */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: '14px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={onBack}
            style={{
              padding: '6px 12px', borderRadius: 9, border: '1px solid var(--border-subtle)', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, background: 'transparent', color: 'var(--text-secondary)', fontFamily: 'inherit',
            }}>
            ‹ Changer de garde
          </button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{garde.name}</span>
              <PlanningStateBadge state={garde.state} status={garde.status} startDate={garde.startDate} endDate={garde.endDate} size="sm" />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {garde.departmentName} · du {fmt(garde.startDate)} au {fmt(garde.endDate)}
              {toDecide > 0 && <> · <span style={{ color: '#B91C1C', fontWeight: 700 }}>{toDecide} demande(s) à décider</span></>}
            </div>
          </div>
          {isChef && garde.mine && !formOpen && (
            <button
              onClick={() => setFormOpen(true)}
              style={{
                padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 700, background: 'var(--color-primary)', color: '#fff', fontFamily: 'inherit',
              }}>
              + Demander un prêt pour cette garde
            </button>
          )}
        </div>
      </div>

      {/* Formulaire de demande — chef de service, sur sa propre garde */}
      {isChef && garde.mine && formOpen && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--color-primary)', borderRadius: 14, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
              Demander un agent d'un autre service
            </div>
            <button
              onClick={() => { setFormOpen(false); setPicked(null); setStaffSearch(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>
              ×
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            La demande part au chef du service propriétaire de l'agent, qui accepte ou refuse.
            Un agent de votre propre service ne nécessite aucun prêt.
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Agent</label>
              {picked ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, padding: '8px 11px',
                  border: '1px solid var(--border-subtle)', borderRadius: 9, background: 'var(--bg-elevated)',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {`${picked.last_name || ''} ${picked.first_name || ''}`.trim()}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {picked.dept_name || 'Sans service'}{picked.role_name ? ` · ${picked.role_name}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => setPicked(null)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, fontWeight: 700 }}>
                    Changer
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className="input"
                    style={{ marginTop: 4 }}
                    placeholder="Nom, prénom ou matricule (2 caractères minimum)"
                    value={staffSearch}
                    onChange={(e) => setStaffSearch(e.target.value)}
                  />
                  {debounced.length >= 2 && (
                    <div style={{
                      marginTop: 6, maxHeight: 210, overflowY: 'auto',
                      border: '1px solid var(--border-subtle)', borderRadius: 9,
                    }}>
                      {searching && (
                        <div style={{ padding: '9px 11px', fontSize: 11, color: 'var(--text-muted)' }}>Recherche…</div>
                      )}
                      {!searching && candidates.length === 0 && (
                        <div style={{ padding: '9px 11px', fontSize: 11, color: 'var(--text-muted)' }}>
                          Aucun agent trouvé.
                        </div>
                      )}
                      {candidates.map((c) => {
                        const sameDept = garde.departmentId && c.dept_id === garde.departmentId;
                        return (
                          <button
                            key={c.id}
                            onClick={() => setPicked(c)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                              padding: '8px 11px', border: 'none', borderBottom: '1px solid var(--border-subtle)',
                              background: 'transparent', cursor: 'pointer', fontFamily: 'inherit',
                            }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                                {`${c.last_name || ''} ${c.first_name || ''}`.trim()}
                                {c.matricule ? <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {c.matricule}</span> : null}
                              </div>
                              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                {c.dept_name || 'Sans service'}{c.role_name ? ` · ${c.role_name}` : ''}
                              </div>
                            </div>
                            {sameDept && (
                              <span style={{ fontSize: 9, fontWeight: 800, color: '#1E40AF', background: 'rgba(59,130,246,.12)', padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                                VOTRE SERVICE
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ width: 180 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Journée de garde</label>
              <input
                className="input"
                type="date"
                style={{ marginTop: 4 }}
                value={shiftDate}
                min={garde.startDate || undefined}
                max={garde.endDate || undefined}
                onChange={(e) => setShiftDate(e.target.value)}
              />
              <div style={{ fontSize: 10, color: dateOutOfRange ? '#B91C1C' : 'var(--text-muted)', marginTop: 4 }}>
                {dateOutOfRange
                  ? 'Hors de la période de la garde.'
                  : `Entre le ${fmt(garde.startDate)} et le ${fmt(garde.endDate)}.`}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button
              onClick={() => { setFormOpen(false); setPicked(null); setStaffSearch(''); }}
              style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border-subtle)', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: 'transparent', color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
              Annuler
            </button>
            <button
              disabled={!picked || !shiftDate || dateOutOfRange || request.isPending}
              onClick={() => request.mutate()}
              style={{
                padding: '8px 14px', borderRadius: 10, border: 'none', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                background: (!picked || !shiftDate || dateOutOfRange) ? 'var(--bg-elevated)' : 'var(--color-primary)',
                color: (!picked || !shiftDate || dateOutOfRange) ? 'var(--text-muted)' : '#fff',
                cursor: (!picked || !shiftDate || dateOutOfRange || request.isPending) ? 'not-allowed' : 'pointer',
              }}>
              {request.isPending ? 'Envoi…' : 'Envoyer la demande'}
            </button>
          </div>
        </div>
      )}

      {/* Les prêts de cette garde */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 14, padding: 18 }}>
        {isLoading && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Chargement des prêts…</div>}

        {!isLoading && loans.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '18px 0', textAlign: 'center' }}>
            Aucun prêt de personnel sur cette garde.
            {isChef && garde.mine && <> Utilisez « Demander un prêt » pour en créer un.</>}
          </div>
        )}

        {incoming.length > 0 && (
          <div style={{ marginBottom: outgoing.length > 0 ? 18 : 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 3 }}>
              Reçues — votre décision
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 9 }}>
              Agents de votre service qu'un autre chef veut affecter à cette garde.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{incoming.map(renderLoan)}</div>
          </div>
        )}

        {outgoing.length > 0 && (
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 3 }}>
              Envoyées — suivi
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 9 }}>
              Agents empruntés à un autre service pour cette garde.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{outgoing.map(renderLoan)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
