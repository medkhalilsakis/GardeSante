/**
 * Routes — Schedule Builder (création, génération, validation, snapshot, import, export)
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./schedule-builder.controller');
const importCtrl = require('./import.controller');
const exportCtrl = require('./export.controller');

// Multer: in-memory storage for file imports
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

// ── Wizard ────────────────────────────────────────────────────
router.get('/wizard/context',              ctrl.getWizardContext);

// ── Génération ────────────────────────────────────────────────
router.post('/generate',                   ctrl.generateSchedule);

// ── Import ────────────────────────────────────────────────────
router.get('/import/template',             importCtrl.downloadTemplate);
router.post('/import/preview',             upload.single('file'), importCtrl.importPreview);
router.post('/import/confirm',             importCtrl.importConfirm);


// ── Par planning ──────────────────────────────────────────────
router.get('/:scheduleId/detail',          ctrl.getScheduleDetail);
router.post('/:scheduleId/validate',       ctrl.validateSchedule);
router.post('/:scheduleId/validate-shift', ctrl.validateShift);
router.post('/:scheduleId/submit',         ctrl.submitSchedule);
router.post('/:scheduleId/snapshot',       ctrl.createSnapshot);

// ── Export ────────────────────────────────────────────────────
router.get('/:scheduleId/export/excel',    exportCtrl.exportExcel);
router.get('/:scheduleId/export/pdf',      exportCtrl.exportPDF);

module.exports = router;
