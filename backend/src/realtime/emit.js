/**
 * Realtime emission helpers — wrapper autour de socket.io avec fallback silencieux
 * Réutilisable pour tous les modules : notes, absences, remplacements, alertes, etc.
 */

/**
 * Émettre un événement à un utilisateur spécifique
 * @param {Express.Application} app - L'application Express (contient io et userSockets)
 * @param {string} userId - L'UUID de l'utilisateur cible
 * @param {string} event - Le nom de l'événement (ex: 'notification:new', 'replacement:updated')
 * @param {object} payload - Les données à envoyer
 */
const emitToUser = (app, userId, event, payload) => {
  const io = app.get('io');
  if (!io) return; // fallback silencieux — le polling 60s prend le relais

  try {
    io.to(`user:${userId}`).emit(event, payload);
  } catch (err) {
    console.warn(`⚠️  Socket emit failed (user:${userId}, ${event}):`, err.message);
  }
};

/**
 * Émettre un événement à tous les utilisateurs d'un établissement
 * @param {Express.Application} app
 * @param {string} establishmentId - L'UUID de l'établissement
 * @param {string} event
 * @param {object} payload
 */
const emitToEstablishment = (app, establishmentId, event, payload) => {
  const io = app.get('io');
  if (!io) return;

  try {
    io.to(`establishment:${establishmentId}`).emit(event, payload);
  } catch (err) {
    console.warn(`⚠️  Socket emit failed (establishment:${establishmentId}, ${event}):`, err.message);
  }
};

/**
 * Émettre un événement à tous les utilisateurs d'un département/service
 * @param {Express.Application} app
 * @param {string} departmentId - L'UUID du département
 * @param {string} event
 * @param {object} payload
 */
const emitToDepartment = (app, departmentId, event, payload) => {
  const io = app.get('io');
  if (!io) return;

  try {
    io.to(`department:${departmentId}`).emit(event, payload);
  } catch (err) {
    console.warn(`⚠️  Socket emit failed (department:${departmentId}, ${event}):`, err.message);
  }
};

module.exports = {
  emitToUser,
  emitToEstablishment,
  emitToDepartment
};
