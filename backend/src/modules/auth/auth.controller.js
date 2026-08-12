const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query } = require('../../config/database');
const { JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN } = require('../../config/constants');
const { log, getIp } = require('../history/history.controller');

const generateTokens = (userId, roleCode, establishmentId) => {
  const payload = { userId, roleCode, establishmentId };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
  return { accessToken, refreshToken };
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email et mot de passe requis' });
  }

  const result = await query(
    `SELECT u.*, r.code AS role_code, r.name AS role_name, r.name_ar AS role_name_ar, r.level AS role_level,
            e.name AS establishment_name, e.name_ar AS establishment_name_ar, e.code AS establishment_code, e.type AS establishment_type
     FROM users u
     JOIN roles r ON u.role_id = r.id
     JOIN establishments e ON u.establishment_id = e.id
     WHERE LOWER(u.email) = LOWER($1) AND u.is_active = TRUE AND e.is_active = TRUE`,
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({
      success: false,
      message: 'Identifiants incorrects',
      message_ar: 'بيانات الدخول غير صحيحة',
    });
  }

  const user = result.rows[0];
  const isValid = await bcrypt.compare(password, user.password_hash);

  if (!isValid) {
    return res.status(401).json({
      success: false,
      message: 'Identifiants incorrects',
      message_ar: 'بيانات الدخول غير صحيحة',
    });
  }

  // Compte archivé par le Super Admin : aucune connexion possible tant qu'il
  // n'est pas réactivé. Contrôlé APRÈS le mot de passe pour ne rien révéler
  // sur l'existence du compte à un tiers.
  if (user.archived_at) {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_ARCHIVED',
      message: 'Ce compte est archivé. Contactez l\'administrateur de la plateforme.',
      message_ar: 'هذا الحساب مؤرشف. يرجى الاتصال بمسؤول المنصة.',
    });
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.role_code, user.establishment_id);

  // Sauvegarder le refresh token et last_login
  await query(
    'UPDATE users SET refresh_token = $1, last_login = NOW() WHERE id = $2',
    [refreshToken, user.id]
  );

  // Journaliser la connexion
  log({
    userId: user.id,
    action: 'login',
    category: 'auth',
    description: `Connexion réussie depuis ${req.headers['user-agent']?.substring(0, 60) || 'inconnu'}`,
    descriptionAr: 'تسجيل دخول ناجح',
    ipAddress: getIp(req),
    userAgent: req.headers['user-agent'],
    severity: 'info',
  });

  return res.json({
    success: true,
    message: 'Connexion réussie',
    data: {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        firstNameAr: user.first_name_ar,
        lastNameAr: user.last_name_ar,
        matricule: user.matricule,
        speciality: user.speciality,
        grade: user.grade,
        avatarUrl: user.avatar_url,
        preferredLanguage: user.preferred_language,
        roleCode: user.role_code,
        roleName: user.role_name,
        roleNameAr: user.role_name_ar,
        roleLevel: user.role_level,
        establishmentId: user.establishment_id,
        establishmentName: user.establishment_name,
        establishmentNameAr: user.establishment_name_ar,
        establishmentCode: user.establishment_code,
        establishmentType: user.establishment_type,
        lastLogin: user.last_login,
      },
    },
  });
};

const logout = async (req, res) => {
  log({
    userId: req.user.id,
    action: 'logout',
    category: 'auth',
    description: 'Déconnexion',
    descriptionAr: 'تسجيل خروج',
    ipAddress: getIp(req),
    severity: 'info',
  });
  await query('UPDATE users SET refresh_token = NULL WHERE id = $1', [req.user.id]);
  return res.json({ success: true, message: 'Déconnecté avec succès' });
};

const refreshToken = async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Refresh token requis' });

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_REFRESH_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Refresh token invalide ou expiré' });
  }

  const result = await query(
    'SELECT id, role_id, establishment_id, refresh_token, is_active, archived_at FROM users WHERE id = $1',
    [decoded.userId]
  );

  if (!result.rows[0] || result.rows[0].refresh_token !== token || !result.rows[0].is_active) {
    return res.status(401).json({ success: false, message: 'Session invalide' });
  }

  // Compte archivé : aucun jeton n'est renouvelé (l'archivage efface déjà le
  // refresh_token, ce contrôle est la ceinture en plus des bretelles).
  if (result.rows[0].archived_at) {
    return res.status(403).json({
      success: false,
      code: 'ACCOUNT_ARCHIVED',
      message: 'Ce compte est archivé. Contactez l\'administrateur de la plateforme.',
      message_ar: 'هذا الحساب مؤرشف. يرجى الاتصال بمسؤول المنصة.',
    });
  }

  const user = result.rows[0];
  const tokens = generateTokens(user.id, decoded.roleCode, user.establishment_id);

  await query('UPDATE users SET refresh_token = $1 WHERE id = $2', [tokens.refreshToken, user.id]);

  return res.json({ success: true, data: tokens });
};

const getMe = async (req, res) => {
  const result = await query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
            u.matricule, u.speciality, u.grade, u.avatar_url, u.preferred_language,
            u.phone, u.is_on_leave, u.last_login, u.created_at,
            r.code AS role_code, r.name AS role_name, r.name_ar AS role_name_ar, r.level AS role_level,
            e.id AS establishment_id, e.name AS establishment_name, e.name_ar AS establishment_name_ar,
            e.code AS establishment_code, e.type AS establishment_type, e.logo_url
     FROM users u
     JOIN roles r ON u.role_id = r.id
     JOIN establishments e ON u.establishment_id = e.id
     WHERE u.id = $1`,
    [req.user.id]
  );

  const user = result.rows[0];
  
  // Charger les services de l'utilisateur
  const depts = await query(
    `SELECT d.id, d.name, d.name_ar, d.code, ud.is_head, ud.is_primary
     FROM departments d
     JOIN user_departments ud ON d.id = ud.department_id
     WHERE ud.user_id = $1`,
    [req.user.id]
  );

  return res.json({
    success: true,
    data: {
      ...user,
      permissions: req.user.permissions,
      departments: depts.rows,
    },
  });
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Mots de passe requis' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'Le mot de passe doit contenir au moins 8 caractères' });
  }

  const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);

  if (!isValid) {
    return res.status(400).json({ success: false, message: 'Mot de passe actuel incorrect' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, req.user.id]);

  return res.json({ success: true, message: 'Mot de passe modifié avec succès' });
};

module.exports = { login, logout, refreshToken, getMe, changePassword };
