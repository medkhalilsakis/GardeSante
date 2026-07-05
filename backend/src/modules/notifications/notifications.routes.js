const express = require('express');
const router = express.Router();
const ctrl = require('./notifications.controller');
const { authenticate } = require('../../middleware/auth');

router.use(authenticate);
router.get('/', ctrl.getNotifications);
router.put('/:id/read', ctrl.markAsRead);
router.put('/read-all', ctrl.markAllRead);
module.exports = router;
