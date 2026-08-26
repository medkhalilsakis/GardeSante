import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notesAPI } from '../../api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowUpRight, FileText, Image as ImageIcon, Paperclip, Pin, Trash2 } from 'lucide-react';
import { PRIORITY_LABELS, priorityClass } from './notes-labels';
import './notes-ui.css';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

export default function NoteModal({ noteId, onClose }) {
  const queryClient = useQueryClient();
  const markedReadRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ['note', noteId],
    queryFn: () => notesAPI.getOne(noteId),
    enabled: !!noteId,
  });

  const deleteMut = useMutation({
    mutationFn: () => notesAPI.delete(noteId),
    onSuccess: () => {
      toast.success('Note supprimée');
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      onClose();
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression');
    },
  });

  const markReadMut = useMutation({
    mutationFn: (id) => notesAPI.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['urgent-notes'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: () => {
      markedReadRef.current = null;
    },
  });

  const note = data?.data?.data;
  const { data: readersData, isLoading: readersLoading } = useQuery({
    queryKey: ['note-readers', noteId],
    queryFn: () => notesAPI.getReaders(noteId),
    enabled: Boolean(noteId && note?.canViewReaders),
  });
  const readers = readersData?.data?.data || [];

  useEffect(() => {
    if (!note?.id) return;
    if (!note.isRead && markedReadRef.current !== note.id) {
      markedReadRef.current = note.id;
      markReadMut.mutate(note.id);
    }
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['urgent-notes'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, [note?.id, note?.isRead, queryClient, markReadMut]);
  if (!noteId) return null;

  return (
    <div className="gsn-overlay" onClick={onClose}>
      <div className="gsn-modal" onClick={(e) => e.stopPropagation()}>
        {isLoading ? (
          <div className="gsn-state">Chargement…</div>
        ) : !note ? (
          <div className="gsn-state is-error">Note introuvable</div>
        ) : (
          <>
            <div className="gsn-modal__head">
              <div>
                <div className="gsn-tags">
                  <span className={priorityClass(note.priority)}>
                    {PRIORITY_LABELS[note.priority] || note.priority}
                  </span>
                  {note.isPinned && (
                    <span className="gsn-pill is-pinned"><Pin size={12} /> Épinglé</span>
                  )}
                  {note.recipientsCount > 0 && (
                    <span className="gsn-pill is-quiet">
                      Lu par {note.readCount}/{note.recipientsCount} destinataires
                    </span>
                  )}
                </div>
                <h2 className="gsn-modal__title">{note.title}</h2>
                <div className="gsn-modal__byline">
                  <strong>{note.author}</strong>
                  {note.authorRole && <span> · {note.authorRole}</span>}
                  <span> · {format(new Date(note.publishedAt), 'd MMM yyyy à HH:mm', { locale: fr })}</span>
                </div>
              </div>
              <button type="button" className="gsn-close" onClick={onClose} aria-label="Fermer">✕</button>
            </div>

            <div className="gsn-modal__body">
              {note.body && (
                <div className={`gsn-prose${note.attachments?.length > 0 ? ' has-attachments' : ''}`}>
                  {note.body}
                </div>
              )}

              {note.attachments?.length > 0 && (
                <div>
                  <h3 className="gsn-sub-title">
                    <Paperclip size={13} /> Pièces jointes ({note.attachments.length})
                  </h3>
                  <div className="gsn-attach-list">
                    {note.attachments.map((att) => (
                      <a
                        key={att.id}
                        className="gsn-attach"
                        href={`${API_BASE}${att.file_url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="gsn-attach__kind">
                          {att.kind === 'pdf' ? <FileText size={16} /> : <ImageIcon size={16} />}
                        </span>
                        <div className="gsn-attach__text">
                          <div className="gsn-attach__name">{att.file_name}</div>
                          <div className="gsn-attach__meta">
                            {att.kind.toUpperCase()} · {Math.round(att.size_bytes / 1024)} Ko
                          </div>
                        </div>
                        <ArrowUpRight className="gsn-attach__go" size={16} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {note.canViewReaders && (
                <div className="gsn-readers">
                  <h3 className="gsn-sub-title">Lecteurs ({readers.length}/{note.recipientsCount})</h3>
                  {readersLoading ? (
                    <div className="gsn-state">Chargement des lecteurs…</div>
                  ) : readers.length === 0 ? (
                    <div className="gsn-state">Aucun destinataire n'a encore lu cette note.</div>
                  ) : (
                    <div className="gsn-reader-list">
                      {readers.map((reader) => (
                        <div key={reader.userId} className="gsn-reader">
                          <span><strong>{reader.name}</strong>{reader.roleName ? ` · ${reader.roleName}` : ''}</span>
                          <time>{format(new Date(reader.readAt), 'd MMM yyyy · HH:mm', { locale: fr })}</time>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {note.isAuthor && (
              <div className="gsn-modal__foot">
                <button
                  type="button"
                  className="gs-btn is-danger"
                  disabled={deleteMut.isPending}
                  onClick={() => {
                    if (window.confirm('Supprimer définitivement cette note ?')) {
                      deleteMut.mutate();
                    }
                  }}
                >
                  <Trash2 size={14} />
                  {deleteMut.isPending ? 'Suppression…' : 'Supprimer'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
