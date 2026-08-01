const express = require('express');
const router  = express.Router();
const ctrl    = require('./history.controller');
const { authenticate } = require('../../middleware/auth');
const { injectEstablishment } = require('../../middleware/rbac');

router.use(authenticate, injectEstablishment);

router.get('/mine',         ctrl.getMine);
router.get('/categories',   ctrl.getCategories);
router.get('/all',          ctrl.getAll);           // super_admin
router.get('/users',        ctrl.getUsersList);     // super_admin — pour le filtre
router.get('/users/:id',    ctrl.getUserHistory);   // super_admin

module.exports = router;
