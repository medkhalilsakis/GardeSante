/**
 * Types de garde par défaut d'un établissement (Lot X4).
 *
 * POURQUOI CE FICHIER EXISTE — un trou d'amorçage réel :
 *
 *   La migration `028_seed_shift_types.sql` amorce J/S/N/G pour tous les
 *   établissements, mais elle ne s'exécute qu'au **démarrage du serveur**. Un
 *   établissement créé en cours de session n'a donc AUCUN type de garde, alors
 *   que `shifts.shift_type_id` est obligatoire : les générateurs hérités, les
 *   remplacements et les statistiques bâties sur `shifts` restent inutilisables
 *   jusqu'au prochain redémarrage.
 *   `establishments.controller.js:create` amorçait déjà les rôles, les configs,
 *   les colonnes du tableur, les règles, les titres de poste et les types
 *   d'absence — les types de garde étaient les seuls oubliés.
 *
 *   Le tableur, lui, ne dépend plus de ces types : il ne connaît qu'une seule
 *   notion, « de service / pas de service », et n'écrit plus dans `shifts`.
 *
 * Ce service comble ce trou, sur le modèle exact de
 * `modules/absences/absence-types.service.js` : même signature, même usage dans
 * une transaction, même idempotence.
 *
 * Différence assumée avec les types d'absence : ici `ON CONFLICT DO NOTHING`,
 * jamais `DO UPDATE`. Un établissement qui a adapté ses horaires ou ses
 * couleurs ne doit pas les voir réécrits — c'est aussi la règle retenue par la
 * migration 028.
 *
 */

const { query } = require('../../config/database');

/** [code, nom, nom_ar, début, fin, durée, chevauche_minuit, couleur] */
const DEFAULT_SHIFT_TYPES = [
  ['J', 'Jour',  'نهار',  '08:00', '16:00',  8.0, false, '#3B82F6'],
  ['S', 'Soir',  'مساء',  '16:00', '00:00',  8.0, true,  '#10B981'],
  ['N', 'Nuit',  'ليل',   '00:00', '08:00',  8.0, false, '#6D28D9'],
  ['G', 'Garde', 'حراسة', '08:00', '08:00', 24.0, true,  '#F59E0B'],
];

/** Codes standards protégés en référentiel (admin-referentiels.controller.js). */
const STANDARD_SHIFT_CODES = DEFAULT_SHIFT_TYPES.map(([code]) => code);

/**
 * Amorce les types de garde standards d'un établissement.
 *
 * @param {string} establishmentId
 * @param {object|function} db  client de transaction, ou `query` par défaut
 * @returns {Promise<number>} nombre de types réellement créés
 */
const ensureDefaultShiftTypes = async (establishmentId, db = query) => {
  if (!establishmentId) return 0;

  const execute = typeof db === 'function' ? db : db.query.bind(db);
  const values = [];
  const rows = DEFAULT_SHIFT_TYPES.map((type, index) => {
    const offset = index * 9;
    values.push(establishmentId, ...type);
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},`
         + `$${offset + 5}::time,$${offset + 6}::time,$${offset + 7},$${offset + 8},$${offset + 9})`;
  });

  const result = await execute(
    `INSERT INTO shift_types
       (establishment_id, code, name, name_ar, start_time, end_time,
        duration_hours, is_overnight, color)
     VALUES ${rows.join(',')}
     ON CONFLICT (establishment_id, code) DO NOTHING
     RETURNING id`,
    values
  );

  return result.rowCount || 0;
};

module.exports = {
  ensureDefaultShiftTypes,
  DEFAULT_SHIFT_TYPES,
  STANDARD_SHIFT_CODES,
};
