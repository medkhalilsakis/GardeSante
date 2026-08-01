const express = require('express');
const router = express.Router();
const ctrl = require('./profile.controller');
const { authenticate } = require('../../middleware/auth');
const { injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

// ── Profil utilisateur connecté ──────────────────────────────
router.get('/',                           ctrl.getProfile);
router.post('/avatar',                    ctrl.uploadMiddleware, ctrl.uploadAvatar);
router.delete('/avatar',                  ctrl.deleteAvatar);
router.put('/credentials',               ctrl.updateCredentials);
router.put('/preferences',               ctrl.updatePreferences);
router.post('/request-change',           ctrl.requestProfileChange);
router.get('/my-requests',               ctrl.getMyRequests);

// ── Super Admin ──────────────────────────────────────────────
router.get('/admin/requests',            ctrl.adminGetRequests);
router.get('/admin/pending-count',       ctrl.adminPendingCount);
router.put('/admin/requests/:id/approve', ctrl.adminApproveRequest);
router.put('/admin/requests/:id/reject',  ctrl.adminRejectRequest);

module.exports = router;
