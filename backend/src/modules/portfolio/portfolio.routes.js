const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const portfolioCtrl = require('./portfolio.controller');

// Toutes les routes nécessitent l'authentification
router.use(authenticate);

// Liste des agents (portée déduite du rôle)
router.get('/', portfolioCtrl.getPortfolio);

// Détails complets d'un agent spécifique
router.get('/:userId/details', portfolioCtrl.getUserDetails);

module.exports = router;
