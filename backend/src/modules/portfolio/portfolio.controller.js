/**
 * Portfolio Controller — portée déduite du rôle
 * Chef de service → son service | Directeur → son hôpital | Super Admin → plateforme
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');

/**
 * GET /api/portfolio
 * GET /api/portfolio/:userId (pour consulter un agent spécifique)
 */
const getPortfolio = async (req, res) => {
  try {
    const { roleCode, establishmentId, departmentId, isSuperAdmin } = req.user;
    const { userId } = req.params;

    let whereConditions = ['u.is_active = TRUE'];
    let params = [];

    // Portée par rôle
    if (isSuperAdmin) {
      // Super Admin → tous les agents de la plateforme
    } else if (roleCode === ROLES.DIRECTOR || roleCode === ROLES.HOSPITAL_ADMIN) {
      // Directeur → son hôpital uniquement
      whereConditions.push(`u.establishment_id = $${params.length + 1}`);
      params.push(establishmentId);
    } else if (roleCode === ROLES.GENERAL_SUPERVISOR) {
      // Surveillant Général → son hôpital
      whereConditions.push(`u.establishment_id = $${params.length + 1}`);
      params.push(establishmentId);
    } else if (roleCode === ROLES.DEPARTMENT_HEAD || roleCode === ROLES.SERVICE_SUPERVISOR) {
      // Chef de service / Surveillant de service → son service uniquement
      if (!departmentId) {
        return res.status(403).json({
          success: false,
          message: 'Votre compte n\'est associé à aucun service',
          message_ar: 'حسابك غير مرتبط بأي قسم'
        });
      }
      whereConditions.push(`ud.department_id = $${params.length + 1}`);
      params.push(departmentId);
    } else {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé',
        message_ar: 'غير مصرح'
      });
    }

    // Filtrage par agent spécifique si demandé
    if (userId) {
      whereConditions.push(`u.id = $${params.length + 1}`);
      params.push(userId);
    }

    // Requête principale
    const result = await query(
      `SELECT
         u.id, u.first_name, u.last_name, u.email, u.phone, u.avatar_url,
         u.matricule, u.speciality, u.grade,
         r.code AS role_code, r.name AS role_name,
         e.name AS establishment_name,
         json_agg(DISTINCT jsonb_build_object(
           'departmentId', d.id,
           'departmentName', d.name,
           'isHead', ud.is_head,
           'isPrimary', ud.is_primary
         )) FILTER (WHERE d.id IS NOT NULL) AS departments,
         (SELECT COUNT(*) FROM shifts s WHERE s.user_id = u.id) AS total_shifts,
         (SELECT COUNT(DISTINCT s.schedule_id) FROM shifts s WHERE s.user_id = u.id) AS schedules_count,
         (SELECT COUNT(*) FROM absences a WHERE a.user_id = u.id AND a.kind = 'shift_absence') AS shift_absences_count,
         (SELECT COUNT(*) FROM absences a WHERE a.user_id = u.id AND a.kind = 'leave' AND a.end_date >= CURRENT_DATE) AS active_leaves_count
       FROM users u
       JOIN roles r ON u.role_id = r.id
       JOIN establishments e ON u.establishment_id = e.id
       LEFT JOIN user_departments ud ON u.id = ud.user_id
       LEFT JOIN departments d ON ud.department_id = d.id
       WHERE ${whereConditions.join(' AND ')}
       GROUP BY u.id, r.code, r.name, e.name
       ORDER BY u.last_name, u.first_name`,
      params
    );

    return res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Portfolio error:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement du portfolio',
      message_ar: 'خطأ في تحميل المحفظة'
    });
  }
};

/**
 * GET /api/portfolio/:userId/details
 * Détails complets d'un agent : statistiques de gardes, absences, congés, historique récent
 */
const getUserDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const { roleCode, establishmentId, departmentId, isSuperAdmin } = req.user;

    // Vérifier que l'utilisateur a accès à cet agent (même portée que getPortfolio)
    const accessCheck = await query(
      `SELECT u.id, u.establishment_id, ud.department_id
       FROM users u
       LEFT JOIN user_departments ud ON u.id = ud.user_id AND ud.is_primary = TRUE
       WHERE u.id = $1`,
      [userId]
    );

    if (accessCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable',
        message_ar: 'المستخدم غير موجود'
      });
    }

    const targetUser = accessCheck.rows[0];

    if (!isSuperAdmin) {
      if (roleCode === ROLES.DIRECTOR || roleCode === ROLES.HOSPITAL_ADMIN || roleCode === ROLES.GENERAL_SUPERVISOR) {
        if (targetUser.establishment_id !== establishmentId) {
          return res.status(403).json({ success: false, message: 'Accès refusé' });
        }
      } else if (roleCode === ROLES.DEPARTMENT_HEAD || roleCode === ROLES.SERVICE_SUPERVISOR) {
        if (targetUser.department_id !== departmentId) {
          return res.status(403).json({ success: false, message: 'Accès refusé' });
        }
      } else {
        return res.status(403).json({ success: false, message: 'Accès refusé' });
      }
    }

    // Statistiques de gardes (6 derniers mois)
    const shiftsStats = await query(
      `SELECT
         (SELECT COUNT(*) FROM shifts WHERE user_id = $1) AS total_shifts,
         (SELECT COUNT(*) FROM shifts WHERE user_id = $1 AND shift_date >= CURRENT_DATE - INTERVAL '30 days') AS shifts_last_month
      `,
      [userId]
    );

    // Répartition mensuelle séparée (évite la jointure complexe avec subquery circulaire)
    const monthlyBreakdown = await query(
      `SELECT
         TO_CHAR(sc.start_date, 'YYYY-MM') AS month,
         COUNT(*)::INTEGER AS count
       FROM shifts s
       JOIN schedules sc ON s.schedule_id = sc.id
       WHERE s.user_id = $1 AND sc.start_date >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY TO_CHAR(sc.start_date, 'YYYY-MM')
       ORDER BY month`,
      [userId]
    );

    // Absences signalées en garde courante
    const shiftAbsences = await query(
      `SELECT a.id, a.start_date, a.end_date, a.start_time, a.end_time, a.reason,
              at.name AS type_name, a.is_justified, a.created_at
       FROM absences a
       JOIN absence_types at ON a.absence_type_id = at.id
       WHERE a.user_id = $1 AND a.kind = 'shift_absence'
       ORDER BY a.start_date DESC LIMIT 10`,
      [userId]
    );

    // Congés (actifs et à venir)
    const leaves = await query(
      `SELECT a.id, a.start_date, a.end_date, at.name AS type_name, at.color, a.status
       FROM absences a
       JOIN absence_types at ON a.absence_type_id = at.id
       WHERE a.user_id = $1 AND a.kind = 'leave' AND a.end_date >= CURRENT_DATE
       ORDER BY a.start_date`,
      [userId]
    );

    // Historique récent (10 dernières actions)
    const recentHistory = await query(
      `SELECT action, description, category, severity, created_at
       FROM activity_logs
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );

    return res.json({
      success: true,
      data: {
        shiftsStats: {
          total_shifts: parseInt(shiftsStats.rows[0]?.total_shifts || 0),
          shifts_last_month: parseInt(shiftsStats.rows[0]?.shifts_last_month || 0),
          monthly_breakdown: monthlyBreakdown.rows
        },
        shiftAbsences: shiftAbsences.rows,
        leaves: leaves.rows,
        recentHistory: recentHistory.rows
      }
    });
  } catch (err) {
    console.error('User details error:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement des détails',
      message_ar: 'خطأ في تحميل التفاصيل'
    });
  }
};

module.exports = {
  getPortfolio,
  getUserDetails
};
