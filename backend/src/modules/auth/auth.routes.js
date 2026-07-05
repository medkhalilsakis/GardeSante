const express = require('express');
const router = express.Router();
const { login, logout, refreshToken, getMe, changePassword } = require('./auth.controller');
const { authenticate } = require('../../middleware/auth');

// @route   POST /api/auth/login
// @desc    Connexion utilisateur
// @access  Public
router.post('/login', login);

// @route   POST /api/auth/logout
// @desc    Déconnexion
// @access  Private
router.post('/logout', authenticate, logout);

// @route   POST /api/auth/refresh
// @desc    Rafraîchir le token d'accès
// @access  Public (avec refresh token)
router.post('/refresh', refreshToken);

// @route   GET /api/auth/me
// @desc    Profil de l'utilisateur connecté
// @access  Private
router.get('/me', authenticate, getMe);

// @route   PUT /api/auth/change-password
// @desc    Changer le mot de passe
// @access  Private
router.put('/change-password', authenticate, changePassword);

module.exports = router;
