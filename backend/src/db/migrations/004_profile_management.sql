-- ============================================================
-- Migration 004 — Informations personnelles étendues
--   + Table de demandes de modification avec workflow approbation
-- Idempotent : ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS
-- ============================================================

-- ── Colonnes supplémentaires sur users ────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date          DATE,
  ADD COLUMN IF NOT EXISTS gender              VARCHAR(20),
  ADD COLUMN IF NOT EXISTS address             TEXT,
  ADD COLUMN IF NOT EXISTS city                VARCHAR(100),
  ADD COLUMN IF NOT EXISTS id_card_number      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS id_card_expiry      DATE,
  ADD COLUMN IF NOT EXISTS hire_date           DATE,
  ADD COLUMN IF NOT EXISTS bio                 TEXT;

-- Agrandir le type si la colonne existait déjà en VARCHAR(10)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'gender'
      AND character_maximum_length IS NOT NULL
      AND character_maximum_length < 20
  ) THEN
    ALTER TABLE users ALTER COLUMN gender TYPE VARCHAR(20);
  END IF;
END $$;

-- Appliquer la valeur par défaut sur la colonne gender
ALTER TABLE users ALTER COLUMN gender SET DEFAULT 'non_renseigne';

-- Remplir les lignes existantes qui n'ont pas encore de valeur gender
UPDATE users SET gender = 'non_renseigne' WHERE gender IS NULL;

-- ── Table des demandes de modification de profil ──────────────
-- Un utilisateur soumet ses modifications → super_admin approuve/rejette
-- Email et mot de passe sont exclus de ce workflow (modification directe)
CREATE TABLE IF NOT EXISTS profile_change_requests (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|cancelled
  -- Données actuelles (snapshot au moment de la demande)
  current_data    JSONB         NOT NULL DEFAULT '{}',
  -- Données proposées
  requested_data  JSONB         NOT NULL DEFAULT '{}',
  -- Champs modifiés (liste des clés)
  changed_fields  TEXT[]        NOT NULL DEFAULT '{}',
  -- Workflow
  submitted_at    TIMESTAMPTZ   DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  -- Métadonnées
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_requests_user    ON profile_change_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_profile_requests_status  ON profile_change_requests (status);
CREATE INDEX IF NOT EXISTS idx_profile_requests_pending ON profile_change_requests (status) WHERE status = 'pending';
