/**
 * Routes de la vue d'ensemble du directeur (Lot Y1).
 *
 * Montage neuf sous `/api/director` : aucun préfixe existant n'est touché.
 * La portée est décidée par le contrôleur (`resolveScope`) — `injectEstablishment`
 * ne sert qu'à laisser un super admin viser un établissement précis.
 *
 * Pas de `requirePermission` : il n'existe pas de permission dédiée au pilotage,
 * et réutiliser `stats.read` élargirait la lecture à des rôles de service. Le
 * filtrage par fonction est donc fait dans le contrôleur, comme le font déjà
 * `supervision.controller.js` et `staff-loans-stats.controller.js`.
 */

const express = require('express');
const router = express.Router();
const ctrl = require('./director-overview.controller');
const { authenticate } = require('../../middleware/auth');
const { injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

router.get('/overview', ctrl.getDirectorOverview);

module.exports = router;
