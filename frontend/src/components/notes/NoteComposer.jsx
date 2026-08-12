import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notesAPI } from '../../api';
import toast from 'react-hot-toast';

const CATEGORIES = [
  { value: 'note', label: '📝 Note' },
  { value: 'circulaire', label: '📢 Circulaire' },
  { value: 'directive', label: '📌 Directive' },
  { value: 'info', label: 'ℹ️ Information' },
];

const PRIORITIES = [
  { value: 'low', label: 'Faible' },
  { value: 'normal', label: 'Normale' },
  { value: 'high', label: 'Élevée' },
  { value: 'urgent', label: 'Urgente' },
];

export default function NoteComposer({ scopeLabel }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('note');
  const [priority, setPriority] = useState('normal');
  const [isPinned, setIsPinned] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [open, setOpen] = useState(false);

  const queryClient = useQueryClient();

  const publish = useMutation({
    mutationFn: () => notesAPI.publish({ title, body, category, priority, isPinned, attachments }),
    onSuccess: () => {
      toast.success('Note publiée et notifiée à toute l’audience');
      setTitle('');
      setBody('');
      setCategory('note');
      setPriority('normal');
      setIsPinned(false);
      setAttachments([]);
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erreur lors de la publication');
    },
  });

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    const ok = files.filter((f) => allowed.includes(f.type));
    const rejected = files.length - ok.length;
    if (rejected > 0) toast.error(`${rejected} fichier(s) ignoré(s) : images (JPG, PNG, WebP, GIF) et PDF uniquement`);
    setAttachments((prev) => [...prev, ...ok].slice(0, 5));
  };

  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        border: '1px solid #E5E7EB',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        padding: '20px',
        marginBottom: '20px',
      }}
    >
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px 16px',
            background: '#F9FAFB',
            border: '1px dashed #D1D5DB',
            borderRadius: '10px',
            cursor: 'pointer',
            color: '#6B7280',
            fontSize: '15px',
            textAlign: 'left',
          }}
        >
          <span
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: '#EFF6FF',
              color: '#3B82F6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              flexShrink: 0,
            }}
          >
            ✍️
          </span>
          Écrire une note ou circulaire…
          {scopeLabel && (
            <span
              style={{
                marginLeft: 'auto',
                background: '#F3F4F6',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#6B7280',
              }}
            >
              Diffusée à {scopeLabel}
            </span>
          )}
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827' }}>Nouvelle note / circulaire</h3>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#9CA3AF' }}
            >
              ✕
            </button>
          </div>

          <input
            type="text"
            placeholder="Titre de la note *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #D1D5DB',
              borderRadius: '8px',
              fontSize: '15px',
              marginBottom: '12px',
              outline: 'none',
            }}
          />

          <textarea
            placeholder="Contenu de la note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              padding: '12px',
              border: '1px solid #D1D5DB',
              borderRadius: '8px',
              fontSize: '14px',
              resize: 'vertical',
              marginBottom: '12px',
              outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{
                padding: '10px',
                border: '1px solid #D1D5DB',
                borderRadius: '8px',
                fontSize: '14px',
                background: 'white',
                flex: 1,
                minWidth: '140px',
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={{
                padding: '10px',
                border: '1px solid #D1D5DB',
                borderRadius: '8px',
                fontSize: '14px',
                background: 'white',
                flex: 1,
                minWidth: '140px',
              }}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>Priorité : {p.label}</option>
              ))}
            </select>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px',
                border: '1px solid #D1D5DB',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                color: '#4B5563',
                flexShrink: 0,
              }}
            >
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
                style={{ accentColor: '#F59E0B' }}
              />
              📌 Épingler
            </label>
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px',
              border: '1px dashed #D1D5DB',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#4B5563',
              marginBottom: '8px',
            }}
          >
            📎 Joindre des fichiers (images ou PDF, max 5)
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              onChange={(e) => addFiles(e.target.files)}
              style={{ display: 'none' }}
            />
          </label>

          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              {attachments.map((f, i) => (
                <div
                  key={`${f.name}_${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: '#F3F4F6',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    color: '#4B5563',
                  }}
                >
                  <span>{f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                  <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </span>
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#EF4444', fontSize: '14px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: '10px 20px',
                background: 'white',
                border: '1px solid #D1D5DB',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                color: '#4B5563',
              }}
            >
              Annuler
            </button>
            <button
              onClick={() => publish.mutate()}
              disabled={!title.trim() || publish.isPending}
              style={{
                padding: '10px 24px',
                background: '#3B82F6',
                border: 'none',
                borderRadius: '8px',
                cursor: publish.isPending ? 'wait' : title.trim() ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: '600',
                color: 'white',
                opacity: title.trim() ? 1 : 0.5,
              }}
            >
              {publish.isPending ? 'Publication…' : '📤 Publier'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
