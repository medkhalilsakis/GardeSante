-- ============================================================
-- Migration 006 — Hiérarchie stricte
-- 1. Ajouter type 'system' aux établissements
-- 2. Créer la fonction create_roles_for_establishment()
--    appelée par le backend à chaque création d'hôpital
-- ============================================================

-- Permettre le type 'system' pour l'établissement virtuel
DO $$
BEGIN
  -- Élargir la contrainte si elle existe déjà en check
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'establishments' AND column_name = 'type'
  ) THEN
    -- Pas de contrainte CHECK sur ce champ dans le schema actuel, rien à faire
    NULL;
  END IF;
END$$;

-- S'assurer que l'établissement SYSTEM existe (idempotent)
INSERT INTO establishments (id, code, name, name_ar, type, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'SYSTEM', 'GardeSante Système', 'نظام جارد سانتي', 'system', TRUE
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Fonction : créer les rôles standard pour un établissement
-- Appelée par le backend lors de POST /api/establishments
-- ============================================================
CREATE OR REPLACE FUNCTION create_roles_for_establishment(p_eid UUID)
RETURNS VOID AS $$
DECLARE
  role_defs RECORD;
BEGIN
  FOR role_defs IN
    SELECT * FROM (VALUES
      ('director',           'Directeur',           'المدير',            2),
      ('general_supervisor', 'Surveillant Général',  'المراقب العام',     3),
      ('department_head',    'Chef de Service',      'رئيس المصلحة',     4),
      ('service_supervisor', 'Surveillant de Service','مراقب المصلحة',   5),
      ('senior_doctor',      'Médecin Senior',       'طبيب متخصص',       6),
      ('resident',           'Résident',             'طبيب مقيم',         7)
    ) AS t(code, name, name_ar, level)
  LOOP
    INSERT INTO roles (establishment_id, code, name, name_ar, level, is_system)
    VALUES (p_eid, role_defs.code, role_defs.name, role_defs.name_ar, role_defs.level, TRUE)
    ON CONFLICT (establishment_id, code) DO NOTHING;
  END LOOP;

  -- Attribuer les permissions aux nouveaux rôles
  -- DIRECTOR : tout sauf establishments.create/delete
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.establishment_id = p_eid
    AND r.code = 'director'
    AND p.code IN (
      'establishments.read','establishments.config',
      'users.read','users.create','users.update','users.delete',
      'departments.read','departments.create','departments.update','departments.delete',
      'schedules.read','schedules.create','schedules.update','schedules.delete',
      'schedules.submit','schedules.approve','schedules.reject','schedules.generate',
      'shifts.read','shifts.create','shifts.update','shifts.delete','shifts.confirm',
      'absences.read','absences.create','absences.update','absences.approve',
      'replacements.read','replacements.create','replacements.update','replacements.approve',
      'stats.read','stats.export','remarks.read','remarks.create','audit.read'
    )
  ON CONFLICT DO NOTHING;

  -- GENERAL_SUPERVISOR
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.establishment_id = p_eid
    AND r.code = 'general_supervisor'
    AND p.code IN (
      'establishments.read','users.read','departments.read',
      'schedules.read','schedules.approve','schedules.reject',
      'shifts.read','shifts.create','shifts.update','shifts.confirm',
      'absences.read','absences.approve',
      'replacements.read','replacements.create','replacements.update','replacements.approve',
      'stats.read','stats.export','remarks.read','remarks.create'
    )
  ON CONFLICT DO NOTHING;

  -- DEPARTMENT_HEAD
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.establishment_id = p_eid
    AND r.code = 'department_head'
    AND p.code IN (
      'users.read','departments.read','departments.update',
      'schedules.read','schedules.create','schedules.update','schedules.submit','schedules.generate',
      'shifts.read','shifts.create','shifts.update','shifts.delete','shifts.confirm',
      'absences.read','absences.create','absences.approve',
      'replacements.read','replacements.create','replacements.update','replacements.approve',
      'stats.read','remarks.read','remarks.create'
    )
  ON CONFLICT DO NOTHING;

  -- SERVICE_SUPERVISOR
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.establishment_id = p_eid
    AND r.code = 'service_supervisor'
    AND p.code IN (
      'users.read','departments.read',
      'schedules.read','schedules.create','schedules.update','schedules.submit',
      'shifts.read','shifts.create','shifts.update','shifts.confirm',
      'absences.read','absences.create','absences.approve',
      'replacements.read','replacements.create','replacements.update',
      'stats.read','remarks.read','remarks.create'
    )
  ON CONFLICT DO NOTHING;

  -- SENIOR_DOCTOR (sans accès login)
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.establishment_id = p_eid
    AND r.code = 'senior_doctor'
    AND p.code IN (
      'departments.read','schedules.read',
      'shifts.read','shifts.confirm',
      'absences.read','absences.create',
      'replacements.read','replacements.create',
      'stats.read','remarks.read','remarks.create'
    )
  ON CONFLICT DO NOTHING;

  -- RESIDENT (sans accès login)
  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id
  FROM roles r, permissions p
  WHERE r.establishment_id = p_eid
    AND r.code = 'resident'
    AND p.code IN (
      'departments.read','schedules.read',
      'shifts.read','shifts.confirm',
      'absences.read','absences.create',
      'replacements.read','stats.read'
    )
  ON CONFLICT DO NOTHING;

END;
$$ LANGUAGE plpgsql;
