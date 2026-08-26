const express = require('express');
const router = express.Router();
const ctrl = require('./schedules.controller');
const { authenticate } = require('../../middleware/auth');
const { requirePermission, injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);
router.get('/', requirePermission('schedules.read'), ctrl.getSchedules);
router.post('/generate', requirePermission('schedules.generate'), ctrl.generateSchedule);
router.get('/hospital-staff', requirePermission('schedules.read'), ctrl.getHospitalStaff); // tout le personnel
router.get('/roles', ctrl.getAllRoles);                         // tous les rôles
router.get('/:id', requirePermission('schedules.read'), ctrl.getSchedule);
router.get('/:id/conflicts', requirePermission('schedules.read'), ctrl.getConflicts);
router.post('/', requirePermission('schedules.create'), ctrl.createSchedule);
router.put('/:id', requirePermission('schedules.update'), ctrl.updateSchedule);
router.patch('/:id/action', ctrl.scheduleAction);               // duplicate/archive/restore/delete
router.post('/:id/submit', requirePermission('schedules.submit'), ctrl.submitSchedule);
// Il n'y a plus d'approbation ni de refus : l'envoi met le planning en marche.
// Les surveillants et surveillants généraux proposent des modifications
// (POST /api/schedule-builder/:scheduleId/proposals). Les permissions
// `schedules.approve` / `schedules.reject` restent en base mais ne sont plus
// rattachées à aucune route.
module.exports = router;
