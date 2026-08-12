-- Migration 024: Briefs réutilisables de l'Assistant Intelligent V2 (Lot 7)
--
-- « brief réutilisable » : un chef de service prépare une fois la composition de
-- son équipe, ses contraintes et son mode de génération, puis le rejoue le mois
-- suivant sans tout ressaisir. Le brief ne contient QUE des paramètres d'entrée :
-- aucune garde, aucune affectation. Régénérer depuis un brief relit toujours les
-- congés du moment, jamais ceux figés à l'enregistrement.
--
-- Additif : aucune table existante n'est modifiée.

CREATE TABLE IF NOT EXISTS assistant_briefs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  mode VARCHAR(30) NOT NULL DEFAULT 'balanced',
  -- { members: [{userId, periodStart, periodEnd, maxShifts, excludedDays, position}],
  --   requirements: {...}, periodType, scheduleType }
  brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_brief_mode CHECK (mode IN ('manual', 'rotation', 'ab_rotation', 'periods', 'balanced')),
  CONSTRAINT uq_brief_name UNIQUE (department_id, name)
);

-- Les cinq modes doivent rester alignés sur `MODES` (assistant-generator.js) :
-- sans ce couple drop/add, une base créée avant l'ajout de `ab_rotation` garderait
-- l'ancienne liste — `CREATE TABLE IF NOT EXISTS` ne retouche pas une table
-- existante. Le drop préalable rend l'ensemble rejouable.
ALTER TABLE assistant_briefs DROP CONSTRAINT IF EXISTS chk_brief_mode;
ALTER TABLE assistant_briefs ADD CONSTRAINT chk_brief_mode
  CHECK (mode IN ('manual', 'rotation', 'ab_rotation', 'periods', 'balanced'));

CREATE INDEX IF NOT EXISTS idx_assistant_briefs_dept
  ON assistant_briefs(department_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_briefs_author
  ON assistant_briefs(created_by);
