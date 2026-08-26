/**
 * Signalement d'absence / retard sur une garde publiée, courante ou passée.
 * Ouvert au chef de service, au surveillant de service, au surveillant général
 * et au directeur (appel du jour, point 6).
 * Le contrôleur absences.controller.js existant n'est pas modifié.
 */

const { query, transaction } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToUser, emitToDepartment, emitToEstablishment } = require('../../realtime/emit');
const history = require('../history/history.controller');
const { ensureDefaultAbsenceTypes } = require('./absence-types.service');
const { rosterOnDate, dateKey } = require('../schedules/spreadsheet-reader');

const ALLOWED_ROLES = [
  ROLES.DEPARTMENT_HEAD,
  ROLES.SERVICE_SUPERVISOR,
  ROLES.GENERAL_SUPERVISOR,
  // Le directeur couvre tout l'hôpital et n'appartient à aucun service (point 1) :
  // le service est déduit du planning, jamais de `user_departments`.
  ROLES.DIRECTOR
];

/**
 * POST /api/absences-shift
 * Signale un agent absent ou en retard dans une garde courante.
 */
const reportShiftAbsence = async (req, res) => {
  try {
    const { roleCode, establishmentId, id: reporterId } = req.user;

    if (!ALLOWED_ROLES.includes(roleCode) && !req.user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Seuls les chefs de service, surveillants, surveillants généraux et directeurs peuvent signaler une absence',
        message_ar: 'فقط رؤساء الأقسام والمشرفون والمديرون يمكنهم الإبلاغ عن غياب'
      });
    }

    const {
      userId, scheduleId, shiftId, absenceTypeId, absenceKind,
      date, startTime, endTime, reason, isJustified, severity, lateMinutes
    } = req.body;

    if (!userId || !date || (!absenceTypeId && !['late', 'absence'].includes(absenceKind))) {
      return res.status(400).json({
        success: false,
        message: 'Agent, type d\'absence et date sont obligatoires',
        message_ar: 'الموظف والنوع والتاريخ مطلوبة'
      });
    }
    if (typeof isJustified !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Indiquez si l’absence ou le retard est justifié ou non',
        message_ar: 'يجب تحديد ما إذا كان الغياب أو التأخير مبرراً أم لا'
      });
    }

    // Le type doit être un type d'absence (pas un congé)
    await ensureDefaultAbsenceTypes(establishmentId);

    let typeCheck;
    if (absenceTypeId) {
      typeCheck = await query(
        `SELECT id, name, code, is_leave FROM absence_types
         WHERE id = $1 AND establishment_id = $2 AND is_active = TRUE`,
        [absenceTypeId, establishmentId]
      );
    }
    if (!typeCheck?.rows.length && ['late', 'absence'].includes(absenceKind)) {
      const code = absenceKind === 'late' ? 'retard' : 'absence_injustifiee';
      typeCheck = await query(
        `SELECT id, name, code, is_leave FROM absence_types
         WHERE establishment_id = $1 AND code = $2 AND is_active = TRUE`,
        [establishmentId, code]
      );
    }
    if (!typeCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Type d\'absence introuvable' });
    }
    if (typeCheck.rows[0].is_leave) {
      return res.status(400).json({
        success: false,
        message: 'Ce type est un congé : utilisez la gestion des congés, pas le signalement en garde',
        message_ar: 'هذا النوع إجازة: استخدم إدارة الإجازات'
      });
    }

    // RÈGLE : garde courante uniquement — le planning doit être soumis et la date dans la période
    let departmentId = null;
    if (scheduleId) {
      const sched = await query(
        `SELECT id, department_id, status, metadata, schedule_type,
                TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(end_date,   'YYYY-MM-DD') AS end_date,
                planning_state(status, start_date, end_date) AS state
         FROM schedules
         WHERE id = $1 AND establishment_id = $2
           AND status NOT IN ('draft','rejected')`,
        [scheduleId, establishmentId]
      );
      if (!sched.rows.length) {
        return res.status(404).json({ success: false, message: 'Planning introuvable' });
      }
      const s = sched.rows[0];
      const d = String(date).slice(0, 10);
      if (d > dateKey(new Date())) {
        return res.status(400).json({
          success: false,
          message: 'Une garde future ne peut pas être pointée',
          message_ar: 'الإبلاغ ممكن فقط في وردية جارية'
        });
      }
      if (d < s.start_date || d > s.end_date) {
        return res.status(400).json({
          success: false,
          message: 'La date doit se situer dans la période de garde',
          message_ar: 'التاريخ يجب أن يكون داخل فترة الوردية'
        });
      }
      departmentId = s.department_id;

      let canWriteDepartment = false;
      if (req.user.isSuperAdmin || [ROLES.GENERAL_SUPERVISOR, ROLES.DIRECTOR].includes(roleCode)) {
        const allowed = await query(
          'SELECT id FROM departments WHERE id = $1 AND establishment_id = $2',
          [departmentId, establishmentId]
        );
        canWriteDepartment = allowed.rows.length > 0;
      } else {
        const allowed = await query(
          'SELECT department_id FROM user_departments WHERE user_id = $1 AND department_id = $2',
          [reporterId, departmentId]
        );
        canWriteDepartment = allowed.rows.length > 0;
      }
      if (!canWriteDepartment) {
        return res.status(403).json({ success: false, message: 'Ce service ne fait pas partie de votre périmètre' });
      }

      if (!rosterOnDate(s, d).some((entry) => entry.userId === userId)) {
        return res.status(400).json({ success: false, message: 'Cet agent n’était pas de garde à cette date' });
      }

      const orphanAbsence = await query(
        `SELECT id FROM absences
         WHERE schedule_id = $1 AND user_id = $2 AND start_date = $3::date
           AND kind = 'shift_absence' AND status <> 'cancelled'
         LIMIT 1`,
        [scheduleId, userId, d]
      );
      if (orphanAbsence.rows.length) {
        return res.status(409).json({ success: false, message: 'Une absence ou un retard existe déjà pour cette garde' });
      }

      const duplicate = await query(
        `SELECT id FROM shift_events
         WHERE schedule_id = $1 AND user_id = $2
           AND COALESCE(duty_date, (event_time AT TIME ZONE 'Africa/Tunis')::date) = $3::date
           AND event_type = ANY($4::text[])
         LIMIT 1`,
        [scheduleId, userId, d, ['presence', 'absence', 'late']]
      );
      if (duplicate.rows.length) {
        return res.status(409).json({ success: false, message: 'Cet agent a déjà été pointé pour cette garde' });
      }
    }

    // Compatibilité avec les signalements hors planning déjà pris en charge par
    // le formulaire de surveillance : le service est alors déduit de l'agent.
    if (!departmentId) {
      const ud = await query(
        `SELECT department_id FROM user_departments
         WHERE user_id = $1 AND is_primary = TRUE LIMIT 1`,
        [userId]
      );
      departmentId = ud.rows[0]?.department_id || req.user.departmentId;
    }
    if (!scheduleId && departmentId) {
      let canWriteDepartment = false;
      if (req.user.isSuperAdmin || [ROLES.GENERAL_SUPERVISOR, ROLES.DIRECTOR].includes(roleCode)) {
        const allowed = await query(
          'SELECT id FROM departments WHERE id = $1 AND establishment_id = $2',
          [departmentId, establishmentId]
        );
        canWriteDepartment = allowed.rows.length > 0;
      } else {
        const allowed = await query(
          'SELECT department_id FROM user_departments WHERE user_id = $1 AND department_id = $2',
          [reporterId, departmentId]
        );
        canWriteDepartment = allowed.rows.length > 0;
      }
      if (!canWriteDepartment) {
        return res.status(403).json({ success: false, message: 'Ce service ne fait pas partie de votre périmètre' });
      }
    }
    if (!departmentId) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de déterminer le service de cet agent',
        message_ar: 'لا يمكن تحديد قسم هذا الموظف'
      });
    }

    // Durée du retard (point 1) — n'a de sens que pour un type « retard ».
    // Le type fait foi, pas le client : une durée envoyée avec une absence est
    // simplement ignorée plutôt que rejetée, pour ne casser aucun appelant.
    const isLate = typeCheck.rows[0].name.toLowerCase().includes('retard')
      || String(typeCheck.rows[0].code || '').toLowerCase() === 'retard';
    const isCatchup = String(date).slice(0, 10) < dateKey(new Date());
    let minutes = null;
    if (isLate && lateMinutes !== undefined && lateMinutes !== null && lateMinutes !== '') {
      const n = Number.parseInt(lateMinutes, 10);
      if (!Number.isFinite(n) || n < 0 || n > 1440) {
        return res.status(400).json({
          success: false,
          message: 'La durée du retard doit être un nombre de minutes entre 0 et 1440',
          message_ar: 'مدة التأخير يجب أن تكون بين 0 و 1440 دقيقة'
        });
      }
      minutes = n;
    }

    const absence = await transaction(async (client) => {
      const inserted = await client.query(
      `INSERT INTO absences
         (establishment_id, department_id, user_id, shift_id, schedule_id, absence_type_id,
          start_date, end_date, start_time, end_time, reason, declared_by,
          kind, reported_by_role, is_justified, notified_at, status, late_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$7::date,$8,$9,$10,$11,
               'shift_absence',$12,$13,NOW(),'approved',$14)
       RETURNING *`,
      [
        establishmentId, departmentId, userId, shiftId || null, scheduleId || null,
        typeCheck.rows[0].id, String(date).slice(0, 10), startTime || null, endTime || null,
        reason || null, reporterId, roleCode, isJustified === true, minutes
      ]
    );
      const createdAbsence = inserted.rows[0];

    // Marquer la garde comme absente si elle est identifiée
      if (shiftId) {
        await client.query(
        `UPDATE shifts SET status = 'absent', updated_at = NOW()
         WHERE id = $1 AND schedule_id = $2 AND user_id = $3
           AND shift_date = $4::date AND establishment_id = $5`,
        [shiftId, scheduleId, userId, String(date).slice(0, 10), establishmentId]
        );
      }

    // Journal de service — la durée voyage aussi dans `metadata` (colonne JSONB
    // déjà présente) pour que l'historique de l'appel l'affiche sans jointure.
      await client.query(
      `INSERT INTO shift_events
         (establishment_id, department_id, schedule_id, shift_id, event_type,
          user_id, reported_by, title, description, severity, metadata, duty_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::date)`,
      [
        establishmentId, departmentId, scheduleId || null, shiftId || null,
        isLate ? 'late' : 'absence',
        userId, reporterId,
        minutes !== null
          ? `${typeCheck.rows[0].name} signalé(e) — ${minutes} min`
          : `${typeCheck.rows[0].name} signalé(e)`,
        reason || null,
        severity || 'warning',
        JSON.stringify({
          absenceId: createdAbsence.id,
          typeName: typeCheck.rows[0].name,
          isJustified,
          ...(minutes !== null ? { lateMinutes: minutes } : {}),
        }),
        String(date).slice(0, 10),
      ]
      );

    // Alerte service
      if (!isCatchup) await client.query(
        `INSERT INTO service_alerts
         (establishment_id, department_id, schedule_id, alert_type, severity, title, message, entity_type, entity_id)
       VALUES ($1,$2,$3,'staff_absent',$4,$5,$6,'absences',$7)`,
      [
        establishmentId, departmentId, scheduleId || null,
        severity || 'warning',
        'Personnel absent signalé',
        `${typeCheck.rows[0].name} le ${String(date).slice(0, 10)}`,
        createdAbsence.id
      ]
      );

      return createdAbsence;
    });

    await history.log({
      userId: reporterId,
      action: 'absence_signalee',
      category: 'absences',
      description: `Absence signalée pour l'agent ${userId} le ${String(date).slice(0, 10)}`,
      entityType: 'absences',
      entityId: absence.id,
      metadata: {
        scheduleId,
        shiftId,
        reportedByRole: roleCode,
        dutyDate: String(date).slice(0, 10),
        isCatchup,
        isJustified,
      },
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent'],
      severity: 'warning'
    });

    // Notifier l'agent concerné
    await createNotification({
      establishmentId,
      recipientId: userId,
      senderId: reporterId,
      type: 'absence_reported',
      title: 'Absence signalée',
      titleAr: 'تم الإبلاغ عن غياب',
      message: `Une absence (${typeCheck.rows[0].name}) a été signalée pour le ${String(date).slice(0, 10)}.`,
      entityType: 'absences',
      entityId: absence.id,
      priority: 'high'
    });

    // Temps réel
    emitToUser(req.app, userId, 'absence:reported', { absenceId: absence.id, scheduleId, userId });
    emitToUser(req.app, userId, 'notification:new', { type: 'absence_reported' });
    emitToDepartment(req.app, departmentId, 'absence:reported', { absenceId: absence.id, scheduleId, userId });
    // Même raison qu'au journal : la supervision (directeur, surveillant général)
    // n'est membre d'aucun service et ne recevait donc que `alert:new`. Cette
    // ligne fait remonter le signalement à l'hôpital pour que « Garde en direct »
    // se mette à jour sans attendre le rafraîchissement périodique.
    emitToEstablishment(req.app, establishmentId, 'absence:reported', { absenceId: absence.id, scheduleId, userId });
    emitToEstablishment(req.app, establishmentId, 'alert:new', { type: 'staff_absent', userId });

    return res.status(201).json({ success: true, data: absence, message: 'Absence signalée' });
  } catch (err) {
    console.error('reportShiftAbsence error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Cet agent a déjà été pointé pour cette garde' });
    }
    return res.status(500).json({ success: false, message: 'Erreur lors du signalement' });
  }
};

/**
 * GET /api/absences-shift
 * Liste les signalements en garde courante, portée déduite du rôle.
 */
const listShiftAbsences = async (req, res) => {
  try {
    const { roleCode, establishmentId, departmentId, isSuperAdmin } = req.user;
    const { scheduleId, userId, from, to, limit = 50 } = req.query;

    const conditions = ["a.kind = 'shift_absence'"];
    const params = [];

    if (isSuperAdmin) {
      if (req.query.establishmentId) {
        conditions.push(`a.establishment_id = $${params.length + 1}`);
        params.push(req.query.establishmentId);
      }
    } else {
      conditions.push(`a.establishment_id = $${params.length + 1}`);
      params.push(establishmentId);

      // Chef / surveillant de service : limité à ses services.
      //
      // `req.user.departmentId` (middleware/auth.js) est le service **primaire**.
      // S'y tenir seul avait deux effets : le sélecteur de service du tableau de
      // bord n'avait aucun effet sur l'onglet « Absences » — un chef de deux
      // services ne voyait jamais les signalements du second — et un compte sans
      // ligne `is_primary` recevait une liste vide alors qu'il appartient bien à
      // un service. On honore donc `?departmentId=` quand ce service est l'un des
      // siens, et à défaut on ouvre sur l'ensemble de ses services (ce qui, pour
      // un chef mono-service, est exactement le comportement actuel).
      if ([ROLES.DEPARTMENT_HEAD, ROLES.SERVICE_SUPERVISOR].includes(roleCode)) {
        const mine = await query(
          'SELECT department_id FROM user_departments WHERE user_id = $1',
          [req.user.id]
        );
        const myIds = mine.rows.map((r) => r.department_id);
        const asked = req.query.departmentId || null;

        if (asked && myIds.includes(asked)) {
          conditions.push(`a.department_id = $${params.length + 1}`);
          params.push(asked);
        } else if (myIds.length > 0) {
          conditions.push(`a.department_id = ANY($${params.length + 1}::uuid[])`);
          params.push(myIds);
        } else if (departmentId) {
          conditions.push(`a.department_id = $${params.length + 1}`);
          params.push(departmentId);
        } else {
          return res.json({ success: true, data: [] });
        }
      }
    }

    if (scheduleId) { conditions.push(`a.schedule_id = $${params.length + 1}`); params.push(scheduleId); }
    if (userId)     { conditions.push(`a.user_id = $${params.length + 1}`);     params.push(userId); }
    if (from)       { conditions.push(`a.start_date >= $${params.length + 1}::date`); params.push(from); }
    if (to)         { conditions.push(`a.end_date   <= $${params.length + 1}::date`); params.push(to); }

    params.push(parseInt(limit));

    const result = await query(
      `SELECT a.id, a.user_id, a.schedule_id, a.shift_id, a.reason, a.is_justified,
              a.reported_by_role, a.start_time, a.end_time, a.created_at, a.late_minutes,
              a.department_id,
              TO_CHAR(a.start_date, 'YYYY-MM-DD') AS date,
              TO_CHAR(a.created_at, 'YYYY-MM-DD') AS declared_date,
              TO_CHAR(a.created_at, 'HH24:MI')    AS declared_hour,
              at.name AS type_name, at.code AS type_code, at.color AS type_color,
              u.first_name, u.last_name, u.avatar_url,
              d.name AS department_name,
              s.name AS schedule_name,
              reporter.first_name AS reporter_first_name,
              reporter.last_name  AS reporter_last_name
       FROM absences a
       JOIN absence_types at ON a.absence_type_id = at.id
       JOIN users u ON a.user_id = u.id
       JOIN departments d ON a.department_id = d.id
       LEFT JOIN schedules s ON a.schedule_id = s.id
       LEFT JOIN users reporter ON a.declared_by = reporter.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.start_date DESC, a.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('listShiftAbsences error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des signalements' });
  }
};

module.exports = { reportShiftAbsence, listShiftAbsences };
