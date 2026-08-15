import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  History,
  LoaderCircle,
  Timer,
  UserRound,
  UserX,
  X,
} from 'lucide-react';
import JustificationChoice from '../../../components/common/JustificationChoice';

const META = {
  late: { label: 'Retard', subject: 'Retard', tone: 'warning', icon: Clock3 },
  absence: { label: 'Absent', subject: 'Absence', tone: 'danger', icon: UserX },
};

const formatDate = (iso) => {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

export default function HistoryCatchupModal({ mark, call, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [isJustified, setIsJustified] = useState(null);
  const [lateMinutes, setLateMinutes] = useState('');
  const dialogRef = useRef(null);
  const initialFocusRef = useRef(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  const meta = META[mark];
  const MarkIcon = meta.icon;

  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const focusFrame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hidden);
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-overlay appel-catchup-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialogRef}
        className={`modal appel-catchup-modal is-${meta.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="appel-catchup-title"
        aria-describedby="appel-catchup-description"
        aria-busy={busy}
      >
        <header className="appel-catchup-header">
          <span className="appel-catchup-title-icon"><MarkIcon size={20} aria-hidden="true" /></span>
          <div>
            <span>Correction de l'historique</span>
            <h2 id="appel-catchup-title">Rattraper « {meta.label} »</h2>
            <p id="appel-catchup-description">Complétez la première déclaration de cette garde passée.</p>
          </div>
          <button
            type="button"
            className="appel-catchup-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Fermer la fenêtre"
            title="Fermer"
          >
            <X size={18} />
          </button>
        </header>

        <div className="appel-catchup-context" aria-label="Garde à rattraper">
          <div>
            <span className="appel-catchup-context-icon"><UserRound size={16} /></span>
            <span><small>Personnel</small><strong>{call.userName}</strong></span>
          </div>
          <div>
            <span className="appel-catchup-context-icon"><CalendarDays size={16} /></span>
            <span><small>Date de garde</small><strong>{formatDate(call.date)}</strong></span>
          </div>
        </div>

        <form onSubmit={(event) => { event.preventDefault(); onConfirm({ reason, isJustified, lateMinutes }); }}>
          <div className="appel-catchup-body">
            {mark === 'late' && (
              <section className="appel-catchup-fieldset" aria-labelledby="appel-catchup-duration-label">
                <div className="appel-catchup-field-label">
                  <span><Timer size={15} /><b id="appel-catchup-duration-label">Durée du retard</b></span>
                  <small>En minutes</small>
                </div>
                <div className="appel-catchup-duration-row">
                  <label className="appel-catchup-number">
                    <input
                      ref={initialFocusRef}
                      type="number"
                      min={0}
                      max={1440}
                      step={5}
                      value={lateMinutes}
                      onChange={(event) => setLateMinutes(event.target.value)}
                      placeholder="25"
                      aria-labelledby="appel-catchup-duration-label"
                    />
                    <span>minutes</span>
                  </label>
                  <div className="appel-catchup-duration-presets" aria-label="Durées rapides">
                    {[15, 30, 60].map((minutes) => (
                      <button
                        type="button"
                        key={minutes}
                        className={String(lateMinutes) === String(minutes) ? 'is-active' : ''}
                        aria-pressed={String(lateMinutes) === String(minutes)}
                        onClick={() => setLateMinutes(String(minutes))}
                      >
                        {minutes} min
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <section className="appel-catchup-fieldset">
              <label className="appel-catchup-field-label" htmlFor="appel-catchup-reason">
                <span><FileText size={15} /><b>Motif</b></span>
                <small>Facultatif</small>
              </label>
              <textarea
                ref={mark !== 'late' ? initialFocusRef : undefined}
                id="appel-catchup-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Précisez le contexte de cette déclaration tardive…"
              />
            </section>

            <section className="appel-catchup-justification">
              <JustificationChoice
                value={isJustified}
                onChange={setIsJustified}
                subject={meta.subject}
                label={mark === 'late' ? 'Qualification du retard' : 'Qualification de l’absence'}
                required
                disabled={busy}
              />
            </section>

            <div className="appel-catchup-note">
              <History size={14} aria-hidden="true" />
              <p>Cette saisie sera enregistrée comme déclaration tardive et restera traçable dans le journal.</p>
            </div>
          </div>

          <footer className="appel-catchup-footer">
            <button type="button" className="appel-catchup-cancel" onClick={onClose} disabled={busy}>Annuler</button>
            <button type="submit" className="appel-catchup-submit" disabled={busy}>
              {busy ? <LoaderCircle className="is-spinning" size={16} /> : <CheckCircle2 size={16} />}
              {busy ? 'Enregistrement…' : 'Confirmer le rattrapage'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
