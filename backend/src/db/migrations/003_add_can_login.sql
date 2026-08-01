-- ============================================================
-- Migration 003 — Ajout flag can_login sur users
-- senior_doctor, resident, observer n'ont pas accès à la plateforme
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_login BOOLEAN DEFAULT TRUE;

-- Les médecins et résidents n'ont pas de compte de connexion
UPDATE users
SET can_login = FALSE
WHERE role_id IN (
  SELECT id FROM roles
  WHERE code IN ('senior_doctor', 'resident', 'observer')
);
