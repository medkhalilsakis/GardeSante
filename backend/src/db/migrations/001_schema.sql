-- ============================================================
-- GARDESANTE — SCHÉMA POSTGRESQL COMPLET ET IDEMPOTENT
-- Version: 2.0.0 — Toutes les tables créées avec IF NOT EXISTS
-- Les triggers et vues sont recréés proprement
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- 1. ÉTABLISSEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS establishments (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         VARCHAR(20)  UNIQUE NOT NULL,
  name         VARCHAR(255) NOT NULL,
  name_ar      VARCHAR(255),
  type         VARCHAR(50)  NOT NULL DEFAULT 'hospital',  -- hospital | institute | clinic
  address      TEXT,
  city         VARCHAR(100),
  phone        VARCHAR(30),
  email        VARCHAR(150),
  logo_url     TEXT,
  is_active    BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS establishment_configs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID        NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  config_key       VARCHAR(100) NOT NULL,
  config_value     TEXT,
  config_type      VARCHAR(20)  DEFAULT 'string',
  description      TEXT,
  description_ar   TEXT,
  updated_by       UUID,
  updated_at       TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(establishment_id, config_key)
);

-- ============================================================
-- 2. RÔLES ET PERMISSIONS (RBAC DYNAMIQUE)
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID        REFERENCES establishments(id) ON DELETE CASCADE,
  code             VARCHAR(50) NOT NULL,
  name             VARCHAR(100) NOT NULL,
  name_ar          VARCHAR(100),
  level            INTEGER     NOT NULL DEFAULT 0,
  is_system        BOOLEAN     DEFAULT FALSE,
  description      TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(establishment_id, code)
);

-- Rôle super_admin global (establishment_id NULL) — contrainte partielle
CREATE UNIQUE INDEX IF NOT EXISTS roles_global_code_unique
  ON roles (code) WHERE establishment_id IS NULL;

CREATE TABLE IF NOT EXISTS permissions (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        VARCHAR(100) UNIQUE NOT NULL,
  module      VARCHAR(50)  NOT NULL,
  action      VARCHAR(50)  NOT NULL,
  description TEXT,
  description_ar TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ============================================================
-- 3. UTILISATEURS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id                     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id       UUID         NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  role_id                UUID         NOT NULL REFERENCES roles(id),
  matricule              VARCHAR(50),
  first_name             VARCHAR(100) NOT NULL,
  last_name              VARCHAR(100) NOT NULL,
  first_name_ar          VARCHAR(100),
  last_name_ar           VARCHAR(100),
  email                  VARCHAR(150) UNIQUE NOT NULL,
  phone                  VARCHAR(30),
  password_hash          TEXT         NOT NULL,
  speciality             VARCHAR(100),
  grade                  VARCHAR(100),
  is_active              BOOLEAN      DEFAULT TRUE,
  is_on_leave            BOOLEAN      DEFAULT FALSE,
  avatar_url             TEXT,
  preferred_language     VARCHAR(5)   DEFAULT 'fr',
  last_login             TIMESTAMPTZ,
  password_reset_token   TEXT,
  password_reset_expires TIMESTAMPTZ,
  refresh_token          TEXT,
  created_at             TIMESTAMPTZ  DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- 4. SERVICES (DÉPARTEMENTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS departments (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID        NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  parent_id        UUID        REFERENCES departments(id),
  code             VARCHAR(30) NOT NULL,
  name             VARCHAR(150) NOT NULL,
  name_ar          VARCHAR(150),
  department_type  VARCHAR(50)  DEFAULT 'other',  -- emergency|surgery|icu|internal|pediatrics|radiology|other
  floor            VARCHAR(30),
  wing             VARCHAR(30),
  phone            VARCHAR(30),
  bed_count        INTEGER,
  min_guard_count  INTEGER     DEFAULT 1,
  is_active        BOOLEAN     DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(establishment_id, code)
);

CREATE TABLE IF NOT EXISTS user_departments (
  user_id       UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID    NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_head       BOOLEAN DEFAULT FALSE,
  is_primary    BOOLEAN DEFAULT TRUE,
  joined_at     DATE    DEFAULT CURRENT_DATE,
  PRIMARY KEY (user_id, department_id)
);

-- ============================================================
-- 5. TYPES DE GARDE (CONFIGURABLES PAR ÉTABLISSEMENT)
-- ============================================================

CREATE TABLE IF NOT EXISTS shift_types (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID           NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  code             VARCHAR(30)    NOT NULL,
  name             VARCHAR(100)   NOT NULL,
  name_ar          VARCHAR(100),
  start_time       TIME           NOT NULL,
  end_time         TIME           NOT NULL,
  duration_hours   DECIMAL(4,1)   NOT NULL,
  is_overnight     BOOLEAN        DEFAULT FALSE,
  color            VARCHAR(7)     DEFAULT '#3B82F6',
  is_active        BOOLEAN        DEFAULT TRUE,
  created_at       TIMESTAMPTZ    DEFAULT NOW(),
  UNIQUE(establishment_id, code)
);

-- ============================================================
-- 6. WORKFLOW DE VALIDATION (CONFIGURABLE)
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_definitions (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID        NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  entity_type      VARCHAR(50)  NOT NULL,  -- schedule | absence | replacement
  is_active        BOOLEAN     DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID        NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  step_order  INTEGER     NOT NULL,
  role_code   VARCHAR(50) NOT NULL,
  step_name   VARCHAR(100) NOT NULL,
  step_name_ar VARCHAR(100),
  is_optional BOOLEAN     DEFAULT FALSE,
  timeout_hours INTEGER,
  UNIQUE(workflow_id, step_order)
);

-- ============================================================
-- 7. PLANNINGS DE GARDE
-- ============================================================

CREATE TABLE IF NOT EXISTS schedules (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id      UUID        NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  department_id         UUID        NOT NULL REFERENCES departments(id),
  name                  VARCHAR(200) NOT NULL,
  start_date            DATE        NOT NULL,
  end_date              DATE        NOT NULL,
  status                VARCHAR(30) NOT NULL DEFAULT 'draft',
  -- draft | submitted | under_review | approved | rejected | active | archived
  created_by            UUID        NOT NULL REFERENCES users(id),
  current_workflow_step INTEGER     DEFAULT 0,
  workflow_id           UUID        REFERENCES workflow_definitions(id),
  notes                 TEXT,
  rejection_reason      TEXT,
  published_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_schedule_dates   CHECK (end_date >= start_date),
  CONSTRAINT chk_schedule_status  CHECK (status IN ('draft','submitted','under_review','approved','rejected','active','archived'))
);

CREATE TABLE IF NOT EXISTS schedule_workflow_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id UUID        NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  step_order  INTEGER     NOT NULL,
  action      VARCHAR(30) NOT NULL,
  actor_id    UUID        NOT NULL REFERENCES users(id),
  comment     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8. GARDES INDIVIDUELLES
-- ============================================================

CREATE TABLE IF NOT EXISTS shifts (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_id      UUID        NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  establishment_id UUID        NOT NULL REFERENCES establishments(id),
  department_id    UUID        NOT NULL REFERENCES departments(id),
  user_id          UUID        NOT NULL REFERENCES users(id),
  shift_type_id    UUID        NOT NULL REFERENCES shift_types(id),
  shift_date       DATE        NOT NULL,
  actual_start     TIMESTAMPTZ,
  actual_end       TIMESTAMPTZ,
  status           VARCHAR(30) NOT NULL DEFAULT 'planned',
  -- planned | confirmed | absent | replaced | cancelled | completed
  notes            TEXT,
  is_extra         BOOLEAN     DEFAULT FALSE,
  created_by       UUID        REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_shift_status CHECK (status IN ('planned','confirmed','absent','replaced','cancelled','completed'))
);

CREATE INDEX IF NOT EXISTS idx_shifts_date            ON shifts(shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_user_date       ON shifts(user_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_department_date ON shifts(department_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_shifts_schedule        ON shifts(schedule_id);
CREATE INDEX IF NOT EXISTS idx_shifts_establishment   ON shifts(establishment_id, shift_date);

-- ============================================================
-- 9. TYPES D'ABSENCE
-- ============================================================

CREATE TABLE IF NOT EXISTS absence_types (
  id                      UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id        UUID        NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  code                    VARCHAR(30) NOT NULL,
  name                    VARCHAR(100) NOT NULL,
  name_ar                 VARCHAR(100),
  requires_justification  BOOLEAN     DEFAULT FALSE,
  is_paid                 BOOLEAN     DEFAULT TRUE,
  color                   VARCHAR(7)  DEFAULT '#EF4444',
  is_active               BOOLEAN     DEFAULT TRUE,
  UNIQUE(establishment_id, code)
);

-- ============================================================
-- 10. ABSENCES
-- ============================================================

CREATE TABLE IF NOT EXISTS absences (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID        NOT NULL REFERENCES establishments(id),
  department_id    UUID        NOT NULL REFERENCES departments(id),
  user_id          UUID        NOT NULL REFERENCES users(id),
  shift_id         UUID        REFERENCES shifts(id),
  absence_type_id  UUID        NOT NULL REFERENCES absence_types(id),
  start_date       DATE        NOT NULL,
  end_date         DATE        NOT NULL,
  reason           TEXT,
  justification_url TEXT,
  status           VARCHAR(30) DEFAULT 'pending',
  declared_by      UUID        NOT NULL REFERENCES users(id),
  approved_by      UUID        REFERENCES users(id),
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_absence_dates  CHECK (end_date >= start_date),
  CONSTRAINT chk_absence_status CHECK (status IN ('pending','approved','rejected','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_absences_user_date  ON absences(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_absences_department ON absences(department_id, start_date);

-- ============================================================
-- 11. REMPLACEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS replacements (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id    UUID        NOT NULL REFERENCES establishments(id),
  shift_id            UUID        NOT NULL REFERENCES shifts(id),
  absent_user_id      UUID        NOT NULL REFERENCES users(id),
  replacement_user_id UUID        REFERENCES users(id),
  absence_id          UUID        REFERENCES absences(id),
  status              VARCHAR(30) DEFAULT 'pending',
  urgency             VARCHAR(20) DEFAULT 'normal',
  requested_by        UUID        NOT NULL REFERENCES users(id),
  notes               TEXT,
  proposed_at         TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_replacement_status CHECK (status IN ('pending','proposed','accepted','rejected','cancelled','completed'))
);

CREATE TABLE IF NOT EXISTS replacement_candidates (
  id             UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  replacement_id UUID           NOT NULL REFERENCES replacements(id) ON DELETE CASCADE,
  user_id        UUID           NOT NULL REFERENCES users(id),
  score          DECIMAL(5,2),
  status         VARCHAR(20)    DEFAULT 'proposed',
  notified_at    TIMESTAMPTZ,
  responded_at   TIMESTAMPTZ,
  notes          TEXT
);

-- ============================================================
-- 12. NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID        NOT NULL REFERENCES establishments(id),
  recipient_id     UUID        NOT NULL REFERENCES users(id),
  sender_id        UUID        REFERENCES users(id),
  type             VARCHAR(50) NOT NULL,
  title            VARCHAR(255) NOT NULL,
  title_ar         VARCHAR(255),
  message          TEXT        NOT NULL,
  message_ar       TEXT,
  entity_type      VARCHAR(50),
  entity_id        UUID,
  is_read          BOOLEAN     DEFAULT FALSE,
  read_at          TIMESTAMPTZ,
  priority         VARCHAR(20) DEFAULT 'normal',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);

-- ============================================================
-- 13. JOURNAL D'AUDIT
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID        REFERENCES establishments(id),
  user_id          UUID        REFERENCES users(id),
  action           VARCHAR(100) NOT NULL,
  entity_type      VARCHAR(50),
  entity_id        UUID,
  old_values       JSONB,
  new_values       JSONB,
  ip_address       INET,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user   ON audit_logs(user_id, created_at DESC);

-- ============================================================
-- 14. TRIGGER updated_at (idempotent)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Établissements
DROP TRIGGER IF EXISTS tr_establishments_updated ON establishments;
CREATE TRIGGER tr_establishments_updated
  BEFORE UPDATE ON establishments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Utilisateurs
DROP TRIGGER IF EXISTS tr_users_updated ON users;
CREATE TRIGGER tr_users_updated
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Plannings
DROP TRIGGER IF EXISTS tr_schedules_updated ON schedules;
CREATE TRIGGER tr_schedules_updated
  BEFORE UPDATE ON schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Gardes
DROP TRIGGER IF EXISTS tr_shifts_updated ON shifts;
CREATE TRIGGER tr_shifts_updated
  BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Absences
DROP TRIGGER IF EXISTS tr_absences_updated ON absences;
CREATE TRIGGER tr_absences_updated
  BEFORE UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Remplacements
DROP TRIGGER IF EXISTS tr_replacements_updated ON replacements;
CREATE TRIGGER tr_replacements_updated
  BEFORE UPDATE ON replacements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 15. VUES (drop + recréation propre pour éviter conflits colonnes)
-- ============================================================

DROP VIEW IF EXISTS v_today_shifts CASCADE;
CREATE VIEW v_today_shifts AS
SELECT
  s.id,
  s.shift_date,
  s.status,
  s.notes,
  s.is_extra,
  st.name             AS shift_type_name,
  st.name_ar          AS shift_type_name_ar,
  st.start_time,
  st.end_time,
  st.duration_hours,
  st.color            AS shift_color,
  u.id                AS user_id,
  u.first_name,
  u.last_name,
  u.first_name_ar,
  u.last_name_ar,
  u.speciality,
  u.grade,
  u.is_on_leave,
  d.id                AS department_id,
  d.name              AS department_name,
  d.name_ar           AS department_name_ar,
  e.id                AS establishment_id,
  e.name              AS establishment_name,
  sch.id              AS schedule_id,
  sch.name            AS schedule_name
FROM shifts s
JOIN users u          ON s.user_id         = u.id
JOIN departments d    ON s.department_id   = d.id
JOIN establishments e ON s.establishment_id = e.id
JOIN shift_types st   ON s.shift_type_id   = st.id
JOIN schedules sch    ON s.schedule_id     = sch.id;

DROP VIEW IF EXISTS v_user_shift_stats CASCADE;
CREATE VIEW v_user_shift_stats AS
SELECT
  u.id                AS user_id,
  u.establishment_id,
  u.first_name,
  u.last_name,
  u.speciality,
  u.grade,
  COUNT(s.id) FILTER (WHERE s.status != 'cancelled')                                       AS total_shifts,
  COUNT(s.id) FILTER (WHERE s.status = 'absent')                                           AS absent_shifts,
  COUNT(s.id) FILTER (WHERE s.status = 'replaced')                                         AS replaced_shifts,
  COUNT(s.id) FILTER (WHERE s.status = 'completed')                                        AS completed_shifts,
  COALESCE(SUM(st.duration_hours) FILTER (WHERE s.status IN ('completed','confirmed','planned')), 0) AS total_hours,
  ROUND(
    COUNT(s.id) FILTER (WHERE s.status = 'absent')::numeric /
    NULLIF(COUNT(s.id) FILTER (WHERE s.status != 'cancelled'), 0) * 100, 2
  ) AS absence_rate
FROM users u
LEFT JOIN shifts s       ON u.id = s.user_id
LEFT JOIN shift_types st ON s.shift_type_id = st.id
WHERE u.is_active = TRUE
GROUP BY u.id, u.establishment_id, u.first_name, u.last_name, u.speciality, u.grade;
