import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { notesAPI } from '../../api';
import toast from 'react-hot-toast';
import NoteCard from './NoteCard';
import NoteModal from './NoteModal';
import './notes-ui.css';

export default function NotesFeed({ scopeLabel }) {
  const [selectedNote, setSelectedNote] = useState(null);
  const [filters, setFilters] = useState({ category: '', scope: '' });
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notes', filters],
    queryFn: () => notesAPI.getAll(filters),
  });

  const deleteNote = useMutation({
    mutationFn: (id) => notesAPI.delete(id),
    onSuccess: () => {
      toast.success('Note supprimée');
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      setSelectedNote(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la suppression');
    },
  });

  const markRead = useMutation({
    mutationFn: (id) => notesAPI.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      queryClient.invalidateQueries({ queryKey: ['urgent-notes'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Marquage impossible'),
  });

  const notes = data?.data?.data || [];
  const canDelete = (note) => note.isAuthor;

  return (
    <div className="gsn-feed">
      <div className="gsn-feed__head">
        <h2 className="gsn-feed__title">Notes et circulaires</h2>
        {scopeLabel && <span className="gsn-scope">{scopeLabel}</span>}
      </div>

      <div className="gsn-filters">
        <select
          className="gsn-select"
          value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
        >
          <option value="">Toutes les catégories</option>
          <option value="note">Note</option>
          <option value="circulaire">Circulaire</option>
          <option value="directive">Directive</option>
          <option value="info">Information</option>
        </select>
        <select
          className="gsn-select"
          value={filters.scope}
          onChange={(e) => setFilters({ ...filters, scope: e.target.value })}
        >
          <option value="">Toutes les portées</option>
          <option value="platform_directors">Plateforme</option>
          <option value="establishment_staff">Hôpital</option>
          <option value="department">Service</option>
        </select>
      </div>

      {isLoading ? (
        <div className="gsn-loading">Chargement des notes…</div>
      ) : notes.length === 0 ? (
        <div className="gsn-empty">
          <Inbox size={26} />
          <p>Aucune note ou circulaire pour le moment</p>
        </div>
      ) : (
        <div>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onClick={() => setSelectedNote(note.id)}
              onDelete={deleteNote.mutate}
              onMarkRead={markRead.mutate}
              markingRead={markRead.isPending && markRead.variables === note.id}
              canDelete={canDelete(note)}
            />
          ))}
        </div>
      )}

      {selectedNote && (
        <NoteModal
          noteId={selectedNote}
          onClose={() => setSelectedNote(null)}
          onDelete={deleteNote.mutate}
        />
      )}
    </div>
  );
}
