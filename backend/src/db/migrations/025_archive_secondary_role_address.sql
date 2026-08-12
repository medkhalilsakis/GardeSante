-- Migration 025 : archivage de compte, rôle secondaire (chef de service = titre), adresse détaillée
-- Purement additive et idempotente.

-- 1) Archivage d'un compte utilisateur par le Super Admin (≠ désactivation, ≠ suppression)
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archive_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_archived ON users(archived_at) WHERE archived_at IS NOT NULL;

-- 2) « Chef de service » est un titre : on garde role_id comme rôle plateforme
--    et on ajoute un rôle métier secondaire optionnel (ex. médecin sénior).
ALTER TABLE users ADD COLUMN IF NOT EXISTS secondary_role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

-- 3) Adresse détaillée des établissements (préparation d'une carte future — non construite ici)
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS delegation VARCHAR(120);
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS address_details TEXT;
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6);
ALTER TABLE establishments ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

-- 4) Prêts de personnel : recherche par (planning, agent) lors de l'enregistrement du tableur
CREATE INDEX IF NOT EXISTS idx_staff_loans_schedule_staff ON staff_loan_requests(schedule_id, staff_user_id);
