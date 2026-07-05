/**
 * Gestionnaire d'erreurs global Express
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.message);
  if (process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Erreur de validation Joi
  if (err.name === 'ValidationError' || err.isJoi) {
    return res.status(400).json({
      success: false,
      message: 'Données invalides',
      message_ar: 'بيانات غير صالحة',
      errors: err.details?.map(d => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  // Erreur PostgreSQL
  if (err.code) {
    switch (err.code) {
      case '23505': // unique_violation
        return res.status(409).json({
          success: false,
          message: 'Cette entrée existe déjà',
          message_ar: 'هذا السجل موجود مسبقاً',
          detail: err.detail,
        });
      case '23503': // foreign_key_violation
        return res.status(400).json({
          success: false,
          message: 'Référence invalide',
          message_ar: 'مرجع غير صالح',
        });
      case '23514': // check_violation
        return res.status(400).json({
          success: false,
          message: 'Données non conformes aux règles métier',
          message_ar: 'البيانات لا تتوافق مع قواعد العمل',
        });
    }
  }

  // Erreur JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Token invalide' });
  }

  // Erreur par défaut
  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    success: false,
    message: err.message || 'Erreur interne du serveur',
    message_ar: 'خطأ داخلي في الخادم',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * Middleware pour les routes non trouvées
 */
const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route introuvable: ${req.method} ${req.path}`,
    message_ar: 'المسار غير موجود',
  });
};

module.exports = { errorHandler, notFound };
