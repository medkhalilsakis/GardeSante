const express = require('express');
const router = express.Router();
const ctrl = require('./schedules.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);
router.get('/', requirePermission('schedules.read'), ctrl.getSchedules);
router.post('/generate', requirePermission('schedules.generate'), ctrl.generateSchedule);
router.get('/:id', requirePermission('schedules.read'), ctrl.getSchedule);
router.get('/:id/conflicts', requirePermission('schedules.read'), ctrl.getConflicts);
router.post('/', requirePermission('schedules.create'), ctrl.createSchedule);
router.put('/:id', requirePermission('schedules.update'), ctrl.updateSchedule);
router.post('/:id/submit', requirePermission('schedules.submit'), ctrl.submitSchedule);
router.post('/:id/approve', requirePermission('schedules.approve'), ctrl.approveSchedule);
router.post('/:id/reject', requirePermission('schedules.reject'), ctrl.rejectSchedule);
module.exports = router;
