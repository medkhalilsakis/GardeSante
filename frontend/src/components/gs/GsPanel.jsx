/**
 * GsPanel — zone de contenu nommée
 * ════════════════════════════════
 * Une zone porte un titre, éventuellement un sous-titre qui dit à quoi elle
 * sert, et ses outils à droite du titre — jamais mêlés au contenu. C'est le
 * motif que les quarante et quelques panneaux de la plateforme redessinaient
 * chacun à sa façon.
 *
 * `tone` sert à signaler, pas à décorer : `alert` pour une zone qui bloque
 * (journée découverte, soumission refusée), `duty` pour ce qui est en service.
 * Sans `tone`, le panneau est neutre — ce qui doit rester le cas le plus
 * fréquent.
 *
 * ```jsx
 * <GsPanel tone="alert" title="Journées découvertes" sub="Aucun agent affecté."
 *          tools={<button className="gs-btn is-quiet">Tout voir</button>}>
 *   …
 * </GsPanel>
 * ```
 */

import './gs-kit.css';

/** L'en-tête seul, pour les cas où le corps n'est pas un enfant direct. */
export function GsPanelHeader({ title, sub, icon, tools, bare = false, children }) {
  return (
    <div className={`gsk-panel-head${bare ? ' is-bare' : ''}`}>
      <div className="gsk-panel-titles">
        <h3 className="gsk-panel-title">
          {icon || null}
          {title}
        </h3>
        {sub ? <p className="gsk-panel-sub">{sub}</p> : null}
        {children || null}
      </div>
      {tools ? <div className="gsk-panel-tools">{tools}</div> : null}
    </div>
  );
}

export default function GsPanel({
  title,
  sub,
  icon,
  tools,
  tone,
  flat = false,
  flush = false,
  tight = false,
  scroll = false,
  maxHeight,
  header,
  footer,
  children,
  className = '',
  ...rest
}) {
  const cls = [
    'gsk-panel',
    flat ? 'is-flat' : '',
    tone === 'alert' ? 'is-alert' : '',
    tone === 'duty' ? 'is-duty' : '',
    className,
  ].filter(Boolean).join(' ');

  const bodyCls = [
    'gsk-panel-body',
    flush ? 'is-flush' : '',
    tight ? 'is-tight' : '',
    scroll ? 'is-scroll' : '',
  ].filter(Boolean).join(' ');

  return (
    <section
      className={cls}
      style={maxHeight ? { '--gsk-panel-max': typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight } : undefined}
      {...rest}
    >
      {header !== undefined
        ? header
        : (title || tools ? <GsPanelHeader title={title} sub={sub} icon={icon} tools={tools} /> : null)}
      <div className={bodyCls}>{children}</div>
      {footer || null}
    </section>
  );
}
