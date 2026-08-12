/**
 * ReplacementsPanel — écran « Remplacements » sur garde courante.
 *
 * Un seul composant sert les trois rôles, le comportement dépend de `isChef` :
 *  · Chef de service  → crée (confirmé d'office), confirme/refuse les propositions
 *  · Surveillant / SG → consulte, propose (reste « non confirmé par chef service »)
 *
 * Aucune écriture dans le tableur : les remplacements sont une couche à part.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { replacementsAPI } from '../../../api';
import { useAuthStore } from '../../../store';
import toast from 'react-hot-toast';
import SchedulePreviewModal from './SchedulePreviewModal';
import ReplacementFormModal from './ReplacementFormModal';

/**
 * Une chaîne 'YYYY-MM-DD' est interprétée en UTC par `new Date()`, ce qui
 * affiche la veille dans les fuseaux négatifs. On construit donc la date
 * dans le fuseau local.
 */
const parseDate = (d) => {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).slice(0, 10));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
};

const fmtDate = (d) => {
  const dt = parseDate(d);
  return dt ? dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '';
};
const fmtTime = (t) => String(t || '').slice(0, 5);

const scopeBadge = (r) => {
  switch (r.scope) {
    case 'single_day': return { icon: '📅', text: fmtDate(r.start_date) };
    case 'date_range': return { icon: '🗓️', text: `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}` };
    case 'time_slot':  return { icon: '⏱️', text: `${fmtDate(r.start_date)} · ${fmtTime(r.start_time)}–${fmtTime(r.end_time)}` };
    default:           return { icon: '📆', text: 'Toute la période' };
  }
};

export default function ReplacementsPanel({ initialScheduleId = null }) {
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const isChef = user?.roleCode === 'department_head' || user?.roleCode === 'super_admin';
  const isSupervisor = ['service_supervisor', 'general_supervisor'].includes(user?.roleCode);
  const canCreate = isChef || isSupervisor;

  const [selectedScheduleId, setSelectedScheduleId] = useState(initialScheduleId || '');
  const [previewSchedule, setPreviewSchedule] = useState(null);
  const [formSchedule, setFormSchedule] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // Le panneau peut déjà être monté quand une notification cible une autre garde.
  useEffect(() => {
    if (initialScheduleId) setSelectedScheduleId(initialScheduleId);
  }, [initialScheduleId]);

  // ── Gardes courantes éligibles ──
  const { data: schedRes, isLoading: schedLoading } = useQuery({
    queryKey: ['eligible-schedules'],
    queryFn: () => replacementsAPI.getEligibleSchedules().then(r => r.data),
  });
  const schedules = schedRes?.data || [];

  const activeSchedule = useMemo(
    () => schedules.find(s => s.id === selectedScheduleId) || null,
    [schedules, selectedScheduleId]
  );

  // ── Remplacements ──
  const { data: replRes, isLoading: replLoading } = useQuery({
    queryKey: ['overlay-replacements', selectedScheduleId],
    queryFn: () => replacementsAPI
      .getOverlay(selectedScheduleId ? { scheduleId: selectedScheduleId } : {})
      .then(r => r.data),
  });
  const replacements = replRes?.data || [];

  const pending = replacements.filter(r => r.confirmation_status === 'pending_chef');
  const confirmed = replacements.filter(r => r.confirmation_status === 'confirmed');

  // ── Mutations ──
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['overlay-replacements'] });
    qc.invalidateQueries({ queryKey: ['eligible-schedules'] });
  };

  const confirmMutation = useMutation({
    mutationFn: (id) => replacementsAPI.confirmOverlay(id).then(r => r.data),
    onSuccess: (res) => { toast.success(res.message || 'Remplacement confirmé'); invalidate(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec de la confirmation'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => replacementsAPI.rejectOverlay(id, { reason }).then(r => r.data),
    onSuccess: (res) => {
      toast.success(res.message || 'Remplacement refusé et supprimé');
      setRejectTarget(null); setRejectReason('');
      invalidate();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Échec du refus'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => replacementsAPI.deleteOverlay(id).then(r => r.data),
    onSuccess: (res) => { toast.success(res.message || 'Remplacement supprimé'); invalidate(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Suppression impossible'),
  });

  // ── Carte d'un remplacement ──
  const ReplacementCard = ({ r }) => {
    const badge = scopeBadge(r);
    const isPending = r.confirmation_status === 'pending_chef';
    // Le chef gère tout ; un surveillant ne retire que SA propre proposition non confirmée.
    const isOwnPending = isPending && r.requested_by === user?.id;
    const canDelete = isChef || isOwnPending;

    return (
      <div style={{
        padding: 14, borderRadius: 12, background: 'var(--bg-card)',
        border: `1px solid ${isPending ? '#FCD34D' : 'var(--border-subtle)'}`,
        borderLeft: `3px solid ${isPending ? '#F59E0B' : '#10B981'}`,
      }}>
        {/* Binômes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(r.items || []).map(it => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--font-sm)', color: 'var(--text-primary)' }}>
                {it.absentLastName} {it.absentFirstName}
              </span>
              <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>→</span>
              <span style={{ fontWeight: 600, fontSize: 'var(--font-sm)', color: 'var(--text-primary)' }}>
                {it.replacementLastName} {it.replacementFirstName}
              </span>
              {it.isCrossDepartment && it.fromDepartmentName && (
                <span style={{
                  padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
                  background: '#FFEDD5', color: '#9A3412',
                }}>
                  ↔ {it.fromDepartmentName}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Méta */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          marginTop: 10, fontSize: 11, color: 'var(--text-muted)',
        }}>
          <span style={{
            padding: '2px 8px', borderRadius: 6, fontWeight: 600,
            background: 'var(--bg-base)', color: 'var(--text-secondary)',
          }}>
            {badge.icon} {badge.text}
          </span>
          {!selectedScheduleId && r.schedule_name && (
            <span>📋 {r.schedule_name}</span>
          )}
          <span>
            par {r.requested_by_first} {r.requested_by_last}
            {r.requested_by_role_name ? ` · ${r.requested_by_role_name}` : ''}
          </span>
        </div>

        {r.reason && (
          <p style={{ margin: '8px 0 0', fontSize: 'var(--font-sm)', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            « {r.reason} »
          </p>
        )}

        {/* Statut + actions */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 10, marginTop: 12, flexWrap: 'wrap',
        }}>
          {isPending ? (
            <span style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: '#FEF3C7', color: '#92400E',
            }}>
              ⏳ non confirmé par chef service
            </span>
          ) : (
            <span style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: '#DCFCE7', color: '#166534',
            }}>
              ✅ confirmé
            </span>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {isChef && isPending && (
              <>
                <button
                  onClick={() => confirmMutation.mutate(r.id)}
                  disabled={confirmMutation.isPending}
                  style={{
                    padding: '5px 14px', borderRadius: 8, cursor: 'pointer',
                    fontSize: 'var(--font-sm)', fontWeight: 600,
                    border: 'none', background: '#10B981', color: '#fff',
                  }}
                >
                  ✓ Confirmer
                </button>
                <button
                  onClick={() => setRejectTarget(r)}
                  style={{
                    padding: '5px 14px', borderRadius: 8, cursor: 'pointer',
                    fontSize: 'var(--font-sm)', fontWeight: 600,
                    border: '1px solid var(--color-danger)', background: 'transparent',
                    color: 'var(--color-danger)',
                  }}
                >
                  ✕ Refuser
                </button>
              </>
            )}
            {canDelete && !(isChef && isPending) && (
              <button
                onClick={() => {
                  if (window.confirm('Supprimer ce remplacement ?')) deleteMutation.mutate(r.id);
                }}
                title="Supprimer"
                style={{
                  padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid var(--border-default)', background: 'var(--bg-base)',
                  color: 'var(--text-muted)', fontSize: 'var(--font-sm)',
                }}
              >
                🗑
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Bandeau explicatif */}
      <div style={{
        padding: '12px 16px', borderRadius: 12,
        background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.18)',
        fontSize: 'var(--font-sm)', color: 'var(--text-secondary)',
      }}>
        Les remplacements évitent toute modification d'un tableur déjà soumis définitivement.
        Le tableau de garde reste intact ; le remplacement s'affiche par-dessus.
        {isSupervisor && ' Vos remplacements restent « non confirmés » jusqu\'à décision du chef de service.'}
      </div>

      {/* Barre de sélection */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
        padding: 16, borderRadius: 12, background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <label style={{
            display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4,
            color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.3,
          }}>
            Garde courante
          </label>
          <select
            value={selectedScheduleId}
            onChange={e => setSelectedScheduleId(e.target.value)}
            style={{
              padding: '8px 10px', borderRadius: 8, width: '100%',
              fontSize: 'var(--font-sm)', border: '1px solid var(--border-default)',
              background: 'var(--bg-base)', color: 'var(--text-primary)',
            }}
          >
            <option value="">— Tous les plannings —</option>
            {schedules.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.department_name}
                {Number(s.pending_count) > 0 ? ` (${s.pending_count} en attente)` : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setPreviewSchedule(activeSchedule)}
          disabled={!activeSchedule}
          style={{
            padding: '8px 16px', borderRadius: 8,
            cursor: activeSchedule ? 'pointer' : 'not-allowed',
            fontSize: 'var(--font-sm)', fontWeight: 600,
            border: '1px solid var(--border-default)',
            background: 'var(--bg-base)', color: 'var(--text-secondary)',
            opacity: activeSchedule ? 1 : 0.5,
          }}
        >
          📊 Aperçu tableur
        </button>

        {canCreate && (
          <button
            onClick={() => setFormSchedule(activeSchedule)}
            disabled={!activeSchedule}
            className="btn btn-primary"
            style={{
              padding: '8px 18px',
              cursor: activeSchedule ? 'pointer' : 'not-allowed',
              opacity: activeSchedule ? 1 : 0.5,
            }}
          >
            + Nouveau remplacement
          </button>
        )}
      </div>

      {schedLoading && (
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Chargement des gardes…</p>
      )}

      {!schedLoading && !schedules.length && (
        <div style={{
          padding: 40, textAlign: 'center', borderRadius: 12,
          background: 'var(--bg-card)', border: '1px dashed var(--border-default)',
        }}>
          <p style={{ fontSize: 28, margin: 0 }}>📋</p>
          <p style={{ fontWeight: 600, color: 'var(--text-primary)', margin: '8px 0 4px' }}>
            Aucune garde courante
          </p>
          <p style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)', margin: 0 }}>
            Les remplacements ne concernent que les tableaux soumis définitivement, encore en cours.
          </p>
        </div>
      )}

      {/* En attente de confirmation */}
      {!!pending.length && (
        <section>
          <h4 style={{
            margin: '0 0 10px', fontSize: 'var(--font-sm)', fontWeight: 700,
            color: '#92400E', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            ⏳ {pending.length} remplacement{pending.length > 1 ? 's' : ''} non confirmé{pending.length > 1 ? 's' : ''}
            {isChef && ' — votre décision est attendue'}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pending.map(r => <ReplacementCard key={r.id} r={r} />)}
          </div>
        </section>
      )}

      {/* Confirmés */}
      <section>
        <h4 style={{
          margin: '0 0 10px', fontSize: 'var(--font-sm)', fontWeight: 700,
          color: 'var(--text-secondary)',
        }}>
          ✅ Remplacements actifs {confirmed.length ? `(${confirmed.length})` : ''}
        </h4>

        {replLoading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Chargement…</p>
        ) : !confirmed.length ? (
          <p style={{
            padding: 24, textAlign: 'center', borderRadius: 12,
            background: 'var(--bg-card)', border: '1px dashed var(--border-default)',
            color: 'var(--text-muted)', fontSize: 'var(--font-sm)', margin: 0,
          }}>
            Aucun remplacement enregistré{activeSchedule ? ' sur cette garde' : ''}.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {confirmed.map(r => <ReplacementCard key={r.id} r={r} />)}
          </div>
        )}
      </section>

      {/* Modales */}
      {previewSchedule && (
        <SchedulePreviewModal
          schedule={previewSchedule}
          replacements={replacements}
          onClose={() => setPreviewSchedule(null)}
        />
      )}

      {formSchedule && (
        <ReplacementFormModal
          schedule={formSchedule}
          isChef={isChef}
          onClose={() => setFormSchedule(null)}
        />
      )}

      {/* Refus : motif */}
      {rejectTarget && (
        <div
          onClick={() => setRejectTarget(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001, padding: 20,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-card)', borderRadius: 14, padding: 20,
              border: '1px solid var(--border-default)', width: '100%', maxWidth: 460,
            }}
          >
            <h4 style={{ margin: '0 0 6px', fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
              Refuser ce remplacement
            </h4>
            <p style={{ margin: '0 0 14px', fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>
              Le remplacement sera <strong>supprimé automatiquement</strong> et son auteur sera notifié.
            </p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Motif du refus (facultatif)"
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 8, resize: 'vertical',
                border: '1px solid var(--border-default)', background: 'var(--bg-base)',
                color: 'var(--text-primary)', fontSize: 'var(--font-sm)', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button
                onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                style={{
                  padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid var(--border-default)', background: 'var(--bg-base)',
                  color: 'var(--text-secondary)', fontSize: 'var(--font-sm)',
                }}
              >
                Annuler
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason })}
                disabled={rejectMutation.isPending}
                style={{
                  padding: '8px 18px', borderRadius: 8, cursor: 'pointer',
                  border: 'none', background: 'var(--color-danger)', color: '#fff',
                  fontSize: 'var(--font-sm)', fontWeight: 600,
                  opacity: rejectMutation.isPending ? 0.6 : 1,
                }}
              >
                {rejectMutation.isPending ? 'Suppression…' : 'Refuser et supprimer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
