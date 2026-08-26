/**
 * GsBadge — un état
 * ═════════════════
 * Nomme un état, ne décore pas. Le point coloré porte l'information, le mot la
 * nomme. Les trois `tone` gardent leur sens partout :
 *   • `duty`  — de service, couvert, accepté ;
 *   • `alert` — découvert, refusé, en retard, bloquant ;
 *   • `seal`  — validé, scellé, engagé.
 * Sans `tone`, l'état est neutre (brouillon, en attente, archivé).
 *
 * Ce composant ne remplace pas `PlanningStateBadge` : celui-là connaît les
 * états d'un planning et reste la source de vérité pour eux. Celui-ci sert aux
 * états que chaque écran inventait en styles en ligne.
 */

import './gs-kit.css';

export default function GsBadge({
  children,
  tone,
  dot = false,
  icon,
  title,
  className = '',
  ...rest
}) {
  const cls = [
    'gsk-badge',
    tone === 'seal' ? 'is-seal' : '',
    tone === 'duty' ? 'is-duty' : '',
    tone === 'alert' ? 'is-alert' : '',
    tone === 'quiet' ? 'is-quiet' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={cls} title={title} {...rest}>
      {dot ? <i className="gsk-badge-dot" aria-hidden="true" /> : null}
      {icon || null}
      {children}
    </span>
  );
}
