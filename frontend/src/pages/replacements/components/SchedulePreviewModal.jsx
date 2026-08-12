/**
 * SchedulePreviewModal — aperçu en lecture seule du tableau de garde.
 *
 * Volontairement indépendant de SmartSpreadsheet : aucune cellule éditable,
 * aucune écriture. Reconstruit la grille à partir de /schedule-builder/:id/detail.
 * Le sélecteur origine / avec remplacements matérialise le fait que le tableur
 * validé n'est jamais modifié par un remplacement.
 *
 * SOURCE DES LIGNES — `schedule.metadata.spreadsheet.rows`, exactement comme
 * `SmartSpreadsheet`. La table `shifts` n'est qu'une projection : elle peut être
 * vide alors que le tableur est rempli, auquel cas l'aperçu affichait une grille
 * vide. Elle reste lue en surcouche, pour les gardes créées hors tableur.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scheduleBuilderAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';

const DOW_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/**
 * Code de repos du tableur — seul code qui retire un agent de la garde.
 * Aligné sur `REST_CODE` de `spreadsheet-reader.js` côté serveur.
 */
const REST_CODE = 'R';

/**
 * L'aperçu ne montre plus de lettres (J / N / S / G / R) : chaque ligne est une
 * bande de deux couleurs — vert dégradé sur les jours de garde de l'agent, gris
 * dégradé sur le reste de la période du planning. Les codes journaliers étant
 * facultatifs (et vides dans la quasi-totalité des plannings réels), afficher
 * une lettre par case laissait la grille désespérément blanche.
 */
const GUARD_FROM = '#A7F3D0';   // vert clair — début de la période de garde
const GUARD_TO   = '#059669';   // vert profond — fin de la période de garde
const OFF_FROM   = '#F3F4F6';   // gris très clair
const OFF_TO     = '#C9CDD4';   // gris moyen

/** Interpolation linéaire entre deux couleurs hexadécimales, t ∈ [0, 1]. */
const mix = (from, to, t) => {
  const p = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const parse = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const at = (a, b) => Math.round(a + (b - a) * p);
  return `rgb(${at(r1, r2)}, ${at(g1, g2)}, ${at(b1, b2)})`;
};

const toISO = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/**
 * Normalise une date en 'YYYY-MM-DD' sans jamais passer par `new Date()` quand
 * la valeur est déjà une chaîne ISO — même précaution que `dateKey` du tableur.
 */
const dateKey = (d) => {
  if (!d) return null;
  const s = String(d);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : toISO(dt);
};

/**
 * Toutes les dates du planning, bornes incluses.
 * Ancré à midi comme dans le tableur : une date 'YYYY-MM-DD' lue par
 * `new Date()` est interprétée en UTC et décalerait la grille d'un jour.
 */
const buildDays = (startDate, endDate) => {
  const start = dateKey(startDate);
  const end = dateKey(endDate);
  if (!start || !end) return [];
  const days = [];
  const cur = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  let guard = 0;
  while (cur <= last && guard < 400) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return days;
};

/** Un remplacement couvre-t-il cette date ? */
const coversDate = (repl, iso) => {
  const start = repl.start_date ? dateKey(repl.start_date) : null;
  const end = repl.end_date ? dateKey(repl.end_date) : start;
  if (!start) return true;             // full_period sans bornes explicites
  return iso >= start && iso <= (end || start);
};

/**
 * Les remplacements arrivent avec des dates 'YYYY-MM-DD' (castées en texte par
 * l'API pour être insensibles au fuseau) : `new Date()` les lit en UTC et
 * afficherait la veille dans les fuseaux négatifs. On force le fuseau local.
 */
const parseLocalDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '').slice(0, 10));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
};

/** « 11 août → 24 août » — la période d'affectation d'un agent, en clair. */
const periodLabel = (start, end) => {
  const fmt = (d) => parseLocalDate(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  if (!start || !end) return '';
  return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
};

const scopeLabel = (repl) => {
  const fmt = (d) => parseLocalDate(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  switch (repl.scope) {
    case 'single_day':  return fmt(repl.start_date);
    case 'date_range':  return `${fmt(repl.start_date)} → ${fmt(repl.end_date)}`;
    case 'time_slot':   return `${fmt(repl.start_date)} · ${String(repl.start_time || '').slice(0, 5)}–${String(repl.end_time || '').slice(0, 5)}`;
    default:            return 'Toute la période';
  }
};

export default function SchedulePreviewModal({ schedule, replacements = [], onClose }) {
  const [mode, setMode] = useState('with'); // 'origin' | 'with'

  const scheduleId = schedule?.id;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['schedule-preview', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId).then(r => r.data),
    enabled: !!scheduleId,
  });

  const detail = data?.data;
  // `getDetail` renvoie { schedule, shifts, cycles, staff, externalLoans } : le
  // planning imbriqué porte `metadata`, donc le tableur enregistré.
  const sched = detail?.schedule || schedule || {};

  const days = useMemo(
    () => buildDays(sched.start_date, sched.end_date),
    [sched.start_date, sched.end_date]
  );

  /**
   * Lignes du tableur — même construction que `SmartSpreadsheet` :
   *   1. `metadata.spreadsheet.rows` (source de vérité, ordre du tableur),
   *   2. à défaut le roster `schedule_staff_assignments`,
   *   3. la table `shifts` en surcouche, puis pour les agents absents des deux.
   * La période propre à chaque agent est conservée : c'est elle qui délimite la
   * bande verte de la ligne, le reste des jours restant en gris.
   */
  const rows = useMemo(() => {
    const savedRows = sched?.metadata?.spreadsheet?.rows;
    const staffList = detail?.staff || [];
    const sourceRows = Array.isArray(savedRows) && savedRows.length ? savedRows : staffList;

    const schedStart = dateKey(sched?.start_date);
    const schedEnd   = dateKey(sched?.end_date);

    const byUser = new Map();
    sourceRows.forEach((m, index) => {
      const userId = m.userId || m.user_id || m.id;
      if (!userId) return;
      byUser.set(userId, {
        userId,
        name: `${m.last_name || m.lastName || ''} ${m.first_name || m.firstName || ''}`.trim(),
        role: m.role_name || m.roleName || '',
        position: m.position ?? index,
        periodStart: dateKey(m.periodStart || m.period_start) || schedStart,
        periodEnd:   dateKey(m.periodEnd   || m.period_end)   || schedEnd,
        shifts: { ...(m.shifts || {}) },
      });
    });

    // Surcouche `shifts` : complète le tableur et rattrape les gardes créées
    // hors de lui (une garde saisie ailleurs ne doit pas disparaître de l'aperçu).
    (detail?.shifts || []).forEach(s => {
      if (s.status === 'cancelled') return;
      if (!byUser.has(s.user_id)) {
        byUser.set(s.user_id, {
          userId: s.user_id,
          name: `${s.last_name || ''} ${s.first_name || ''}`.trim(),
          role: s.role_name || '',
          position: 999,
          // Pas de période connue : un agent qui n'existe que dans `shifts` ne
          // doit pas être peint en garde sur tout le planning. Ses bornes sont
          // déduites plus bas de ses propres gardes.
          periodStart: null,
          periodEnd: null,
          fromShiftsOnly: true,
          shifts: {},
        });
      }
      const code = String(s.shift_type_code || s.shift_type_name || '?').charAt(0).toUpperCase();
      byUser.get(s.user_id).shifts[dateKey(s.shift_date)] = code;
    });

    // Bornes déduites pour les lignes issues des seules `shifts`.
    byUser.forEach(row => {
      if (!row.fromShiftsOnly) return;
      const dates = Object.keys(row.shifts).filter(Boolean).sort();
      row.periodStart = dates[0] || schedStart;
      row.periodEnd   = dates[dates.length - 1] || schedEnd;
    });

    return [...byUser.values()].sort(
      (a, b) => (a.position - b.position) || a.name.localeCompare(b.name)
    );
  }, [detail, sched]);

  /**
   * Jours de garde par agent — même règle de lecture que le serveur
   * (`spreadsheet-reader.rosterOnDate`) : le code du jour prime quand il existe
   * (seul « R » retire de la garde), sinon la période d'affectation de la ligne
   * fait foi. C'est ce second cas qui couvre les plannings réels, où les cases
   * sont vides et où seule la période « début → fin » est saisie.
   *
   * On mémorise aussi la première et la dernière case de la bande : le dégradé
   * s'étale entre les deux, ce qui donne une progression continue de gauche à
   * droite plutôt qu'un aplat uniforme.
   */
  const guardDays = useMemo(() => {
    const map = new Map();
    rows.forEach(row => {
      const set = new Set();
      let firstIdx = -1;
      let lastIdx = -1;
      days.forEach((d, idx) => {
        const iso = toISO(d);
        const code = row.shifts[iso];
        const onGuard = code
          ? String(code).toUpperCase() !== REST_CODE
          : !!(row.periodStart && row.periodEnd && iso >= row.periodStart && iso <= row.periodEnd);
        if (!onGuard) return;
        set.add(iso);
        if (firstIdx < 0) firstIdx = idx;
        lastIdx = idx;
      });
      map.set(row.userId, { set, firstIdx, lastIdx });
    });
    return map;
  }, [rows, days]);

  /** Remplacements actifs indexés par (userId, date) — appliqués à la lecture seulement. */
  const overlay = useMemo(() => {
    if (mode === 'origin') return new Map();
    const map = new Map();
    replacements
      .filter(r => r.schedule_id === scheduleId)
      .forEach(repl => {
        (repl.items || []).forEach(item => {
          days.forEach(d => {
            const iso = toISO(d);
            if (!coversDate(repl, iso)) return;
            map.set(`${item.absentUserId}|${iso}`, {
              replacerName: `${item.replacementLastName || ''} ${item.replacementFirstName || ''}`.trim(),
              isPending: repl.confirmation_status === 'pending_chef',
              isCross: item.isCrossDepartment,
              fromDept: item.fromDepartmentName,
              detail: scopeLabel(repl),
            });
          });
        });
      });
    return map;
  }, [replacements, scheduleId, days, mode]);

  const replacementCount = replacements.filter(r => r.schedule_id === scheduleId).length;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', borderRadius: 14,
          border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-xl)',
          width: '100%', maxWidth: 1180, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* En-tête */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>📊</span>
              <h3 style={{
                margin: 0, fontSize: 'var(--font-lg)', fontWeight: 700,
                color: 'var(--text-primary)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {sched.name || 'Tableau de garde'}
              </h3>
              <PlanningStateBadge
                state={schedule?.state || sched.state}
                status={sched.status}
                startDate={dateKey(sched.start_date)}
                endDate={dateKey(sched.end_date)}
                size="sm"
              />
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>
              {sched.dept_name || sched.department_name || ''}
              {sched.start_date && ` · ${parseLocalDate(dateKey(sched.start_date)).toLocaleDateString('fr-FR')} → ${parseLocalDate(dateKey(sched.end_date)).toLocaleDateString('fr-FR')}`}
              {rows.length > 0 && ` · ${rows.length} agent${rows.length > 1 ? 's' : ''}`}
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              border: '1px solid var(--border-default)', background: 'var(--bg-base)',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {/* Sélecteur origine / avec remplacements */}
        {replacementCount > 0 && (
          <div style={{
            padding: '10px 20px', borderBottom: '1px solid var(--border-subtle)',
            display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-base)',
          }}>
            {[
              { key: 'origin', label: "Tableur d'origine" },
              { key: 'with', label: `Avec remplacements (${replacementCount})` },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setMode(opt.key)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 'var(--font-sm)',
                  fontWeight: mode === opt.key ? 700 : 500, cursor: 'pointer',
                  border: `1px solid ${mode === opt.key ? 'var(--color-primary)' : 'var(--border-default)'}`,
                  background: mode === opt.key ? 'var(--color-primary)' : 'var(--bg-card)',
                  color: mode === opt.key ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Grille */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {isLoading && (
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Chargement du tableau…
            </p>
          )}

          {isError && (
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--color-danger)' }}>
              Impossible de charger ce tableau de garde.
            </p>
          )}

          {!isLoading && !isError && !rows.length && (
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              Aucun personnel affecté sur ce tableau.
            </p>
          )}

          {!isLoading && !isError && !!rows.length && (
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: 'max-content' }}>
              <thead>
                <tr>
                  <th style={{
                    position: 'sticky', left: 0, zIndex: 2, textAlign: 'left',
                    background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                    padding: '8px 12px', minWidth: 190, color: 'var(--text-secondary)',
                    fontWeight: 700,
                  }}>
                    Personnel
                  </th>
                  {days.map(d => {
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <th key={toISO(d)} style={{
                        border: '1px solid var(--border-subtle)', padding: '4px 2px',
                        minWidth: 34, textAlign: 'center',
                        background: weekend ? 'var(--bg-hover, #F9FAFB)' : 'var(--bg-base)',
                        color: 'var(--text-muted)', fontWeight: 600,
                      }}>
                        <div style={{ fontSize: 9 }}>{DOW_FR[d.getDay()]}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{d.getDate()}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.userId}>
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 1,
                      background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                      padding: '6px 12px', whiteSpace: 'nowrap',
                    }}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.name}</div>
                      {row.role && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{row.role}</div>
                      )}
                      {/* La période de l'agent en clair, sous son nom : c'est elle
                          que matérialise la bande verte de la ligne. Aucune
                          colonne ajoutée, la grille reste identique. */}
                      {row.periodStart && row.periodEnd && (
                        <div style={{ fontSize: 10, color: '#047857', fontWeight: 600, marginTop: 1 }}>
                          {periodLabel(row.periodStart, row.periodEnd)}
                        </div>
                      )}
                    </td>

                    {days.map((d, dayIdx) => {
                      const iso = toISO(d);
                      const repl = overlay.get(`${row.userId}|${iso}`);
                      const band = guardDays.get(row.userId);
                      const onGuard = !!band?.set.has(iso);

                      // Position du jour dans sa bande : le vert progresse du
                      // premier au dernier jour de garde de l'agent, le gris sur
                      // toute la largeur du planning. D'où la bande continue
                      // décrite dans la demande plutôt qu'un aplat uniforme.
                      const span = onGuard
                        ? Math.max(1, band.lastIdx - band.firstIdx)
                        : Math.max(1, days.length - 1);
                      const ratio = onGuard ? (dayIdx - band.firstIdx) / span : dayIdx / span;
                      const shade = onGuard
                        ? mix(GUARD_FROM, GUARD_TO, ratio)
                        : mix(OFF_FROM, OFF_TO, ratio);

                      // Extrémités du segment : coins arrondis et bord marqué
                      // seulement là où la nature du jour change. À l'intérieur,
                      // le bord prend la teinte de la case et disparaît.
                      const prevGuard = dayIdx > 0 ? !!band?.set.has(toISO(days[dayIdx - 1])) : null;
                      const nextGuard = dayIdx < days.length - 1 ? !!band?.set.has(toISO(days[dayIdx + 1])) : null;
                      const opens  = prevGuard !== onGuard;
                      const closes = nextGuard !== onGuard;

                      const dayLabel = parseLocalDate(iso).toLocaleDateString('fr-FR', {
                        weekday: 'long', day: '2-digit', month: 'long',
                      });
                      const title = repl
                        ? `Remplacé par ${repl.replacerName}${repl.fromDept ? ` (${repl.fromDept})` : ''} — ${repl.detail}${repl.isPending ? ' — non confirmé par chef service' : ''}`
                        : onGuard
                          ? `En garde — ${dayLabel}`
                          : `Hors de la période d'affectation de cet agent — ${dayLabel}`;

                      const background = repl
                        ? (repl.isPending ? '#FEF3C7' : '#FFE4E6')
                        : shade;

                      return (
                        <td
                          key={iso}
                          title={title}
                          style={{
                            borderTop: '1px solid var(--border-subtle)',
                            borderBottom: '1px solid var(--border-subtle)',
                            borderLeft: `1px solid ${opens || repl ? 'var(--border-subtle)' : background}`,
                            borderRight: `1px solid ${closes || repl ? 'var(--border-subtle)' : background}`,
                            borderTopLeftRadius: opens ? 6 : 0,
                            borderBottomLeftRadius: opens ? 6 : 0,
                            borderTopRightRadius: closes ? 6 : 0,
                            borderBottomRightRadius: closes ? 6 : 0,
                            padding: 0, textAlign: 'center', height: 30, minWidth: 34,
                            background,
                            color: '#9F1239', fontSize: 11, lineHeight: 1,
                            cursor: 'help',
                          }}
                        >
                          {repl ? '🔄' : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pied */}
        <div style={{
          padding: '10px 20px', borderTop: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, flexWrap: 'wrap', background: 'var(--bg-base)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
            {/* Deux couleurs, plus aucun code : la bande verte = les jours de
                garde de l'agent, la bande grise = le reste de la période. */}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 44, height: 14, borderRadius: 5, display: 'inline-block',
                background: `linear-gradient(90deg, ${GUARD_FROM}, ${GUARD_TO})`,
                border: '1px solid var(--border-subtle)',
              }} />
              <span style={{ color: 'var(--text-muted)' }}>Jours de garde de l'agent</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{
                width: 44, height: 14, borderRadius: 5, display: 'inline-block',
                background: `linear-gradient(90deg, ${OFF_FROM}, ${OFF_TO})`,
                border: '1px solid var(--border-subtle)',
              }} />
              <span style={{ color: 'var(--text-muted)' }}>Hors période de l'agent</span>
            </span>
            {mode === 'with' && replacementCount > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 3, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: '#FFE4E6', border: '1px solid #FDA4AF', fontSize: 9,
                }}>
                  🔄
                </span>
                <span style={{ color: 'var(--text-muted)' }}>Remplacé (survolez la case)</span>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Aperçu — lecture seule
            </span>
            <button onClick={onClose} className="btn btn-primary" style={{ padding: '6px 18px' }}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
