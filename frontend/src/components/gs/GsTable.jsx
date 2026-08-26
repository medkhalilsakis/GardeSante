/**
 * GsTable — le registre
 * ═════════════════════
 * Un vrai `<table>` : en-tête collant en surtitre, filets horizontaux seuls,
 * chiffres tabulaires alignés à droite. Les listes de la plateforme sont
 * aujourd'hui des piles de `<div>` en flex — lisibles à l'œil, mais sans
 * en-tête de colonne, sans tri et sans lecture possible au lecteur d'écran.
 *
 * L'enveloppe porte le défilement horizontal : c'est ce qui empêche une colonne
 * de trop de pousser la page entière, le défaut de mise en page relevé sur la
 * coque sous 900 px.
 *
 * Une colonne se déclare une fois :
 *   `{ key, label, num, strong, width, align, render, sortable, hidden }`
 * — `num` met la cellule au registre et l'aligne à droite (tout chiffre, date,
 * matricule ou compteur), `render(row, index)` prend la main quand la cellule
 * n'est pas une valeur brute.
 *
 * ```jsx
 * <GsTable
 *   columns={[
 *     { key: 'name', label: 'Agent', strong: true },
 *     { key: 'gardes', label: 'Gardes', num: true, sortable: true },
 *     { key: 'state', label: 'État', render: (r) => <GsBadge tone={r.tone}>{r.state}</GsBadge> },
 *   ]}
 *   rows={rows}
 *   rowKey="id"
 *   sort={sort}
 *   onSort={setSortKey}
 *   empty={<GsEmpty title="Aucun agent dans ce service" hint="…" />}
 * />
 * ```
 */

import './gs-kit.css';

/** Glyphe de tri : une donnée d'état, pas une icône décorative. */
const arrow = (dir) => (dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕');

export default function GsTable({
  columns = [],
  rows = [],
  rowKey = 'id',
  empty,
  caption,
  sort,
  onSort,
  flagged,
  label,
  className = '',
}) {
  const cols = columns.filter(Boolean).filter((c) => c.hidden !== true);

  // Le vide n'est pas un tableau à zéro ligne : c'est une instruction, et elle
  // n'a pas besoin d'en-têtes de colonnes pour être lue.
  if (rows.length === 0 && empty) return empty;

  const keyOf = (row, i) => (typeof rowKey === 'function' ? rowKey(row, i) : row?.[rowKey] ?? i);

  return (
    <div className={`gsk-table-wrap${className ? ` ${className}` : ''}`}>
      <table className="gsk-table" aria-label={label || undefined}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {cols.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{
                    width: c.width || undefined,
                    textAlign: c.num ? 'right' : c.align || undefined,
                  }}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sortable && onSort ? (
                    <button type="button" className="gsk-table-sort" onClick={() => onSort(c.key)}>
                      {c.label}
                      <span aria-hidden="true">{arrow(active ? sort.dir : null)}</span>
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={keyOf(row, i)} className={flagged?.(row) ? 'is-flagged' : undefined}>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={[c.num ? 'is-num' : '', c.strong ? 'is-strong' : ''].filter(Boolean).join(' ') || undefined}
                  style={!c.num && c.align ? { textAlign: c.align } : undefined}
                >
                  {c.render ? c.render(row, i) : row?.[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
