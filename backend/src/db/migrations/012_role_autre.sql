-- ============================================================
-- Migration 012 — Role "Autre" (personnel non classe)
-- Role sans acces plateforme (can_login = FALSE)
-- Utilise avec le titre de poste libre (job_title_id)
-- ============================================================

-- Mettre a jour la fonction create_roles_for_establishment
-- pour inclure le role 'autre'
CREATE OR REPLACE FUNCTION create_roles_for_establishment(p_eid UUID)
RETURNS VOID AS $$
DECLARE
  role_defs RECORD;
BEGIN
  FOR role_defs IN
    SELECT * FROM (VALUES
      ('director',           'Directeur',              'المدير',              2),
      ('general_supervisor', 'Surveillant General',     'المراقب العام',       3),
      ('department_head',    'Chef de Service',         'رئيس المصلحة',        4),
      ('service_supervisor', 'Surveillant de Service',  'مراقب المصلحة',       5),
      ('senior_doctor',      'Medecin Senior',          'طبيب متخصص',          6),
      ('resident',           'Resident',                'طبيب مقيم',           7),
      ('autre',              'Autre Personnel',         'موظف اخر',            8)
    ) AS t(code, name, name_ar, level)
  LOOP
    INSERT INTO roles (establishment_id, code, name, name_ar, level, is_system)
    VALUES (p_eid, role_defs.code, role_defs.name, role_defs.name_ar, role_defs.level, TRUE)
    ON CONFLICT (establishment_id, code) DO NOTHING;
  END LOOP;

  -- DIRECTOR : acces complet (inchange)
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

  -- GENERAL_SUPERVISOR (inchange)
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

  -- DEPARTMENT_HEAD (inchange)
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

  -- SERVICE_SUPERVISOR (inchange)
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

  -- SENIOR_DOCTOR (sans acces login)
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

  -- RESIDENT (sans acces login)
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

  -- AUTRE : aucune permission (profil seul, sans acces plateforme)
  -- Pas d'INSERT role_permissions pour 'autre' — aucun acces

END;
$$ LANGUAGE plpgsql;

-- Ajouter le role 'autre' pour tous les etablissements existants
DO $$
DECLARE
  eid UUID;
BEGIN
  FOR eid IN SELECT id FROM establishments WHERE is_active = TRUE AND type != 'system'
  LOOP
    INSERT INTO roles (establishment_id, code, name, name_ar, level, is_system)
    VALUES (eid, 'autre', 'Autre Personnel', 'موظف اخر', 8, TRUE)
    ON CONFLICT (establishment_id, code) DO NOTHING;
  END LOOP;
END;
$$;
