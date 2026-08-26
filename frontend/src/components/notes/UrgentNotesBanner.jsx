import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { notesAPI } from '../../api';
import NoteModal from './NoteModal';
import './notes-ui.css';

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
      <section className={`gsn-urgent${notes.length > 1 ? ' has-many' : ''}`}>
        <div className="gsn-urgent__head">
          <AlertTriangle size={17} />
          <strong>{notes.length} information{notes.length > 1 ? 's' : ''} urgente{notes.length > 1 ? 's' : ''} à lire</strong>
        </div>
        <div>
          {notes.map((note) => (
            <div key={note.id} className="gsn-urgent__row">
              <button type="button" className="gsn-urgent__link" onClick={() => setSelectedNote(note.id)}>
                <strong>{note.title}</strong>
                <span>{note.author} · cliquez pour lire</span>
              </button>
              <button type="button" className="gs-btn" disabled={markRead.isPending && markRead.variables === note.id} onClick={() => markRead.mutate(note.id)}>
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
