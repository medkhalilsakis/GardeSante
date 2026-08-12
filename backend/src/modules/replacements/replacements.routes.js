const express = require('express');
const router = express.Router();
const ctrl = require('./replacements.controller');
const overlayCtrl = require('./replacements-overlay.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

// ── Remplacements « overlay » sur garde courante (déclarés avant les
//    routes paramétrées pour qu'aucun /:id ne puisse les capturer) ──
router.get('/eligible-schedules', overlayCtrl.getEligibleSchedules);
router.get('/overlay', overlayCtrl.getOverlayReplacements);
router.post('/overlay', overlayCtrl.createOverlayReplacement);
router.post('/overlay/:id/confirm', overlayCtrl.confirmOverlayReplacement);
router.post('/overlay/:id/reject', overlayCtrl.rejectOverlayReplacement);
router.delete('/overlay/:id', overlayCtrl.deleteOverlayReplacement);
router.get('/schedule/:scheduleId/staff', overlayCtrl.getScheduleStaff);

// ── Flux historique (remplacements liés aux absences) ──
router.get('/', requirePermission('replacements.read'), ctrl.getReplacements);
router.post('/', requirePermission('replacements.create'), ctrl.createReplacement);
router.post('/:id/accept', requirePermission('replacements.approve'), ctrl.acceptReplacement);
router.post('/:id/reject', requirePermission('replacements.approve'), ctrl.rejectReplacement);
router.get('/:id/candidates', requirePermission('replacements.read'), ctrl.getCandidates);
module.exports = router;
