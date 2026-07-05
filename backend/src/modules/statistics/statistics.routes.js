const express = require('express');
const router = express.Router();
const ctrl = require('./statistics.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);
router.get('/dashboard', requirePermission('stats.read'), ctrl.getDashboard);
router.get('/shifts', requirePermission('stats.read'), ctrl.getShiftStats);
router.get('/absences', requirePermission('stats.read'), ctrl.getAbsenceStats);
router.get('/coverage', requirePermission('stats.read'), ctrl.getCoverageReport);
module.exports = router;
