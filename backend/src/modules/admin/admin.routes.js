const express = require('express');
const router  = express.Router();
const ctrl    = require('./admin.controller');
const { authenticate } = require('../../middleware/auth');

// Toutes les routes admin requièrent une authentification
router.use(authenticate);

// ── Gouvernorats ──────────────────────────────────────────────
router.get('/governorates', ctrl.getGovernorates);

// ── Statistiques globales ─────────────────────────────────────
router.get('/stats',         ctrl.getGlobalStats);
router.get('/online-users',  ctrl.getOnlineUsers);

// ── Gestion établissements (cascade) ─────────────────────────
router.put('/establishments/:id/deactivate', ctrl.deactivateWithCascade);
router.put('/establishments/:id/activate',   ctrl.activateEstablishment);

// ── Gestion du directeur ──────────────────────────────────────
router.put('/establishments/:id/director/password',      ctrl.resetDirectorPassword);
router.put('/establishments/:id/director/toggle-status', ctrl.toggleDirectorStatus);

// ── Jours & Périodes Fériés ──────────────────────────────────
router.get('/holidays',               ctrl.getPublicHolidays);
router.post('/holidays',              ctrl.createPublicHoliday);
router.put('/holidays/:id',           ctrl.updatePublicHoliday);
router.delete('/holidays/:id',        ctrl.deletePublicHoliday);
router.post('/holidays/seed-tunisia', ctrl.seedTunisiaHolidays);

module.exports = router;
