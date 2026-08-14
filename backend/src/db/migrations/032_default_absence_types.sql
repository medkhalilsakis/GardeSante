-- Types standards pour tous les établissements, y compris ceux créés après 019.
INSERT INTO absence_types
  (establishment_id, code, name, name_ar, requires_justification, is_paid, is_leave, color, is_active)
SELECT e.id, defaults.code, defaults.name, defaults.name_ar,
       defaults.requires_justification, defaults.is_paid, defaults.is_leave,
       defaults.color, TRUE
FROM establishments e
CROSS JOIN (VALUES
  ('conge_annuel', 'Congé annuel', 'إجازة سنوية', FALSE, TRUE, TRUE, '#10B981'),
  ('conge_maladie', 'Congé maladie', 'إجازة مرضية', TRUE, TRUE, TRUE, '#F59E0B'),
  ('conge_maternite', 'Congé maternité', 'إجازة أمومة', TRUE, TRUE, TRUE, '#EC4899'),
  ('conge_exceptionnel', 'Congé exceptionnel', 'إجازة استثنائية', TRUE, FALSE, TRUE, '#8B5CF6'),
  ('conge_formation', 'Congé formation', 'إجازة تكوين', FALSE, TRUE, TRUE, '#3B82F6'),
  ('absence_injustifiee', 'Absence', 'غياب', FALSE, FALSE, FALSE, '#EF4444'),
  ('retard', 'Retard', 'تأخر', FALSE, FALSE, FALSE, '#F97316')
) AS defaults(code, name, name_ar, requires_justification, is_paid, is_leave, color)
ON CONFLICT (establishment_id, code) DO UPDATE
SET name = EXCLUDED.name,
    name_ar = EXCLUDED.name_ar,
    requires_justification = EXCLUDED.requires_justification,
    is_paid = EXCLUDED.is_paid,
    is_leave = EXCLUDED.is_leave,
    color = EXCLUDED.color,
    is_active = TRUE;
