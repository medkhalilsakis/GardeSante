-- ============================================================
-- Migration 010 — Intelligence & Normalisation Nationale
-- learned_columns, schedule_snapshots
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. APPRENTISSAGE DES COLONNES PERSONNALISÉES
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS learned_columns (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID         NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  raw_label        VARCHAR(300) NOT NULL,     -- label saisi par l'utilisateur
  normalized_label VARCHAR(300),              -- label normalisé
  detected_type    VARCHAR(50),               -- type détecté automatiquement
  mapped_to        UUID         REFERENCES schedule_column_models(id) ON DELETE SET NULL,
  confidence       DECIMAL(4,3) DEFAULT 0.0,  -- confiance de la détection (0.0–1.0)
  times_used       INTEGER      DEFAULT 1,
  was_confirmed    BOOLEAN      DEFAULT FALSE, -- l'utilisateur a confirmé la suggestion
  was_rejected     BOOLEAN      DEFAULT FALSE, -- l'utilisateur a rejeté la suggestion
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE learned_columns IS 'Apprentissage des colonnes personnalisées saisies par chaque établissement';
COMMENT ON COLUMN learned_columns.confidence IS 'Score de confiance de la détection automatique (0=incertain, 1=certain)';

CREATE INDEX IF NOT EXISTS idx_learned_columns_est ON learned_columns (establishment_id, normalized_label);

-- ──────────────────────────────────────────────────────────────
-- B. SNAPSHOTS DE NORMALISATION NATIONALE
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_snapshots (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id  UUID        NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  snapshot     JSONB       NOT NULL,    -- données normalisées modèle national
  -- Structure : { period, establishment, department, kpis, staff_summary }
  version      INTEGER     NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  created_by   UUID        REFERENCES users(id),
  UNIQUE(schedule_id, version)
);

COMMENT ON TABLE schedule_snapshots IS 'Snapshots normalisés pour le tableau de bord national du Super Admin';
COMMENT ON COLUMN schedule_snapshots.snapshot IS 'Données normalisées JSON : period, establishment, department, kpis, staff_summary';

CREATE INDEX IF NOT EXISTS idx_snapshots_schedule ON schedule_snapshots (schedule_id);

-- ──────────────────────────────────────────────────────────────
-- C. HISTORIQUE DES ÉVALUATIONS DE RÈGLES
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rule_evaluations (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id  UUID        NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  rule_id      UUID        REFERENCES establishment_rules(id) ON DELETE SET NULL,
  rule_code    VARCHAR(80) NOT NULL,
  severity     VARCHAR(20) NOT NULL,  -- error | warning | info
  violations   JSONB       NOT NULL DEFAULT '[]',
  -- Array de { type, message, user_id, date, shift_ids }
  evaluated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE rule_evaluations IS 'Historique des évaluations de règles sur chaque planning (pour audit)';

CREATE INDEX IF NOT EXISTS idx_rule_eval_schedule ON rule_evaluations (schedule_id, evaluated_at DESC);

-- ──────────────────────────────────────────────────────────────
-- D. COLONNES SYSTÈME PAR DÉFAUT (référence globale)
-- Insérées lors de l'initialisation d'un établissement
-- ──────────────────────────────────────────────────────────────
-- Note : Ces colonnes sont créées dynamiquement par établissement
-- via la fonction initDefaultColumns() dans rules-engine.js
-- lors de la création d'un nouvel établissement.
--
-- Colonnes système standards :
-- first_name, last_name, matricule, role, speciality, grade, phone
--
-- Colonnes optionnelles proposées :
-- department, shift_type, notes, replacement, on_call_phone
