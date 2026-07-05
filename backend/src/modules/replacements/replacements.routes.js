const express = require('express');
const router = express.Router();
const ctrl = require('./replacements.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);
router.get('/', requirePermission('replacements.read'), ctrl.getReplacements);
router.post('/', requirePermission('replacements.create'), ctrl.createReplacement);
router.post('/:id/accept', requirePermission('replacements.approve'), ctrl.acceptReplacement);
router.post('/:id/reject', requirePermission('replacements.approve'), ctrl.rejectReplacement);
router.get('/:id/candidates', requirePermission('replacements.read'), ctrl.getCandidates);
module.exports = router;
