/**
 * Règle II — Prêt de personnel inter-service.
 * Un chef de service peut ajouter dans son tableur un agent d'un autre service
 * uniquement si le chef propriétaire accepte.
 * Exception : un agent qui n'appartient à AUCUN service passe sans autorisation.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToUser } = require('../../realtime/emit');
const history = require('../history/history.controller');

/** Garde-fou de format pour les identifiants reçus en query string. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Détermine si un agent nécessite une autorisation de prêt.
 * @returns {Promise<{needsApproval: boolean, ownerDepartmentId: string|null, ownerChiefId: string|null}>}
 */
const checkLoanRequirement = async (staffUserId, requestingDepartmentId) => {
  const depts = await query(
    `SELECT ud.department_id,
            (SELECT u.id FROM users u
             JOIN user_departments ud2 ON u.id = ud2.user_id
             WHERE ud2.department_id = ud.department_id AND ud2.is_head = TRUE
             LIMIT 1) AS chief_id
     FROM user_departments ud
     WHERE ud.user_id = $1`,
    [staffUserId]
  );

  // Aucun service : autorisé sans demande (exception explicite de la spec)
  if (depts.rows.length === 0) {
    return { needsApproval: false, ownerDepartmentId: null, ownerChiefId: null };
  }

  // Déjà dans le service demandeur : rien à demander
  const inRequesting = depts.rows.find((d) => d.department_id === requestingDepartmentId);
  if (inRequesting) {
    return { needsApproval: false, ownerDepartmentId: requestingDepartmentId, ownerChiefId: null };
  }

  const owner = depts.rows[0];
  return {
    needsApproval: true,
    ownerDepartmentId: owner.department_id,
    ownerChiefId: owner.chief_id || null
  };
};

/**
 * POST /api/staff-loans
 * Demande le prêt d'un agent d'un autre service.
 */
const requestLoan = async (req, res) => {
  try {
    const { roleCode, establishmentId, departmentId, id: actorId, isSuperAdmin } = req.user;

    if (roleCode !== ROLES.DEPARTMENT_HEAD && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Seul un chef de service peut demander un prêt de personnel',
        message_ar: 'فقط رئيس القسم يمكنه طلب إعارة موظف'
      });
    }
    if (!departmentId && !isSuperAdmin) {
      return res.status(400).json({ success: false, message: 'Votre compte n\'est associé à aucun service' });
    }

    const { staffUserId, scheduleId, shiftDate } = req.body;
    if (!staffUserId || !scheduleId || !shiftDate) {
      return res.status(400).json({
        success: false,
        message: 'Agent, planning et date sont obligatoires',
        message_ar: 'الموظف والجدول والتاريخ مطلوبة'
      });
    }

    const check = await checkLoanRequirement(staffUserId, departmentId);

    // Agent sans service, ou déjà du service : auto-approuvé
    if (!check.needsApproval) {
      const auto = await query(
        `INSERT INTO staff_loan_requests
           (establishment_id, schedule_id, requesting_department_id, requesting_chief_id,
            staff_user_id, owner_department_id, owner_chief_id, shift_date, status, responded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,'auto_approved',NOW())
         RETURNING id`,
        [establishmentId, scheduleId, departmentId, actorId, staffUserId,
         check.ownerDepartmentId || departmentId, null, String(shiftDate).slice(0, 10)]
      );
      return res.status(201).json({
        success: true,
        data: { id: auto.rows[0].id, status: 'auto_approved' },
        message: 'Agent autorisé sans demande (aucun service propriétaire)'
      });
    }

    // Doublon en attente ou déjà approuvé pour cette date
    const existing = await query(
      `SELECT id, status FROM staff_loan_requests
       WHERE staff_user_id = $1 AND schedule_id = $2 AND shift_date = $3::date
         AND status IN ('pending','approved','auto_approved')`,
      [staffUserId, scheduleId, String(shiftDate).slice(0, 10)]
    );
    if (existing.rows.length) {
      return res.status(200).json({
        success: true,
        data: existing.rows[0],
        message: existing.rows[0].status === 'pending'
          ? 'Une demande est déjà en attente pour cet agent à cette date'
          : 'Cet agent est déjà autorisé pour cette date'
      });
    }

    if (!check.ownerChiefId) {
      return res.status(409).json({
        success: false,
        message: 'Le service propriétaire n\'a pas de chef désigné : demande impossible',
        message_ar: 'القسم المالك ليس له رئيس محدد'
      });
    }

    const inserted = await query(
      `INSERT INTO staff_loan_requests
         (establishment_id, schedule_id, requesting_department_id, requesting_chief_id,
          staff_user_id, owner_department_id, owner_chief_id, shift_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,'pending')
       RETURNING id`,
      [establishmentId, scheduleId, departmentId, actorId, staffUserId,
       check.ownerDepartmentId, check.ownerChiefId, String(shiftDate).slice(0, 10)]
    );
    const loanId = inserted.rows[0].id;

    const staff = await query('SELECT first_name, last_name FROM users WHERE id = $1', [staffUserId]);
    const staffName = staff.rows[0] ? `${staff.rows[0].first_name} ${staff.rows[0].last_name}` : 'un agent';

    await history.log({
      userId: actorId,
      action: 'pret_personnel_demande',
      category: 'schedules',
      description: `Demande de prêt pour ${staffName} le ${String(shiftDate).slice(0, 10)}`,
      entityType: 'staff_loan_requests',
      entityId: loanId,
      metadata: { staffUserId, scheduleId },
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent']
    });

    await createNotification({
      establishmentId,
      recipientId: check.ownerChiefId,
      senderId: actorId,
      type: 'staff_loan_requested',
      title: 'Demande de prêt de personnel',
      titleAr: 'طلب إعارة موظف',
      message: `${req.user.firstName} ${req.user.lastName} souhaite affecter ${staffName} à une garde le ${String(shiftDate).slice(0, 10)}.`,
      entityType: 'staff_loan_requests',
      entityId: loanId,
      priority: 'high'
    });

    emitToUser(req.app, check.ownerChiefId, 'staff-loan:requested', { loanId });
    emitToUser(req.app, check.ownerChiefId, 'notification:new', { type: 'staff_loan_requested' });

    return res.status(201).json({
      success: true,
      data: { id: loanId, status: 'pending' },
      message: 'Demande envoyée au chef du service propriétaire'
    });
  } catch (err) {
    console.error('requestLoan error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la demande de prêt' });
  }
};

/**
 * GET /api/staff-loans
 * Demandes reçues (chef propriétaire) et envoyées (chef demandeur).
 */
const listLoans = async (req, res) => {
  try {
    const { id: actorId, establishmentId } = req.user;
    // `scheduleId` (point 4) : traiter les prêts garde par garde. Filtre purement
    // additif — sans lui la réponse est exactement celle d'avant.
    const { status, direction, scheduleId } = req.query;

    const conditions = ['l.establishment_id = $1'];
    const params = [establishmentId];

    if (direction === 'incoming')      { conditions.push(`l.owner_chief_id = $${params.length + 1}`);      params.push(actorId); }
    else if (direction === 'outgoing') { conditions.push(`l.requesting_chief_id = $${params.length + 1}`); params.push(actorId); }
    else {
      conditions.push(`(l.owner_chief_id = $${params.length + 1} OR l.requesting_chief_id = $${params.length + 1})`);
      params.push(actorId);
    }

    if (status) { conditions.push(`l.status = $${params.length + 1}`); params.push(status); }
    // La colonne est un uuid : une valeur mal formée ferait échouer la requête
    // entière (22P02) au lieu de ne rien filtrer, d'où le garde-fou.
    if (scheduleId) {
      if (!UUID_RE.test(String(scheduleId))) {
        return res.status(400).json({ success: false, message: 'Identifiant de garde invalide' });
      }
      conditions.push(`l.schedule_id = $${params.length + 1}`);
      params.push(scheduleId);
    }

    const result = await query(
      `SELECT l.id, l.status, l.response_reason, l.requested_at, l.responded_at,
              TO_CHAR(l.shift_date, 'YYYY-MM-DD') AS shift_date,
              l.schedule_id, l.staff_user_id,
              u.first_name AS staff_first_name, u.last_name AS staff_last_name, u.avatar_url AS staff_avatar,
              rd.name AS requesting_department_name,
              od.name AS owner_department_name,
              rc.first_name AS requester_first_name, rc.last_name AS requester_last_name,
              -- Identité de la garde (point 4) : le regroupement par garde doit
              -- rester possible même pour un prêt dont le planning appartient à
              -- un autre service — il n'apparaît alors dans aucune autre liste.
              sch.name AS schedule_name,
              sch.status AS schedule_status,
              TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS schedule_start,
              TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS schedule_end,
              planning_state(sch.status, sch.start_date, sch.end_date) AS schedule_state,
              sd.name AS schedule_department_name,
              (l.owner_chief_id = $${params.length + 1}) AS is_incoming
       FROM staff_loan_requests l
       JOIN users u ON l.staff_user_id = u.id
       JOIN departments rd ON l.requesting_department_id = rd.id
       JOIN departments od ON l.owner_department_id = od.id
       LEFT JOIN users rc ON l.requesting_chief_id = rc.id
       LEFT JOIN schedules sch ON l.schedule_id = sch.id
       LEFT JOIN departments sd ON sch.department_id = sd.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY l.requested_at DESC
       LIMIT 100`,
      [...params, actorId]
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('listLoans error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des demandes' });
  }
};

/**
 * PUT /api/staff-loans/:id/decide
 * Le chef propriétaire accepte ou refuse.
 */
const decideLoan = async (req, res) => {
  try {
    const { id: actorId, establishmentId } = req.user;
    const { decision, reason } = req.body;

    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ success: false, message: 'Décision invalide (approved | rejected)' });
    }

    const loan = await query(
      `SELECT l.*, u.first_name, u.last_name
       FROM staff_loan_requests l
       JOIN users u ON l.staff_user_id = u.id
       WHERE l.id = $1 AND l.establishment_id = $2`,
      [req.params.id, establishmentId]
    );
    if (!loan.rows.length) {
      return res.status(404).json({ success: false, message: 'Demande introuvable' });
    }
    const l = loan.rows[0];

    if (l.owner_chief_id !== actorId && !req.user.isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Seul le chef du service propriétaire peut répondre à cette demande',
        message_ar: 'فقط رئيس القسم المالك يمكنه الرد'
      });
    }
    if (l.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Demande déjà traitée (${l.status})` });
    }

    await query(
      `UPDATE staff_loan_requests
       SET status = $1, response_reason = $2, responded_at = NOW()
       WHERE id = $3`,
      [decision, reason || null, req.params.id]
    );

    const staffName = `${l.first_name} ${l.last_name}`;
    const verdict = decision === 'approved' ? 'acceptée' : 'refusée';

    // Refus : seule la ligne de cet agent est retirée du tableur. Le planning
    // garde son état (brouillon ou publié) et le reste du tableur est intact.
    let removal = null;
    if (decision === 'rejected') {
      try {
        const { removeStaffFromSchedule, announceStaffRemoval } = require('./external-staff');
        removal = await removeStaffFromSchedule({ scheduleId: l.schedule_id, staffUserId: l.staff_user_id });
        announceStaffRemoval({
          app: req.app,
          removal,
          staffName,
          ownerChiefName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim(),
          // Permet au client de retirer la ligne immédiatement, et double
          // l'envoi vers le chef demandeur en plus de la room du service.
          staffUserId: l.staff_user_id,
          requestingChiefId: l.requesting_chief_id,
        });
      } catch (removeErr) {
        console.error('decideLoan removal error:', removeErr.message);
      }
    }

    await history.log({
      userId: actorId,
      action: `pret_personnel_${decision === 'approved' ? 'accepte' : 'refuse'}`,
      category: 'schedules',
      description: `Demande de prêt pour ${staffName} ${verdict}`,
      entityType: 'staff_loan_requests',
      entityId: req.params.id,
      metadata: { decision, reason },
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent']
    });

    await createNotification({
      establishmentId,
      recipientId: l.requesting_chief_id,
      senderId: actorId,
      type: 'staff_loan_decided',
      title: `Demande de prêt ${verdict}`,
      titleAr: decision === 'approved' ? 'تمت الموافقة على الإعارة' : 'تم رفض الإعارة',
      message: decision === 'approved'
        ? `Votre demande pour ${staffName} a été acceptée. Sa ligne apparaît désormais normalement dans le tableur.`
        : `Votre demande pour ${staffName} a été refusée : sa ligne a été retirée du tableur, le planning reste inchangé.${reason ? ` Motif : ${reason}` : ''}`,
      entityType: 'staff_loan_requests',
      entityId: req.params.id,
      priority: 'high'
    });

    emitToUser(req.app, l.requesting_chief_id, 'staff-loan:decided', { loanId: req.params.id, decision, scheduleId: l.schedule_id, staffUserId: l.staff_user_id });
    emitToUser(req.app, l.requesting_chief_id, 'notification:new', { type: 'staff_loan_decided' });

    return res.json({
      success: true,
      message: decision === 'approved'
        ? 'Demande acceptée'
        : 'Demande refusée — la ligne a été retirée du tableur',
      data: { decision, scheduleId: l.schedule_id, staffUserId: l.staff_user_id, rowRemoved: removal?.rowRemoved || false }
    });
  } catch (err) {
    console.error('decideLoan error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la décision' });
  }
};

module.exports = { checkLoanRequirement, requestLoan, listLoans, decideLoan };
