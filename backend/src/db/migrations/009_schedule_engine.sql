-- ============================================================
-- Migration 009 — Moteur de Configuration Avancé
-- schedule_templates, establishment_rules, schedule_column_models
-- schedule_cycles
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A. MODÈLES DE COLONNES (par établissement)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_column_models (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID         REFERENCES establishments(id) ON DELETE CASCADE,
  code             VARCHAR(50)  NOT NULL,
  label            VARCHAR(150) NOT NULL,
  label_ar         VARCHAR(150),
  data_type        VARCHAR(30)  NOT NULL DEFAULT 'text',
  -- text | number | time | date | person | phone | select | boolean | shift_type
  validation_rules JSONB        NOT NULL DEFAULT '{}',
  -- { "required": true, "pattern": "...", "min": 0, "max": 999, "options": [] }
  is_system        BOOLEAN      DEFAULT FALSE,   -- colonnes système non supprimables
  is_default       BOOLEAN      DEFAULT TRUE,    -- affichée par défaut
  display_order    INTEGER      DEFAULT 0,
  is_active        BOOLEAN      DEFAULT TRUE,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(establishment_id, code)
);

COMMENT ON TABLE schedule_column_models IS 'Colonnes personnalisables des tableaux de garde par établissement';
COMMENT ON COLUMN schedule_column_models.data_type IS 'Type de donnée : text|number|time|date|person|phone|select|boolean|shift_type';
COMMENT ON COLUMN schedule_column_models.is_system IS 'Colonne système non supprimable (Nom, Prénom, Matricule, etc.)';

-- Colonnes système par défaut (insérées à la création de chaque établissement via le seed)
-- Elles seront injectées lors de la création d'un établissement

-- ──────────────────────────────────────────────────────────────
-- B. RÈGLES MÉTIER CONFIGURABLES
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS establishment_rules (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID         NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  rule_code        VARCHAR(80)  NOT NULL,
  rule_name        VARCHAR(200) NOT NULL,
  rule_name_ar     VARCHAR(200),
  rule_type        VARCHAR(50)  NOT NULL,
  -- rest | frequency | balance | constraint | rotation | cross_establishment
  config           JSONB        NOT NULL DEFAULT '{}',
  severity         VARCHAR(20)  NOT NULL DEFAULT 'warning',
  -- error (bloquant) | warning (avertissement) | info
  is_active        BOOLEAN      DEFAULT TRUE,
  is_system        BOOLEAN      DEFAULT FALSE,  -- règle système non supprimable
  priority         INTEGER      DEFAULT 0,      -- ordre d'évaluation
  created_by       UUID         REFERENCES users(id),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(establishment_id, rule_code)
);

COMMENT ON TABLE establishment_rules IS 'Règles métier configurables par établissement (repos, fréquences, rotations, contraintes)';
COMMENT ON COLUMN establishment_rules.config IS 'Configuration JSON de la règle selon son type';

-- Index pour performance
CREATE INDEX IF NOT EXISTS idx_rules_establishment_active
  ON establishment_rules (establishment_id, is_active, rule_type);

-- ──────────────────────────────────────────────────────────────
-- C. MODÈLES DE PLANNING (TEMPLATES)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_templates (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID         NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id    UUID         REFERENCES departments(id) ON DELETE SET NULL,
  name             VARCHAR(200) NOT NULL,
  description      TEXT,
  period_type      VARCHAR(30)  NOT NULL DEFAULT 'monthly',
  -- weekly | monthly | quarterly | biannual | custom
  week_mode        VARCHAR(20)  NOT NULL DEFAULT 'standard',
  -- standard | ab | ab_shared
  generation_algo  VARCHAR(50)  NOT NULL DEFAULT 'round_robin',
  -- round_robin | cyclic | ab_rotation | manual | ai_assisted
  column_ids       UUID[]       DEFAULT '{}',    -- IDs colonnes utilisées
  shift_type_ids   UUID[]       DEFAULT '{}',    -- types de garde autorisés
  shared_with      UUID[]       DEFAULT '{}',    -- IDs établissements partenaires
  config           JSONB        NOT NULL DEFAULT '{}',
  -- { "min_staff": 2, "max_shifts_per_person": 8, "rotation_weeks": 4, ... }
  is_active        BOOLEAN      DEFAULT TRUE,
  is_default       BOOLEAN      DEFAULT FALSE,   -- template par défaut du service
  times_used       INTEGER      DEFAULT 0,
  created_by       UUID         REFERENCES users(id),
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON TABLE schedule_templates IS 'Modèles/templates de planning réutilisables par service';

-- ──────────────────────────────────────────────────────────────
-- D. CYCLES ET ROTATIONS (Semaines A/B, équipes tournantes)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_cycles (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id  UUID        NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  cycle_label  VARCHAR(20) NOT NULL,  -- 'A' | 'B' | 'Rouge' | 'Bleu' | '1' | '2'
  cycle_color  VARCHAR(7)  DEFAULT '#3B82F6',
  start_date   DATE        NOT NULL,
  end_date     DATE        NOT NULL,
  team_ids     UUID[]      DEFAULT '{}',   -- utilisateurs affectés à ce cycle
  shift_pattern JSONB      DEFAULT '{}',   -- { "mon": "G", "tue": "R", "wed": "-", ... }
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE schedule_cycles IS 'Cycles de rotation (semaines A/B, équipes tournantes) pour un planning';

CREATE INDEX IF NOT EXISTS idx_cycles_schedule ON schedule_cycles (schedule_id);

-- ──────────────────────────────────────────────────────────────
-- E. ENRICHISSEMENT TABLE SCHEDULES
-- ──────────────────────────────────────────────────────────────
ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS template_id    UUID         REFERENCES schedule_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS period_type    VARCHAR(30)  NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS creation_mode  VARCHAR(30)  NOT NULL DEFAULT 'manual',
  -- manual | assistant | spreadsheet | visual
  ADD COLUMN IF NOT EXISTS is_shared      BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS shared_with    UUID[]       DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metadata       JSONB        NOT NULL DEFAULT '{}';
  -- metadata: { "column_ids": [], "algo": "round_robin", "week_mode": "standard", ... }

COMMENT ON COLUMN schedules.creation_mode IS 'Méthode de création : manual|assistant|spreadsheet|visual';
COMMENT ON COLUMN schedules.metadata IS 'Métadonnées flexibles du planning (colonnes, algorithme, options)';

-- ──────────────────────────────────────────────────────────────
-- F. RÈGLES SYSTÈME PAR DÉFAUT (appliquées lors de la création d'un établissement)
-- ──────────────────────────────────────────────────────────────
-- Ces règles sont générées automatiquement pour chaque nouvel établissement
-- via le contrôleur establishments.controller.js (création)
-- Voir la fonction createDefaultRules() dans rules-engine.js
