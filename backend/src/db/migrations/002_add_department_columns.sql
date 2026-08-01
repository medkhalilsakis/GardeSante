-- ============================================================
-- Migration 002 — Ajout colonnes manquantes sur departments
-- Idempotent : utilise ADD COLUMN IF NOT EXISTS
-- ============================================================

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS department_type VARCHAR(50) DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS wing            VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bed_count       INTEGER,
  ADD COLUMN IF NOT EXISTS min_guard_count INTEGER DEFAULT 1;

-- Mise à jour des types pour les services déjà créés
UPDATE departments SET department_type = 'emergency' WHERE code = 'URG';
UPDATE departments SET department_type = 'surgery'   WHERE code IN ('CHI', 'CHIR-CARD');
UPDATE departments SET department_type = 'icu'        WHERE code IN ('REA', 'USIC');
UPDATE departments SET department_type = 'pediatrics' WHERE code = 'PED';
UPDATE departments SET department_type = 'internal'   WHERE code = 'MED';
