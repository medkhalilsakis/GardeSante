const { query } = require('../../config/database');

const DEFAULT_ABSENCE_TYPES = [
  ['conge_annuel', 'Congé annuel', 'إجازة سنوية', false, true, true, '#10B981'],
  ['conge_maladie', 'Congé maladie', 'إجازة مرضية', true, true, true, '#F59E0B'],
  ['conge_maternite', 'Congé maternité', 'إجازة أمومة', true, true, true, '#EC4899'],
  ['conge_exceptionnel', 'Congé exceptionnel', 'إجازة استثنائية', true, false, true, '#8B5CF6'],
  ['conge_formation', 'Congé formation', 'إجازة تكوين', false, true, true, '#3B82F6'],
  // Le code historique reste stable pour ne casser aucune intégration. Le
  // libellé devient neutre : la qualification justifiée / non justifiée est
  // portée par `absences.is_justified`, choisie explicitement à l'appel.
  ['absence_injustifiee', 'Absence', 'غياب', false, false, false, '#EF4444'],
  ['retard', 'Retard', 'تأخر', false, false, false, '#F97316'],
];

const ensureDefaultAbsenceTypes = async (establishmentId, db = query) => {
  if (!establishmentId) return;

  const execute = typeof db === 'function' ? db : db.query.bind(db);
  const values = [];
  const rows = DEFAULT_ABSENCE_TYPES.map((type, index) => {
    const offset = index * 8;
    values.push(establishmentId, ...type);
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8})`;
  });

  await execute(
    `INSERT INTO absence_types
       (establishment_id, code, name, name_ar, requires_justification, is_paid, is_leave, color)
     VALUES ${rows.join(',')}
     ON CONFLICT (establishment_id, code) DO UPDATE
       SET name = EXCLUDED.name,
           name_ar = EXCLUDED.name_ar,
           requires_justification = EXCLUDED.requires_justification,
           is_paid = EXCLUDED.is_paid,
           is_leave = EXCLUDED.is_leave,
           color = EXCLUDED.color,
           is_active = TRUE`,
    values
  );
};

module.exports = { ensureDefaultAbsenceTypes };
