const express = require('express');
const router = express.Router();
const { getUsers, getUser, createUser, updateUser, deleteUser, getUserShifts, getUserStats } = require('./users.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

router.get('/', requirePermission('users.read'), getUsers);
router.get('/:id', requirePermission('users.read'), getUser);
router.post('/', requirePermission('users.create'), createUser);
router.put('/:id', requirePermission('users.update'), updateUser);
router.delete('/:id', requirePermission('users.delete'), deleteUser);
router.get('/:id/shifts', requirePermission('shifts.read'), getUserShifts);
router.get('/:id/stats', requirePermission('stats.read'), getUserStats);

module.exports = router;
