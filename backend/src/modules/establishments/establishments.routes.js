const express = require('express');
const router  = express.Router();
const ctrl    = require('./establishments.controller');
const { authenticate } = require('../../middleware/auth');
const { injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

// ── CRUD Établissements ────────────────────────────────────────
router.get  ('/',              ctrl.getAll);
router.get  ('/:id',           ctrl.getOne);
router.post ('/',              ctrl.create);
router.put  ('/:id',           ctrl.update);
router.put  ('/:id/activate',  ctrl.activate);
router.delete('/:id',          ctrl.deactivate);
router.get  ('/:id/roles',     ctrl.getRoles);
router.put  ('/:id/config',    ctrl.updateConfig);

// ── Personnel de l'établissement ──────────────────────────────
router.get ('/:id/personnel',  ctrl.getPersonnel);

// ── Historique de l'établissement ─────────────────────────────
router.get ('/:id/history',    ctrl.getEstablishmentHistory);

// ── Directeur de l'établissement ──────────────────────────────
router.get   ('/:id/director', ctrl.getDirector);
router.put   ('/:id/director', ctrl.updateDirector);
router.delete('/:id/director', ctrl.removeDirector);

// ── Actions sur un membre du personnel ────────────────────────
router.put   ('/personnel/:userId',        ctrl.updatePersonnel);
router.delete('/personnel/:userId',        ctrl.removePersonnel);
router.get   ('/personnel/:userId/salary', ctrl.getSalaryReport);

module.exports = router;
