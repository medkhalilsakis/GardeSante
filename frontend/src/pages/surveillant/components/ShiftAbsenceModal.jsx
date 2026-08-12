/**
 * Signalement d'absence ou de retard en GARDE COURANTE (règle métier).
 *
 * Le serveur (`absences-shift.controller.js`) refuse tout planning qui n'est pas
 * à l'état `en_cours` et toute date hors période : ce formulaire ne propose donc
 * que les gardes courantes et borne le sélecteur de date sur la période retenue.
 * Les types marqués « congé » sont écartés côté serveur — on n'en propose aucun.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { absencesShiftAPI, absencesAPI, replacementsAPI } from '../../../api';

/** Date du jour en 'YYYY-MM-DD' assemblée depuis les parties locales (jamais toISOString). */
const todayKey = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const SEVERITIES = [
  { value: 'info',     label: 'Information' },
  { value: 'warning',  label: 'Avertissement' },
  { value: 'error',    label: 'Grave' },
  { value: 'critical', label: 'Critique' },
];

export default function ShiftAbsenceModal({ onClose, onReported }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    scheduleId: '', userId: '', absenceTypeId: '',
    date: todayKey(), startTime: '', endTime: '',
    reason: '', isJustified: false, severity: 'warning',
  });

  // Gardes courantes uniquement — même source que le module Remplacements.
  const { data: schedRes, isLoading: loadingSched } = useQuery({
    queryKey: ['eligible-schedules'],
    queryFn: () => replacementsAPI.getEligibleSchedules(),
  });
  const schedules = schedRes?.data?.data || [];

  const { data: typesRes } = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => absencesAPI.getTypes(),
  });
  // Les congés relèvent de la gestion des congés, pas du signalement en garde.
  const types = (typesRes?.data?.data || []).filter((t) => !t.is_leave);

  const { data: staffRes, isFetching: loadingStaff } = useQuery({
    queryKey: ['schedule-staff', form.scheduleId],
    queryFn: () => replacementsAPI.getScheduleStaff(form.scheduleId),
    enabled: !!form.scheduleId,
  });
  const staff = staffRes?.data?.data || [];

  const selected = useMemo(
    () => schedules.find((s) => s.id === form.scheduleId) || null,
    [schedules, form.scheduleId]
  );

  // Le premier type disponible évite un envoi sans type quand le champ n'est pas touché.
  useEffect(() => {
    if (!form.absenceTypeId && types.length) {
      setForm((f) => ({ ...f, absenceTypeId: types[0].id }));
    }
  }, [types, form.absenceTypeId]);

  // La date doit rester dans la période de la garde retenue.
  useEffect(() => {
    if (!selected) return;
    setForm((f) => {
      const t = todayKey();
      const within = t >= selected.start_date && t <= selected.end_date;
      return { ...f, date: within ? t : selected.start_date, userId: '' };
    });
  }, [selected]);

  const report = useMutation({
    mutationFn: (payload) => absencesShiftAPI.report(payload),
    onSuccess: () => {
      toast.success('Absence signalée');
      qc.invalidateQueries({ queryKey: ['journal'] });
      qc.invalidateQueries({ queryKey: ['journal-alerts'] });
      qc.invalidateQueries({ queryKey: ['journal-overview'] });
      qc.invalidateQueries({ queryKey: ['shift-absences'] });
      if (onReported) onReported();
      onClose();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Signalement impossible'),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.userId)        { toast.error('Choisissez l\'agent concerné'); return; }
    if (!form.absenceTypeId) { toast.error('Choisissez un type'); return; }
    if (!form.date)          { toast.error('La date est obligatoire'); return; }
    report.mutate({
      scheduleId: form.scheduleId || undefined,
      userId: form.userId,
      absenceTypeId: form.absenceTypeId,
      date: form.date,
      startTime: form.startTime || undefined,
      endTime: form.endTime || undefined,
      reason: form.reason || undefined,
      isJustified: form.isJustified,
      severity: form.severity,
    });
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Signaler une absence ou un retard</h2>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
              Gardes courantes uniquement — le journal de service en garde la trace
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label">Garde courante</label>
              <select
                className="form-control"
                value={form.scheduleId}
                onChange={(e) => setForm((f) => ({ ...f, scheduleId: e.target.value }))}
              >
                <option value="">
                  {loadingSched ? 'Chargement…' : 'Hors planning (agent du service)'}
                </option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.department_name} ({s.start_date} → {s.end_date})
                  </option>
                ))}
              </select>
              {!loadingSched && schedules.length === 0 && (
                <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  Aucune garde courante : le signalement se rattachera au service de l'agent.
                </p>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Agent concerné *</label>
              <select
                className="form-control"
                value={form.userId}
                onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
                required
              >
                <option value="">
                  {form.scheduleId
                    ? (loadingStaff ? 'Chargement…' : 'Choisir un agent affecté')
                    : 'Choisir une garde pour lister les agents'}
                </option>
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.first_name} {u.last_name}{u.role_name ? ` — ${u.role_name}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Type *</label>
                <select
                  className="form-control"
                  value={form.absenceTypeId}
                  onChange={(e) => setForm((f) => ({ ...f, absenceTypeId: e.target.value }))}
                  required
                >
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Date *</label>
                <input
                  type="date"
                  className="form-control"
                  value={form.date}
                  min={selected?.start_date || undefined}
                  max={selected?.end_date || undefined}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Heure de début</label>
                <input
                  type="time"
                  className="form-control"
                  value={form.startTime}
                  onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Heure de fin</label>
                <input
                  type="time"
                  className="form-control"
                  value={form.endTime}
                  onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Gravité</label>
                <select
                  className="form-control"
                  value={form.severity}
                  onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
                >
                  {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-sm)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.isJustified}
                    onChange={(e) => setForm((f) => ({ ...f, isJustified: e.target.checked }))}
                  />
                  Absence justifiée
                </label>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Motif</label>
              <textarea
                className="form-control form-control-textarea"
                rows={3}
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="Précisions sur le signalement…"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={report.isPending}>
              {report.isPending ? 'Envoi…' : 'Signaler'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
