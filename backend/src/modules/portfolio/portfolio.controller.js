/**
 * Portfolio Controller — portée déduite du rôle
 * Chef de service → son service | Directeur → son hôpital | Super Admin → plateforme
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { dutyEntries, dateKey } = require('../schedules/spreadsheet-reader');

const emptyDutyStats = () => ({ counts: new Map(), monthly: new Map() });

/**
 * Lit les affectations du Tableur pour un portefeuille. Les plannings qui ne
 * possèdent pas encore `metadata.spreadsheet.rows` restent lus depuis `shifts`
 * afin de préserver les historiques importés avant le registre.
 */
const loadDutyStats = async ({ establishmentIds, departmentId }) => {
  const stats = emptyDutyStats();
  const ids = [...new Set((establishmentIds || []).filter(Boolean))];
  if (!ids.length) return stats;

  const scheduleParams = [ids];
  const scheduleConditions = [
    'sch.establishment_id = ANY($1::uuid[])',
    "sch.status NOT IN ('draft', 'cancelled', 'rejected')",
  ];
  if (departmentId) {
    scheduleParams.push(departmentId);
    scheduleConditions.push(`sch.department_id = $${scheduleParams.length}`);
  }
  const scheduleResult = await query(
    `SELECT sch.id, sch.department_id, sch.schedule_type, sch.metadata,
            TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(sch.end_date, 'YYYY-MM-DD') AS end_date
       FROM schedules sch
      WHERE ${scheduleConditions.join(' AND ')}`,
    scheduleParams
  );

  const recentThreshold = dateKey(new Date(Date.now() - (30 * 24 * 60 * 60 * 1000)));
  const modernScheduleIds = [];
  for (const schedule of scheduleResult.rows) {
    if (!Array.isArray(schedule.metadata?.spreadsheet?.rows)) continue;
    modernScheduleIds.push(schedule.id);
    for (const entry of dutyEntries(schedule, schedule.start_date, schedule.end_date)) {
      if (!entry.userId) continue;
      const current = stats.counts.get(entry.userId) || { total: 0, recent: 0, schedules: new Set() };
      current.total += 1;
      current.schedules.add(schedule.id);
      if (entry.date >= recentThreshold) current.recent += 1;
      stats.counts.set(entry.userId, current);

      const month = String(entry.date || '').slice(0, 7);
      if (month) {
        const monthly = stats.monthly.get(entry.userId) || new Map();
        monthly.set(month, (monthly.get(month) || 0) + 1);
        stats.monthly.set(entry.userId, monthly);
      }
    }
  }

  const legacyParams = [ids];
  const legacyConditions = [
    's.establishment_id = ANY($1::uuid[])',
    "s.status <> 'cancelled'",
    "jsonb_typeof(sch.metadata -> 'spreadsheet' -> 'rows') IS DISTINCT FROM 'array'",
  ];
  if (departmentId) {
    legacyParams.push(departmentId);
    legacyConditions.push(`s.department_id = $${legacyParams.length}`);
  }
  if (modernScheduleIds.length) {
    legacyParams.push(modernScheduleIds);
    legacyConditions.push(`s.schedule_id <> ALL($${legacyParams.length}::uuid[])`);
  }
  const legacyResult = await query(
    `SELECT s.user_id,
            COUNT(*)::integer AS total,
            COUNT(*) FILTER (WHERE s.shift_date >= CURRENT_DATE - INTERVAL '30 days')::integer AS recent,
            ARRAY_AGG(DISTINCT s.schedule_id) AS schedule_ids,
            TO_CHAR(s.shift_date, 'YYYY-MM') AS month,
            COUNT(*)::integer AS month_count
       FROM shifts s
       JOIN schedules sch ON sch.id = s.schedule_id
      WHERE ${legacyConditions.join(' AND ')}
      GROUP BY s.user_id, TO_CHAR(s.shift_date, 'YYYY-MM')`,
    legacyParams
  );
  for (const row of legacyResult.rows) {
    const current = stats.counts.get(row.user_id) || { total: 0, recent: 0, schedules: new Set() };
    current.total += Number(row.total) || 0;
    current.recent += Number(row.recent) || 0;
    (row.schedule_ids || []).forEach((scheduleId) => current.schedules.add(scheduleId));
    stats.counts.set(row.user_id, current);
    if (row.month) {
      const monthly = stats.monthly.get(row.user_id) || new Map();
      monthly.set(row.month, (monthly.get(row.month) || 0) + (Number(row.month_count) || 0));
      stats.monthly.set(row.user_id, monthly);
    }
  }

  return stats;
};

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
         u.establishment_id,
         e.name AS establishment_name,
         json_agg(DISTINCT jsonb_build_object(
           'departmentId', d.id,
           'departmentName', d.name,
           'isHead', ud.is_head,
           'isPrimary', ud.is_primary
         )) FILTER (WHERE d.id IS NOT NULL) AS departments,
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

    // Les affectations du registre moderne vivent dans le Tableur. Les lignes
    // `shifts` ne servent qu'au repli historique, encapsulé par le helper.
    const scopedEstablishmentIds = isSuperAdmin
      ? result.rows.map((row) => row.establishment_id).filter(Boolean)
      : [establishmentId];
    const dutyStats = await loadDutyStats({
      establishmentIds: scopedEstablishmentIds,
      departmentId: roleCode === ROLES.DEPARTMENT_HEAD || roleCode === ROLES.SERVICE_SUPERVISOR
        ? departmentId
        : null,
    });
    const data = result.rows.map((row) => {
      const stats = dutyStats.counts.get(row.id);
      const publicRow = { ...row };
      delete publicRow.establishment_id;
      return {
        ...publicRow,
        total_shifts: stats?.total || 0,
        schedules_count: stats?.schedules?.size || 0,
      };
    });

    return res.json({
      success: true,
      data
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
      `SELECT u.id, u.establishment_id,
              ud.department_id AS primary_department_id
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
        const membership = await query(
          `SELECT 1
             FROM user_departments ud
             JOIN users u ON u.id = ud.user_id
            WHERE ud.user_id = $1
              AND ud.department_id = $2
              AND u.establishment_id = $3
            LIMIT 1`,
          [userId, departmentId, establishmentId]
        );
        if (!membership.rows.length) {
          return res.status(403).json({ success: false, message: 'Accès refusé' });
        }
      } else {
        return res.status(403).json({ success: false, message: 'Accès refusé' });
      }
    }

    // Statistiques de gardes : Tableur moderne, puis repli historique `shifts`.
    const dutyStats = await loadDutyStats({
      establishmentIds: [targetUser.establishment_id],
      departmentId: null,
    });
    const userDutyStats = dutyStats.counts.get(userId) || { total: 0, recent: 0 };
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const firstMonth = dateKey(sixMonthsAgo).slice(0, 7);
    const monthlyBreakdown = [...(dutyStats.monthly.get(userId) || new Map())]
      .filter(([month]) => !firstMonth || month >= firstMonth)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, count]) => ({ month, count }));

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
          total_shifts: userDutyStats.total || 0,
          shifts_last_month: userDutyStats.recent || 0,
          monthly_breakdown: monthlyBreakdown
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
