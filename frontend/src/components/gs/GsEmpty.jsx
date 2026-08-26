/**
 * GsEmpty — le vide est une instruction
 * ═════════════════════════════════════
 * La plateforme comptait quatorze blocs « Aucun… » quasi identiques, qui
 * constataient sans jamais dire quoi faire. Un écran vide est une invitation à
 * agir : il nomme ce qui manque, explique pourquoi c'est vide, et propose
 * l'action qui le remplirait — ou dit franchement qu'il n'y a rien à faire.
 *
 * Ne jamais s'excuser, ne jamais rester vague sur ce qui s'est passé. « Aucune
 * garde aujourd'hui » ne suffit pas ; « Aucun agent de service aujourd'hui dans
 * ce service — le planning d'août est encore un brouillon » situe, et le bouton
 * « Ouvrir le brouillon » termine la phrase.
 *
 * ```jsx
 * <GsEmpty
 *   icon={<CalendarOff size={26} strokeWidth={1.6} />}
 *   title="Aucun agent de service aujourd'hui"
 *   hint="Le planning d'août 2026 est encore un brouillon : personne n'y est affecté."
 *   actions={<button className="gs-btn is-primary" onClick={open}>Ouvrir le brouillon</button>}
 * />
 * ```
 */

import './gs-kit.css';

export default function GsEmpty({
  icon,
  title,
  hint,
  actions,
  bare = false,
  className = '',
}) {
  return (
    <div className={`gsk-empty${bare ? ' is-bare' : ''}${className ? ` ${className}` : ''}`}>
      {icon || null}
      {title ? <strong className="gsk-empty-title">{title}</strong> : null}
      {hint ? <p className="gsk-empty-hint">{hint}</p> : null}
      {actions ? <div className="gsk-empty-actions">{actions}</div> : null}
    </div>
  );
}
