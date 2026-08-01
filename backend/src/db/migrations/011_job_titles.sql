-- ============================================================
-- Migration 011 — Titres de poste personnalisables (idempotent)
-- Separee des roles systeme (acces plateforme)
-- job_titles = etiquettes metier sans droits d'acces
-- ============================================================

CREATE TABLE IF NOT EXISTS job_titles (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  establishment_id UUID         REFERENCES establishments(id) ON DELETE CASCADE,
  name             VARCHAR(200) NOT NULL,
  name_ar          VARCHAR(200),
  category         VARCHAR(50)  DEFAULT 'medical',
  is_system        BOOLEAN      DEFAULT FALSE,
  is_active        BOOLEAN      DEFAULT TRUE,
  sort_order       INTEGER      DEFAULT 0,
  created_at       TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (establishment_id, name)
);

-- Colonne job_title_id sur les utilisateurs
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_title_id UUID REFERENCES job_titles(id) ON DELETE SET NULL;

-- Index
CREATE INDEX IF NOT EXISTS idx_job_titles_establishment ON job_titles(establishment_id);
CREATE INDEX IF NOT EXISTS idx_job_titles_name_trgm ON job_titles USING gin (name gin_trgm_ops);

-- ============================================================
-- Procedure seed (idempotente - ON CONFLICT DO NOTHING)
-- ============================================================
CREATE OR REPLACE FUNCTION seed_job_titles_for_establishment(p_eid UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO job_titles (establishment_id, category, name, is_system, sort_order) VALUES
    -- MEDICAL GENERAL
    (p_eid,'medical','Medecin Generaliste',TRUE,1),
    (p_eid,'medical','Medecin Specialiste',TRUE,2),
    (p_eid,'medical','Medecin Interne',TRUE,3),
    (p_eid,'medical','Medecin Resident',TRUE,4),
    (p_eid,'medical','Medecin Chef',TRUE,5),
    -- CARDIO / PNEUMO / NEURO
    (p_eid,'medical','Cardiologie',TRUE,10),
    (p_eid,'medical','Pneumologie',TRUE,11),
    (p_eid,'medical','Neurologie',TRUE,12),
    (p_eid,'medical','Nephrologie',TRUE,13),
    (p_eid,'medical','Nephrologie-Urologie',TRUE,14),
    (p_eid,'medical','Gastro-Enterologie',TRUE,15),
    (p_eid,'medical','Hepato-Gastro-Enterologie',TRUE,16),
    (p_eid,'medical','Endocrinologie',TRUE,17),
    (p_eid,'medical','Rhumatologie',TRUE,18),
    (p_eid,'medical','Infectiologie',TRUE,19),
    (p_eid,'medical','Dermatologie',TRUE,20),
    (p_eid,'medical','Oncologie',TRUE,21),
    (p_eid,'medical','Hematologie',TRUE,22),
    (p_eid,'medical','Psychiatrie',TRUE,23),
    (p_eid,'medical','Pediatrie',TRUE,24),
    (p_eid,'medical','Neonatologie',TRUE,25),
    (p_eid,'medical','Geriatrie',TRUE,26),
    (p_eid,'medical','Medecine du Travail',TRUE,27),
    (p_eid,'medical','Medecine Legale',TRUE,28),
    (p_eid,'medical','Medecine Urgence',TRUE,29),
    -- ANESTHESIE / REANIMATION
    (p_eid,'medical','Anesthesiste-Reanimateur',TRUE,30),
    (p_eid,'medical','Reanimation Medicale',TRUE,31),
    (p_eid,'medical','Reanimation Chirurgicale',TRUE,32),
    -- CHIRURGIE
    (p_eid,'surgical','Chirurgie Generale',TRUE,40),
    (p_eid,'surgical','Chirurgie Pediatrique',TRUE,41),
    (p_eid,'surgical','Chirurgie Cardiovasculaire',TRUE,42),
    (p_eid,'surgical','Chirurgie Thoracique',TRUE,43),
    (p_eid,'surgical','Chirurgie Orthopedique',TRUE,44),
    (p_eid,'surgical','Neurochirurgie',TRUE,45),
    (p_eid,'surgical','Urologie',TRUE,46),
    (p_eid,'surgical','Chirurgie Maxillo-Faciale',TRUE,47),
    (p_eid,'surgical','Chirurgie Plastique',TRUE,48),
    (p_eid,'surgical','Chirurgie Digestive',TRUE,49),
    (p_eid,'surgical','Gynecologie-Obstetrique',TRUE,50),
    -- ORL / OPHTALMO / STOMATOLOGIE
    (p_eid,'medical','ORL',TRUE,55),
    (p_eid,'medical','Ophtalmologie',TRUE,56),
    (p_eid,'medical','Stomatologie',TRUE,57),
    -- IMAGERIE / LABO
    (p_eid,'technical','Radiologie-Imagerie Medicale',TRUE,60),
    (p_eid,'technical','Medecine Nucleaire',TRUE,61),
    (p_eid,'technical','Biologie Medicale',TRUE,62),
    (p_eid,'technical','Biologie Clinique',TRUE,63),
    (p_eid,'technical','Anatomie Pathologique',TRUE,64),
    -- PHARMACIE
    (p_eid,'medical','Pharmacien',TRUE,70),
    (p_eid,'medical','Pharmacien Biologiste',TRUE,71),
    (p_eid,'medical','Pharmacien Hospitalier',TRUE,72),
    (p_eid,'technical','Preparateur en Pharmacie',TRUE,73),
    -- PARAMEDICAL / SOINS
    (p_eid,'nursing','Infirmier General',TRUE,80),
    (p_eid,'nursing','Infirmier Specialise',TRUE,81),
    (p_eid,'nursing','Infirmier Chef',TRUE,82),
    (p_eid,'nursing','Sage-Femme',TRUE,83),
    (p_eid,'nursing','Aide-Soignant',TRUE,84),
    (p_eid,'nursing','Technicien de Soins',TRUE,85),
    (p_eid,'nursing','Technicien de Laboratoire',TRUE,86),
    (p_eid,'nursing','Technicien de Radiologie',TRUE,87),
    (p_eid,'nursing','Technicien de Pharmacie',TRUE,88),
    (p_eid,'nursing','Kinesitherapeute',TRUE,89),
    (p_eid,'nursing','Ergotherapeute',TRUE,90),
    (p_eid,'nursing','Orthophoniste',TRUE,91),
    (p_eid,'nursing','Psychologue Clinicien',TRUE,92),
    -- ADMINISTRATIF
    (p_eid,'admin','Directeur',TRUE,100),
    (p_eid,'admin','Directeur Adjoint',TRUE,101),
    (p_eid,'admin','Administrateur Hospitalier',TRUE,102),
    (p_eid,'admin','Secretaire Medical',TRUE,103),
    (p_eid,'admin','Agent Administratif',TRUE,104),
    (p_eid,'admin','Responsable Ressources Humaines',TRUE,105),
    (p_eid,'admin','Comptable',TRUE,106),
    (p_eid,'admin','Informaticien',TRUE,107),
    (p_eid,'admin','Recette / Caisse',TRUE,108),
    (p_eid,'admin','Gestionnaire de Stock',TRUE,109),
    -- TECHNIQUE / LOGISTIQUE
    (p_eid,'technical','Ambulancier',TRUE,120),
    (p_eid,'technical','Conducteur Ambulance',TRUE,121),
    (p_eid,'technical','Agent Securite / Gardiennage',TRUE,122),
    (p_eid,'technical','Technicien Biomedical',TRUE,123),
    (p_eid,'technical','Technicien de Maintenance',TRUE,124),
    (p_eid,'technical','Technicien Hygiene Hospitaliere',TRUE,125),
    (p_eid,'technical','Agent de Nettoyage',TRUE,126),
    (p_eid,'technical','Cuisinier / Dieteticien',TRUE,127),
    (p_eid,'technical','Brancardier',TRUE,128)
  ON CONFLICT (establishment_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Seeder pour tous les etablissements existants
DO $$
DECLARE
  eid UUID;
BEGIN
  FOR eid IN SELECT id FROM establishments WHERE is_active = TRUE
  LOOP
    PERFORM seed_job_titles_for_establishment(eid);
  END LOOP;
END;
$$;
