/**
 * GsTabRail — rangée d'onglets
 * ════════════════════════════
 * Les quatre tableaux de bord dupliquaient la même rangée de pastilles en
 * styles en ligne, avec un bleu plein sur l'onglet courant — le bleu du cachet,
 * qui est réservé à ce qui engage. Ici l'onglet courant se souligne : le filet
 * du bas est la ligne de séparation de la zone, l'onglet y pose son
 * marque-page. Les classes viennent de `styles/gardesante-design.css`.
 *
 * Le compteur ne s'affiche que lorsqu'il y a quelque chose à traiter : c'est un
 * chiffre, pas une décoration, donc au registre et à l'ambre.
 *
 * ```jsx
 * const tabs = [
 *   { id: 'journee', label: 'Ma journée' },
 *   { id: 'vigilance', label: 'Vigilance', count: 3 },
 *   { id: 'historique', label: 'Historique' },
 * ];
 * <GsTabRail label="Sections du service" tabs={tabs} value={tab} onChange={setTab} />
 * ```
 */

import './gs-kit.css';

export default function GsTabRail({
  tabs = [],
  value,
  onChange,
  label = 'Sections',
  className = '',
  ...rest
}) {
  const shown = tabs.filter(Boolean).filter((t) => t.hidden !== true);
  if (shown.length === 0) return null;

  return (
    <nav className={`gs-tabs${className ? ` ${className}` : ''}`} aria-label={label} {...rest}>
      {shown.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            className="gs-tab"
            aria-current={active ? 'page' : undefined}
            disabled={t.disabled || false}
            title={t.title || undefined}
            onClick={() => onChange?.(t.id)}
          >
            {t.icon || null}
            <span>{t.label}</span>
            {/* Un zéro n'est pas une alerte : on ne l'affiche pas. */}
            {t.count ? <span className="gs-tab-count">{t.count}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
