const { ROLES } = require('../config/constants');

/**
 * Vérifier si l'utilisateur a la permission requise
 */
const requirePermission = (...permissionCodes) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Non authentifié' });
    }

    // Super admin a tous les droits
    if (req.user.isSuperAdmin) return next();

    const hasPermission = permissionCodes.some(code =>
      req.user.permissions.includes(code)
    );

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé : permission insuffisante',
        message_ar: 'تم رفض الوصول: صلاحية غير كافية',
        required: permissionCodes,
      });
    }

    next();
  };
};

/**
 * Vérifier si l'utilisateur appartient à l'établissement de la requête
 */
const requireSameEstablishment = (paramName = 'establishmentId') => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Non authentifié' });

    if (req.user.isSuperAdmin) return next();

    const targetEstablishment = req.params[paramName] || req.body.establishmentId || req.query.establishmentId;

    if (targetEstablishment && targetEstablishment !== req.user.establishmentId) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé : établissement différent',
        message_ar: 'تم رفض الوصول: مؤسسة مختلفة',
      });
    }

    next();
  };
};

/**
 * Vérifier que l'utilisateur a un niveau de rôle suffisant
 */
const requireRoleLevel = (maxLevel) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'Non authentifié' });

    if (req.user.isSuperAdmin) return next();

    if (req.user.roleLevel > maxLevel) {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé : niveau de rôle insuffisant',
        message_ar: 'تم رفض الوصول: مستوى الصلاحية غير كافٍ',
      });
    }

    next();
  };
};

/**
 * Vérifier que l'utilisateur est admin ou super admin
 */
const requireAdmin = requireRoleLevel(1);

/**
 * Injecter automatiquement l'establishmentId dans les requêtes
 * à partir du token JWT (pour les non super-admins)
 */
const injectEstablishment = (req, res, next) => {
  if (req.user && !req.user.isSuperAdmin) {
    // Forcer l'establishment de l'utilisateur authentifié
    req.establishmentId = req.user.establishmentId;
  } else if (req.user && req.user.isSuperAdmin) {
    // Super admin peut spécifier un establishment
    req.establishmentId = req.query.establishmentId || req.body.establishmentId || req.user.establishmentId;
  }
  next();
};

module.exports = {
  requirePermission,
  requireSameEstablishment,
  requireRoleLevel,
  requireAdmin,
  injectEstablishment,
};
