import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { notesAPI } from '../../api';
import NoteModal from './NoteModal';

export default function UrgentNotesBanner() {
  const queryClient = useQueryClient();
  const [selectedNote, setSelectedNote] = useState(null);
  const { data } = useQuery({
    queryKey: ['urgent-notes'],
    queryFn: () => notesAPI.getAll({ priority: 'urgent', unreadOnly: true, limit: 20 }),
    refetchInterval: 60000,
  });
  const notes = data?.data?.data || [];

  const markRead = useMutation({
    mutationFn: (id) => notesAPI.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['urgent-notes'] });
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => toast.error(error.response?.data?.message || 'Marquage impossible'),
  });

  if (!notes.length) return null;

  return (
    <>
      <section style={{ margin: '0 0 16px', border: '1px solid #FCA5A5', borderLeft: '5px solid #DC2626', borderRadius: 8, background: '#FEF2F2', overflow: 'hidden' }}>
        <div style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9, color: '#991B1B', borderBottom: notes.length > 1 ? '1px solid #FECACA' : 'none' }}>
          <AlertTriangle size={18} />
          <strong style={{ fontSize: 13 }}>{notes.length} information{notes.length > 1 ? 's' : ''} urgente{notes.length > 1 ? 's' : ''} à lire</strong>
        </div>
        <div style={{ display: 'grid' }}>
          {notes.map((note) => (
            <div key={note.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderTop: '1px solid #FEE2E2' }}>
              <button type="button" onClick={() => setSelectedNote(note.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'transparent', color: '#7F1D1D', cursor: 'pointer', padding: 0 }}>
                <strong style={{ display: 'block', fontSize: 13 }}>{note.title}</strong>
                <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: '#B91C1C' }}>{note.author} · cliquez pour lire</span>
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={markRead.isPending && markRead.variables === note.id} onClick={() => markRead.mutate(note.id)}>
                <Check size={14} /> Marquer comme lu
              </button>
            </div>
          ))}
        </div>
      </section>
      {selectedNote && <NoteModal noteId={selectedNote} onClose={() => setSelectedNote(null)} />}
    </>
  );
}
