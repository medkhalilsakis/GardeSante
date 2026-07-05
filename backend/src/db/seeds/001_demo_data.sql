-- ============================================================
-- GARDESANTE - DONNÉES DE DÉMONSTRATION
-- 2 Hôpitaux + 1 Institut, utilisateurs, services, configs
-- Mot de passe pour tous les comptes: Admin@123
-- Hash bcrypt: $2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e
-- ============================================================

-- ============================================================
-- ÉTABLISSEMENTS
-- ============================================================

INSERT INTO establishments (id, code, name, name_ar, type, address, city, phone, email) VALUES
(
  '11111111-1111-1111-1111-111111111111',
  'HCA-001',
  'Hôpital Central d''Alger',
  'المستشفى المركزي للجزائر',
  'hospital',
  '1 Rue des Martyrs, Alger Centre',
  'Alger',
  '+213 21 23 45 67',
  'contact@hca.dz'
),
(
  '22222222-2222-2222-2222-222222222222',
  'CHU-ORA',
  'CHU d''Oran',
  'جامعي للجراحة التعليمي وهران',
  'hospital',
  'BP 4166 Ibn Rochd, Oran',
  'Oran',
  '+213 41 29 53 80',
  'contact@chu-oran.dz'
),
(
  '33333333-3333-3333-3333-333333333333',
  'IHU-CAR',
  'Institut de Cardiologie',
  'معهد أمراض القلب',
  'institute',
  'Rue Kaddour Rahim, Alger',
  'Alger',
  '+213 21 56 78 90',
  'contact@ihucardio.dz'
);

-- ============================================================
-- CONFIGURATION DES ÉTABLISSEMENTS
-- ============================================================

-- HCA - Hôpital Central
INSERT INTO establishment_configs (establishment_id, config_key, config_value, config_type, description) VALUES
('11111111-1111-1111-1111-111111111111', 'planning_period', 'monthly', 'string', 'Période de planification'),
('11111111-1111-1111-1111-111111111111', 'max_shifts_per_month', '8', 'integer', 'Nombre max de gardes par mois'),
('11111111-1111-1111-1111-111111111111', 'min_rest_hours', '24', 'integer', 'Repos minimum entre 2 gardes (heures)'),
('11111111-1111-1111-1111-111111111111', 'auto_notification', 'true', 'boolean', 'Notifications automatiques'),
('11111111-1111-1111-1111-111111111111', 'allow_self_replacement', 'false', 'boolean', 'Auto-remplacement autorisé'),
('11111111-1111-1111-1111-111111111111', 'workflow_type', 'standard', 'string', 'Type de workflow validation');

-- CHU Oran
INSERT INTO establishment_configs (establishment_id, config_key, config_value, config_type, description) VALUES
('22222222-2222-2222-2222-222222222222', 'planning_period', 'weekly', 'string', 'Période de planification'),
('22222222-2222-2222-2222-222222222222', 'max_shifts_per_month', '10', 'integer', 'Nombre max de gardes par mois'),
('22222222-2222-2222-2222-222222222222', 'min_rest_hours', '24', 'integer', 'Repos minimum entre 2 gardes (heures)'),
('22222222-2222-2222-2222-222222222222', 'auto_notification', 'true', 'boolean', 'Notifications automatiques'),
('22222222-2222-2222-2222-222222222222', 'workflow_type', 'extended', 'string', 'Type de workflow validation');

-- IHU Cardiologie
INSERT INTO establishment_configs (establishment_id, config_key, config_value, config_type, description) VALUES
('33333333-3333-3333-3333-333333333333', 'planning_period', 'semestrial', 'string', 'Période de planification'),
('33333333-3333-3333-3333-333333333333', 'max_shifts_per_month', '6', 'integer', 'Nombre max de gardes par mois'),
('33333333-3333-3333-3333-333333333333', 'min_rest_hours', '48', 'integer', 'Repos minimum entre 2 gardes (heures)'),
('33333333-3333-3333-3333-333333333333', 'workflow_type', 'simple', 'string', 'Type de workflow validation');

-- ============================================================
-- RÔLES SYSTÈMES (GLOBAUX)
-- ============================================================

INSERT INTO roles (id, establishment_id, code, name, name_ar, level, is_system) VALUES
('aaaa0001-0000-0000-0000-000000000001', NULL, 'super_admin', 'Super Administrateur', 'المسؤول العام', 0, TRUE);

-- Rôles pour HCA
INSERT INTO roles (id, establishment_id, code, name, name_ar, level, is_system) VALUES
('aaaa0001-1111-1111-1111-000000000001', '11111111-1111-1111-1111-111111111111', 'hospital_admin', 'Administrateur', 'مدير المستشفى', 1, TRUE),
('aaaa0001-1111-1111-1111-000000000002', '11111111-1111-1111-1111-111111111111', 'director', 'Directeur', 'المدير', 2, TRUE),
('aaaa0001-1111-1111-1111-000000000003', '11111111-1111-1111-1111-111111111111', 'general_supervisor', 'Surveillant Général', 'المراقب العام', 3, TRUE),
('aaaa0001-1111-1111-1111-000000000004', '11111111-1111-1111-1111-111111111111', 'department_head', 'Chef de Service', 'رئيس المصلحة', 4, TRUE),
('aaaa0001-1111-1111-1111-000000000005', '11111111-1111-1111-1111-111111111111', 'service_supervisor', 'Surveillant de Service', 'مراقب المصلحة', 5, TRUE),
('aaaa0001-1111-1111-1111-000000000006', '11111111-1111-1111-1111-111111111111', 'senior_doctor', 'Médecin Senior', 'طبيب متخصص', 6, TRUE),
('aaaa0001-1111-1111-1111-000000000007', '11111111-1111-1111-1111-111111111111', 'resident', 'Résident', 'طبيب مقيم', 7, TRUE),
('aaaa0001-1111-1111-1111-000000000008', '11111111-1111-1111-1111-111111111111', 'observer', 'Observateur', 'مراقب', 8, TRUE);

-- Rôles pour CHU Oran
INSERT INTO roles (id, establishment_id, code, name, name_ar, level, is_system) VALUES
('aaaa0002-2222-2222-2222-000000000001', '22222222-2222-2222-2222-222222222222', 'hospital_admin', 'Administrateur', 'مدير المستشفى', 1, TRUE),
('aaaa0002-2222-2222-2222-000000000002', '22222222-2222-2222-2222-222222222222', 'director', 'Directeur', 'المدير', 2, TRUE),
('aaaa0002-2222-2222-2222-000000000003', '22222222-2222-2222-2222-222222222222', 'general_supervisor', 'Surveillant Général', 'المراقب العام', 3, TRUE),
('aaaa0002-2222-2222-2222-000000000004', '22222222-2222-2222-2222-222222222222', 'department_head', 'Chef de Service', 'رئيس المصلحة', 4, TRUE),
('aaaa0002-2222-2222-2222-000000000005', '22222222-2222-2222-2222-222222222222', 'service_supervisor', 'Surveillant de Service', 'مراقب المصلحة', 5, TRUE),
('aaaa0002-2222-2222-2222-000000000006', '22222222-2222-2222-2222-222222222222', 'senior_doctor', 'Médecin Senior', 'طبيب متخصص', 6, TRUE),
('aaaa0002-2222-2222-2222-000000000007', '22222222-2222-2222-2222-222222222222', 'resident', 'Résident', 'طبيب مقيم', 7, TRUE);

-- Rôles pour IHU
INSERT INTO roles (id, establishment_id, code, name, name_ar, level, is_system) VALUES
('aaaa0003-3333-3333-3333-000000000001', '33333333-3333-3333-3333-333333333333', 'hospital_admin', 'Administrateur', 'مدير المعهد', 1, TRUE),
('aaaa0003-3333-3333-3333-000000000002', '33333333-3333-3333-3333-333333333333', 'director', 'Directeur', 'المدير', 2, TRUE),
('aaaa0003-3333-3333-3333-000000000003', '33333333-3333-3333-3333-333333333333', 'general_supervisor', 'Surveillant Général', 'المراقب العام', 3, TRUE),
('aaaa0003-3333-3333-3333-000000000004', '33333333-3333-3333-3333-333333333333', 'department_head', 'Chef de Service', 'رئيس المصلحة', 4, TRUE),
('aaaa0003-3333-3333-3333-000000000005', '33333333-3333-3333-3333-333333333333', 'service_supervisor', 'Surveillant de Service', 'مراقب المصلحة', 5, TRUE),
('aaaa0003-3333-3333-3333-000000000006', '33333333-3333-3333-3333-333333333333', 'senior_doctor', 'Médecin Senior', 'طبيب متخصص', 6, TRUE),
('aaaa0003-3333-3333-3333-000000000007', '33333333-3333-3333-3333-333333333333', 'resident', 'Résident', 'طبيب مقيم', 7, TRUE);

-- ============================================================
-- PERMISSIONS
-- ============================================================

INSERT INTO permissions (code, module, action, description) VALUES
-- Établissements
('establishments.read', 'establishments', 'read', 'Voir les établissements'),
('establishments.create', 'establishments', 'create', 'Créer un établissement'),
('establishments.update', 'establishments', 'update', 'Modifier un établissement'),
('establishments.delete', 'establishments', 'delete', 'Supprimer un établissement'),
('establishments.config', 'establishments', 'config', 'Configurer un établissement'),
-- Utilisateurs
('users.read', 'users', 'read', 'Voir les utilisateurs'),
('users.create', 'users', 'create', 'Créer un utilisateur'),
('users.update', 'users', 'update', 'Modifier un utilisateur'),
('users.delete', 'users', 'delete', 'Supprimer un utilisateur'),
-- Services
('departments.read', 'departments', 'read', 'Voir les services'),
('departments.create', 'departments', 'create', 'Créer un service'),
('departments.update', 'departments', 'update', 'Modifier un service'),
-- Plannings
('schedules.read', 'schedules', 'read', 'Voir les plannings'),
('schedules.create', 'schedules', 'create', 'Créer un planning'),
('schedules.update', 'schedules', 'update', 'Modifier un planning'),
('schedules.delete', 'schedules', 'delete', 'Supprimer un planning'),
('schedules.submit', 'schedules', 'submit', 'Soumettre un planning pour validation'),
('schedules.approve', 'schedules', 'approve', 'Approuver un planning'),
('schedules.reject', 'schedules', 'reject', 'Rejeter un planning'),
('schedules.generate', 'schedules', 'generate', 'Générer un planning automatiquement'),
-- Gardes
('shifts.read', 'shifts', 'read', 'Voir les gardes'),
('shifts.create', 'shifts', 'create', 'Créer une garde'),
('shifts.update', 'shifts', 'update', 'Modifier une garde'),
('shifts.delete', 'shifts', 'delete', 'Supprimer une garde'),
('shifts.confirm', 'shifts', 'confirm', 'Confirmer une présence'),
-- Absences
('absences.read', 'absences', 'read', 'Voir les absences'),
('absences.create', 'absences', 'create', 'Déclarer une absence'),
('absences.update', 'absences', 'update', 'Modifier une absence'),
('absences.approve', 'absences', 'approve', 'Valider une absence'),
-- Remplacements
('replacements.read', 'replacements', 'read', 'Voir les remplacements'),
('replacements.create', 'replacements', 'create', 'Demander un remplacement'),
('replacements.update', 'replacements', 'update', 'Modifier un remplacement'),
('replacements.approve', 'replacements', 'approve', 'Valider un remplacement'),
-- Statistiques
('stats.read', 'stats', 'read', 'Voir les statistiques'),
('stats.export', 'stats', 'export', 'Exporter les statistiques'),
-- Remarques
('remarks.read', 'remarks', 'read', 'Voir les remarques'),
('remarks.create', 'remarks', 'create', 'Ajouter une remarque'),
-- Audit
('audit.read', 'audit', 'read', 'Voir le journal d''audit');

-- ============================================================
-- SERVICES (DÉPARTEMENTS) - HCA
-- ============================================================

INSERT INTO departments (id, establishment_id, code, name, name_ar, floor) VALUES
('dddd0001-1111-0001-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'URG', 'Urgences', 'المستعجلات', 'RDC'),
('dddd0001-1111-0001-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'CHI', 'Chirurgie Générale', 'الجراحة العامة', '1er'),
('dddd0001-1111-0001-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'MED', 'Médecine Interne', 'الطب الداخلي', '2e'),
('dddd0001-1111-0001-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'PED', 'Pédiatrie', 'طب الأطفال', '3e'),
('dddd0001-1111-0001-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'REA', 'Réanimation', 'الإنعاش', 'RDC'),
('dddd0001-1111-0001-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'GYNEC', 'Gynécologie', 'أمراض النساء', '4e');

-- Services CHU Oran
INSERT INTO departments (id, establishment_id, code, name, name_ar, floor) VALUES
('dddd0002-2222-0002-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'URG', 'Urgences', 'المستعجلات', 'RDC'),
('dddd0002-2222-0002-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'CARDIO', 'Cardiologie', 'أمراض القلب', '2e'),
('dddd0002-2222-0002-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'NEURO', 'Neurologie', 'طب الأعصاب', '3e');

-- Services IHU
INSERT INTO departments (id, establishment_id, code, name, name_ar, floor) VALUES
('dddd0003-3333-0003-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'CATH', 'Cathétérisme', 'قسطرة القلب', '1er'),
('dddd0003-3333-0003-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'CHIR-CARD', 'Chirurgie Cardiaque', 'الجراحة القلبية', '2e'),
('dddd0003-3333-0003-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'USIC', 'USIC', 'وحدة العناية بأمراض القلب', 'RDC');

-- ============================================================
-- TYPES DE GARDE
-- ============================================================

INSERT INTO shift_types (establishment_id, code, name, name_ar, start_time, end_time, duration_hours, is_overnight, color) VALUES
('11111111-1111-1111-1111-111111111111', 'G24', 'Garde 24h', 'حراسة 24 ساعة', '07:00', '07:00', 24, TRUE, '#3B82F6'),
('11111111-1111-1111-1111-111111111111', 'G12M', 'Garde 12h Matin', 'حراسة 12 ساعة صباح', '07:00', '19:00', 12, FALSE, '#10B981'),
('11111111-1111-1111-1111-111111111111', 'G12S', 'Garde 12h Soir', 'حراسة 12 ساعة مساء', '19:00', '07:00', 12, TRUE, '#8B5CF6'),
('11111111-1111-1111-1111-111111111111', 'G8', 'Garde 8h', 'حراسة 8 ساعات', '08:00', '16:00', 8, FALSE, '#F59E0B'),
('22222222-2222-2222-2222-222222222222', 'G24', 'Garde 24h', 'حراسة 24 ساعة', '08:00', '08:00', 24, TRUE, '#3B82F6'),
('22222222-2222-2222-2222-222222222222', 'G12', 'Garde 12h', 'حراسة 12 ساعة', '08:00', '20:00', 12, FALSE, '#10B981'),
('33333333-3333-3333-3333-333333333333', 'G24', 'Garde 24h', 'حراسة 24 ساعة', '07:30', '07:30', 24, TRUE, '#3B82F6'),
('33333333-3333-3333-3333-333333333333', 'ASTR', 'Astreinte', 'استعداد', '00:00', '23:59', 24, FALSE, '#EC4899');

-- ============================================================
-- TYPES D'ABSENCE
-- ============================================================

INSERT INTO absence_types (establishment_id, code, name, name_ar, requires_justification, is_paid, color) VALUES
('11111111-1111-1111-1111-111111111111', 'MALADIE', 'Maladie', 'مرض', TRUE, TRUE, '#EF4444'),
('11111111-1111-1111-1111-111111111111', 'CONGE', 'Congé', 'إجازة', FALSE, TRUE, '#3B82F6'),
('11111111-1111-1111-1111-111111111111', 'URGENCE', 'Urgence Familiale', 'طارئ عائلي', TRUE, FALSE, '#F59E0B'),
('11111111-1111-1111-1111-111111111111', 'FORMATION', 'Formation', 'تكوين', TRUE, TRUE, '#10B981'),
('11111111-1111-1111-1111-111111111111', 'INJUSTIFIE', 'Non Justifiée', 'غير مبرر', FALSE, FALSE, '#DC2626'),
('22222222-2222-2222-2222-222222222222', 'MALADIE', 'Maladie', 'مرض', TRUE, TRUE, '#EF4444'),
('22222222-2222-2222-2222-222222222222', 'CONGE', 'Congé', 'إجازة', FALSE, TRUE, '#3B82F6'),
('22222222-2222-2222-2222-222222222222', 'URGENCE', 'Urgence Familiale', 'طارئ عائلي', TRUE, FALSE, '#F59E0B'),
('33333333-3333-3333-3333-333333333333', 'MALADIE', 'Maladie', 'مرض', TRUE, TRUE, '#EF4444'),
('33333333-3333-3333-3333-333333333333', 'CONGE', 'Congé', 'إجازة', FALSE, TRUE, '#3B82F6');

-- ============================================================
-- UTILISATEURS (mot de passe: Admin@123)
-- ============================================================

-- Super Admin (global)
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0000-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-0000-0000-0000-000000000001',
  'SA-001',
  'Admin', 'Système', 'المدير', 'العام',
  'admin@gardesante.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  NULL, 'Super Administrateur'
);

-- HCA - Administrateur
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0001-1111-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000001',
  'HCA-ADM-001',
  'Karim', 'Bensalem', 'كريم', 'بن سالم',
  'admin@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  NULL, 'Administrateur'
);

-- HCA - Directeur
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0001-1111-0000-0000-000000000002',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000002',
  'HCA-DIR-001',
  'Mohammed', 'Brahimi', 'محمد', 'براهيمي',
  'directeur@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  NULL, 'Directeur Général'
);

-- HCA - Surveillant Général
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0001-1111-0000-0000-000000000003',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000003',
  'HCA-SG-001',
  'Fatima', 'Hadj', 'فاطمة', 'حاج',
  'surv.general@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  NULL, 'Surveillant Général'
);

-- HCA - Chef de Service Urgences
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0001-1111-0000-0000-000000000004',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000004',
  'HCA-CS-URG-001',
  'Djamel', 'Kaci', 'جمال', 'كاسي',
  'chef.urg@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  'Médecine d''Urgence', 'Professeur'
);

-- HCA - Chef de Service Chirurgie
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0001-1111-0000-0000-000000000005',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000004',
  'HCA-CS-CHI-001',
  'Nabil', 'Cherif', 'نبيل', 'شريف',
  'chef.chi@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  'Chirurgie Générale', 'Maître de Conférences'
);

-- HCA - Surveillant Urgences
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0001-1111-0000-0000-000000000006',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000005',
  'HCA-SS-URG-001',
  'Amina', 'Belkacem', 'أمينة', 'بلقاسم',
  'surv.urg@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  NULL, 'Infirmier Principal'
);

-- HCA - Médecins Urgences
INSERT INTO users (id, establishment_id, role_id, matricule, first_name, last_name, first_name_ar, last_name_ar, email, password_hash, speciality, grade) VALUES
(
  'uuuu0001-1111-0000-0000-000000000007',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000006',
  'HCA-MED-URG-001',
  'Sofiane', 'Aït Amar', 'سفيان', 'آيت عمار',
  'dr.sofiane@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  'Médecine d''Urgence', 'Spécialiste'
),
(
  'uuuu0001-1111-0000-0000-000000000008',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000006',
  'HCA-MED-URG-002',
  'Rania', 'Meziane', 'رانيا', 'مزيان',
  'dr.rania@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  'Médecine d''Urgence', 'Spécialiste'
),
(
  'uuuu0001-1111-0000-0000-000000000009',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000007',
  'HCA-RES-URG-001',
  'Lyes', 'Hamdi', 'ليث', 'حمدي',
  'res.lyes@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  'Médecine d''Urgence', 'Résident 3ème année'
),
(
  'uuuu0001-1111-0000-0000-000000000010',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000007',
  'HCA-RES-URG-002',
  'Sara', 'Boukhalfa', 'سارة', 'بوخلفة',
  'res.sara@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  'Médecine d''Urgence', 'Résidente 2ème année'
),
(
  'uuuu0001-1111-0000-0000-000000000011',
  '11111111-1111-1111-1111-111111111111',
  'aaaa0001-1111-1111-1111-000000000007',
  'HCA-RES-URG-003',
  'Mehdi', 'Ferhat', 'مهدي', 'فرحات',
  'res.mehdi@hca.dz',
  '$2b$10$rQZ9vKjX1mN8pL2wY5oXKuHs3kF7gM4nB6eT0qR1vW8yA9iU3xC5e',
  'Médecine d''Urgence', 'Résident 1ère année'
);

-- ============================================================
-- AFFECTATION AUX SERVICES
-- ============================================================

INSERT INTO user_departments (user_id, department_id, is_head, is_primary) VALUES
-- Chef Urgences HCA
('uuuu0001-1111-0000-0000-000000000004', 'dddd0001-1111-0001-0000-000000000001', TRUE, TRUE),
-- Chef Chirurgie HCA
('uuuu0001-1111-0000-0000-000000000005', 'dddd0001-1111-0001-0000-000000000002', TRUE, TRUE),
-- Surveillant Urgences
('uuuu0001-1111-0000-0000-000000000006', 'dddd0001-1111-0001-0000-000000000001', FALSE, TRUE),
-- Médecins Urgences
('uuuu0001-1111-0000-0000-000000000007', 'dddd0001-1111-0001-0000-000000000001', FALSE, TRUE),
('uuuu0001-1111-0000-0000-000000000008', 'dddd0001-1111-0001-0000-000000000001', FALSE, TRUE),
('uuuu0001-1111-0000-0000-000000000009', 'dddd0001-1111-0001-0000-000000000001', FALSE, TRUE),
('uuuu0001-1111-0000-0000-000000000010', 'dddd0001-1111-0001-0000-000000000001', FALSE, TRUE),
('uuuu0001-1111-0000-0000-000000000011', 'dddd0001-1111-0001-0000-000000000001', FALSE, TRUE);

-- ============================================================
-- WORKFLOW DE VALIDATION - HCA
-- ============================================================

INSERT INTO workflow_definitions (id, establishment_id, name, entity_type) VALUES
('wwww0001-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Validation Planning Standard', 'schedule'),
('wwww0001-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Validation Absence', 'absence');

INSERT INTO workflow_steps (workflow_id, step_order, role_code, step_name, step_name_ar, is_optional) VALUES
('wwww0001-1111-0000-0000-000000000001', 1, 'general_supervisor', 'Validation Surveillant Général', 'مراجعة المراقب العام', FALSE),
('wwww0001-1111-0000-0000-000000000001', 2, 'director', 'Approbation Directeur', 'موافقة المدير', FALSE),
('wwww0001-1111-0000-0000-000000000002', 1, 'department_head', 'Validation Chef de Service', 'مراجعة رئيس المصلحة', FALSE),
('wwww0001-1111-0000-0000-000000000002', 2, 'general_supervisor', 'Validation Surveillant Général', 'مراجعة المراقب العام', FALSE);
