/**
 * PlanningHero — l'en-tête d'un planning de garde
 * ═══════════════════════════════════════════════
 *
 * Fichier neuf. Classes préfixées `.gs-hero-`. Purement présentatif : il ne
 * connaît ni l'API ni l'état du tableur, il reçoit ce qu'il montre et rend les
 * actions qu'on lui passe.
 *
 * Ce qu'il remplace : une barre d'outils où le nom du planning, son état, ses
 * dates, la recherche, quatre boutons d'export et l'action principale avaient
 * tous le même poids. Ici la hiérarchie est explicite — de quoi on parle, dans
 * quel état c'est, ce que ça pèse, puis ce qu'on peut en faire.
 *
 * Réutilisable pour les autres écrans de la refonte : la même coquille sert à
 * n'importe quel document daté (planning, appel du jour, feuille de garde) et,
 * avec `standalone`, à l'en-tête d'un écran qui n'est pas un document — c'est
 * ainsi que le tableau de bord du chef annonce son service.
 *
 * Les dates s'écrivent avec `utils/frenchDates` (`frenchRange`, `frenchSpan`) —
 * jamais avec `new Date()` sur une colonne DATE.
 */
import React from 'react';
import './PlanningHero.css';

export default function PlanningHero({
  eyebrow,
  title,
  statusLabel,
  statusTone = 'neutral',
  dirtyLabel,
  range,
  kindLabel,
  quantities = [],
  onBack,
  backLabel = 'Retour',
  actions,
  notices,
  standalone = false,
  children,
}) {
  return (
    <header className={`gs-hero ${standalone ? 'is-standalone' : ''}`}>
      {onBack && (
        <button type="button" className="gs-hero-back" onClick={onBack}>
          <span aria-hidden="true">←</span> {backLabel}
        </button>
      )}

      {notices}

      <div className="gs-hero-body">
        <div className="gs-hero-identity">
          <div className="gs-hero-eyebrow-row">
            {eyebrow && <span className="gs-eyebrow">{eyebrow}</span>}
            {kindLabel && <span className="gs-hero-kind">{kindLabel}</span>}
          </div>
          <h1 className="gs-title gs-hero-title">{title}</h1>
          {range && <p className="gs-hero-range">{range}</p>}
        </div>

        <div className="gs-hero-side">
          <div className="gs-hero-state">
            {statusLabel && (
              <span className={`gs-hero-seal is-${statusTone}`}>
                <i aria-hidden="true" />{statusLabel}
              </span>
            )}
            {dirtyLabel && <span className="gs-hero-dirty">{dirtyLabel}</span>}
          </div>
          {actions && <div className="gs-hero-actions">{actions}</div>}
        </div>
      </div>

      {quantities.length > 0 && (
        <dl className="gs-hero-quants">
          {quantities.map(q => (
            <div key={q.label} className={`gs-hero-quant ${q.tone ? `is-${q.tone}` : ''}`}>
              <dt>{q.label}</dt>
              <dd className="gs-num">{q.value}{q.unit && <span>{q.unit}</span>}</dd>
            </div>
          ))}
        </dl>
      )}

      {children}
    </header>
  );
}
