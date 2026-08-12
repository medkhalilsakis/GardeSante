const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const {
  listSchedules,
  listConflicts,
  getOverview,
  listLoans,
  sendReport,
} = require('./supervision.controller');

router.use(authenticate);

// Supervision hôpital — le contrôleur filtre lui-même sur les rôles autorisés
router.get('/overview',  getOverview);
router.get('/schedules', listSchedules);
router.get('/conflicts', listConflicts);
router.get('/loans',     listLoans);

// Transmission d'un rapport à la direction
router.post('/report',   sendReport);

module.exports = router;
