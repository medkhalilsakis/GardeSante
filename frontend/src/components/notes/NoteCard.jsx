import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const PRIORITY_CONFIG = {
  low: { label: 'Faible', color: '#9CA3AF', bg: '#F3F4F6' },
  normal: { label: 'Normal', color: '#3B82F6', bg: '#EFF6FF' },
  high: { label: 'Élevée', color: '#F59E0B', bg: '#FEF3C7' },
  urgent: { label: 'Urgent', color: '#EF4444', bg: '#FEE2E2' },
};

const CATEGORY_LABELS = {
  note: 'Note',
  circulaire: 'Circulaire',
  directive: 'Directive',
  info: 'Information',
};

export default function NoteCard({ note, onClick, onDelete, onMarkRead, canDelete, markingRead = false }) {
  const priorityStyle = PRIORITY_CONFIG[note.priority] || PRIORITY_CONFIG.normal;

  return (
    <div
      style={{
        background: note.isPinned ? 'linear-gradient(135deg, #FFF7ED 0%, #FFFFFF 100%)' : '#FFFFFF',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '16px',
        border: note.isPinned ? '2px solid #F59E0B' : '1px solid #E5E7EB',
        boxShadow: note.isPinned ? '0 4px 12px rgba(245, 158, 11, 0.15)' : '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!note.isPinned) e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        if (!note.isPinned) e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
      }}
    >
      {note.isPinned && (
        <div
          style={{
            position: 'absolute',
            top: '-10px',
            right: '20px',
            background: '#F59E0B',
            color: 'white',
            padding: '4px 12px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: '600',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          📌 Épinglé
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span
              style={{
                background: priorityStyle.bg,
                color: priorityStyle.color,
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600',
              }}
            >
              {priorityStyle.label}
            </span>
            <span
              style={{
                background: '#F3F4F6',
                color: '#6B7280',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '500',
              }}
            >
              {CATEGORY_LABELS[note.category] || note.category}
            </span>
            {!note.isRead && (
              <span
                style={{
                  background: '#3B82F6',
                  color: 'white',
                  padding: '4px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: '600',
                }}
              >
                Non lu
              </span>
            )}
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
            {note.title}
          </h3>
          {note.body && (
            <p
              style={{
                color: '#6B7280',
                fontSize: '14px',
                lineHeight: '1.6',
                marginBottom: '12px',
                maxHeight: '60px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {note.body}
            </p>
          )}
          {note.attachmentsCount > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
              <span style={{ fontSize: '14px' }}>📎</span>
              <span style={{ fontSize: '13px', color: '#6B7280' }}>
                {note.attachmentsCount} pièce{note.attachmentsCount > 1 ? 's' : ''} jointe{note.attachmentsCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!note.isRead && (
          <button
            onClick={(event) => { event.stopPropagation(); onMarkRead?.(note.id); }}
            disabled={markingRead}
            style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8', cursor: markingRead ? 'wait' : 'pointer', padding: '7px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}
          >
            Marquer comme lu
          </button>
        )}
        {canDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm('Supprimer définitivement cette note ?')) onDelete(note.id);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#EF4444',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '6px',
              fontSize: '18px',
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#FEE2E2')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            title="Supprimer"
          >
            🗑️
          </button>
        )}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', color: '#9CA3AF' }}>
        <div>
          <strong style={{ color: '#4B5563' }}>{note.author}</strong>
          {note.authorRole && <span> · {note.authorRole}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>{format(new Date(note.publishedAt), 'd MMM yyyy · HH:mm', { locale: fr })}</span>
          {note.recipientsCount > 0 && (
            <span
              style={{
                background: '#F3F4F6',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#6B7280',
              }}
            >
              Lu par {note.readCount}/{note.recipientsCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
