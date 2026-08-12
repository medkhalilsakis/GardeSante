const { query } = require('../../config/database');

// Filtres additionnels (`type`, `priority`, `read`) et total renvoyé pour la
// pagination de l'écran dédié. `unreadOnly`, `page` et `limit` gardent leur sens
// exact : le menu déroulant du Header et le polling d'AppLayout continuent de
// fonctionner sans aucune modification.
const getNotifications = async (req, res) => {
  const { unreadOnly = false, page = 1, limit = 20, type, priority, read } = req.query;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const conditions = ['n.recipient_id = $1'];
  const params = [req.user.id];

  if (unreadOnly === 'true' || read === 'false') conditions.push('n.is_read = FALSE');
  else if (read === 'true') conditions.push('n.is_read = TRUE');
  if (type)     { params.push(type);     conditions.push(`n.type = $${params.length}`); }
  if (priority) { params.push(priority); conditions.push(`n.priority = $${params.length}`); }

  const where = conditions.join(' AND ');

  const result = await query(
    `SELECT n.*,
            COALESCE(p.schedule_id, rp.schedule_id, sl.schedule_id,
                     CASE WHEN n.entity_type='schedules' THEN n.entity_id END) AS target_schedule_id
     FROM notifications n
     LEFT JOIN schedule_change_proposals p ON n.entity_type='schedule_change_proposals' AND p.id=n.entity_id
     LEFT JOIN replacements rp ON n.entity_type='replacements' AND rp.id=n.entity_id
     LEFT JOIN staff_loan_requests sl ON n.entity_type='staff_loan_requests' AND sl.id=n.entity_id
     WHERE ${where}
     ORDER BY n.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safeLimit, offset]
  );

  const totalRes = await query(`SELECT COUNT(*) FROM notifications n WHERE ${where}`, params);
  const unreadCount = await query(
    'SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 AND is_read = FALSE',
    [req.user.id]
  );
  // Types et priorités réellement présents chez l'appelant : l'écran dédié ne
  // propose que des filtres qui donneront un résultat.
  const facets = await query(
    'SELECT type, priority FROM notifications WHERE recipient_id = $1 GROUP BY type, priority',
    [req.user.id]
  );

  const total = parseInt(totalRes.rows[0].count, 10);
  return res.json({
    success: true,
    data: result.rows,
    unreadCount: parseInt(unreadCount.rows[0].count, 10),
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(Math.ceil(total / safeLimit), 1),
    types: [...new Set(facets.rows.map((r) => r.type).filter(Boolean))].sort(),
    priorities: [...new Set(facets.rows.map((r) => r.priority).filter(Boolean))],
  });
};

const markAsRead = async (req, res) => {
  await query(
    'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 AND recipient_id = $2',
    [req.params.id, req.user.id]
  );
  return res.json({ success: true, message: 'Notification marquée comme lue' });
};

const markAllRead = async (req, res) => {
  await query(
    'UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE recipient_id = $1 AND is_read = FALSE',
    [req.user.id]
  );
  return res.json({ success: true, message: 'Toutes les notifications lues' });
};

// Suppression unitaire — bornée au destinataire : personne ne peut effacer la
// notification d'un autre, même en devinant son identifiant.
const deleteNotification = async (req, res) => {
  const result = await query(
    'DELETE FROM notifications WHERE id = $1 AND recipient_id = $2 RETURNING id',
    [req.params.id, req.user.id]
  );
  if (!result.rows.length) {
    return res.status(404).json({ success: false, message: 'Notification introuvable' });
  }
  return res.json({ success: true, message: 'Notification supprimée' });
};

// Purge des notifications déjà lues de l'appelant. Les non lues sont conservées :
// vider sa boîte ne doit jamais faire disparaître une information non consultée.
const clearRead = async (req, res) => {
  const result = await query(
    'DELETE FROM notifications WHERE recipient_id = $1 AND is_read = TRUE RETURNING id',
    [req.user.id]
  );
  return res.json({
    success: true,
    deleted: result.rows.length,
    message: `${result.rows.length} notification(s) supprimée(s)`,
  });
};

// Fonction utilitaire pour créer une notification (utilisée par les autres modules)
const createNotification = async (data) => {
  const { establishmentId, recipientId, senderId, type, title, titleAr, message, messageAr, entityType, entityId, priority } = data;
  try {
    await query(
      `INSERT INTO notifications (establishment_id, recipient_id, sender_id, type, title, title_ar, message, message_ar, entity_type, entity_id, priority)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [establishmentId, recipientId, senderId, type, title, titleAr, message, messageAr, entityType, entityId, priority || 'normal']
    );
  } catch (err) {
    console.error('Failed to create notification:', err.message);
  }
};

module.exports = { getNotifications, markAsRead, markAllRead, deleteNotification, clearRead, createNotification };
