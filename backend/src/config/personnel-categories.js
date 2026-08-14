const PERSONNEL_CATEGORIES = [
  { code: 'medical', label: 'Personnel médical', requiresDepartment: true,
    examples: ['Médecin', 'Infirmier', 'Pharmacien', 'Sage-femme', 'Aide-soignant', 'Technicien de soins'] },
  { code: 'administrative', label: 'Personnel administratif', requiresDepartment: false,
    examples: ['Directeur', 'Surveillant', 'Secrétaire', 'Agent d’accueil', 'Informaticien', 'Comptable'] },
  { code: 'auxiliary', label: 'Personnel auxiliaire', requiresDepartment: false,
    examples: ['Ambulancier', 'Concierge', 'Chauffeur', 'Brancardier', 'Sécurité', 'Nettoyage', 'Maintenance'] },
];

const CARE_CATEGORIES = new Set(['medical']);
module.exports = { PERSONNEL_CATEGORIES, CARE_CATEGORIES };
