const { query } = require('../../config/database');

const getNotifications = async (req, res) => {
  const { unreadOnly = false, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let conditions = ['recipient_id = $1'];
  if (unreadOnly === 'true') conditions.push('is_read = FALSE');

  const result = await query(
    `SELECT * FROM notifications WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.user.id, parseInt(limit), offset]
  );

  const unreadCount = await query(
    'SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 AND is_read = FALSE',
    [req.user.id]
  );

  return res.json({
    success: true,
    data: result.rows,
    unreadCount: parseInt(unreadCount.rows[0].count),
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

module.exports = { getNotifications, markAsRead, markAllRead, createNotification };
