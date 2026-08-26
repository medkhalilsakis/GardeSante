/**
 * ExportMenu — un seul bouton pour les quatre exports
 * ═══════════════════════════════════════════════════
 *
 * Fichier neuf. Classes préfixées `.gs-menu-`. Aucune logique d'export ici :
 * le composant appelle `onExport(format)` et laisse l'écran faire son travail.
 *
 * Pourquoi : les quatre exports occupaient quatre boutons de quatre couleurs
 * saturées (rouge, vert, bleu, violet) au même niveau que l'action principale
 * du planning. Ils rentrent dans un seul menu, sans rien perdre.
 */
import React, { useEffect, useRef, useState } from 'react';
import './ExportMenu.css';

const FORMATS = [
  { key: 'pdf', label: 'PDF du tableur', hint: 'Le tableau tel qu’il est affiché' },
  { key: 'excel', label: 'Excel (.xlsx)', hint: 'Modifiable, une feuille par planning' },
  { key: 'csv', label: 'CSV', hint: 'Pour un autre logiciel' },
  { key: 'calendar', label: 'Calendrier PDF', hint: 'Une page paysage, jour par jour' },
];

export default function ExportMenu({ onExport, label = 'Exporter' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="gs-menu" ref={ref}>
      <button
        type="button"
        className={`gs-menu-trigger ${open ? 'is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <span aria-hidden="true">↓</span> {label}
      </button>
      {open && (
        <div className="gs-menu-list" role="menu">
          {FORMATS.map(f => (
            <button
              key={f.key}
              type="button"
              role="menuitem"
              className="gs-menu-item"
              onClick={() => { setOpen(false); onExport(f.key); }}
            >
              <span className="gs-menu-item-label">{f.label}</span>
              <span className="gs-menu-item-hint">{f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
