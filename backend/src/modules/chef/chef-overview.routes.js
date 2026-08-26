/**
 * Routes de la vue d'ensemble du chef de service (Lot Z3).
 *
 * Montage neuf sous `/api/chef` : aucun préfixe existant n'est touché.
 *
 * `injectEstablishment` ne sert qu'à laisser un super admin viser un
 * établissement précis ; la portée réelle — quel service, et le droit de le lire —
 * est décidée par `resolveDepartment` dans le contrôleur, comme le font déjà
 * `supervision.controller.js` et `staff-loans-stats.controller.js`.
 *
 * Pas de `requirePermission` : il n'existe pas de permission dédiée au pilotage
 * d'un service, et réutiliser `stats.read` élargirait la lecture au-delà de
 * l'encadrement. Le filtrage par fonction est donc fait dans le contrôleur.
 */

const express = require('express');
const router = express.Router();
const ctrl = require('./chef-overview.controller');
const { authenticate } = require('../../middleware/auth');
const { injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

router.get('/overview', ctrl.getChefOverview);

module.exports = router;
