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
const scheduleExportCtrl = require('./schedule-export.controller');

// Multer: in-memory storage for file imports
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authenticate);

// ── Wizard ────────────────────────────────────────────────────
router.get('/wizard/context',              ctrl.getWizardContext);

// ── Génération ────────────────────────────────────────────────
router.post('/generate',                   ctrl.generateSchedule);
router.post('/generate-proposals',         ctrl.generateProposals);
router.post('/confirm-proposal',            ctrl.confirmProposal);

// ── Import ────────────────────────────────────────────────────
router.get('/import/template',             importCtrl.downloadTemplate);
router.post('/import/preview',             upload.single('file'), importCtrl.importPreview);
router.post('/import/confirm',             importCtrl.importConfirm);


// ── Par planning ──────────────────────────────────────────────
router.get('/:scheduleId/detail',          ctrl.getScheduleDetail);
router.get('/:scheduleId/history',         ctrl.getScheduleHistory);
router.get('/:scheduleId/change-proposals', ctrl.listChangeProposals);
router.post('/:scheduleId/change-proposals', ctrl.createChangeProposal);
router.post('/:scheduleId/change-proposals/decide-all', ctrl.decideAllChangeProposals);
router.post('/:scheduleId/change-proposals/:proposalId/decision', ctrl.decideChangeProposal);
router.post('/:scheduleId/notify-sg', ctrl.notifyGeneralSupervisor);
router.post('/:scheduleId/validate',       ctrl.validateSchedule);
router.post('/:scheduleId/validate-shift', ctrl.validateShift);
router.put('/:scheduleId/draft',           ctrl.saveDraft);
router.post('/:scheduleId/submit',         ctrl.submitSchedule);
router.post('/:scheduleId/cancel-submission', ctrl.cancelScheduleSubmission);
router.post('/:scheduleId/snapshot',       ctrl.createSnapshot);

// ── Export ────────────────────────────────────────────────────
router.get('/:scheduleId/export/excel',    scheduleExportCtrl.exportExcel);
router.get('/:scheduleId/export/csv',      scheduleExportCtrl.exportCSV);
router.get('/:scheduleId/export/pdf',      scheduleExportCtrl.exportPDF);
router.get('/:scheduleId/export/detailed-calendar-pdf', scheduleExportCtrl.exportDetailedCalendarPDF);

module.exports = router;
