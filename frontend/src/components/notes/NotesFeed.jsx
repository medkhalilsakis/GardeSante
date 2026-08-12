import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notesAPI } from '../../api';
import toast from 'react-hot-toast';
import NoteCard from './NoteCard';
import NoteModal from './NoteModal';

export default function NotesFeed({ scopeLabel, showComposer = false }) {
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

  const notes = data?.data?.data || [];
  const canDelete = (note) => note.isAuthor;

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#111827' }}>
          📢 Notes et Circulaires
        </h2>
        {scopeLabel && (
          <span
            style={{
              background: '#F3F4F6',
              color: '#6B7280',
              padding: '6px 12px',
              borderRadius: '8px',
              fontSize: '13px',
            }}
          >
            {scopeLabel}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <select
          value={filters.category}
          onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          style={{
            padding: '10px',
            border: '1px solid #D1D5DB',
            borderRadius: '8px',
            fontSize: '14px',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="">Toutes les catégories</option>
          <option value="note">📝 Note</option>
          <option value="circulaire">📢 Circulaire</option>
          <option value="directive">📌 Directive</option>
          <option value="info">ℹ️ Information</option>
        </select>
        <select
          value={filters.scope}
          onChange={(e) => setFilters({ ...filters, scope: e.target.value })}
          style={{
            padding: '10px',
            border: '1px solid #D1D5DB',
            borderRadius: '8px',
            fontSize: '14px',
            background: 'white',
            cursor: 'pointer',
          }}
        >
          <option value="">Toutes les portées</option>
          <option value="platform_directors">🌐 Plateforme</option>
          <option value="establishment_staff">🏥 Hôpital</option>
          <option value="department">🏢 Service</option>
        </select>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF' }}>
          Chargement des notes…
        </div>
      ) : notes.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            background: '#F9FAFB',
            borderRadius: '12px',
            border: '1px dashed #D1D5DB',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
          <p style={{ color: '#6B7280', fontSize: '15px' }}>
            Aucune note ou circulaire pour le moment
          </p>
        </div>
      ) : (
        <div>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onClick={() => setSelectedNote(note.id)}
              onDelete={deleteNote.mutate}
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
