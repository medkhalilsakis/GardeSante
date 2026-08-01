const express = require('express');
const router = express.Router();
const {
  getUsers, getUser, createUser, updateUser, deleteUser,
  activateUser, deactivateUser, getUserShifts, getUserStats, getCreatableRoles,
} = require('./users.controller');
const {
  getJobTitles, createJobTitle, updateJobTitle, deleteJobTitle,
} = require('./job-titles.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

// ── ROUTES STATIQUES EN PREMIER (avant /:id) ─────────────────
// Roles systeme disponibles
router.get('/roles-available', requirePermission('users.read'), getCreatableRoles);

// Titres de poste hospitaliers (DOIT etre avant /:id)
router.get('/job-titles',         requirePermission('users.read'),   getJobTitles);
router.post('/job-titles',        requirePermission('users.create'), createJobTitle);
router.put('/job-titles/:id',     requirePermission('users.update'), updateJobTitle);
router.delete('/job-titles/:id',  requirePermission('users.delete'), deleteJobTitle);

// ── CRUD Utilisateurs (routes dynamiques apres) ───────────────
router.get('/',           requirePermission('users.read'),   getUsers);
router.get('/:id',        requirePermission('users.read'),   getUser);
router.post('/',          requirePermission('users.create'), createUser);
router.put('/:id',        requirePermission('users.update'), updateUser);
router.delete('/:id',     requirePermission('users.delete'), deleteUser);
router.put('/:id/activate',   requirePermission('users.update'), activateUser);
router.put('/:id/deactivate', requirePermission('users.update'), deactivateUser);
router.get('/:id/shifts', requirePermission('shifts.read'),  getUserShifts);
router.get('/:id/stats',  requirePermission('stats.read'),   getUserStats);

module.exports = router;
