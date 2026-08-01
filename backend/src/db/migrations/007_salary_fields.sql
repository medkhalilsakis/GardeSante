-- ============================================================
-- Migration 007 — Champs salaire et embauche sur users
-- Ajoute : hourly_rate, base_salary, hire_date
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS hourly_rate  DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS base_salary  DECIMAL(10,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hire_date    DATE          DEFAULT NULL;

COMMENT ON COLUMN users.hourly_rate IS 'Taux horaire (DZD) pour les gardes supplémentaires';
COMMENT ON COLUMN users.base_salary  IS 'Salaire de base mensuel (DZD)';
COMMENT ON COLUMN users.hire_date    IS 'Date d''embauche / entrée en fonction';
