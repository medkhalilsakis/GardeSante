/**
 * Transmission d'un rapport de supervision à la direction (Lot 5).
 *
 * Écrit une notification par directeur actif de l'hôpital et trace l'action
 * dans l'historique immuable — côté serveur, `POST /api/supervision/report`.
 *
 * Refonte (phase 4)
 * ─────────────────
 * La modale portait sa propre couche d'assombrissement,
 * sa propre boîte et ses libellés en styles en ligne : elle se désaccordait des
 * trente autres modales de la plateforme. Elle reprend ici la coquille commune
 * (`.modal-overlay`, `.modal`, `.form-group`, `.form-control`) comme le fait le
 * signalement d'absence ; seuls son sous-titre et ses consignes passent au
 * vocabulaire du registre.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supervisionAPI } from '../../../api';
import { frenchRange } from '../../../utils/frenchDates';
import '../supervision.css';

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
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      {/* `.modal` porte déjà `max-width: 560px` : la largeur ne se répète pas ici. */}
      <div className="modal">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Rapport à la direction</h2>
            <p className="gsp-modal-sub">
              Chaque directeur de l'hôpital en reçoit une notification, et l'envoi
              reste inscrit à l'historique.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer">
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>

        <form onSubmit={submit}>
          <div className="modal-body gsp-modal-body">
            <div className="form-group">
              <label className="form-label" htmlFor="gsp-report-title">Titre *</label>
              <input
                id="gsp-report-title"
                className="form-control"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Couverture des gardes — semaine en cours"
                maxLength={255}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="gsp-report-summary">Synthèse</label>
              <textarea
                id="gsp-report-summary"
                className="form-control form-control-textarea"
                rows={6}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Constats, anomalies relevées, corrections demandées…"
              />
              {/* Le brouillon reprend les mesures de l'écran : un rapport part de
                  faits déjà comptés, pas d'une page blanche. */}
              <span className="gsp-modal-hint">
                Pré-rempli avec les mesures du jour — modifiez-le librement avant l'envoi.
              </span>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="gsp-report-schedule">Planning concerné</label>
                <select
                  id="gsp-report-schedule"
                  className="form-control"
                  value={scheduleId}
                  onChange={(e) => setScheduleId(e.target.value)}
                >
                  <option value="">Aucun en particulier</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.departmentName ? `${s.departmentName} — ` : ''}{s.name}
                      {s.startDate ? ` (${frenchRange(s.startDate, s.endDate)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="gsp-report-priority">Priorité</label>
                <select
                  id="gsp-report-priority"
                  className="form-control"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="high">Haute</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={send.isPending}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={send.isPending}>
              {send.isPending ? 'Transmission…' : 'Transmettre'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
