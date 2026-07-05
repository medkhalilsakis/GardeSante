-- ============================================================
-- GARDESANTE - SCHÉMA POSTGRESQL COMPLET
-- Plateforme nationale configurable de gestion des gardes
-- Version: 1.0.0
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 1. ÉTABLISSEMENTS
-- ============================================================

CREATE TABLE establishments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(20) UNIQUE NOT NULL,              -- Ex: HCA-001, IHU-002
  name VARCHAR(255) NOT NULL,
  name_ar VARCHAR(255),                          -- Nom en arabe
  type VARCHAR(50) NOT NULL DEFAULT 'hospital',  -- hospital | institute | clinic
  address TEXT,
  city VARCHAR(100),
  phone VARCHAR(30),
  email VARCHAR(150),
  logo_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configuration flexible par établissement (clé-valeur)
CREATE TABLE establishment_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  config_key VARCHAR(100) NOT NULL,
  config_value TEXT,
  config_type VARCHAR(20) DEFAULT 'string',      -- string | integer | boolean | json
  description TEXT,
  description_ar TEXT,
  updated_by UUID,                               -- Référence vers users (ajoutée après)
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(establishment_id, config_key)
);

-- ============================================================
-- 2. RÔLES ET PERMISSIONS (RBAC DYNAMIQUE)
-- ============================================================

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID REFERENCES establishments(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,                     -- super_admin | hospital_admin | ...
  name VARCHAR(100) NOT NULL,
  name_ar VARCHAR(100),
  level INTEGER NOT NULL DEFAULT 0,              -- Niveau hiérarchique (plus bas = plus haut)
  is_system BOOLEAN DEFAULT FALSE,               -- Rôle système non modifiable
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(establishment_id, code)
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(100) UNIQUE NOT NULL,             -- schedules.create | shifts.delete | ...
  module VARCHAR(50) NOT NULL,
  action VARCHAR(50) NOT NULL,
  description TEXT,
  description_ar TEXT
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ============================================================
-- 3. UTILISATEURS
-- ============================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id),
  matricule VARCHAR(50),                         -- Numéro matricule
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  first_name_ar VARCHAR(100),
  last_name_ar VARCHAR(100),
  email VARCHAR(150) UNIQUE NOT NULL,
  phone VARCHAR(30),
  password_hash TEXT NOT NULL,
  speciality VARCHAR(100),                       -- Spécialité médicale
  grade VARCHAR(100),                            -- Grade professionnel
  is_active BOOLEAN DEFAULT TRUE,
  is_on_leave BOOLEAN DEFAULT FALSE,
  avatar_url TEXT,
  preferred_language VARCHAR(5) DEFAULT 'fr',    -- fr | ar
  last_login TIMESTAMPTZ,
  password_reset_token TEXT,
  password_reset_expires TIMESTAMPTZ,
  refresh_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. SERVICES (DÉPARTEMENTS)
-- ============================================================

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES departments(id),     -- Hiérarchie possible
  code VARCHAR(30) NOT NULL,
  name VARCHAR(150) NOT NULL,
  name_ar VARCHAR(150),
  floor VARCHAR(30),                             -- Étage / Localisation
  phone VARCHAR(30),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(establishment_id, code)
);

CREATE TABLE user_departments (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_head BOOLEAN DEFAULT FALSE,                 -- Chef de service
  is_primary BOOLEAN DEFAULT TRUE,               -- Service principal
  joined_at DATE DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, department_id)
);

-- ============================================================
-- 5. TYPES DE GARDE (CONFIGURABLES)
-- ============================================================

CREATE TABLE shift_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_ar VARCHAR(100),
  start_time TIME NOT NULL,                      -- Ex: 07:00
  end_time TIME NOT NULL,                        -- Ex: 07:00 (lendemain)
  duration_hours DECIMAL(4,1) NOT NULL,          -- 24h, 12h, 8h, etc.
  is_overnight BOOLEAN DEFAULT FALSE,
  color VARCHAR(7) DEFAULT '#3B82F6',            -- Couleur hex pour l'UI
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(establishment_id, code)
);

-- ============================================================
-- 6. WORKFLOW DE VALIDATION (CONFIGURABLE)
-- ============================================================

CREATE TABLE workflow_definitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,              -- schedule | absence | replacement
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  role_code VARCHAR(50) NOT NULL,                -- Rôle qui valide cette étape
  step_name VARCHAR(100) NOT NULL,
  step_name_ar VARCHAR(100),
  is_optional BOOLEAN DEFAULT FALSE,
  timeout_hours INTEGER,                         -- Délai avant escalade
  UNIQUE(workflow_id, step_order)
);

-- ============================================================
-- 7. PÉRIODES DE PLANIFICATION
-- ============================================================

CREATE TABLE schedule_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id),
  name VARCHAR(150) NOT NULL,
  period_type VARCHAR(20) NOT NULL DEFAULT 'monthly', -- weekly | monthly | bimonthly | semestrial
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. PLANNINGS DE GARDE
-- ============================================================

CREATE TABLE schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id),
  period_id UUID REFERENCES schedule_periods(id),
  name VARCHAR(200) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  -- draft | submitted | under_review | approved | rejected | active | archived
  created_by UUID NOT NULL REFERENCES users(id),
  current_workflow_step INTEGER DEFAULT 0,
  workflow_id UUID REFERENCES workflow_definitions(id),
  notes TEXT,
  rejection_reason TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE schedule_workflow_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  action VARCHAR(30) NOT NULL,                   -- submitted | approved | rejected | returned
  actor_id UUID NOT NULL REFERENCES users(id),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. GARDES INDIVIDUELLES
-- ============================================================

CREATE TABLE shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  user_id UUID NOT NULL REFERENCES users(id),
  shift_type_id UUID NOT NULL REFERENCES shift_types(id),
  shift_date DATE NOT NULL,
  actual_start TIMESTAMPTZ,                      -- Présence réelle
  actual_end TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'planned',
  -- planned | confirmed | absent | replaced | cancelled | completed
  notes TEXT,
  is_extra BOOLEAN DEFAULT FALSE,                -- Garde supplémentaire hors planning
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_shifts_date ON shifts(shift_date);
CREATE INDEX idx_shifts_user_date ON shifts(user_id, shift_date);
CREATE INDEX idx_shifts_department_date ON shifts(department_id, shift_date);
CREATE INDEX idx_shifts_schedule ON shifts(schedule_id);

-- ============================================================
-- 10. PRÉSENCES
-- ============================================================

CREATE TABLE attendances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shift_id UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  checked_in_at TIMESTAMPTZ,
  checked_out_at TIMESTAMPTZ,
  checked_by UUID REFERENCES users(id),
  status VARCHAR(20) DEFAULT 'present',          -- present | late | absent | partial
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 11. ABSENCES
-- ============================================================

CREATE TABLE absence_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  code VARCHAR(30) NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_ar VARCHAR(100),
  requires_justification BOOLEAN DEFAULT FALSE,
  is_paid BOOLEAN DEFAULT TRUE,
  color VARCHAR(7) DEFAULT '#EF4444',
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(establishment_id, code)
);

CREATE TABLE absences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  user_id UUID NOT NULL REFERENCES users(id),
  shift_id UUID REFERENCES shifts(id),           -- Absence sur une garde précise
  absence_type_id UUID NOT NULL REFERENCES absence_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME,                               -- Pour absences partielles
  end_time TIME,
  reason TEXT,
  justification_url TEXT,                        -- Document justificatif
  status VARCHAR(30) DEFAULT 'pending',          -- pending | approved | rejected | cancelled
  declared_by UUID NOT NULL REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_absences_user_date ON absences(user_id, start_date, end_date);
CREATE INDEX idx_absences_department ON absences(department_id, start_date);

-- ============================================================
-- 12. REMPLACEMENTS
-- ============================================================

CREATE TABLE replacements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  shift_id UUID NOT NULL REFERENCES shifts(id),
  absent_user_id UUID NOT NULL REFERENCES users(id),
  replacement_user_id UUID REFERENCES users(id), -- NULL si pas encore trouvé
  absence_id UUID REFERENCES absences(id),
  status VARCHAR(30) DEFAULT 'pending',
  -- pending | proposed | accepted | rejected | cancelled | completed
  urgency VARCHAR(20) DEFAULT 'normal',          -- low | normal | high | critical
  requested_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  proposed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE replacement_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  replacement_id UUID NOT NULL REFERENCES replacements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  score DECIMAL(5,2),                            -- Score de compatibilité (IA future)
  status VARCHAR(20) DEFAULT 'proposed',         -- proposed | accepted | declined
  notified_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  notes TEXT
);

-- ============================================================
-- 13. REMARQUES ET COMMENTAIRES
-- ============================================================

CREATE TABLE remarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  entity_type VARCHAR(50) NOT NULL,              -- shift | schedule | absence | replacement
  entity_id UUID NOT NULL,
  content TEXT NOT NULL,
  content_ar TEXT,
  author_id UUID NOT NULL REFERENCES users(id),
  is_internal BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 14. NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID NOT NULL REFERENCES establishments(id),
  recipient_id UUID NOT NULL REFERENCES users(id),
  sender_id UUID REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  -- schedule_submitted | schedule_approved | absence_declared |
  -- replacement_needed | replacement_accepted | conflict_detected
  title VARCHAR(255) NOT NULL,
  title_ar VARCHAR(255),
  message TEXT NOT NULL,
  message_ar TEXT,
  entity_type VARCHAR(50),
  entity_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  priority VARCHAR(20) DEFAULT 'normal',         -- low | normal | high | urgent
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);

-- ============================================================
-- 15. JOURNAL D'AUDIT
-- ============================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID REFERENCES establishments(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);

-- ============================================================
-- 16. VUES UTILES
-- ============================================================

-- Vue : Gardes du jour avec informations complètes
CREATE OR REPLACE VIEW v_today_shifts AS
SELECT
  s.id,
  s.shift_date,
  s.status,
  s.notes,
  st.name AS shift_type_name,
  st.name_ar AS shift_type_name_ar,
  st.start_time,
  st.end_time,
  st.duration_hours,
  st.color AS shift_color,
  u.id AS user_id,
  u.first_name,
  u.last_name,
  u.first_name_ar,
  u.last_name_ar,
  u.speciality,
  u.grade,
  d.id AS department_id,
  d.name AS department_name,
  d.name_ar AS department_name_ar,
  e.id AS establishment_id,
  e.name AS establishment_name,
  sch.id AS schedule_id,
  sch.name AS schedule_name
FROM shifts s
JOIN users u ON s.user_id = u.id
JOIN departments d ON s.department_id = d.id
JOIN establishments e ON s.establishment_id = e.id
JOIN shift_types st ON s.shift_type_id = st.id
JOIN schedules sch ON s.schedule_id = sch.id;

-- Vue : Résumé statistiques par médecin
CREATE OR REPLACE VIEW v_user_shift_stats AS
SELECT
  u.id AS user_id,
  u.establishment_id,
  u.first_name,
  u.last_name,
  COUNT(s.id) FILTER (WHERE s.status != 'cancelled') AS total_shifts,
  COUNT(s.id) FILTER (WHERE s.status = 'absent') AS absent_shifts,
  COUNT(s.id) FILTER (WHERE s.status = 'replaced') AS replaced_shifts,
  COUNT(s.id) FILTER (WHERE s.status = 'completed') AS completed_shifts,
  SUM(st.duration_hours) FILTER (WHERE s.status IN ('completed', 'confirmed', 'planned')) AS total_hours,
  ROUND(
    COUNT(s.id) FILTER (WHERE s.status = 'absent')::numeric /
    NULLIF(COUNT(s.id) FILTER (WHERE s.status != 'cancelled'), 0) * 100, 2
  ) AS absence_rate
FROM users u
LEFT JOIN shifts s ON u.id = s.user_id
LEFT JOIN shift_types st ON s.shift_type_id = st.id
WHERE u.is_active = TRUE
GROUP BY u.id, u.establishment_id, u.first_name, u.last_name;

-- ============================================================
-- 17. TRIGGERS
-- ============================================================

-- Trigger: updated_at automatique
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_establishments_updated BEFORE UPDATE ON establishments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_schedules_updated BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_shifts_updated BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_absences_updated BEFORE UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tr_replacements_updated BEFORE UPDATE ON replacements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 18. CONTRAINTES MÉTIER
-- ============================================================

-- Vérifier que la date de fin >= date de début pour les plannings
ALTER TABLE schedules ADD CONSTRAINT chk_schedule_dates
  CHECK (end_date >= start_date);

-- Vérifier que la date de fin >= date de début pour les absences
ALTER TABLE absences ADD CONSTRAINT chk_absence_dates
  CHECK (end_date >= start_date);

-- Vérifier les statuts valides
ALTER TABLE schedules ADD CONSTRAINT chk_schedule_status
  CHECK (status IN ('draft','submitted','under_review','approved','rejected','active','archived'));

ALTER TABLE shifts ADD CONSTRAINT chk_shift_status
  CHECK (status IN ('planned','confirmed','absent','replaced','cancelled','completed'));

ALTER TABLE absences ADD CONSTRAINT chk_absence_status
  CHECK (status IN ('pending','approved','rejected','cancelled'));

ALTER TABLE replacements ADD CONSTRAINT chk_replacement_status
  CHECK (status IN ('pending','proposed','accepted','rejected','cancelled','completed'));
