import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notesAPI } from '../../api';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const PRIORITY_CONFIG = {
  low: { label: 'Faible', color: '#9CA3AF', bg: '#F3F4F6' },
  normal: { label: 'Normal', color: '#3B82F6', bg: '#EFF6FF' },
  high: { label: 'Élevée', color: '#F59E0B', bg: '#FEF3C7' },
  urgent: { label: 'Urgent', color: '#EF4444', bg: '#FEE2E2' },
};

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000';

export default function NoteModal({ noteId, onClose }) {
  const queryClient = useQueryClient();

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

  const note = data?.data?.data;
  const { data: readersData, isLoading: readersLoading } = useQuery({
    queryKey: ['note-readers', noteId],
    queryFn: () => notesAPI.getReaders(noteId),
    enabled: Boolean(noteId && note?.canViewReaders),
  });
  const readers = readersData?.data?.data || [];

  useEffect(() => {
    if (!note?.id) return;
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    queryClient.invalidateQueries({ queryKey: ['urgent-notes'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, [note?.id, queryClient]);
  if (!noteId) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          maxWidth: '800px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {isLoading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#9CA3AF' }}>
            Chargement…
          </div>
        ) : !note ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#EF4444' }}>
            Note introuvable
          </div>
        ) : (
          <>
            <div
              style={{
                padding: '24px',
                borderBottom: '1px solid #E5E7EB',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      background: PRIORITY_CONFIG[note.priority]?.bg || '#F3F4F6',
                      color: PRIORITY_CONFIG[note.priority]?.color || '#6B7280',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: '600',
                    }}
                  >
                    {PRIORITY_CONFIG[note.priority]?.label || note.priority}
                  </span>
                  {note.isPinned && (
                    <span
                      style={{
                        background: '#FEF3C7',
                        color: '#F59E0B',
                        padding: '6px 12px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                      }}
                    >
                      📌 Épinglé
                    </span>
                  )}
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
                  {note.title}
                </h2>
                <div style={{ fontSize: '14px', color: '#6B7280' }}>
                  <strong style={{ color: '#4B5563' }}>{note.author}</strong>
                  {note.authorRole && <span> · {note.authorRole}</span>}
                  <span> · {format(new Date(note.publishedAt), 'd MMM yyyy à HH:mm', { locale: fr })}</span>
                </div>
                {note.recipientsCount > 0 && (
                  <div
                    style={{
                      marginTop: '8px',
                      background: '#F3F4F6',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      color: '#6B7280',
                      display: 'inline-block',
                    }}
                  >
                    Lu par {note.readCount}/{note.recipientsCount} destinataires
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: '#9CA3AF',
                  padding: '8px',
                  marginLeft: '16px',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '24px' }}>
              {note.body && (
                <div
                  style={{
                    fontSize: '15px',
                    lineHeight: '1.7',
                    color: '#374151',
                    whiteSpace: 'pre-wrap',
                    marginBottom: note.attachments?.length > 0 ? '24px' : 0,
                  }}
                >
                  {note.body}
                </div>
              )}

              {note.attachments?.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '14px', fontWeight: '600', color: '#6B7280', marginBottom: '12px' }}>
                    📎 Pièces jointes ({note.attachments.length})
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {note.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={`${API_BASE}${att.file_url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px',
                          background: '#F9FAFB',
                          border: '1px solid #E5E7EB',
                          borderRadius: '8px',
                          textDecoration: 'none',
                          color: '#111827',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#F3F4F6';
                          e.currentTarget.style.borderColor = '#D1D5DB';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#F9FAFB';
                          e.currentTarget.style.borderColor = '#E5E7EB';
                        }}
                      >
                        <span style={{ fontSize: '24px' }}>
                          {att.kind === 'pdf' ? '📄' : '🖼️'}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '14px', fontWeight: '500' }}>{att.file_name}</div>
                          <div style={{ fontSize: '12px', color: '#9CA3AF' }}>
                            {att.kind.toUpperCase()} · {Math.round(att.size_bytes / 1024)} Ko
                          </div>
                        </div>
                        <span style={{ fontSize: '18px', color: '#9CA3AF' }}>↗</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {note.canViewReaders && (
                <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid #E5E7EB' }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 10 }}>
                    Lecteurs ({readers.length}/{note.recipientsCount})
                  </h3>
                  {readersLoading ? (
                    <div style={{ color: '#9CA3AF', fontSize: 13 }}>Chargement des lecteurs…</div>
                  ) : readers.length === 0 ? (
                    <div style={{ color: '#9CA3AF', fontSize: 13 }}>Aucun destinataire n'a encore lu cette note.</div>
                  ) : (
                    <div style={{ display: 'grid', gap: 7 }}>
                      {readers.map((reader) => (
                        <div key={reader.userId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 10px', borderRadius: 7, background: '#F9FAFB', fontSize: 12 }}>
                          <span><strong>{reader.name}</strong>{reader.roleName ? ` · ${reader.roleName}` : ''}</span>
                          <span style={{ color: '#6B7280' }}>{format(new Date(reader.readAt), 'd MMM yyyy · HH:mm', { locale: fr })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {note.isAuthor && (
              <div
                style={{
                  padding: '20px 24px',
                  borderTop: '1px solid #E5E7EB',
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  onClick={() => {
                    if (window.confirm('Supprimer définitivement cette note ?')) {
                      deleteMut.mutate();
                    }
                  }}
                  disabled={deleteMut.isPending}
                  style={{
                    padding: '10px 20px',
                    background: '#EF4444',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: deleteMut.isPending ? 'wait' : 'pointer',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: 'white',
                  }}
                >
                  {deleteMut.isPending ? 'Suppression…' : '🗑️ Supprimer'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
