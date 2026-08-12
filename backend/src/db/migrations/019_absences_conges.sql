-- Migration 019: Absences + Congés
-- Corrige le bug start_time/end_time, ajoute le discriminateur kind, seed les types

-- 1) Corriger le bug absences.start_time / end_time (colonnes manquantes)
ALTER TABLE absences ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE absences ADD COLUMN IF NOT EXISTS end_time TIME;

-- 2) Discriminateur + champs supplémentaires
ALTER TABLE absences ADD COLUMN IF NOT EXISTS kind VARCHAR(20) DEFAULT 'shift_absence';
ALTER TABLE absences ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES schedules(id) ON DELETE CASCADE;
ALTER TABLE absences ADD COLUMN IF NOT EXISTS reported_by_role VARCHAR(40);
ALTER TABLE absences ADD COLUMN IF NOT EXISTS is_justified BOOLEAN DEFAULT FALSE;
ALTER TABLE absences ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;

-- 3) Drapeau is_leave sur les types
ALTER TABLE absence_types ADD COLUMN IF NOT EXISTS is_leave BOOLEAN DEFAULT FALSE;

-- 4) Index de recherche
CREATE INDEX IF NOT EXISTS idx_absences_user_kind_dates ON absences(user_id, kind, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_absences_schedule ON absences(schedule_id) WHERE schedule_id IS NOT NULL;

-- 5) Fonction planning_state (dérivée, pas stockée)
CREATE OR REPLACE FUNCTION planning_state(
  p_status VARCHAR(30),
  p_start_date DATE,
  p_end_date DATE
) RETURNS VARCHAR(20) AS $$
BEGIN
  IF p_status = 'draft' THEN
    RETURN 'brouillon';
  END IF;

  IF CURRENT_DATE < p_start_date THEN
    RETURN 'soumis';
  END IF;

  IF CURRENT_DATE BETWEEN p_start_date AND p_end_date THEN
    RETURN 'en_cours';
  END IF;

  RETURN 'termine';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 6) Seed des absence_types (idempotent)
-- On insère un jeu de base par établissement existant
DO $$
DECLARE
  est RECORD;
BEGIN
  FOR est IN SELECT id FROM establishments LOOP
    -- Congés (is_leave = true)
    INSERT INTO absence_types (establishment_id, code, name, name_ar, requires_justification, is_paid, is_leave, color, is_active)
    VALUES
      (est.id, 'conge_annuel', 'Congé annuel', 'إجازة سنوية', FALSE, TRUE, TRUE, '#10B981', TRUE),
      (est.id, 'conge_maladie', 'Congé maladie', 'إجازة مرضية', TRUE, TRUE, TRUE, '#F59E0B', TRUE),
      (est.id, 'conge_maternite', 'Congé maternité', 'إجازة أمومة', TRUE, TRUE, TRUE, '#EC4899', TRUE),
      (est.id, 'conge_exceptionnel', 'Congé exceptionnel', 'إجازة استثنائية', TRUE, FALSE, TRUE, '#8B5CF6', TRUE),
      (est.id, 'conge_formation', 'Congé formation', 'إجازة تكوين', FALSE, TRUE, TRUE, '#3B82F6', TRUE)
    ON CONFLICT (establishment_id, code) DO NOTHING;

    -- Absences en garde courante (is_leave = false)
    INSERT INTO absence_types (establishment_id, code, name, name_ar, requires_justification, is_paid, is_leave, color, is_active)
    VALUES
      (est.id, 'absence_injustifiee', 'Absence injustifiée', 'غياب غير مبرر', FALSE, FALSE, FALSE, '#EF4444', TRUE),
      (est.id, 'retard', 'Retard', 'تأخر', FALSE, FALSE, FALSE, '#F97316', TRUE)
    ON CONFLICT (establishment_id, code) DO NOTHING;
  END LOOP;
END $$;
