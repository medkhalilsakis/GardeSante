const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const {
  listEvents,
  createEvent,
  listAlerts,
  updateAlert,
  getServiceOverview,
  listCallRoster,
} = require('./journal.controller');

router.use(authenticate);

// Vue d'ensemble du service (tableau de bord rapide)
router.get('/overview', getServiceOverview);
router.get('/calls', listCallRoster);

// Alertes — déclarées avant '/' pour ne pas être absorbées par le journal
router.get('/alerts', listAlerts);
router.patch('/alerts/:id', updateAlert);

// Journal de service
router.get('/', listEvents);
router.post('/', createEvent);

module.exports = router;
