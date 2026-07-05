const express = require('express');
const router = express.Router();
const ctrl = require('./shifts.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);
router.get('/', requirePermission('shifts.read'), ctrl.getShifts);
router.get('/today', requirePermission('shifts.read'), ctrl.getTodayShifts);
router.post('/', requirePermission('shifts.create'), ctrl.createShift);
router.put('/:id', requirePermission('shifts.update'), ctrl.updateShift);
router.delete('/:id', requirePermission('shifts.delete'), ctrl.deleteShift);
router.post('/:id/confirm', requirePermission('shifts.confirm'), ctrl.confirmPresence);
router.post('/:id/absent', requirePermission('shifts.confirm'), ctrl.markAbsent);
module.exports = router;
