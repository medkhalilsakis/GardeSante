-- ============================================================
-- Migration 018 — Remplacements « overlay » sur garde courante
--
-- PRINCIPE : un remplacement ne modifie JAMAIS le tableur validé.
-- Les gardes (table `shifts`) restent figées ; les remplacements
-- forment une couche de superposition appliquée à la lecture.
--
-- 100 % additive : aucun DROP, aucun changement de type,
-- aucune modification des données existantes.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. EXTENSION DE `replacements` — l'ordre de remplacement
-- ──────────────────────────────────────────────────────────────
ALTER TABLE replacements
  ADD COLUMN IF NOT EXISTS schedule_id         UUID REFERENCES schedules(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS department_id       UUID REFERENCES departments(id),
  ADD COLUMN IF NOT EXISTS scope               VARCHAR(20),
  ADD COLUMN IF NOT EXISTS start_date          DATE,
  ADD COLUMN IF NOT EXISTS end_date            DATE,
  ADD COLUMN IF NOT EXISTS start_time          TIME,
  ADD COLUMN IF NOT EXISTS end_time            TIME,
  ADD COLUMN IF NOT EXISTS confirmation_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS created_by_role     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS confirmed_by        UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason    TEXT,
  ADD COLUMN IF NOT EXISTS reason              TEXT;

COMMENT ON COLUMN replacements.schedule_id         IS 'Planning (garde courante) concerné — NULL pour l''ancien flux basé absence';
COMMENT ON COLUMN replacements.scope               IS 'full_period | date_range | single_day | time_slot';
COMMENT ON COLUMN replacements.confirmation_status IS 'confirmed (créé par le chef) | pending_chef (créé par un surveillant)';
COMMENT ON COLUMN replacements.created_by_role     IS 'Code du rôle de l''auteur au moment de la création';

-- Les remplacements « overlay » ne visent pas une garde unique :
-- shift_id et absent_user_id deviennent facultatifs.
-- (Assouplissement de contrainte : ne peut invalider aucune donnée existante.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'replacements' AND column_name = 'shift_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE replacements ALTER COLUMN shift_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'replacements' AND column_name = 'absent_user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE replacements ALTER COLUMN absent_user_id DROP NOT NULL;
  END IF;
END$$;

-- Valeurs par défaut rétro-compatibles pour les lignes déjà présentes
UPDATE replacements
SET confirmation_status = 'confirmed'
WHERE confirmation_status IS NULL;

UPDATE replacements
SET scope = 'full_period'
WHERE scope IS NULL AND schedule_id IS NOT NULL;

ALTER TABLE replacements ALTER COLUMN confirmation_status SET DEFAULT 'confirmed';

-- Contraintes de cohérence (ajoutées seulement si absentes)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_replacement_scope') THEN
    ALTER TABLE replacements ADD CONSTRAINT chk_replacement_scope
      CHECK (scope IS NULL OR scope IN ('full_period','date_range','single_day','time_slot'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_replacement_confirmation') THEN
    ALTER TABLE replacements ADD CONSTRAINT chk_replacement_confirmation
      CHECK (confirmation_status IS NULL OR confirmation_status IN ('confirmed','pending_chef'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_replacement_period') THEN
    ALTER TABLE replacements ADD CONSTRAINT chk_replacement_period
      CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_replacements_schedule
  ON replacements(schedule_id, confirmation_status, start_date);
CREATE INDEX IF NOT EXISTS idx_replacements_department
  ON replacements(department_id, confirmation_status);

-- ──────────────────────────────────────────────────────────────
-- B. `replacement_items` — un ou plusieurs personnels par ordre
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replacement_items (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  replacement_id      UUID        NOT NULL REFERENCES replacements(id) ON DELETE CASCADE,
  absent_user_id      UUID        NOT NULL REFERENCES users(id),
  replacement_user_id UUID        NOT NULL REFERENCES users(id),
  from_department_id  UUID        REFERENCES departments(id),
  is_cross_department BOOLEAN     DEFAULT FALSE,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_replacement_item_distinct CHECK (absent_user_id <> replacement_user_id),
  UNIQUE(replacement_id, absent_user_id)
);

COMMENT ON TABLE replacement_items IS 'Binômes remplacé → remplaçant d''un ordre de remplacement';
COMMENT ON COLUMN replacement_items.is_cross_department IS 'TRUE si le remplaçant vient d''un autre service du même hôpital';

CREATE INDEX IF NOT EXISTS idx_replacement_items_repl    ON replacement_items(replacement_id);
CREATE INDEX IF NOT EXISTS idx_replacement_items_absent  ON replacement_items(absent_user_id);
CREATE INDEX IF NOT EXISTS idx_replacement_items_replacer ON replacement_items(replacement_user_id);
