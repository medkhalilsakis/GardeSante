/**
 * GsPageHeader — en-tête de page
 * ══════════════════════════════
 * L'ouverture de chaque écran, dans la même grammaire partout : le surtitre
 * situe, le titre nomme, la ligne de faits chiffre, les actions se rangent à
 * droite, et le pied accueille la rangée d'onglets ou la barre de filtres pour
 * qu'elles partagent le filet de séparation au lieu d'en ajouter un second.
 *
 * Remplace les huit en-têtes écrits à la main dans les tableaux de bord, tous
 * différents d'un ou deux pixels et tous en styles en ligne.
 *
 * ```jsx
 * <GsPageHeader
 *   eyebrow="Chef de service · Urgences"
 *   title="Planning des gardes"
 *   subtitle="Le tableur validé n'est jamais réécrit : les remplacements vivent à côté."
 *   meta={[{ label: 'Période', value: 'août 2026' }, { label: 'Effectif', value: 17 }]}
 *   actions={<button className="gs-btn is-primary">Créer un planning</button>}
 *   rail={<GsStatRail>…</GsStatRail>}
 * >
 *   <GsTabRail tabs={tabs} value={tab} onChange={setTab} />
 * </GsPageHeader>
 * ```
 */

import './gs-kit.css';

export default function GsPageHeader({
  eyebrow,
  title,
  subtitle,
  meta,
  actions,
  rail,
  children,
  plain = false,
  className = '',
}) {
  const facts = (meta || []).filter(Boolean);

  return (
    <header className={`gsk-head${plain ? ' is-plain' : ''}${className ? ` ${className}` : ''}`}>
      <div className="gsk-head-top">
        <div className="gsk-head-titles">
          {eyebrow ? <span className="gs-eyebrow">{eyebrow}</span> : null}
          {title ? <h1 className="gs-title">{title}</h1> : null}
          {subtitle ? <p className="gsk-head-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="gsk-head-actions">{actions}</div> : null}
      </div>

      {facts.length > 0 ? (
        <div className="gsk-head-meta">
          {facts.map((f, i) => (
            <span key={f.key || f.label || i}>
              {f.icon || null}
              {f.label ? `${f.label} ` : null}
              {/* Un chiffre passe au registre : c'est ce qui aligne les colonnes
                  d'un écran à l'autre. Un texte reste dans la voix courante. */}
              {typeof f.value === 'number' || f.numeric
                ? <b className="gs-num">{f.value}</b>
                : f.value}
            </span>
          ))}
        </div>
      ) : null}

      {rail || null}

      {children ? <div className="gsk-head-foot">{children}</div> : null}
    </header>
  );
}
