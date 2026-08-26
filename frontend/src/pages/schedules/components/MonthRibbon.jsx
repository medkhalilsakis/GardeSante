/**
 * RubanDuMois — la bande des jours du planning
 * ════════════════════════════════════════════
 *
 * Fichier neuf. Classes préfixées `.gs-ribbon-`. Aucune écriture, aucune
 * mutation : le ruban ne fait que lire les lignes du tableur avec la règle de
 * lecture partagée que lui passe l'appelant, et signaler ce qu'il voit.
 *
 * Pourquoi il existe : le tableur n'affiche plus de grille jour par jour, et
 * la question qu'un chef de service se pose devant son tableau de garde n'a
 * plus de réponse à l'écran — « est-ce que chaque journée est couverte, et par
 * assez de monde ? ». Le ruban la rend, sans rien inventer : une colonne par
 * jour du planning, la hauteur du trait = le nombre d'agents de service, et
 * l'ambre sur les journées qui passent sous l'effectif minimum du service.
 *
 * Réutilisable tel quel : il ne connaît ni le tableur ni l'API, seulement
 * `days`, `rows` et la fonction `isOnDuty(row, dateKey)`. Les dates s'écrivent
 * avec `utils/frenchDates`.
 */
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { fullFrenchDate, FRENCH_MONTHS } from '@/utils/frenchDates';
import './MonthRibbon.css';

const WEEKDAY_INITIAL = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export default function MonthRibbon({
  days = [],
  rows = [],
  isOnDuty,
  dateKey,
  holidays = [],
  minStaff = 0,
  todayKey = '',
  isSpecial = false,
  onOpenRow,
}) {
  const [active, setActive] = useState(null);   // jour ouvert au clic
  const [focusIdx, setFocusIdx] = useState(0);  // tabindex glissant
  const stripRef = useRef(null);

  const holidayByDay = useMemo(() => {
    const map = new Map();
    holidays.forEach(h => {
      const start = dateKey(h.start_date);
      const end = dateKey(h.end_date) || start;
      if (!start) return;
      days.forEach(d => {
        const key = dateKey(d);
        if (key >= start && key <= end) map.set(key, h.name || h.name_fr || 'Jour férié');
      });
    });
    return map;
  }, [holidays, days, dateKey]);

  const cols = useMemo(() => {
    const staffed = rows.filter(r => r.userId);
    let prevMonth = null;
    return days.map(day => {
      const key = dateKey(day);
      const onDuty = staffed.filter(r => isOnDuty(r, key));
      const month = day.getMonth();
      // Un planning trimestriel enchaîne « … 29 30 1 2 … » : on repère le
      // changement de mois par comparaison avec la colonne précédente, ce qui
      // marche aussi quand les jours ne sont pas contigus (planning spécial).
      const monthStart = prevMonth === null || month !== prevMonth;
      prevMonth = month;
      return {
        key,
        day,
        count: onDuty.length,
        people: onDuty,
        monthStart,
        monthLabel: FRENCH_MONTHS[month],
        weekend: day.getDay() === 0 || day.getDay() === 6,
        holiday: holidayByDay.get(key) || null,
      };
    });
  }, [days, rows, isOnDuty, dateKey, holidayByDay]);

  /** Le cartouche de mois ne sert à rien quand tout tient dans un seul mois :
   *  l'en-tête du planning le dit déjà. */
  const multiMonth = useMemo(() => cols.some((c, i) => i > 0 && c.monthStart), [cols]);

  const summary = useMemo(() => {
    const covered = cols.filter(c => c.count > 0).length;
    const thin = minStaff > 0 ? cols.filter(c => c.count > 0 && c.count < minStaff).length : 0;
    const peak = cols.reduce((max, c) => Math.max(max, c.count), 0);
    return { covered, uncovered: cols.length - covered, thin, peak };
  }, [cols, minStaff]);

  const move = useCallback((from, delta) => {
    const next = Math.min(cols.length - 1, Math.max(0, from + delta));
    setFocusIdx(next);
    stripRef.current?.querySelectorAll('.gs-ribbon-day')[next]?.focus();
  }, [cols.length]);

  if (!cols.length) return null;

  const scale = Math.max(summary.peak, minStaff, 1);
  const activeCol = active ? cols.find(c => c.key === active) : null;

  return (
    <section className="gs-ribbon" aria-label="Couverture jour par jour du planning">
      <header className="gs-ribbon-head">
        <span className="gs-eyebrow">
          {isSpecial ? 'Week-ends et jours fériés retenus' : 'Le mois, jour par jour'}
        </span>
        <div className="gs-ribbon-read">
          <span className={`gs-ribbon-verdict ${summary.uncovered ? 'is-alert' : 'is-good'}`}>
            <strong className="gs-num">{summary.covered}</strong>
            <span> / {cols.length} {cols.length > 1 ? 'journées couvertes' : 'journée couverte'}</span>
          </span>
          {summary.uncovered > 0 && (
            <span className="gs-ribbon-flag is-alert">
              {summary.uncovered} sans personne de garde
            </span>
          )}
          {summary.thin > 0 && (
            <span className="gs-ribbon-flag is-thin">
              {summary.thin} sous l’effectif minimum ({minStaff})
            </span>
          )}
          {!summary.uncovered && !summary.thin && (
            <span className="gs-ribbon-flag is-good">Aucune journée à découvert</span>
          )}
        </div>
      </header>

      <div className={`gs-ribbon-strip ${multiMonth ? 'has-months' : ''}`} ref={stripRef} role="group" aria-label="Journées du planning">
        {cols.map((c, i) => {
          const ratio = c.count / scale;
          const state = c.count === 0 ? 'is-empty'
            : (minStaff > 0 && c.count < minStaff) ? 'is-thin' : 'is-ok';
          const label = `${fullFrenchDate(c.key)}${c.holiday ? ` — ${c.holiday}` : ''} : ${
            c.count === 0 ? 'personne de garde' : `${c.count} ${c.count > 1 ? 'personnes' : 'personne'} de garde`}`;
          return (
            <button
              key={c.key}
              type="button"
              className={`gs-ribbon-day ${state} ${c.weekend ? 'is-weekend' : ''} ${c.holiday ? 'is-holiday' : ''} ${multiMonth && c.monthStart ? 'is-month-start' : ''} ${c.key === todayKey ? 'is-today' : ''} ${c.key === active ? 'is-active' : ''}`}
              style={{
                '--gs-ribbon-fill': `${Math.max(ratio * 100, c.count ? 12 : 0)}%`,
                '--gs-ribbon-delay': `${Math.min(i * 8, 260)}ms`,
                ...(multiMonth && c.monthStart ? { '--gs-ribbon-month': `"${c.monthLabel}"` } : null),
              }}
              tabIndex={i === focusIdx ? 0 : -1}
              aria-pressed={c.key === active}
              aria-label={label}
              title={label}
              onFocus={() => setFocusIdx(i)}
              onKeyDown={e => {
                if (e.key === 'ArrowRight') { e.preventDefault(); move(i, 1); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i, -1); }
                else if (e.key === 'Home') { e.preventDefault(); move(i, -cols.length); }
                else if (e.key === 'End') { e.preventDefault(); move(i, cols.length); }
              }}
              onClick={() => setActive(prev => prev === c.key ? null : c.key)}
            >
              <span className="gs-ribbon-daynum gs-num">{c.day.getDate()}</span>
              <span className="gs-ribbon-gauge" aria-hidden="true"><i /></span>
              <span className="gs-ribbon-dow">{WEEKDAY_INITIAL[c.day.getDay()]}</span>
              <span className="gs-ribbon-count gs-num" aria-hidden="true">{c.count || '—'}</span>
            </button>
          );
        })}
      </div>

      {activeCol && (
        <div className="gs-ribbon-detail" role="status">
          <div className="gs-ribbon-detail-head">
            <span className="gs-ribbon-detail-date">{fullFrenchDate(activeCol.key)}</span>
            {activeCol.holiday && <span className="gs-ribbon-tag is-holiday">{activeCol.holiday}</span>}
            {activeCol.weekend && <span className="gs-ribbon-tag">Week-end</span>}
            <span className={`gs-ribbon-tag ${activeCol.count === 0 ? 'is-alert' : minStaff > 0 && activeCol.count < minStaff ? 'is-thin' : 'is-duty'}`}>
              {activeCol.count === 0 ? 'Personne de garde'
                : `${activeCol.count} de garde${minStaff > 0 && activeCol.count < minStaff ? ` · minimum ${minStaff}` : ''}`}
            </span>
            <button type="button" className="gs-ribbon-close" onClick={() => setActive(null)} aria-label="Fermer le détail du jour">✕</button>
          </div>
          {activeCol.count === 0 ? (
            <p className="gs-ribbon-empty">
              {isSpecial
                ? 'Aucun agent n’a retenu cette date. Ouvrez la colonne « Jours / périodes autorisés » d’une ligne pour l’y ajouter.'
                : 'Aucune période d’affectation ne couvre cette journée. Ouvrez les périodes d’une ligne pour l’étendre jusqu’ici.'}
            </p>
          ) : (
            <ul className="gs-ribbon-people">
              {activeCol.people.map(p => (
                <li key={p.id}>
                  <button type="button" className="gs-ribbon-person" onClick={() => onOpenRow?.(p.id)}>
                    <span className="gs-ribbon-person-name">{`${p.lastName} ${p.firstName}`.trim() || 'Sans nom'}</span>
                    {p.roleName && <span className="gs-ribbon-person-role">{p.roleName}</span>}
                    <span className="gs-ribbon-person-hours gs-num">{p.shiftStart}–{p.shiftEnd}</span>
                    {p.atHome && <span className="gs-ribbon-person-home" title="Garde à domicile (astreinte)">domicile</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="gs-ribbon-legend">
        <span><i className="gs-ribbon-key is-ok" />de service</span>
        {minStaff > 0 && <span><i className="gs-ribbon-key is-thin" />sous l’effectif minimum</span>}
        <span><i className="gs-ribbon-key is-empty" />personne</span>
        <span className="gs-ribbon-legend-hint">Cliquez un jour pour voir qui est de garde.</span>
      </footer>
    </section>
  );
}
