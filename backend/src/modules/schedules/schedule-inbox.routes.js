const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { listInbox } = require('./schedule-inbox.controller');

router.use(authenticate);

// Boîte de réception « Planning à consulter » — le contrôleur applique lui-même
// la portée (services de l'appelant, ou établissement pour la hiérarchie).
router.get('/', listInbox);

module.exports = router;
