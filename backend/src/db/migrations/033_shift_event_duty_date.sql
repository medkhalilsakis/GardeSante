-- 033 — Distinguer le jour de garde du moment réel de déclaration.
-- Nécessaire pour le rattrapage d'un appel oublié depuis l'historique.

ALTER TABLE shift_events
  ADD COLUMN IF NOT EXISTS duty_date DATE;

UPDATE shift_events
SET duty_date = (event_time AT TIME ZONE 'Africa/Tunis')::date
WHERE duty_date IS NULL;

ALTER TABLE shift_events
  ALTER COLUMN duty_date SET DEFAULT ((CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tunis')::date);

-- Les anciennes versions pouvaient créer plusieurs pointages pour la même
-- garde. On conserve toutes les traces, mais on marque les suivantes comme
-- anciens doublons avant d'activer l'unicité métier pour les nouvelles saisies.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY schedule_id, user_id, duty_date
           ORDER BY created_at, id
         ) AS row_num
  FROM shift_events
  WHERE schedule_id IS NOT NULL
    AND user_id IS NOT NULL
    AND event_type IN ('presence', 'absence', 'late')
    AND NOT COALESCE(metadata @> '{"legacyDuplicateCall": true}'::jsonb, FALSE)
)
UPDATE shift_events e
SET title = CONCAT('[Ancien doublon de pointage] ', e.title),
    metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object('legacyDuplicateCall', TRUE)
FROM ranked r
WHERE e.id = r.id AND r.row_num > 1;

CREATE INDEX IF NOT EXISTS idx_shift_events_call_lookup
  ON shift_events (schedule_id, user_id, duty_date)
  WHERE event_type IN ('presence', 'absence', 'late');

CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_events_single_call
  ON shift_events (schedule_id, user_id, duty_date)
  WHERE schedule_id IS NOT NULL
    AND user_id IS NOT NULL
    AND event_type IN ('presence', 'absence', 'late')
    AND NOT COALESCE(metadata @> '{"legacyDuplicateCall": true}'::jsonb, FALSE);
