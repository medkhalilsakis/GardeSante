const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { reportShiftAbsence, listShiftAbsences } = require('./absences-shift.controller');

router.use(authenticate);

router.post('/', reportShiftAbsence);
router.get('/', listShiftAbsences);

module.exports = router;
