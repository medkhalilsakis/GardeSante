const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { getHospitalCalendar } = require('./hospital-calendar.controller');

router.use(authenticate);

// Calendrier hôpital (lecture seule) — la portée et la visibilité des brouillons
// sont déduites du rôle dans le contrôleur.
router.get('/', getHospitalCalendar);

module.exports = router;
