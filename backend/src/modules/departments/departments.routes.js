const express = require('express');
const router = express.Router();
const ctrl = require('./departments.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);
router.get('/', requirePermission('departments.read'), ctrl.getDepartments);
router.get('/:id', requirePermission('departments.read'), ctrl.getDepartment);
router.post('/', requirePermission('departments.create'), ctrl.createDepartment);
router.put('/:id', requirePermission('departments.update'), ctrl.updateDepartment);
router.post('/:id/members', requirePermission('users.update'), ctrl.addMember);
router.delete('/:id/members/:userId', requirePermission('users.update'), ctrl.removeMember);
module.exports = router;
