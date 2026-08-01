const { query } = require('../config/database');

/**
 * Middleware de tracking d'activité en temps réel.
 * Met à jour last_activity_at pour chaque requête authentifiée.
 * Throttle : mise à jour toutes les 60 secondes max pour éviter les écritures excessives.
 */
const ACTIVITY_THROTTLE_MS = 60 * 1000; // 60 secondes

// Cache en mémoire : userId → timestamp de la dernière mise à jour
const lastUpdateMap = new Map();

const trackActivity = async (req, res, next) => {
  // Seulement si l'utilisateur est authentifié
  if (!req.user?.id) return next();

  const userId = req.user.id;
  const now    = Date.now();
  const last   = lastUpdateMap.get(userId) || 0;

  // Throttle : ne pas écrire en BD plus d'une fois par minute par user
  if (now - last < ACTIVITY_THROTTLE_MS) return next();

  lastUpdateMap.set(userId, now);

  // Mise à jour asynchrone sans bloquer la réponse
  query(
    'UPDATE users SET last_activity_at = NOW() WHERE id = $1',
    [userId]
  ).catch(err => {
    // Log silencieux — ne pas faire planter la requête principale
    if (process.env.NODE_ENV !== 'production') {
      console.error('[trackActivity] Error:', err.message);
    }
  });

  next();
};

/**
 * Calcule la présence d'un utilisateur selon last_activity_at.
 * @param {string|Date} lastActivity
 * @returns {{ status: 'online'|'offline'|'away', label: string, minutesAgo: number }}
 */
const computePresence = (lastActivity) => {
  if (!lastActivity) return { status: 'offline', label: 'Jamais connecté', minutesAgo: null };

  const diffMs      = Date.now() - new Date(lastActivity).getTime();
  const minutesAgo  = Math.floor(diffMs / 60000);
  const hoursAgo    = Math.floor(minutesAgo / 60);
  const daysAgo     = Math.floor(hoursAgo / 24);

  if (minutesAgo < 5) {
    return { status: 'online',   label: 'Connecté',          minutesAgo };
  } else if (minutesAgo < 30) {
    return { status: 'away',     label: `Il y a ${minutesAgo} min`, minutesAgo };
  } else if (hoursAgo < 24) {
    return { status: 'offline',  label: `Il y a ${hoursAgo}h`, minutesAgo };
  } else if (daysAgo < 7) {
    return { status: 'offline',  label: `Il y a ${daysAgo} jour${daysAgo > 1 ? 's' : ''}`, minutesAgo };
  } else {
    const date = new Date(lastActivity);
    const formatted = date.toLocaleDateString('fr-FR', {
      day:   '2-digit',
      month: '2-digit',
      year:  'numeric',
    });
    return { status: 'offline', label: `Le ${formatted}`, minutesAgo };
  }
};

module.exports = { trackActivity, computePresence };
