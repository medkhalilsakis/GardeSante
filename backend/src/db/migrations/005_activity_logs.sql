-- ============================================================
-- Migration 005 — Journal d'activité utilisateur (activity_logs)
-- Idempotent : CREATE TABLE IF NOT EXISTS
-- ============================================================

-- Extension uuid si pas encore activée
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS activity_logs (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          VARCHAR(80)   NOT NULL,          -- ex: login, logout, profile_update, password_change …
  category        VARCHAR(40)   NOT NULL DEFAULT 'general',  -- auth | profile | schedule | absence | admin
  description     TEXT,                            -- message lisible
  description_ar  TEXT,                            -- version arabe
  entity_type     VARCHAR(60),                     -- users | departments | schedules | absences …
  entity_id       UUID,                            -- id de l'entité concernée
  metadata        JSONB         DEFAULT '{}',      -- données supplémentaires (avant/après, champs, etc.)
  ip_address      VARCHAR(45),                     -- IPv4 ou IPv6
  user_agent      TEXT,
  severity        VARCHAR(10)   NOT NULL DEFAULT 'info',  -- info | warning | error | critical
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user       ON activity_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action     ON activity_logs (action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_category   ON activity_logs (category);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity     ON activity_logs (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;
