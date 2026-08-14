-- Regroupe toutes les fonctions métier sous les trois types de personnel.
-- Les rôles techniques d'autorisation restent inchangés pour ne pas casser
-- les permissions et les historiques existants.
UPDATE job_titles
SET category = CASE
  WHEN category IN ('medical', 'paramedical') THEN 'medical'
  WHEN category = 'administrative' THEN 'administrative'
  ELSE 'auxiliary'
END;

UPDATE job_titles
SET category_label = CASE category
  WHEN 'medical' THEN 'Personnel médical'
  WHEN 'administrative' THEN 'Personnel administratif'
  ELSE 'Personnel auxiliaire'
END;

INSERT INTO job_titles (establishment_id, category, category_label, name, is_system, sort_order)
SELECT e.id, v.category, v.label, v.name, TRUE, v.sort_order
FROM establishments e
CROSS JOIN (VALUES
  ('medical','Personnel médical','Médecin généraliste',1),
  ('medical','Personnel médical','Médecin spécialiste',2),
  ('medical','Personnel médical','Médecin interne',3),
  ('medical','Personnel médical','Médecin résident',4),
  ('medical','Personnel médical','Infirmier',80),
  ('medical','Personnel médical','Infirmier spécialisé',81),
  ('medical','Personnel médical','Infirmier chef',82),
  ('medical','Personnel médical','Sage-femme',83),
  ('medical','Personnel médical','Aide-soignant',84),
  ('medical','Personnel médical','Pharmacien',85),
  ('administrative','Personnel administratif','Surveillant général',100),
  ('administrative','Personnel administratif','Surveillant de service',101),
  ('administrative','Personnel administratif','Secrétaire',102),
  ('administrative','Personnel administratif','Agent d''accueil',103),
  ('administrative','Personnel administratif','Informaticien',104),
  ('administrative','Personnel administratif','Responsable ressources humaines',105),
  ('administrative','Personnel administratif','Comptable',106),
  ('administrative','Personnel administratif','Caissier',107),
  ('administrative','Personnel administratif','Gestionnaire de stock',108),
  ('auxiliary','Personnel auxiliaire','Ambulancier',120),
  ('auxiliary','Personnel auxiliaire','Concierge',121),
  ('auxiliary','Personnel auxiliaire','Chauffeur',122),
  ('auxiliary','Personnel auxiliaire','Brancardier',123),
  ('auxiliary','Personnel auxiliaire','Agent de sécurité',124),
  ('auxiliary','Personnel auxiliaire','Agent de nettoyage',125),
  ('auxiliary','Personnel auxiliaire','Agent de restauration',126),
  ('auxiliary','Personnel auxiliaire','Technicien de maintenance',127)
) AS v(category, label, name, sort_order)
ON CONFLICT (establishment_id, name) DO UPDATE
SET category = EXCLUDED.category, category_label = EXCLUDED.category_label;
