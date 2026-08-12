/**
 * Supervision plateforme — lecture seule, réservée au Super Admin.
 * Chaque endpoint vérifie lui-même le rôle : aucun verbe autre que GET n'est monté.
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const {
  listEstablishments,
  listSchedules,
  listAbsences,
  listReplacements,
} = require('./admin-oversight.controller');

router.use(authenticate);

router.get('/establishments', listEstablishments);
router.get('/schedules',      listSchedules);
router.get('/absences',       listAbsences);
router.get('/replacements',   listReplacements);

module.exports = router;
