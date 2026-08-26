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
 *
 * ── Harmonisation couleurs et typographie ──
 * La grille, les colonnes et les lignes ne changent pas ; seules les couleurs
 * et les fontes bougent.
 *
 * Les bandes étaient dégradées : la teinte de chaque case dépendait de sa
 * position dans la bande de l'agent. Le dégradé n'ajoutait rien — la position
 * du jour est déjà donnée par la colonne — et il coûtait la seule chose que
 * cette grille doit dire : le premier jour d'une garde était plus pâle que le
 * dernier jour hors période, si bien qu'« en garde » et « hors période » se
 * confondaient aux extrémités. Les bandes sont désormais d'un seul ton.
 *
 * Chaque fond est un mélange d'un jeton de teinte et du papier. C'est le papier
 * qui s'inverse avec le thème, donc une seule définition suffit pour le clair et
 * le sombre — là où les huit teintes codées en dur restaient claires sur fond
 * sombre.
 *
 * Le cyan du remplaçant a disparu : un jour couvert par un remplaçant est un
 * jour de service, il porte donc le ton du service comme n'importe quel autre.
 * Ce qui distingue vraiment ces lignes — l'attente de confirmation du chef —
 * prend le ton d'alerte, puisque c'est là qu'une action est due.
 *
 * Corrigé au passage : la légende annonçait le remplacement avec un pictogramme
 * que la grille n'utilisait pas.
 *
 * ── Les jours de garde s'affichent ──
 * Une journée de service ne portait aucune marque : seul le fond, très pâle, la
 * distinguait d'un jour hors période. La grille paraissait vide alors qu'elle
 * était pleine. Chaque journée porte désormais le même signe que le tableur
 * éditable (`SmartSpreadsheet`) — de service ● / pas de service · — pour que le
 * même tableau se lise pareil selon qu'on le remplit ou qu'on le consulte, et
 * les fonds sont assez marqués pour tenir la lecture sur trente colonnes.
 *
 * Les remplacements ne dépendent plus de l'écran appelant : la modale les
 * charge elle-même. Quatre des cinq écrans qui l'ouvrent ne les passaient pas,
 * donc les lignes de remplacement y étaient invisibles. Une liste reçue en
 * propriété reste prioritaire — l'écran « Remplacements » continue d'afficher
 * exactement sa propre sélection.
 */
import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { scheduleBuilderAPI, replacementsAPI } from '../../../api';
import PlanningStateBadge from '../../../components/planning/PlanningStateBadge';

const DOW_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/**
 * Une case du tableur est cochée, ou vide : il n'y a plus de code de garde.
 * Miroir exact de `isMarked` dans `backend/src/modules/schedules/
 * spreadsheet-reader.js`, tolérance « R » comprise — c'était l'ancien code Repos
 * des plannings antérieurs, et il n'a jamais désigné un service.
 */
const isMarked = (value) => {
  if (value === true) return true;
  const text = String(value ?? '').trim();
  if (!text) return false;
  return text.charAt(0).toUpperCase() !== 'R';
};

/**
 * Les fonds de la grille. Chaque bande mélange un jeton de teinte au papier :
 * en clair le papier est blanc et la bande s'éclaircit, en sombre il est
 * profond et la bande s'assombrit, sans qu'on ait à l'écrire deux fois.
 *
 * Les proportions ont été relevées : à 22 % la bande de service se distinguait
 * à peine du papier, et sur trente colonnes de 34 px l'œil ne suivait plus la
 * ligne. Le texte de la case prend une version dense de la même teinte, pour
 * rester lisible sur son propre fond.
 */
const wash = (tone, amount) => `color-mix(in srgb, ${tone} ${amount}%, var(--gs-paper))`;
const dense = (tone) => `color-mix(in srgb, ${tone} 82%, var(--gs-ink))`;

const DUTY_FILL = wash('var(--gs-duty)', 42);   // jour de garde de l'agent
const WAIT_FILL = wash('var(--gs-alert)', 42);  // remplacement non confirmé
const ACT_FILL  = wash('var(--gs-seal)', 34);   // jour repris par un remplaçant
const OFF_FILL  = 'var(--gs-paper-alt)';        // hors de la période de l'agent

/**
 * Les signes de la grille. « De service » et « pas de service » sont repris tels
 * quels du tableur éditable (`SmartSpreadsheet`), pour que le même tableau se
 * lise pareil selon qu'on le remplit ou qu'on le consulte. La reprise garde son
 * propre signe : sur la ligne de l'agent remplacé, un point plein voudrait dire
 * qu'il assure la garde, ce qui est exactement l'inverse.
 */
const DUTY_ON    = '●';
const DUTY_OFF   = '·';
const TAKEN_OVER = '↺';

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

export default function SchedulePreviewModal({ schedule, replacements = null, onClose }) {
  const [mode, setMode] = useState('with'); // 'origin' | 'with'

  const scheduleId = schedule?.id;
  const { data, isLoading, isError } = useQuery({
    queryKey: ['schedule-preview', scheduleId],
    queryFn: () => scheduleBuilderAPI.getDetail(scheduleId).then(r => r.data),
    enabled: !!scheduleId,
  });

  /**
   * Les remplacements du planning affiché. La liste reçue en propriété gagne
   * toujours — l'écran « Remplacements » passe la sélection qu'il montre déjà,
   * et rien ne doit s'y ajouter. Les autres écrans (supervision, direction,
   * boîte de réception du surveillant, panneau Super Admin) n'en avaient
   * aucune : l'aperçu la demande alors lui-même, pour ce seul planning.
   */
  const hasGivenList = Array.isArray(replacements);
  const { data: fetchedReplacements } = useQuery({
    queryKey: ['schedule-preview-replacements', scheduleId],
    queryFn: () => replacementsAPI.getOverlay({ scheduleId }).then(r => r.data.data || []),
    enabled: !!scheduleId && !hasGivenList,
  });
  const overlayList = useMemo(
    // Mémoïsée : sans elle le tableau littéral serait neuf à chaque rendu et
    // relancerait le calcul de toute la grille, colonne par colonne.
    () => (hasGivenList ? replacements : (fetchedReplacements || [])),
    [hasGivenList, replacements, fetchedReplacements]
  );

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
   * bande de service de la ligne, le reste des jours restant neutre.
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
        // Nature et horaires de la garde : le tableur les porte, l'aperçu les
        // taisait. Absent ⇒ garde à l'hôpital, en présence — même défaut que
        // `SmartSpreadsheet`, pour que les plannings antérieurs à la colonne
        // « Garde à domicile » restent lus en présence.
        atHome: (m.atHome ?? m.at_home) === true,
        shiftStart: String(m.shiftStart || m.shift_start || '').slice(0, 5),
        shiftEnd:   String(m.shiftEnd   || m.shift_end   || '').slice(0, 5),
        shifts: { ...(m.shifts || {}) },
      });
    });

    // Surcouche `shifts` : complète le tableur et rattrape les gardes créées
    // hors de lui (une garde saisie ailleurs ne doit pas disparaître de l'aperçu).
    (detail?.shifts || []).forEach(s => {
      if (s.status === 'cancelled') return;
      // Sans jour lisible, une garde ne se place sur aucune colonne : on l'ignore
      // au lieu de la compter. Une clé vide passait pour une case cochée, ce qui
      // faisait basculer la ligne entière en lecture « par cases » et écrasait sa
      // période de participation — l'agent était alors peint hors service tous
      // les jours, alors que le serveur, lui, comptait bien ses gardes.
      const day = dateKey(s.shift_date || s.shiftDate);
      if (!day) return;
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
          atHome: false,
          shiftStart: '',
          shiftEnd: '',
          shifts: {},
        });
      }
      // Une garde héritée de la table `shifts` coche simplement la journée : son
      // type ne se traduit plus par une lettre dans le tableur.
      byUser.get(s.user_id).shifts[day] = true;
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

  /** Planning « week-ends et jours fériés » : seuls les jours cochés comptent. */
  const isSpecialSchedule = sched?.schedule_type === 'special_weekend_holiday'
    || sched?.metadata?.schedule_kind === 'weekend_holiday'
    || sched?.metadata?.special_days_only === true;

  /**
   * Jours de garde par agent — même règle de lecture que le serveur
   * (`spreadsheet-reader.rowOnDuty`), arbitrée **ligne par ligne** :
   *   • planning spécial → les jours cochés, jamais la période ;
   *   • ligne portant au moins un jour coché (assistant, import) → ses jours ;
   *   • ligne sans aucun jour coché → sa période d'affectation, le cas courant.
   */
  const guardDays = useMemo(() => {
    const map = new Map();
    rows.forEach(row => {
      const marks = new Set(
        Object.entries(row.shifts || {})
          .filter(([, value]) => isMarked(value))
          .map(([date]) => date)
      );
      const cellsDecide = isSpecialSchedule || marks.size > 0;
      const set = new Set();
      days.forEach(d => {
        const iso = toISO(d);
        const onGuard = cellsDecide
          ? marks.has(iso)
          : !!(row.periodStart && row.periodEnd && iso >= row.periodStart && iso <= row.periodEnd);
        if (onGuard) set.add(iso);
      });
      map.set(row.userId, { set });
    });
    return map;
  }, [rows, days, isSpecialSchedule]);

  /** Remplacements actifs indexés par (userId, date) — appliqués à la lecture seulement. */
  const overlay = useMemo(() => {
    if (mode === 'origin') return new Map();
    const map = new Map();
    overlayList
      .filter(r => r.schedule_id === scheduleId)
      .forEach(repl => {
        (repl.items || []).forEach(item => {
          const originalGuard = guardDays.get(item.absentUserId);
          days.forEach(d => {
            const iso = toISO(d);
            if (!coversDate(repl, iso) || !originalGuard?.set.has(iso)) return;
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
  }, [overlayList, scheduleId, days, mode, guardDays]);

  // Les lignes virtuelles n'altèrent jamais le tableur enregistré. Elles sont
  // construites à la lecture et placées juste sous le personnel d'origine.
  const replacementRowsByOrigin = useMemo(() => {
    if (mode === 'origin') return new Map();
    const byOrigin = new Map();
    overlayList
      .filter(replacement => replacement.schedule_id === scheduleId)
      .forEach(replacement => {
        (replacement.items || []).forEach(item => {
          const original = rows.find(row => String(row.userId) === String(item.absentUserId));
          const originalGuard = original ? guardDays.get(original.userId) : null;
          if (!original || !originalGuard) return;
          const replacementDates = days
            .map(toISO)
            .filter(iso => originalGuard.set.has(iso) && coversDate(replacement, iso));
          if (!replacementDates.length) return;
          const virtualRow = {
            userId: `replacement:${replacement.id}:${item.absentUserId}:${item.replacementUserId}`,
            name: `${item.replacementLastName || ''} ${item.replacementFirstName || ''}`.trim(),
            role: item.replacementSpeciality || 'Personnel remplaçant',
            periodStart: replacementDates[0],
            periodEnd: replacementDates[replacementDates.length - 1],
            // La nature de la garde du remplaçant n'est pas enregistrée sur le
            // binôme : on ne l'invente pas, la ligne reste en présence.
            atHome: false,
            shiftStart: original.shiftStart,
            shiftEnd: original.shiftEnd,
            replacementRow: true,
            originalName: original.name,
            isPending: replacement.confirmation_status === 'pending_chef',
            detail: scopeLabel(replacement),
            replacementDates: new Set(replacementDates),
          };
          const key = String(original.userId);
          byOrigin.set(key, [...(byOrigin.get(key) || []), virtualRow]);
        });
      });
    return byOrigin;
  }, [mode, overlayList, scheduleId, rows, guardDays, days]);

  const visibleRows = useMemo(() => rows.flatMap(row => [
    row,
    ...(replacementRowsByOrigin.get(String(row.userId)) || []),
  ]), [rows, replacementRowsByOrigin]);

  const replacementCount = overlayList.filter(r => r.schedule_id === scheduleId).length;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--gs-paper)', borderRadius: 14,
          border: '1px solid var(--gs-rule)', boxShadow: 'var(--gs-shadow-lift)',
          width: '100%', maxWidth: 1180, maxHeight: '92vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* En-tête */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--gs-rule)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h3 style={{
                margin: 0, fontFamily: 'var(--gs-display)', fontSize: 16, fontWeight: 800,
                letterSpacing: '-.015em', color: 'var(--gs-ink)', whiteSpace: 'nowrap',
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
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--gs-ink-soft)' }}>
              {sched.dept_name || sched.department_name || ''}
              {sched.start_date && ` · ${parseLocalDate(dateKey(sched.start_date)).toLocaleDateString('fr-FR')} → ${parseLocalDate(dateKey(sched.end_date)).toLocaleDateString('fr-FR')}`}
              {rows.length > 0 && ` · ${rows.length} agent${rows.length > 1 ? 's' : ''}`}
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, flexShrink: 0,
              border: '1px solid var(--gs-rule)', background: 'var(--gs-paper-alt)',
              color: 'var(--gs-ink-soft)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
            }}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {/* Sélecteur origine / avec remplacements */}
        {replacementCount > 0 && (
          <div style={{
            padding: '10px 20px', borderBottom: '1px solid var(--gs-rule)',
            display: 'flex', alignItems: 'center', gap: 8, background: 'var(--gs-paper-alt)',
          }}>
            {[
              { key: 'origin', label: "Tableur d'origine" },
              { key: 'with', label: `Avec remplacements (${replacementCount})` },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setMode(opt.key)}
                style={{
                  padding: '6px 14px', borderRadius: 8, fontSize: 12,
                  fontWeight: mode === opt.key ? 700 : 500, cursor: 'pointer',
                  border: `1px solid ${mode === opt.key ? 'var(--gs-seal)' : 'var(--gs-rule)'}`,
                  background: mode === opt.key ? 'var(--gs-seal)' : 'var(--gs-paper)',
                  color: mode === opt.key ? 'var(--gs-on-tone)' : 'var(--gs-ink-soft)',
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
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--gs-ink-soft)' }}>
              Chargement du tableau…
            </p>
          )}

          {isError && (
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--gs-alert)' }}>
              Impossible de charger ce tableau de garde.
            </p>
          )}

          {!isLoading && !isError && !rows.length && (
            <p style={{ textAlign: 'center', padding: 40, color: 'var(--gs-ink-soft)' }}>
              Aucun personnel affecté sur ce tableau.
            </p>
          )}

          {!isLoading && !isError && !!rows.length && (
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: 'max-content' }}>
              <thead>
                <tr>
                  <th style={{
                    position: 'sticky', left: 0, zIndex: 2, textAlign: 'left',
                    background: 'var(--gs-paper-alt)', border: '1px solid var(--gs-rule)',
                    padding: '8px 12px', minWidth: 190, color: 'var(--gs-ink-soft)',
                    fontFamily: 'var(--gs-display)', fontSize: 10, fontWeight: 800,
                    letterSpacing: '.14em', textTransform: 'uppercase',
                  }}>
                    Personnel
                  </th>
                  {days.map(d => {
                    const weekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <th key={toISO(d)} style={{
                        border: '1px solid var(--gs-rule)', padding: '4px 2px',
                        minWidth: 34, textAlign: 'center',
                        background: weekend
                          ? 'color-mix(in srgb, var(--gs-ink) 7%, var(--gs-paper-alt))'
                          : 'var(--gs-paper-alt)',
                        color: 'var(--gs-ink-faint)', fontWeight: 600,
                      }}>
                        <div style={{ fontSize: 9 }}>{DOW_FR[d.getDay()]}</div>
                        <div style={{
                          fontFamily: 'var(--gs-data)', fontSize: 12, color: 'var(--gs-ink)',
                        }}>
                          {d.getDate()}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(row => (
                  <tr
                    key={row.userId}
                    style={row.replacementRow
                      ? { boxShadow: `inset 4px 0 ${row.isPending ? 'var(--gs-alert)' : 'var(--gs-seal)'}` }
                      : undefined}
                  >
                    <td style={{
                      position: 'sticky', left: 0, zIndex: 1,
                      background: 'var(--gs-paper)', border: '1px solid var(--gs-rule)',
                      padding: '6px 12px', whiteSpace: 'nowrap',
                    }}>
                      <div style={{
                        fontWeight: 600,
                        color: row.replacementRow
                          ? (row.isPending ? 'var(--gs-alert)' : 'var(--gs-seal)')
                          : 'var(--gs-ink)',
                      }}>
                        {row.name}
                        {row.replacementRow && (
                          <span style={{
                            marginLeft: 7, padding: '2px 6px', borderRadius: 999,
                            background: row.isPending ? 'var(--gs-alert-wash)' : 'var(--gs-seal-wash)',
                            color: row.isPending ? 'var(--gs-alert)' : 'var(--gs-seal)',
                            fontFamily: 'var(--gs-display)', fontSize: 8, fontWeight: 800,
                            letterSpacing: '.08em', textTransform: 'uppercase',
                          }}>
                            Remplaçant{row.isPending ? ' · en attente' : ''}
                          </span>
                        )}
                      </div>
                      {row.role && (
                        <div style={{ fontSize: 10, color: 'var(--gs-ink-faint)' }}>{row.role}</div>
                      )}
                      {/* La période de l'agent en clair, sous son nom : c'est elle
                          que matérialise la bande de service de la ligne. Les
                          horaires et la nature de la garde la complètent — le
                          tableur les porte, l'aperçu les passait sous silence.
                          Aucune colonne ajoutée, la grille reste identique. */}
                      {row.periodStart && row.periodEnd && (
                        <div style={{
                          fontFamily: 'var(--gs-data)', fontSize: 10,
                          color: 'var(--gs-duty)', fontWeight: 600, marginTop: 1,
                        }}>
                          {periodLabel(row.periodStart, row.periodEnd)}
                          {row.shiftStart && row.shiftEnd && ` · ${row.shiftStart}→${row.shiftEnd}`}
                        </div>
                      )}
                      {row.atHome && (
                        <div style={{
                          fontSize: 9, color: 'var(--gs-ink-faint)', marginTop: 1,
                          fontFamily: 'var(--gs-display)', fontWeight: 700,
                          letterSpacing: '.08em', textTransform: 'uppercase',
                        }}>
                          Garde à domicile
                        </div>
                      )}
                      {row.replacementRow && (
                        <div style={{ fontSize: 9, color: 'var(--gs-ink-faint)', marginTop: 2 }}>
                          Remplace {row.originalName} · {row.detail}
                        </div>
                      )}
                    </td>

                    {days.map((d, dayIdx) => {
                      const iso = toISO(d);
                      const weekend = d.getDay() === 0 || d.getDay() === 6;
                      const repl = row.replacementRow ? null : overlay.get(`${row.userId}|${iso}`);
                      const band = row.replacementRow
                        ? { set: row.replacementDates }
                        : guardDays.get(row.userId);
                      const onGuard = !!band?.set.has(iso);

                      // Un seul ton par nature de jour : le service, l'attente de
                      // confirmation, la reprise par un remplaçant, ou rien.
                      const pending = repl ? repl.isPending : row.isPending;
                      const tone = pending
                        ? 'var(--gs-alert)'
                        : repl ? 'var(--gs-seal)' : 'var(--gs-duty)';
                      // Le samedi et le dimanche sont creusés d'un cran, comme
                      // l'en-tête : sur un mois entier c'est le seul repère qui
                      // permette de compter les week-ends d'un agent sans
                      // remonter aux dates.
                      const background = repl
                        ? (pending ? WAIT_FILL : ACT_FILL)
                        : onGuard
                          ? (row.replacementRow && pending ? WAIT_FILL : DUTY_FILL)
                          : weekend
                            ? 'color-mix(in srgb, var(--gs-ink) 7%, var(--gs-paper-alt))'
                            : OFF_FILL;
                      // Le signe de la case, et non plus rien : c'est lui qui
                      // dit qu'un jour est couvert. Hors période il reste un
                      // point discret — une case vide ne se distingue pas d'un
                      // affichage en panne. Sur la ligne de l'agent remplacé, le
                      // jour repris porte la flèche : sa garde est passée à un
                      // autre, elle n'est plus la sienne.
                      const covered = onGuard || !!repl;
                      const glyph = repl ? TAKEN_OVER : onGuard ? DUTY_ON : DUTY_OFF;
                      const glyphTone = covered ? dense(tone) : 'var(--gs-ink-faint)';

                      // Extrémités du segment : coins arrondis et bord marqué
                      // seulement là où la nature du jour change. À l'intérieur,
                      // le bord prend la teinte de la case et disparaît.
                      const prevGuard = dayIdx > 0 ? !!band?.set.has(toISO(days[dayIdx - 1])) : null;
                      const nextGuard = dayIdx < days.length - 1 ? !!band?.set.has(toISO(days[dayIdx + 1])) : null;
                      const opens  = prevGuard !== onGuard;
                      const closes = nextGuard !== onGuard;
                      // Le filet qui ferme une bande de service prend la teinte
                      // de la bande : à `--gs-rule` il se confondait avec le
                      // quadrillage et le début d'une garde ne se voyait pas.
                      const segEdge = covered ? tone : 'var(--gs-rule)';

                      const dayLabel = parseLocalDate(iso).toLocaleDateString('fr-FR', {
                        weekday: 'long', day: '2-digit', month: 'long',
                      });
                      // Les horaires et la nature de la garde sont dans le
                      // tableur : les taire dans l'aperçu obligeait à rouvrir le
                      // tableur pour savoir de quelle garde on parle.
                      const hours = row.shiftStart && row.shiftEnd
                        ? ` · ${row.shiftStart} → ${row.shiftEnd}`
                        : '';
                      const place = row.atHome ? ' · garde à domicile' : '';
                      const title = row.replacementRow
                        ? `${row.name} remplace ${row.originalName} — ${row.detail}${row.isPending ? ' — en attente de confirmation' : ''}`
                        : repl
                        ? `Remplacé par ${repl.replacerName}${repl.fromDept ? ` (${repl.fromDept})` : ''} — ${repl.detail}${repl.isPending ? ' — non confirmé par chef service' : ''}`
                        : onGuard
                          ? `De service — ${dayLabel}${hours}${place}`
                          : `Hors de la période d'affectation de cet agent — ${dayLabel}`;

                      return (
                        <td
                          key={iso}
                          title={title}
                          style={{
                            borderTop: '1px solid var(--gs-rule)',
                            borderBottom: '1px solid var(--gs-rule)',
                            borderLeft: `1px solid ${opens || repl ? segEdge : background}`,
                            borderRight: `1px solid ${closes || repl ? segEdge : background}`,
                            borderTopLeftRadius: opens ? 6 : 0,
                            borderBottomLeftRadius: opens ? 6 : 0,
                            borderTopRightRadius: closes ? 6 : 0,
                            borderBottomRightRadius: closes ? 6 : 0,
                            padding: 0, textAlign: 'center', height: 30, minWidth: 34,
                            background,
                            color: glyphTone, fontFamily: 'var(--gs-data)', fontSize: 11,
                            fontWeight: 700, lineHeight: 1, cursor: 'help',
                          }}
                        >
                          {glyph}
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
          padding: '10px 20px', borderTop: '1px solid var(--gs-rule)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 16, flexWrap: 'wrap', background: 'var(--gs-paper-alt)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
            {/* Un ton par nature de jour, et le signe qui l'accompagne dans la
                grille. La légende ne montre que ce que la grille affiche
                réellement dans le mode courant. */}
            {[
              { fill: DUTY_FILL, edge: 'var(--gs-duty)', glyph: DUTY_ON, label: "Jours de garde de l'agent" },
              { fill: OFF_FILL,  edge: 'var(--gs-rule-strong)', glyph: DUTY_OFF, label: "Hors période de l'agent" },
              ...(mode === 'with' && replacementCount > 0 ? [
                { fill: ACT_FILL,  edge: 'var(--gs-seal)',  glyph: TAKEN_OVER, label: 'Jour repris par un remplaçant' },
                { fill: WAIT_FILL, edge: 'var(--gs-alert)', glyph: TAKEN_OVER, label: 'En attente de confirmation' },
              ] : []),
            ].map(item => (
              <span key={item.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{
                  width: 30, height: 16, borderRadius: 5, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  background: item.fill, border: `1px solid ${item.edge}`,
                  color: item.edge, fontFamily: 'var(--gs-data)', fontSize: 9, fontWeight: 700,
                }}>
                  {item.glyph || ''}
                </span>
                <span style={{ color: 'var(--gs-ink-soft)' }}>{item.label}</span>
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--gs-ink-faint)', fontStyle: 'italic' }}>
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
