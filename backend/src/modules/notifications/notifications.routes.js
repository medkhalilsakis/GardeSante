const express = require('express');
const router = express.Router();
const ctrl = require('./notifications.controller');
const { authenticate } = require('../../middleware/auth');

router.use(authenticate);
router.get('/', ctrl.getNotifications);
router.put('/:id/read', ctrl.markAsRead);
router.put('/read-all', ctrl.markAllRead);

// ⚠️ Ordre impératif : `/read` et `/:id` ont le même nombre de segments. Si la
// route paramétrée était déclarée en premier, Express capturerait « read »
// comme un identifiant et la purge répondrait systématiquement 404.
router.delete('/read', ctrl.clearRead);
router.delete('/:id', ctrl.deleteNotification);

module.exports = router;
