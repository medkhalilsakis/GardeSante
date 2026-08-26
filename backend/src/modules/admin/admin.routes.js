const express = require('express');
const router  = express.Router();
const ctrl    = require('./admin.controller');
// Activité réelle de la plateforme (Lot X3) — contrôleur séparé, lecture seule.
const platformCtrl = require('./admin-platform.controller');
// Référentiels nationaux (Lot X4) — types de garde, types d'absence, droits.
const referentielsCtrl = require('./admin-referentiels.controller');
// Fiche de conformité des établissements (Lot X6, C1) — lecture + réparations
// qui ne demandent aucune décision métier.
const conformiteCtrl = require('./admin-conformite.controller');
// Annuaire national du personnel (Lot X6, D2) — recherche transverse.
const annuaireCtrl = require('./admin-annuaire.controller');
const { authenticate } = require('../../middleware/auth');

// Toutes les routes admin requièrent une authentification
router.use(authenticate);

// ── Gouvernorats ──────────────────────────────────────────────
router.get('/governorates', ctrl.getGovernorates);

// ── Statistiques globales ─────────────────────────────────────
router.get('/stats',         ctrl.getGlobalStats);
router.get('/online-users',  ctrl.getOnlineUsers);

// ── Activité réelle de la plateforme (services, plannings, gardes, …) ──
router.get('/platform-activity', platformCtrl.getPlatformActivity);

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

// ── Référentiels nationaux (Lot X4) ───────────────────────────
// Chaque handler vérifie lui-même `isSuperAdmin` (403 sinon), comme le fait
// déjà `admin-platform.controller.js`.
router.get('/referentiels/overview',    referentielsCtrl.getOverview);
router.get('/referentiels/permissions', referentielsCtrl.getPermissionMatrix);
router.post('/referentiels/seed',       referentielsCtrl.seedReferentiels);

router.get('/referentiels/shift-types',        referentielsCtrl.getShiftTypes);
router.post('/referentiels/shift-types',       referentielsCtrl.createShiftType);
router.put('/referentiels/shift-types/:id',    referentielsCtrl.updateShiftType);
router.delete('/referentiels/shift-types/:id', referentielsCtrl.deleteShiftType);

router.get('/referentiels/absence-types',        referentielsCtrl.getAbsenceTypes);
router.post('/referentiels/absence-types',       referentielsCtrl.createAbsenceType);
router.put('/referentiels/absence-types/:id',    referentielsCtrl.updateAbsenceType);
router.delete('/referentiels/absence-types/:id', referentielsCtrl.deleteAbsenceType);

// ── Fiche de conformité des établissements (Lot X6, C1) ───────
// `:id` est un UUID d'établissement, jamais un mot-clé : aucune collision avec
// les routes statiques ci-dessus.
router.get('/conformite',              conformiteCtrl.getConformite);
router.get('/conformite/:id',          conformiteCtrl.getConformiteDetail);
router.post('/conformite/:id/repair',  conformiteCtrl.repairConformite);

// ── Annuaire national du personnel (Lot X6, D2) ───────────────
// `/facets` est déclaré avant `/:id` pour ne pas être capté comme un id.
router.get('/annuaire',        annuaireCtrl.searchStaff);
router.get('/annuaire/facets', annuaireCtrl.getFacets);
router.get('/annuaire/:id',    annuaireCtrl.getPerson);

module.exports = router;
