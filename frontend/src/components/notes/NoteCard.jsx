import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Paperclip, Pin, Trash2 } from 'lucide-react';
import { CATEGORY_LABELS, PRIORITY_LABELS, priorityClass } from './notes-labels';
import './notes-ui.css';

export default function NoteCard({ note, onClick, onDelete, onMarkRead, canDelete, markingRead = false }) {
  const attachments = note.attachmentsCount || 0;

  return (
    <div className={`gsn-card${note.isPinned ? ' is-pinned' : ''}`} onClick={onClick}>
      {note.isPinned && (
        <div className="gsn-card__pin">
          <Pin size={12} /> Épinglé
        </div>
      )}

      <div className="gsn-card__head">
        <div className="gsn-card__main">
          <div className="gsn-tags">
            <span className={priorityClass(note.priority)}>
              {PRIORITY_LABELS[note.priority] || PRIORITY_LABELS.normal}
            </span>
            <span className="gsn-pill is-quiet">
              {CATEGORY_LABELS[note.category] || note.category}
            </span>
            {!note.isRead && <span className="gsn-pill is-unread">Non lu</span>}
          </div>

          <h3 className="gsn-card__title">{note.title}</h3>

          {note.body && <p className="gsn-card__body">{note.body}</p>}

          {attachments > 0 && (
            <div className="gsn-card__attach">
              <Paperclip size={13} />
              <span>{attachments} pièce{attachments > 1 ? 's' : ''} jointe{attachments > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>

        <div className="gsn-card__actions">
          {!note.isRead && (
            <button
              type="button"
              className="gs-btn"
              disabled={markingRead}
              onClick={(event) => { event.stopPropagation(); onMarkRead?.(note.id); }}
            >
              Marquer comme lu
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="gsn-del"
              title="Supprimer"
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm('Supprimer définitivement cette note ?')) onDelete(note.id);
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      <div className="gsn-card__foot">
        <div>
          <strong>{note.author}</strong>
          {note.authorRole && <span> · {note.authorRole}</span>}
        </div>
        <div className="gsn-card__meta">
          <time>{format(new Date(note.publishedAt), 'd MMM yyyy · HH:mm', { locale: fr })}</time>
          {note.recipientsCount > 0 && (
            <span className="gsn-readcount">Lu par {note.readCount}/{note.recipientsCount}</span>
          )}
        </div>
      </div>
    </div>
  );
}
