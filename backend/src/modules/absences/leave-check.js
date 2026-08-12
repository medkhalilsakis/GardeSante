/**
 * Règle I — Un personnel en congé ne peut pas être affecté à une garde
 * Helper réutilisable : tableur (saveDraft / validateSchedule) et assistant intelligent.
 *
 * Les colonnes DATE sont castées en TO_CHAR pour éviter le décalage de fuseau
 * (pg renvoie DATE en Date locale, le front parse en UTC).
 */

const { query } = require('../../config/database');

/**
 * Récupère les congés actifs qui chevauchent une période, pour une liste d'agents.
 * @param {string[]} userIds
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate   - 'YYYY-MM-DD'
 * @returns {Promise<Map<string, object[]>>} userId -> liste de congés
 */
const getLeavesInPeriod = async (userIds, startDate, endDate) => {
  const map = new Map();
  if (!userIds?.length || !startDate || !endDate) return map;

  const result = await query(
    `SELECT a.user_id,
            TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
            at.name AS type_name, at.color
     FROM absences a
     JOIN absence_types at ON a.absence_type_id = at.id
     WHERE a.user_id = ANY($1::uuid[])
       AND a.kind = 'leave'
       AND a.status <> 'cancelled'
       AND a.status <> 'rejected'
       AND a.start_date <= $3::date
       AND a.end_date   >= $2::date`,
    [userIds, startDate, endDate]
  );

  for (const row of result.rows) {
    if (!map.has(row.user_id)) map.set(row.user_id, []);
    map.get(row.user_id).push(row);
  }
  return map;
};

/**
 * Vérifie si un agent est en congé à une date donnée.
 * Comparaison lexicographique sur 'YYYY-MM-DD' — sûre et sans fuseau.
 * @param {object[]} leaves - congés de l'agent (issus de getLeavesInPeriod)
 * @param {string} date     - 'YYYY-MM-DD'
 */
const isOnLeaveAt = (leaves, date) => {
  if (!leaves?.length || !date) return null;
  const d = String(date).slice(0, 10);
  return leaves.find((l) => l.start_date <= d && l.end_date >= d) || null;
};

/**
 * Contrôle serveur : détecte toute affectation d'un agent en congé.
 * @param {Array<{userId: string, date: string}>} assignments
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<Array<{userId, date, typeName, leaveStart, leaveEnd}>>} violations
 */
const findLeaveViolations = async (assignments, startDate, endDate) => {
  if (!assignments?.length) return [];

  const userIds = [...new Set(assignments.map((a) => a.userId).filter(Boolean))];
  const leavesByUser = await getLeavesInPeriod(userIds, startDate, endDate);
  if (leavesByUser.size === 0) return [];

  const violations = [];
  for (const a of assignments) {
    const leave = isOnLeaveAt(leavesByUser.get(a.userId), a.date);
    if (leave) {
      violations.push({
        userId: a.userId,
        date: String(a.date).slice(0, 10),
        typeName: leave.type_name,
        leaveStart: leave.start_date,
        leaveEnd: leave.end_date
      });
    }
  }
  return violations;
};

module.exports = { getLeavesInPeriod, isOnLeaveAt, findLeaveViolations };
