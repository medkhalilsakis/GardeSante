const PERSONNEL_CATEGORIES = [
  { code: 'medical', label: 'Personnel médical', requiresDepartment: true,
    examples: ['Médecin senior', 'Chef de service', 'Résident', 'Interne', 'Médecin généraliste', 'Médecin spécialiste', 'Pharmacien'] },
  { code: 'paramedical', label: 'Personnel paramédical', requiresDepartment: true,
    examples: ['Infirmier', 'Sage-femme', 'Kinésithérapeute', 'Aide-soignant', 'Technicien de laboratoire', 'Technicien de radiologie', 'Psychologue clinicien'] },
  { code: 'administrative', label: 'Personnel administratif', requiresDepartment: false,
    examples: ['RH', 'Comptable', 'Secrétaire', 'Agent administratif', 'Gestionnaire de stock', 'Informaticien'] },
  { code: 'technical_logistics', label: 'Personnel technique et logistique', requiresDepartment: false,
    examples: ['Ambulancier', 'Brancardier', 'Technicien biomédical', 'Maintenance', 'Hygiène', 'Sécurité', 'Restauration'] },
  { code: 'other', label: 'Autre personnel', requiresDepartment: false, examples: [] },
];

const CARE_CATEGORIES = new Set(['medical', 'paramedical']);
module.exports = { PERSONNEL_CATEGORIES, CARE_CATEGORIES };
