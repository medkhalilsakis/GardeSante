const express = require('express');
const router = express.Router();
const ctrl = require('./absences.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);
router.get('/types', ctrl.getAbsenceTypes);
router.get('/', requirePermission('absences.read'), ctrl.getAbsences);
router.post('/', requirePermission('absences.create'), ctrl.createAbsence);
router.put('/:id/approve', requirePermission('absences.approve'), ctrl.approveAbsence);
router.put('/:id/reject', requirePermission('absences.approve'), ctrl.rejectAbsence);
router.put('/:id/cancel', requirePermission('absences.create'), ctrl.cancelAbsence);
module.exports = router;
