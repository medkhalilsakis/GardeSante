/**
 * Rôles transversaux à l'hôpital — ils n'appartiennent à aucun service.
 *
 * Règle métier : le surveillant général couvre l'établissement entier, comme le
 * directeur. Le rattacher à un service n'aurait aucun effet fonctionnel (sa
 * portée est déjà « établissement » dans `schedule-inbox`, `journal`,
 * `hospital-calendar` et les statistiques) mais contredirait la règle et
 * ferait apparaître une puce « service » erronée dans son badge de contexte.
 *
 * La migration 027 nettoie les lignes existantes ; ce module ferme la porte
 * pour l'avenir. Il est appelé par les QUATRE seuls endroits qui écrivent dans
 * `user_departments` : `setDepartmentHead`, `setDepartmentSupervisor`,
 * `addMember` (`departments.controller.js`) et `createUser`
 * (`users.controller.js`).
 *
 * Le directeur et l'administrateur n'y figurent pas : aucun n'est aujourd'hui
 * rattaché à un service, et l'interface ne le propose pas. Ajouter leur code
 * ici suffirait à verrouiller ce cas aussi, sans autre modification.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');

/** Codes de rôle qui ne peuvent pas être membres d'un service. */
const HOSPITAL_WIDE_ROLES = [ROLES.GENERAL_SUPERVISOR];

const REFUSAL = {
  success: false,
  message: 'Le surveillant général couvre tout l\'hôpital : il ne peut pas être rattaché à un service.',
  message_ar: 'المشرف العام يغطي المستشفى بالكامل ولا يمكن ربطه بمصلحة.',
};

/** Ce code de rôle est-il transversal ? Utilisable quand le rôle est déjà connu. */
const isHospitalWideRole = (roleCode) => HOSPITAL_WIDE_ROLES.includes(roleCode);

/**
 * Vérifie qu'un utilisateur peut être rattaché à un service.
 * Un `userId` absent ou inconnu passe : ce n'est pas le rôle de ce garde-fou
 * de valider l'existence de la cible, chaque appelant a déjà ses propres
 * contrôles (et la contrainte de clé étrangère fait le reste).
 *
 * @param {string|null} userId
 * @returns {Promise<{ allowed: boolean, roleCode: string|null }>}
 */
const checkDepartmentMembership = async (userId) => {
  if (!userId) return { allowed: true, roleCode: null };
  const res = await query(
    `SELECT r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId]
  );
  const roleCode = res.rows[0]?.code || null;
  return { allowed: !isHospitalWideRole(roleCode), roleCode };
};

module.exports = {
  HOSPITAL_WIDE_ROLES,
  REFUSAL,
  isHospitalWideRole,
  checkDepartmentMembership,
};
