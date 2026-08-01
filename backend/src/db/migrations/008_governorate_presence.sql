-- ============================================================
-- Migration 008 — Gouvernorats tunisiens + présence en temps réel
-- ============================================================

-- 1. Ajouter le champ gouvernorat sur les établissements
ALTER TABLE establishments
  ADD COLUMN IF NOT EXISTS governorate VARCHAR(100) DEFAULT NULL;

COMMENT ON COLUMN establishments.governorate IS 'Gouvernorat tunisien de l''établissement';

-- 2. Ajouter last_activity_at pour la présence en temps réel
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN users.last_activity_at IS 'Dernière activité API (mise à jour à chaque requête authentifiée)';

-- 3. Index pour performance des requêtes de présence
CREATE INDEX IF NOT EXISTS idx_users_last_activity ON users (last_activity_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_establishments_governorate ON establishments (governorate);

-- 4. Mettre à jour les utilisateurs existants
UPDATE users SET last_activity_at = last_login WHERE last_activity_at IS NULL AND last_login IS NOT NULL;
