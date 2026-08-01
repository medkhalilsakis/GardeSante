const jwt = require('jsonwebtoken');
const { JWT_SECRET, ROLES } = require('../config/constants');
const { query } = require('../config/database');

/**
 * Middleware d'authentification JWT
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    // Support token from query param (for file downloads via window.open)
    const queryToken = req.query?.token;

    if (!authHeader && !queryToken) {
      return res.status(401).json({
        success: false,
        message: 'Token d\'authentification requis',
        message_ar: 'مطلوب رمز المصادقة',
      });
    }

    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : queryToken;
    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          message: 'Session expirée, veuillez vous reconnecter',
          message_ar: 'انتهت الجلسة، يرجى تسجيل الدخول مجددًا',
        });
      }
      return res.status(401).json({
        success: false,
        code: 'TOKEN_INVALID',
        message: 'Token invalide',
        message_ar: 'رمز غير صالح',
      });
    }

    // Charger l'utilisateur depuis la DB
    const result = await query(
      `SELECT u.*, r.code AS role_code, r.level AS role_level, r.name AS role_name,
              e.name AS establishment_name, e.code AS establishment_code, e.is_active AS establishment_active
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN establishments e ON u.establishment_id = e.id
       WHERE u.id = $1 AND u.is_active = TRUE`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur introuvable ou désactivé',
        message_ar: 'المستخدم غير موجود أو معطل',
      });
    }

    const user = result.rows[0];

    // Vérifier que l'utilisateur peut se connecter (les médecins/résidents n'ont pas d'accès plateforme)
    if (user.can_login === false) {
      return res.status(403).json({
        success: false,
        code: 'NO_LOGIN_ACCESS',
        message: 'Ce compte ne dispose pas d\'accès à la plateforme. Contactez votre directeur.',
        message_ar: 'هذا الحساب لا يملك صلاحية الدخول للمنصة. تواصل مع المدير.',
      });
    }

    if (!user.establishment_active) {
      return res.status(403).json({
        success: false,
        message: 'Établissement désactivé',
        message_ar: 'المؤسسة غير مفعلة',
      });
    }

    // Charger les permissions du rôle.
    // Si la couche RBAC n'est pas encore initialisée (migration partielle),
    // on évite de faire tomber toute l'API: permissions vides et fallback super admin.
    let permissionCodes = [];
    try {
      const permsResult = await query(
        `SELECT p.code FROM permissions p
         JOIN role_permissions rp ON p.id = rp.permission_id
         WHERE rp.role_id = $1`,
        [user.role_id]
      );
      permissionCodes = permsResult.rows.map((r) => r.code);
    } catch (rbacErr) {
      if (rbacErr.code === '42P01') {
        console.warn('⚠️  RBAC tables missing (permissions/role_permissions). Continuing with empty permissions.');
      } else {
        throw rbacErr;
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      roleId: user.role_id,
      roleCode: user.role_code,
      roleLevel: user.role_level,
      roleName: user.role_name,
      establishmentId: user.establishment_id,
      establishmentName: user.establishment_name,
      establishmentCode: user.establishment_code,
      isSuperAdmin: user.role_code === ROLES.SUPER_ADMIN,
      permissions: user.role_code === ROLES.SUPER_ADMIN ? ['*'] : permissionCodes,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur d\'authentification',
    });
  }
};

/**
 * Middleware optionnel (ne bloque pas si pas de token)
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();
  return authenticate(req, res, next);
};

module.exports = { authenticate, optionalAuth };
