-- ============================================================
-- GARDESANTE — SEED MINIMAL & IDEMPOTENT
-- Seul le Super Admin est créé par défaut.
-- Les établissements et utilisateurs sont créés via l'interface.
-- Mot de passe Super Admin : Admin@123
-- Hash bcrypt (cost=10) : $2b$10$4kUNvogP0X1XoyWKGFLLw.P4dApb.LBCUPtg.l46CbDDf2CR3db56
-- ============================================================

-- ============================================================
-- 1. ÉTABLISSEMENT SYSTÈME (requis pour rattacher le super_admin)
--    Cet établissement est "virtuel" — il n'apparaît pas dans
--    la liste des hôpitaux gérés.
-- ============================================================

INSERT INTO establishments (
  id, code, name, name_ar, type, is_active
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'SYSTEM',
  'GardeSante Système',
  'نظام جارد سانتي',
  'system',
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. RÔLE SUPER ADMIN (global, establishment_id NULL)
-- ============================================================

INSERT INTO roles (id, establishment_id, code, name, name_ar, level, is_system) VALUES
  ('aaaa0001-0000-0000-0000-000000000001', NULL, 'super_admin', 'Super Administrateur', 'المسؤول العام', 0, TRUE)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. PERMISSIONS GLOBALES
-- ============================================================

INSERT INTO permissions (code, module, action, description) VALUES
  ('establishments.read',    'establishments','read',    'Voir les établissements'),
  ('establishments.create',  'establishments','create',  'Créer un établissement'),
  ('establishments.update',  'establishments','update',  'Modifier un établissement'),
  ('establishments.delete',  'establishments','delete',  'Supprimer un établissement'),
  ('establishments.config',  'establishments','config',  'Configurer un établissement'),
  ('users.read',             'users','read',    'Voir les utilisateurs'),
  ('users.create',           'users','create',  'Créer un utilisateur'),
  ('users.update',           'users','update',  'Modifier un utilisateur'),
  ('users.delete',           'users','delete',  'Supprimer un utilisateur'),
  ('departments.read',       'departments','read',   'Voir les services'),
  ('departments.create',     'departments','create', 'Créer un service'),
  ('departments.update',     'departments','update', 'Modifier un service'),
  ('departments.delete',     'departments','delete', 'Supprimer un service'),
  ('schedules.read',         'schedules','read',     'Voir les plannings'),
  ('schedules.create',       'schedules','create',   'Créer un planning'),
  ('schedules.update',       'schedules','update',   'Modifier un planning'),
  ('schedules.delete',       'schedules','delete',   'Supprimer un planning'),
  ('schedules.submit',       'schedules','submit',   'Soumettre un planning'),
  ('schedules.approve',      'schedules','approve',  'Approuver un planning'),
  ('schedules.reject',       'schedules','reject',   'Rejeter un planning'),
  ('schedules.generate',     'schedules','generate', 'Générer un planning'),
  ('shifts.read',            'shifts','read',    'Voir les gardes'),
  ('shifts.create',          'shifts','create',  'Créer une garde'),
  ('shifts.update',          'shifts','update',  'Modifier une garde'),
  ('shifts.delete',          'shifts','delete',  'Supprimer une garde'),
  ('shifts.confirm',         'shifts','confirm', 'Confirmer une présence'),
  ('absences.read',          'absences','read',   'Voir les absences'),
  ('absences.create',        'absences','create', 'Déclarer une absence'),
  ('absences.update',        'absences','update', 'Modifier une absence'),
  ('absences.approve',       'absences','approve','Valider une absence'),
  ('replacements.read',      'replacements','read',   'Voir les remplacements'),
  ('replacements.create',    'replacements','create', 'Demander un remplacement'),
  ('replacements.update',    'replacements','update', 'Modifier un remplacement'),
  ('replacements.approve',   'replacements','approve','Valider un remplacement'),
  ('stats.read',             'stats','read',   'Voir les statistiques'),
  ('stats.export',           'stats','export', 'Exporter les statistiques'),
  ('remarks.read',           'remarks','read',   'Voir les remarques'),
  ('remarks.create',         'remarks','create', 'Ajouter une remarque'),
  ('audit.read',             'audit','read',     'Voir le journal d''audit')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 4. SUPER ADMIN — toutes les permissions
-- ============================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'aaaa0001-0000-0000-0000-000000000001'::uuid, p.id FROM permissions p
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. SUPER ADMIN — compte unique
-- ============================================================

INSERT INTO users (
  id, establishment_id, role_id,
  matricule, first_name, last_name, first_name_ar, last_name_ar,
  email, password_hash,
  grade, can_login, is_active
) VALUES (
  'eeee0000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'aaaa0001-0000-0000-0000-000000000001',
  'SA-001', 'Super', 'Admin', 'المدير', 'العام',
  'admin@gardesante.dz',
  '$2b$10$4kUNvogP0X1XoyWKGFLLw.P4dApb.LBCUPtg.l46CbDDf2CR3db56',
  'Super Administrateur', TRUE, TRUE
) ON CONFLICT (id) DO UPDATE
  SET email        = EXCLUDED.email,
      password_hash= EXCLUDED.password_hash,
      is_active    = TRUE;

-- ============================================================
-- FIN DU SEED MINIMAL
-- Les établissements, directeurs et personnels
-- sont créés dynamiquement via l'interface Super Admin.
-- ============================================================
