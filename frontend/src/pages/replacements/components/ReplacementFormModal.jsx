/**
 * ReplacementFormModal — création d'un remplacement sur une garde courante.
 *
 * Portées : toute la période · une période · un jour · une durée horaire.
 * Un ou plusieurs personnels remplacés, chacun par un personnel du même
 * hôpital (même service ou autre service).
 */
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { replacementsAPI, schedulesAPI } from '../../../api';
import toast from 'react-hot-toast';

const SCOPES = [
  { key: 'full_period', label: 'Toute la période', emoji: '📆', hint: 'Sur tout le planning' },
  { key: 'date_range',  label: 'Une période',      emoji: '🗓️', hint: 'Du … au …' },
  { key: 'single_day',  label: 'Un jour',          emoji: '📅', hint: 'Une seule date' },
  { key: 'time_slot',   label: 'Une durée',        emoji: '⏱️', hint: 'Ex. 14h → 16h' },
];

const fullName = (p) => `${p.last_name || ''} ${p.first_name || ''}`.trim();

/** 'YYYY-MM-DD' lu en UTC par `new Date()` décale d'un jour : on force le local. */
const fmtLong = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '').slice(0, 10));
  const dt = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('fr-FR');
};

export default function ReplacementFormModal({ schedule, isChef, onClose }) {
  const qc = useQueryClient();

  const [scope, setScope] = useState('full_period');
  const [startDate, setStartDate] = useState(schedule?.start_date?.slice(0, 10) || '');
  const [endDate, setEndDate] = useState(schedule?.end_date?.slice(0, 10) || '');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('10:00');
  const [reason, setReason] = useState('');
  const [pairs, setPairs] = useState([]);        // [{ absentUserId, replacementUserId }]
  const [search, setSearch] = useState('');

  // Personnel du tableur = les remplaçables
  const { data: staffRes, isLoading: staffLoading } = useQuery({
    queryKey: ['replacement-schedule-staff', schedule?.id],
    queryFn: () => replacementsAPI.getScheduleStaff(schedule.id).then(r => r.data),
    enabled: !!schedule?.id,
  });
  const scheduleStaff = staffRes?.data || [];

  // Tout le personnel de l'hôpital = les remplaçants possibles
  const { data: hospitalRes } = useQuery({
    queryKey: ['hospital-staff-replacement', search],
    queryFn: () => schedulesAPI.getHospitalStaff({ search: search || undefined, limit: 200 }).then(r => r.data),
  });
  const hospitalStaff = hospitalRes?.data || [];

  const selectedAbsentIds = useMemo(() => pairs.map(p => p.absentUserId), [pairs]);

  const toggleAbsent = (userId) => {
    setPairs(prev => prev.some(p => p.absentUserId === userId)
      ? prev.filter(p => p.absentUserId !== userId)
      : [...prev, { absentUserId: userId, replacementUserId: '' }]);
  };

  const setReplacer = (absentUserId, replacementUserId) => {
    setPairs(prev => prev.map(p => p.absentUserId === absentUserId ? { ...p, replacementUserId } : p));
  };

  const mutation = useMutation({
    mutationFn: (payload) => replacementsAPI.createOverlay(payload).then(r => r.data),
    onSuccess: (res) => {
      toast.success(res.message || 'Remplacement enregistré');
      (res.warnings || []).forEach(w => toast(w.message, { icon: '⚠️', duration: 6000 }));
      qc.invalidateQueries({ queryKey: ['overlay-replacements'] });
      qc.invalidateQueries({ queryKey: ['eligible-schedules'] });
      onClose?.();
    },
    onError: (err) => {
      toast.error(err?.response?.data?.message || 'Échec de l\'enregistrement');
    },
  });

  const handleSubmit = () => {
    if (!pairs.length) return toast.error('Sélectionnez au moins un personnel à remplacer.');
    const incomplete = pairs.find(p => !p.replacementUserId);
    if (incomplete) {
      const who = scheduleStaff.find(s => s.id === incomplete.absentUserId);
      return toast.error(`Choisissez un remplaçant pour ${who ? fullName(who) : 'chaque personnel'}.`);
    }
    if (scope !== 'full_period' && !startDate) return toast.error('La date est requise.');
    if (scope === 'date_range' && !endDate) return toast.error('La date de fin est requise.');
    if (scope === 'time_slot' && (!startTime || !endTime)) return toast.error('Les heures sont requises.');

    mutation.mutate({
      scheduleId: schedule.id,
      scope,
      startDate: scope === 'full_period' ? undefined : startDate,
      endDate: scope === 'date_range' ? endDate : (scope === 'time_slot' ? startDate : undefined),
      startTime: scope === 'time_slot' ? startTime : undefined,
      endTime: scope === 'time_slot' ? endTime : undefined,
      reason: reason || undefined,
      items: pairs,
    });
  };

  const inputStyle = {
    padding: '8px 10px', borderRadius: 8, fontSize: 'var(--font-sm)',
    border: '1px solid var(--border-default)', background: 'var(--bg-card)',
    color: 'var(--text-primary)', width: '100%',
  };
  const labelStyle = {
    display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4,
    color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.3,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', borderRadius: 14,
          border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)',
          width: '100%', maxWidth: 880, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* En-tête */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
              🔄 Nouveau remplacement
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>
              {schedule?.name} · {schedule?.department_name}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              border: '1px solid var(--border-default)', background: 'var(--bg-base)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {!isChef && (
          <div style={{
            padding: '10px 20px', background: '#FEF3C7', borderBottom: '1px solid #FDE68A',
            fontSize: 'var(--font-sm)', color: '#92400E',
          }}>
            ⏳ Ce remplacement devra être confirmé par le chef de service avant de devenir effectif.
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Portée */}
          <div>
            <label style={labelStyle}>1 · Portée du remplacement</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              {SCOPES.map(s => (
                <button
                  key={s.key}
                  onClick={() => setScope(s.key)}
                  style={{
                    padding: '10px 12px', borderRadius: 10, textAlign: 'left', cursor: 'pointer',
                    border: `1.5px solid ${scope === s.key ? 'var(--color-primary)' : 'var(--border-default)'}`,
                    background: scope === s.key ? 'rgba(37,99,235,0.06)' : 'var(--bg-base)',
                  }}
                >
                  <div style={{
                    fontSize: 'var(--font-sm)', fontWeight: 700,
                    color: scope === s.key ? 'var(--color-primary)' : 'var(--text-primary)',
                  }}>
                    {s.emoji} {s.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{s.hint}</div>
                </button>
              ))}
            </div>

            {/* Champs selon la portée */}
            {scope !== 'full_period' && (
              <div style={{
                marginTop: 12, display: 'grid', gap: 12,
                gridTemplateColumns: scope === 'time_slot' ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
              }}>
                <div>
                  <label style={labelStyle}>{scope === 'single_day' || scope === 'time_slot' ? 'Date' : 'Du'}</label>
                  <input
                    type="date" value={startDate} style={inputStyle}
                    min={schedule?.start_date?.slice(0, 10)}
                    max={schedule?.end_date?.slice(0, 10)}
                    onChange={e => setStartDate(e.target.value)}
                  />
                </div>
                {scope === 'date_range' && (
                  <div>
                    <label style={labelStyle}>Au</label>
                    <input
                      type="date" value={endDate} style={inputStyle}
                      min={startDate || schedule?.start_date?.slice(0, 10)}
                      max={schedule?.end_date?.slice(0, 10)}
                      onChange={e => setEndDate(e.target.value)}
                    />
                  </div>
                )}
                {scope === 'time_slot' && (
                  <>
                    <div>
                      <label style={labelStyle}>De</label>
                      <input type="time" value={startTime} style={inputStyle}
                        onChange={e => setStartTime(e.target.value)} />
                    </div>
                    <div>
                      <label style={labelStyle}>À</label>
                      <input type="time" value={endTime} style={inputStyle}
                        onChange={e => setEndTime(e.target.value)} />
                    </div>
                  </>
                )}
              </div>
            )}

            {scope === 'full_period' && (
              <p style={{ marginTop: 8, fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>
                Du {fmtLong(schedule?.start_date)} au {fmtLong(schedule?.end_date)}
              </p>
            )}
          </div>

          {/* Personnels remplacés */}
          <div>
            <label style={labelStyle}>2 · Personnel à remplacer ({selectedAbsentIds.length} sélectionné{selectedAbsentIds.length > 1 ? 's' : ''})</label>
            {staffLoading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>Chargement…</p>
            ) : !scheduleStaff.length ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                Aucun personnel affecté sur ce tableau.
              </p>
            ) : (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 6,
                maxHeight: 140, overflowY: 'auto', padding: 8,
                border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--bg-base)',
              }}>
                {scheduleStaff.map(p => {
                  const on = selectedAbsentIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => toggleAbsent(p.id)}
                      style={{
                        padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
                        fontSize: 'var(--font-sm)', fontWeight: on ? 700 : 500,
                        border: `1px solid ${on ? 'var(--color-primary)' : 'var(--border-default)'}`,
                        background: on ? 'var(--color-primary)' : 'var(--bg-card)',
                        color: on ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      {on ? '✓ ' : ''}{fullName(p)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Remplaçants */}
          {!!pairs.length && (
            <div>
              <label style={labelStyle}>3 · Remplaçant pour chacun</label>
              <input
                placeholder="🔎 Filtrer le personnel de l'hôpital…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ ...inputStyle, marginBottom: 10 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pairs.map(pair => {
                  const absent = scheduleStaff.find(s => s.id === pair.absentUserId);
                  const chosen = hospitalStaff.find(h => h.id === pair.replacementUserId);
                  const isCross = chosen && absent && chosen.dept_id && chosen.dept_id !== absent.department_id;
                  return (
                    <div
                      key={pair.absentUserId}
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr auto 1.2fr', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 10,
                        border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--font-sm)', color: 'var(--text-primary)' }}>
                          {absent ? fullName(absent) : '—'}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {absent?.role_name}
                        </div>
                      </div>

                      <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>→</span>

                      <div>
                        <select
                          value={pair.replacementUserId}
                          onChange={e => setReplacer(pair.absentUserId, e.target.value)}
                          style={inputStyle}
                        >
                          <option value="">— Choisir un remplaçant —</option>
                          {hospitalStaff
                            .filter(h => h.id !== pair.absentUserId)
                            .map(h => (
                              <option key={h.id} value={h.id}>
                                {fullName(h)}{h.dept_name ? ` · ${h.dept_name}` : ''}
                              </option>
                            ))}
                        </select>
                        {isCross && (
                          <div style={{ fontSize: 11, color: '#B45309', marginTop: 4 }}>
                            ↔ Autre service : {chosen.dept_name}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Motif */}
          <div>
            <label style={labelStyle}>Motif (facultatif)</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder="Ex. formation, congé exceptionnel, mission…"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>

        {/* Pied */}
        <div style={{
          padding: '12px 20px', borderTop: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--bg-base)',
        }}>
          <button onClick={onClose} className="btn" style={{
            padding: '8px 18px', border: '1px solid var(--border-default)',
            background: 'var(--bg-card)', color: 'var(--text-secondary)', borderRadius: 8, cursor: 'pointer',
          }}>
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="btn btn-primary"
            style={{ padding: '8px 22px', opacity: mutation.isPending ? 0.6 : 1 }}
          >
            {mutation.isPending ? 'Enregistrement…' : (isChef ? 'Enregistrer' : 'Proposer')}
          </button>
        </div>
      </div>
    </div>
  );
}
