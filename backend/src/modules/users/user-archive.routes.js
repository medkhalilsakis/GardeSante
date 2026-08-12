/**
 * Archivage de comptes — Super Admin uniquement.
 * Routes montées à part pour ne pas modifier `users.routes.js`.
 * Le contrôle de rôle est fait dans le contrôleur (pas de permission RBAC
 * nouvelle à seeder, donc aucune migration de permissions requise).
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const { listArchived, archiveUser, unarchiveUser } = require('./user-archive.controller');

router.use(authenticate);

router.get('/',                 listArchived);
router.put('/:id/archive',      archiveUser);
router.put('/:id/unarchive',    unarchiveUser);

module.exports = router;
