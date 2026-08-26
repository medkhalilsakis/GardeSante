/**
 * GsStat — le filet de mesure
 * ═══════════════════════════
 * L'élément signature de la plateforme, hérité du `PlanningHero` de la
 * partie 1 : la valeur, son unité et son libellé posés sur une réglure
 * verticale. Il remplace les grilles de cartes à icône colorée — une mesure
 * n'a pas de couleur parce qu'elle est la quatrième de la rangée.
 *
 * Les six couleurs décoratives que chaque tableau de bord répétait — un bleu,
 * un vert, un indigo, un ambre, un rouge et un rose — disparaissent ici.
 * Restent trois `tone`, et chacun veut dire quelque chose :
 *   • `duty`  — de service, couvert ;
 *   • `alert` — découvert, bloquant, en retard ;
 *   • `seal`  — la mesure qui engage l'écran (une seule par rangée).
 *
 * Une mesure cliquable est un lien étiré, pas une carte : le libellé porte le
 * bouton et son `::after` couvre la mesure, donc la souris et le clavier visent
 * la même cible. Avant de rendre un compteur cliquable, vérifier que l'écran
 * ouvert montre bien le même ensemble que l'agrégat, pour le rôle qui clique.
 *
 * ```jsx
 * <GsStatRail>
 *   <GsStat label="De service aujourd'hui" value={8} tone="duty" />
 *   <GsStat label="Journées découvertes" value={3} tone="alert"
 *           hint="Sur les sept prochains jours" onClick={() => setTab('vigilance')} />
 *   <GsStat label="Taux de couverture" value="94" unit="%" />
 * </GsStatRail>
 * ```
 */

import './gs-kit.css';

/** La rangée. `compact` pour un pied de panneau plutôt qu'un en-tête de page. */
export function GsStatRail({ compact = false, children, className = '' }) {
  return (
    <dl className={`gsk-rail${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </dl>
  );
}

export default function GsStat({
  label,
  value,
  unit,
  hint,
  tone,
  onClick,
  title,
  className = '',
}) {
  const cls = [
    'gsk-stat',
    tone === 'duty' ? 'is-duty' : '',
    tone === 'alert' ? 'is-alert' : '',
    tone === 'seal' ? 'is-seal' : '',
    onClick ? 'is-link' : '',
    className,
  ].filter(Boolean).join(' ');

  // Une valeur absente se dit « — » : un tiret cadratin est une donnée
  // manquante, un « 0 » est une mesure. Les confondre a produit le faux
  // « 100 % de couverture » de l'ancien tableau de bord.
  const shown = value === null || value === undefined || value === '' ? '—' : value;

  return (
    <div className={cls}>
      <dt>
        {onClick
          ? <button type="button" className="gsk-stat-open" onClick={onClick} title={title}>{label}</button>
          : label}
      </dt>
      <dd>
        {shown}
        {unit ? <span className="gsk-stat-unit">{unit}</span> : null}
      </dd>
      {hint ? <span className="gsk-stat-hint">{hint}</span> : null}
    </div>
  );
}
