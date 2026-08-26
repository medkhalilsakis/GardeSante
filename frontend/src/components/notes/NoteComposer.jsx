import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Image as ImageIcon, Paperclip, PenLine, Pin } from 'lucide-react';
import { notesAPI } from '../../api';
import toast from 'react-hot-toast';
import { CATEGORY_LABELS, PRIORITY_LABELS } from './notes-labels';
import './notes-ui.css';

const CATEGORIES = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }));
const PRIORITIES = Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }));

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
    <div className="gsn-composer">
      {!open ? (
        <button type="button" className="gsn-composer__open" onClick={() => setOpen(true)}>
          <span className="gsn-composer__glyph"><PenLine size={16} /></span>
          Écrire une note ou circulaire…
          {scopeLabel && (
            <span className="gsn-pill is-quiet gsn-composer__scope">Diffusée {scopeLabel}</span>
          )}
        </button>
      ) : (
        <div>
          <div className="gsn-composer__head">
            <h3>Nouvelle note ou circulaire</h3>
            <button type="button" className="gsn-close" onClick={() => setOpen(false)} aria-label="Fermer">✕</button>
          </div>

          <input
            type="text"
            className="gsn-input"
            placeholder="Titre de la note *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
          />

          <textarea
            className="gsn-textarea"
            placeholder="Contenu de la note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />

          <div className="gsn-composer__row">
            <select className="gsn-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <select className="gsn-select" aria-label="Priorité" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>Priorité — {p.label}</option>
              ))}
            </select>
            <label className={`gsn-check${isPinned ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(e) => setIsPinned(e.target.checked)}
              />
              <Pin size={13} /> Épingler
            </label>
          </div>

          <label className="gsn-drop-files">
            <Paperclip size={14} />
            Joindre des fichiers (images ou PDF, 5 au maximum)
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              onChange={(e) => addFiles(e.target.files)}
            />
          </label>

          {attachments.length > 0 && (
            <div className="gsn-files">
              {attachments.map((f, i) => (
                <div key={`${f.name}_${i}`} className="gsn-file">
                  {f.type === 'application/pdf' ? <FileText size={13} /> : <ImageIcon size={13} />}
                  <span className="gsn-file__name">{f.name}</span>
                  <button
                    type="button"
                    className="gsn-file__drop"
                    aria-label={`Retirer ${f.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="gsn-composer__foot">
            <button type="button" className="gs-btn" onClick={() => setOpen(false)}>Annuler</button>
            <button
              type="button"
              className="gs-btn is-primary"
              onClick={() => publish.mutate()}
              disabled={!title.trim() || publish.isPending}
            >
              {publish.isPending ? 'Publication…' : 'Publier'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
