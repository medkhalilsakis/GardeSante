/**
 * Transmission d'un rapport de supervision à la direction (Lot 5).
 *
 * Écrit une notification par directeur actif de l'hôpital et trace l'action
 * dans l'historique immuable — côté serveur, `POST /api/supervision/report`.
 */
import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supervisionAPI } from '../../../api';

export default function SupervisionReportModal({ schedules = [], defaultSummary = '', onClose }) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState(defaultSummary);
  const [scheduleId, setScheduleId] = useState('');
  const [priority, setPriority] = useState('high');

  const send = useMutation({
    mutationFn: () => supervisionAPI.sendReport({
      title: title.trim(),
      summary: summary.trim() || undefined,
      scheduleId: scheduleId || undefined,
      priority,
    }),
    onSuccess: (res) => {
      toast.success(res?.data?.message || 'Rapport transmis à la direction');
      onClose?.();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Transmission impossible'),
  });

  const submit = (e) => {
    e.preventDefault();
    if (!title.trim()) return toast.error('Le titre du rapport est obligatoire');
    send.mutate();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, .55)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--border-radius-lg)', padding: 22,
          width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}
      >
        <div>
          <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700, color: 'var(--text-primary)' }}>
            Rapport à la direction
          </h3>
          <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 3 }}>
            Chaque directeur de l'hôpital reçoit une notification. L'envoi est tracé.
          </p>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Titre *</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Couverture des gardes — semaine en cours"
            maxLength={255}
            autoFocus
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Synthèse</span>
          <textarea
            className="input"
            rows={5}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Constats, conflits relevés, corrections demandées…"
            style={{ resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Planning concerné
            </span>
            <select className="input" value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
              <option value="">Aucun en particulier</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.departmentName ? `${s.departmentName} — ` : ''}{s.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>Priorité</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="high">Haute</option>
              <option value="urgent">Urgente</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={send.isPending}>
            Annuler
          </button>
          <button type="submit" className="btn btn-primary" disabled={send.isPending}>
            {send.isPending ? 'Transmission…' : 'Transmettre'}
          </button>
        </div>
      </form>
    </div>
  );
}
