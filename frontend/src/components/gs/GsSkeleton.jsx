/**
 * GsSkeleton — l'attente
 * ══════════════════════
 * Des filets à la géométrie du contenu qui arrive, plutôt qu'un « Chargement… »
 * centré qui fait sauter la page une fois les données là. Quatre formes, une par
 * assemblage du kit : la rangée de mesures, les lignes d'un tableau, un bloc de
 * panneau, et le texte simple.
 *
 * Le balayage se tait pour qui demande moins de mouvement (le socle neutralise
 * la durée, la feuille du kit retire aussi le dégradé pour ne pas laisser un
 * reflet figé au milieu de la barre).
 *
 * ```jsx
 * {isLoading ? <GsSkeleton variant="rail" count={4} /> : <GsStatRail>…</GsStatRail>}
 * ```
 */

import './gs-kit.css';

export default function GsSkeleton({ variant = 'text', count = 3, className = '' }) {
  const wrap = (children) => (
    <div className={`gsk-skel${className ? ` ${className}` : ''}`} aria-hidden="true">
      {children}
    </div>
  );

  if (variant === 'rail') {
    return (
      <div className={`gsk-skel-rail${className ? ` ${className}` : ''}`} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>
            <div className="gsk-skel-bar" style={{ width: '60%', height: 7 }} />
            <div className="gsk-skel-bar is-tall" style={{ width: '85%' }} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'rows') {
    return wrap(
      Array.from({ length: count }, (_, i) => (
        <div key={i} className="gsk-skel-bar" style={{ height: 30, width: `${100 - i * 4}%` }} />
      ))
    );
  }

  if (variant === 'block') {
    return wrap(
      Array.from({ length: count }, (_, i) => <div key={i} className="gsk-skel-bar is-block" />)
    );
  }

  return wrap(
    Array.from({ length: count }, (_, i) => (
      <div key={i} className="gsk-skel-bar" style={{ width: i === count - 1 ? '55%' : '100%' }} />
    ))
  );
}
