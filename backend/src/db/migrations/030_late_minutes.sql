-- ============================================================================
-- 030 — Durée du retard déclaré à l'appel du jour
-- ============================================================================
-- L'appel du jour sait déclarer « Retard », mais nulle part la DURÉE de ce
-- retard n'était conservée : `absences` n'a aucune colonne de durée, et les
-- `shift_events` créés par `reportShiftAbsence` partaient avec `metadata` NULL.
-- L'historique pouvait donc dire « X est arrivé en retard », jamais « de 25
-- minutes ».
--
-- Une seule colonne, facultative, sur la table qui porte déjà le signalement.
-- Elle ne concerne que les types de retard : elle reste NULL pour une absence,
-- pour un congé et pour toutes les lignes existantes.
--
-- Rejouable : ADD COLUMN IF NOT EXISTS ne fait rien au second passage, et la
-- contrainte est créée sous condition d'absence (ADD CONSTRAINT n'a pas de
-- IF NOT EXISTS en PostgreSQL 16).
-- ============================================================================

ALTER TABLE absences
  ADD COLUMN IF NOT EXISTS late_minutes INTEGER;

COMMENT ON COLUMN absences.late_minutes IS
  'Durée du retard en minutes, renseignée uniquement pour les signalements de type retard (appel du jour). NULL sinon.';

-- Garde-fou : une durée négative n'a aucun sens, et une journée de retard non
-- plus (au-delà, c'est une absence). Bornes larges à dessein.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'absences_late_minutes_range'
      AND conrelid = 'absences'::regclass
  ) THEN
    ALTER TABLE absences
      ADD CONSTRAINT absences_late_minutes_range
      CHECK (late_minutes IS NULL OR (late_minutes >= 0 AND late_minutes <= 1440));
  END IF;
END $$;
