import React, { useState } from 'react';
import JustificationChoice from '../../../components/common/JustificationChoice';

const META = {
  late: { label: 'Retard', emoji: '⏰' },
  absence: { label: 'Absent', emoji: '⛔' },
};

export default function HistoryCatchupModal({ mark, call, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [isJustified, setIsJustified] = useState(null);
  const [lateMinutes, setLateMinutes] = useState('');
  const meta = META[mark];

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{meta.emoji} Rattraper « {meta.label} »</h2>
            <p style={{ fontSize: 'var(--font-xs)', color: 'var(--text-muted)', marginTop: 2 }}>
              {call.userName} — garde du {new Date(`${call.date}T12:00:00`).toLocaleDateString('fr-FR')}
            </p>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>×</button>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); onConfirm({ reason, isJustified, lateMinutes }); }}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mark === 'late' && (
              <div className="form-group">
                <label className="form-label">Durée du retard (minutes)</label>
                <input
                  type="number" className="form-control" min={0} max={1440} step={5}
                  value={lateMinutes} onChange={(e) => setLateMinutes(e.target.value)}
                  placeholder="ex. 25"
                />
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Motif</label>
              <textarea
                className="form-control" rows={3} value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Motif facultatif…"
              />
            </div>
            <JustificationChoice
              value={isJustified}
              onChange={setIsJustified}
              subject={mark === 'late' ? 'Retard' : 'Absence'}
              label={mark === 'late' ? 'Qualification du retard' : 'Qualification de l’absence'}
              required
            />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Confirmer le rattrapage'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
