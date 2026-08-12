-- ============================================================================
-- 029 — Rattrapage du décalage d'un jour des périodes déjà enregistrées
-- ============================================================================
-- `getScheduleDetail` renvoyait les colonnes DATE du planning sans TO_CHAR.
-- node-pg les convertissait en Date JS à minuit LOCAL, et JSON.stringify les
-- sérialisait en « 2026-08-09T23:00:00.000Z » pour un planning commençant le
-- 2026-08-10 (fuseau Africa/Lagos, +01). Le tableur, qui ne compare que des clés
-- « YYYY-MM-DD » obtenues en tronquant la chaîne, reculait donc d'un jour :
-- les périodes par défaut de chaque ligne ont été enregistrées à J-1.
--
-- Le correctif applicatif (TO_CHAR dans getScheduleDetail) empêche tout nouveau
-- décalage, mais les lignes déjà enregistrées gardent leurs dates fausses —
-- elles tombent alors hors des bornes du planning et déclenchent « Période
-- invalide » dans le tableur, tout en laissant le dernier jour sans personne.
--
-- Cette migration ne corrige QUE les valeurs qui portent la signature exacte du
-- défaut : période = date du planning MOINS un jour. Une date saisie à la main
-- par un chef n'est jamais touchée. Rejouable : au second passage, plus aucune
-- ligne ne correspond, donc 0 mise à jour.
-- ============================================================================

-- ── 1. Périodes du tableur (schedules.metadata.spreadsheet.rows[]) ───────────
-- Deux UPDATE distincts plutôt qu'un CASE imbriqué : chacun reste lisible et
-- idempotent. La clause EXISTS garantit que le tableau n'est jamais vide, ce qui
-- exclut le piège du jsonb_agg sur zéro ligne (qui renverrait NULL).

UPDATE schedules s
SET metadata = jsonb_set(
      s.metadata,
      '{spreadsheet,rows}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN t.el ? 'periodStart'
                    AND t.el ->> 'periodStart' = TO_CHAR(s.start_date - INTERVAL '1 day', 'YYYY-MM-DD')
                   THEN jsonb_set(t.el, '{periodStart}', to_jsonb(TO_CHAR(s.start_date, 'YYYY-MM-DD')))
                   ELSE t.el
                 END
                 ORDER BY t.ord
               )
        FROM jsonb_array_elements(s.metadata -> 'spreadsheet' -> 'rows')
             WITH ORDINALITY AS t(el, ord)
      )
    )
WHERE s.start_date IS NOT NULL
  AND jsonb_typeof(s.metadata -> 'spreadsheet' -> 'rows') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(s.metadata -> 'spreadsheet' -> 'rows') AS t(el)
    WHERE t.el ? 'periodStart'
      AND t.el ->> 'periodStart' = TO_CHAR(s.start_date - INTERVAL '1 day', 'YYYY-MM-DD')
  );

UPDATE schedules s
SET metadata = jsonb_set(
      s.metadata,
      '{spreadsheet,rows}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN t.el ? 'periodEnd'
                    AND t.el ->> 'periodEnd' = TO_CHAR(s.end_date - INTERVAL '1 day', 'YYYY-MM-DD')
                   THEN jsonb_set(t.el, '{periodEnd}', to_jsonb(TO_CHAR(s.end_date, 'YYYY-MM-DD')))
                   ELSE t.el
                 END
                 ORDER BY t.ord
               )
        FROM jsonb_array_elements(s.metadata -> 'spreadsheet' -> 'rows')
             WITH ORDINALITY AS t(el, ord)
      )
    )
WHERE s.end_date IS NOT NULL
  AND jsonb_typeof(s.metadata -> 'spreadsheet' -> 'rows') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(s.metadata -> 'spreadsheet' -> 'rows') AS t(el)
    WHERE t.el ? 'periodEnd'
      AND t.el ->> 'periodEnd' = TO_CHAR(s.end_date - INTERVAL '1 day', 'YYYY-MM-DD')
  );

-- ── 2. Mêmes périodes recopiées dans schedule_staff_assignments ──────────────
-- `saveDraft` y insère `row.periodStart` / `row.periodEnd` tels quels
-- (schedule-builder.controller.js) : ces colonnes DATE portent le même décalage.

UPDATE schedule_staff_assignments a
SET period_start = s.start_date
FROM schedules s
WHERE a.schedule_id = s.id
  AND a.period_start IS NOT NULL
  AND s.start_date IS NOT NULL
  AND a.period_start = s.start_date - INTERVAL '1 day';

UPDATE schedule_staff_assignments a
SET period_end = s.end_date
FROM schedules s
WHERE a.schedule_id = s.id
  AND a.period_end IS NOT NULL
  AND s.end_date IS NOT NULL
  AND a.period_end = s.end_date - INTERVAL '1 day';
