/**
 * GsFilterBar — restreindre une liste
 * ═══════════════════════════════════
 * Des filtres, pas des onglets : `aria-pressed` et non `aria-current`, parce
 * qu'ils restreignent une liste au lieu de changer de vue. C'est la distinction
 * que les écrans actuels brouillent en réutilisant les mêmes pastilles pour les
 * deux rôles.
 *
 * Le compteur de chaque filtre annonce ce qu'il reste après application — un
 * filtre qui mène à zéro doit le dire avant d'être pressé.
 *
 * `mode="multi"` accepte plusieurs filtres à la fois (`value` est alors un
 * tableau) ; `mode="single"` en garde un seul. La recherche est un champ
 * optionnel, avec son effacement.
 *
 * ```jsx
 * <GsFilterBar
 *   filters={[{ id: 'all', label: 'Tous', count: 17 }, { id: 'duty', label: 'De service', count: 8 }]}
 *   value={filter}
 *   onChange={setFilter}
 *   search={{ value: q, onChange: setQ, placeholder: 'Nom ou matricule' }}
 *   end={<button className="gs-btn is-quiet">Exporter</button>}
 * />
 * ```
 */

import { Search, X } from 'lucide-react';
import './gs-kit.css';

export default function GsFilterBar({
  filters = [],
  value,
  onChange,
  mode = 'single',
  search,
  end,
  inset = false,
  label = 'Filtres',
  className = '',
  children,
}) {
  const shown = filters.filter(Boolean).filter((f) => f.hidden !== true);
  const isOn = (id) => (mode === 'multi' ? (value || []).includes(id) : value === id);

  return (
    <div
      className={`gsk-filters${inset ? ' is-inset' : ''}${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={label}
    >
      {shown.length > 0 ? (
        <div className="gsk-filter-set">
          {shown.map((f) => (
            <button
              key={f.id}
              type="button"
              className="gsk-filter"
              aria-pressed={isOn(f.id)}
              data-tone={f.tone || undefined}
              title={f.title || undefined}
              onClick={() => onChange?.(f.id)}
            >
              {f.label}
              {/* Le zéro compte ici : « Découvertes 0 » est une bonne nouvelle
                  qu'il faut pouvoir lire sans presser le filtre. */}
              {f.count !== undefined && f.count !== null ? <b className="gs-num">{f.count}</b> : null}
            </button>
          ))}
        </div>
      ) : null}

      {search ? (
        <label className="gsk-search">
          <Search size={14} strokeWidth={2} aria-hidden="true" />
          <input
            type="search"
            value={search.value || ''}
            placeholder={search.placeholder || 'Rechercher'}
            aria-label={search.label || search.placeholder || 'Rechercher'}
            onChange={(e) => search.onChange?.(e.target.value)}
          />
          {search.value ? (
            <button type="button" onClick={() => search.onChange?.('')} aria-label="Effacer la recherche">
              <X size={13} strokeWidth={2.2} />
            </button>
          ) : null}
        </label>
      ) : null}

      {children || null}

      {end ? <div className="gsk-filters-end">{end}</div> : null}
    </div>
  );
}
