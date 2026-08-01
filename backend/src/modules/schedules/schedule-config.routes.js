/**
 * Routes — Schedule Config (colonnes, règles, templates)
 */
const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./schedule-config.controller');

router.use(authenticate);

// ── Colonnes ──────────────────────────────────────────────────
router.get('/columns',                    ctrl.getColumns);
router.post('/columns',                   ctrl.createColumn);
router.post('/columns/detect',            ctrl.detectColumn);
router.post('/columns/confirm-detection', ctrl.confirmColumnDetection);
router.delete('/columns/:id',             ctrl.deleteColumn);

// ── Règles ────────────────────────────────────────────────────
router.get('/rules',                      ctrl.getRules);
router.post('/rules',                     ctrl.createRule);
router.put('/rules/:id/toggle',           ctrl.toggleRule);
router.delete('/rules/:id',               ctrl.deleteRule);

// ── Templates ─────────────────────────────────────────────────
router.get('/templates',                  ctrl.getTemplates);
router.post('/templates',                 ctrl.createTemplate);
router.put('/templates/:id',              ctrl.updateTemplate);
router.delete('/templates/:id',           ctrl.deleteTemplate);

// ── Init établissement ────────────────────────────────────────
router.post('/init/:establishmentId',     ctrl.initEstablishment);
router.post('/init',                      ctrl.initEstablishment);

module.exports = router;
