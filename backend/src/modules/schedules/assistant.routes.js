/**
 * Routes de l'Assistant Intelligent V2 (Lot 7).
 *
 * Surface neuve, montée sur `/api/assistant` : les routes de
 * `schedule-builder.routes.js` ne sont pas touchées, donc l'assistant actuel
 * (`/schedule-builder/generate-proposals`) continue de fonctionner à l'identique.
 *
 * Le gating de rôle vit dans le contrôleur (`canBuild`), au plus près de la
 * décision, comme dans `admin-oversight.controller.js`.
 */

const express = require('express');
const router = express.Router();

const { authenticate } = require('../../middleware/auth');
const assistant = require('./assistant.controller');

router.use(authenticate);

// Préparation et génération
router.get('/context',      assistant.getContext);
router.post('/generate',    assistant.generate);
router.post('/validate',    assistant.validate);
router.post('/apply-fixes', assistant.applyFixes);
router.post('/confirm',     assistant.confirm);

// Briefs réutilisables
router.get('/briefs',           assistant.listBriefs);
router.post('/briefs',          assistant.saveBrief);
router.post('/briefs/:id/use',  assistant.useBrief);
router.delete('/briefs/:id',    assistant.deleteBrief);

module.exports = router;
