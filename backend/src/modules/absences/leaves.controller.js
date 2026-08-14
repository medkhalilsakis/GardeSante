/**
 * Gestion des congés — pose et annulation par le directeur / admin hôpital.
 * Les congés vivent dans la table absences avec kind = 'leave'.
 * Le contrôleur absences.controller.js existant n'est pas modifié.
 */

const path = require('path');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToUser, emitToEstablishment } = require('../../realtime/emit');
const history = require('../history/history.controller');

const MANAGER_ROLES = [ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN];
const UPLOAD_DIR = path.join(__dirname, '../../../uploads/leaves');
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIME.has(file.mimetype)) {
      const err = new Error('Format non supporté : PDF, JPEG, PNG, WebP ou GIF uniquement');
      err.status = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const uploadLeaveAttachment = (req, res, next) => {
  upload.single('attachment')(req, res, (err) => {
    if (!err) return next();
    err.status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      err.message = 'La pièce jointe ne doit pas dépasser 10 Mo';
    }
    return next(err);
  });
};

const persistLeaveAttachment = async (file) => {
  if (!file) return null;
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const token = randomUUID();

  if (file.mimetype === 'application/pdf') {
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      const err = new Error('Le fichier transmis n’est pas un PDF valide');
      err.status = 400;
      throw err;
    }
    const filename = `leave_${token}.pdf`;
    const diskPath = path.join(UPLOAD_DIR, filename);
    await fs.writeFile(diskPath, file.buffer);
    return { url: `/uploads/leaves/${filename}`, diskPath };
  }

  const filename = `leave_${token}.webp`;
  const diskPath = path.join(UPLOAD_DIR, filename);
  await sharp(file.buffer, { animated: false })
    .rotate()
    .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 84 })
    .toFile(diskPath);
  return { url: `/uploads/leaves/${filename}`, diskPath };
};

/**
 * GET /api/leaves
 * Liste les congés de l'établissement (ou d'un agent).
 */
const listLeaves = async (req, res) => {
  try {
    const { establishmentId, isSuperAdmin } = req.user;
    const {
      userId, departmentId, absenceTypeId, activeOnly,
      from, to, search, reason, limit = 100,
    } = req.query;

    const conditions = ["a.kind = 'leave'", "a.status <> 'cancelled'"];
    const params = [];

    const eid = isSuperAdmin ? (req.query.establishmentId || establishmentId) : establishmentId;
    conditions.push(`a.establishment_id = $${params.length + 1}`);
    params.push(eid);

    if (userId)       { conditions.push(`a.user_id = $${params.length + 1}`); params.push(userId); }
    if (departmentId) { conditions.push(`a.department_id = $${params.length + 1}`); params.push(departmentId); }
    if (absenceTypeId) { conditions.push(`a.absence_type_id = $${params.length + 1}`); params.push(absenceTypeId); }
    if (activeOnly === 'true') conditions.push('a.end_date >= CURRENT_DATE');
    if (from) { conditions.push(`a.end_date   >= $${params.length + 1}::date`); params.push(from); }
    if (to)   { conditions.push(`a.start_date <= $${params.length + 1}::date`); params.push(to); }
    if (search) {
      conditions.push(`(
        (u.first_name || ' ' || u.last_name) ILIKE $${params.length + 1}
        OR u.matricule ILIKE $${params.length + 1}
        OR d.name ILIKE $${params.length + 1}
        OR at.name ILIKE $${params.length + 1}
        OR COALESCE(a.reason, '') ILIKE $${params.length + 1}
      )`);
      params.push(`%${String(search).trim()}%`);
    }
    if (reason) {
      conditions.push(`COALESCE(a.reason, '') ILIKE $${params.length + 1}`);
      params.push(`%${String(reason).trim()}%`);
    }

    params.push(Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500));

    const result = await query(
      `SELECT a.id, a.user_id, a.reason, a.status, a.justification_url, a.created_at,
              TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
              at.id AS type_id, at.name AS type_name, at.color AS type_color,
              u.first_name, u.last_name, u.avatar_url,
              d.name AS department_name,
              (a.start_date <= CURRENT_DATE AND a.end_date >= CURRENT_DATE) AS is_current
       FROM absences a
       JOIN absence_types at ON a.absence_type_id = at.id
       JOIN users u ON a.user_id = u.id
       JOIN departments d ON a.department_id = d.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.start_date DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('listLeaves error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des congés' });
  }
};

/**
 * GET /api/leaves/types
 * Types de congé (is_leave = TRUE) de l'établissement.
 */
const getLeaveTypes = async (req, res) => {
  try {
    const eid = req.user.isSuperAdmin
      ? (req.query.establishmentId || req.user.establishmentId)
      : req.user.establishmentId;

    const result = await query(
      `SELECT id, code, name, name_ar, color, requires_justification, is_paid
       FROM absence_types
       WHERE establishment_id = $1 AND is_active = TRUE AND is_leave = TRUE
       ORDER BY name`,
      [eid]
    );
    return res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('getLeaveTypes error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des types' });
  }
};

/**
 * POST /api/leaves
 * Pose un congé pour un agent de son établissement.
 */
const createLeave = async (req, res) => {
  let savedAttachment = null;
  let leaveInserted = false;
  try {
    const { roleCode, establishmentId, id: actorId, isSuperAdmin } = req.user;

    if (!MANAGER_ROLES.includes(roleCode) && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Seul le directeur peut poser un congé',
        message_ar: 'فقط المدير يمكنه تسجيل إجازة'
      });
    }

    const { userId, absenceTypeId, startDate, endDate, reason } = req.body;

    if (!userId || !absenceTypeId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Agent, type, date de début et date de fin sont obligatoires',
        message_ar: 'الموظف والنوع وتاريخ البداية والنهاية مطلوبة'
      });
    }

    const start = String(startDate).slice(0, 10);
    const end   = String(endDate).slice(0, 10);
    if (end < start) {
      return res.status(400).json({
        success: false,
        message: 'La date de fin doit être postérieure à la date de début',
        message_ar: 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'
      });
    }

    // L'agent doit appartenir à l'établissement
    const target = await query(
      `SELECT u.id, u.establishment_id, u.first_name, u.last_name,
              (SELECT department_id FROM user_departments WHERE user_id = u.id AND is_primary = TRUE LIMIT 1) AS department_id
       FROM users u WHERE u.id = $1 AND u.is_active = TRUE`,
      [userId]
    );
    if (!target.rows.length) {
      return res.status(404).json({ success: false, message: 'Agent introuvable' });
    }
    const agent = target.rows[0];
    if (!isSuperAdmin && agent.establishment_id !== establishmentId) {
      return res.status(403).json({ success: false, message: 'Cet agent n\'appartient pas à votre établissement' });
    }
    if (!agent.department_id) {
      return res.status(400).json({
        success: false,
        message: 'Cet agent n\'est associé à aucun service : impossible de poser un congé',
        message_ar: 'هذا الموظف غير مرتبط بأي قسم'
      });
    }

    // Le type doit être un congé
    const typeCheck = await query(
      `SELECT id, name, is_leave, requires_justification FROM absence_types
       WHERE id = $1 AND establishment_id = $2 AND is_active = TRUE`,
      [absenceTypeId, agent.establishment_id]
    );
    if (!typeCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Type de congé introuvable' });
    }
    if (!typeCheck.rows[0].is_leave) {
      return res.status(400).json({
        success: false,
        message: 'Ce type n\'est pas un congé',
        message_ar: 'هذا النوع ليس إجازة'
      });
    }
    if (typeCheck.rows[0].requires_justification && !req.file) {
      return res.status(400).json({
        success: false,
        message: 'Ce type de congé exige une pièce jointe (PDF ou image)',
      });
    }

    // Chevauchement avec un congé existant
    const overlap = await query(
      `SELECT id, TO_CHAR(start_date,'YYYY-MM-DD') AS start_date, TO_CHAR(end_date,'YYYY-MM-DD') AS end_date
       FROM absences
       WHERE user_id = $1 AND kind = 'leave'
         AND status NOT IN ('cancelled','rejected')
         AND start_date <= $3::date AND end_date >= $2::date`,
      [userId, start, end]
    );
    if (overlap.rows.length) {
      const o = overlap.rows[0];
      return res.status(409).json({
        success: false,
        message: `Un congé existe déjà du ${o.start_date} au ${o.end_date}`,
        message_ar: 'توجد إجازة بالفعل في هذه الفترة'
      });
    }

    savedAttachment = await persistLeaveAttachment(req.file);

    const inserted = await query(
      `INSERT INTO absences
         (establishment_id, department_id, user_id, absence_type_id,
          start_date, end_date, reason, justification_url, declared_by, kind, reported_by_role,
          status, approved_by, approved_at)
       VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,'leave',$10,'approved',$9,NOW())
       RETURNING id`,
      [agent.establishment_id, agent.department_id, userId, absenceTypeId,
       start, end, reason || null, savedAttachment?.url || null, actorId, roleCode]
    );
    const leaveId = inserted.rows[0].id;
    leaveInserted = true;

    // Drapeau rapide sur le profil si le congé est en cours
    await query(
      `UPDATE users SET is_on_leave = TRUE, updated_at = NOW()
       WHERE id = $1 AND $2::date <= CURRENT_DATE AND $3::date >= CURRENT_DATE`,
      [userId, start, end]
    );

    await history.log({
      userId: actorId,
      action: 'conge_pose',
      category: 'absences',
      description: `Congé ${typeCheck.rows[0].name} posé pour ${agent.first_name} ${agent.last_name} du ${start} au ${end}`,
      entityType: 'absences',
      entityId: leaveId,
      metadata: { userId, startDate: start, endDate: end, hasAttachment: Boolean(savedAttachment) },
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent']
    });

    await createNotification({
      establishmentId: agent.establishment_id,
      recipientId: userId,
      senderId: actorId,
      type: 'leave_created',
      title: 'Congé enregistré',
      titleAr: 'تم تسجيل الإجازة',
      message: `Un congé (${typeCheck.rows[0].name}) a été enregistré du ${start} au ${end}.`,
      entityType: 'absences',
      entityId: leaveId,
      priority: 'normal'
    });

    emitToUser(req.app, userId, 'leave:created', { leaveId, userId });
    emitToUser(req.app, userId, 'notification:new', { type: 'leave_created' });
    emitToEstablishment(req.app, agent.establishment_id, 'leave:created', { leaveId, userId });

    return res.status(201).json({ success: true, data: { id: leaveId }, message: 'Congé enregistré' });
  } catch (err) {
    console.error('createLeave error:', err);
    if (savedAttachment?.diskPath && !leaveInserted) {
      await fs.unlink(savedAttachment.diskPath).catch(() => {});
    }
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: status < 500 ? err.message : 'Erreur lors de l\'enregistrement du congé',
    });
  }
};

/**
 * PUT /api/leaves/:id/cancel
 * Annule un congé posé. On ne SUPPRIME pas la ligne : le congé passe en
 * `cancelled` pour que l'historique reste lisible et que la traçabilité soit
 * conservée (aucun acteur ne peut effacer une trace).
 */
const cancelLeave = async (req, res) => {
  try {
    const { roleCode, establishmentId, id: actorId, isSuperAdmin } = req.user;

    if (!MANAGER_ROLES.includes(roleCode) && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Seul le directeur peut annuler un congé',
        message_ar: 'فقط المدير يمكنه إلغاء الإجازة'
      });
    }

    const found = await query(
      `SELECT a.id, a.user_id, a.establishment_id, a.status,
              TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
              at.name AS type_name,
              u.first_name, u.last_name
       FROM absences a
       JOIN absence_types at ON a.absence_type_id = at.id
       JOIN users u ON a.user_id = u.id
       WHERE a.id = $1 AND a.kind = 'leave'`,
      [req.params.id]
    );
    if (!found.rows.length) {
      return res.status(404).json({ success: false, message: 'Congé introuvable' });
    }

    const leave = found.rows[0];
    if (!isSuperAdmin && leave.establishment_id !== establishmentId) {
      return res.status(403).json({ success: false, message: 'Ce congé n\'appartient pas à votre établissement' });
    }
    if (leave.status === 'cancelled') {
      return res.status(409).json({ success: false, message: 'Ce congé est déjà annulé' });
    }

    await query(
      `UPDATE absences SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [leave.id]
    );

    // Le drapeau ne retombe que si l'agent n'a plus AUCUN autre congé en cours :
    // annuler un congé ne doit pas effacer un second congé qui le chevauche.
    await query(
      `UPDATE users SET is_on_leave = FALSE, updated_at = NOW()
       WHERE id = $1
         AND NOT EXISTS (
           SELECT 1 FROM absences
           WHERE user_id = $1 AND kind = 'leave'
             AND status NOT IN ('cancelled','rejected')
             AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
         )`,
      [leave.user_id]
    );

    await history.log({
      userId: actorId,
      action: 'conge_annule',
      category: 'absences',
      description: `Congé ${leave.type_name} annulé pour ${leave.first_name} ${leave.last_name} (${leave.start_date} → ${leave.end_date})`,
      entityType: 'absences',
      entityId: leave.id,
      metadata: { userId: leave.user_id, startDate: leave.start_date, endDate: leave.end_date },
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent']
    });

    await createNotification({
      establishmentId: leave.establishment_id,
      recipientId: leave.user_id,
      senderId: actorId,
      type: 'leave_cancelled',
      title: 'Congé annulé',
      titleAr: 'تم إلغاء الإجازة',
      message: `Votre congé (${leave.type_name}) du ${leave.start_date} au ${leave.end_date} a été annulé.`,
      entityType: 'absences',
      entityId: leave.id,
      priority: 'normal'
    });

    emitToUser(req.app, leave.user_id, 'leave:cancelled', { leaveId: leave.id, userId: leave.user_id });
    emitToUser(req.app, leave.user_id, 'notification:new', { type: 'leave_cancelled' });
    emitToEstablishment(req.app, leave.establishment_id, 'leave:cancelled', { leaveId: leave.id, userId: leave.user_id });

    return res.json({ success: true, message: 'Congé annulé' });
  } catch (err) {
    console.error('cancelLeave error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'annulation du congé' });
  }
};

module.exports = {
  uploadLeaveAttachment,
  listLeaves,
  getLeaveTypes,
  createLeave,
  cancelLeave,
};
