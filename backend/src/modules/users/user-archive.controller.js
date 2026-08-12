/**
 * Archivage d'un compte utilisateur — réservé au Super Admin.
 *
 * L'archivage n'est NI une suppression NI une clôture (`is_active = FALSE`) :
 *   • le compte et toutes ses données restent en base, intactes ;
 *   • l'utilisateur ne peut plus rien faire — ni se connecter, ni utiliser un
 *     jeton déjà émis (voir les deux garde-fous `archived_at IS NULL` posés
 *     dans `auth.controller.login` et `middleware/auth.authenticate`) ;
 *   • le Super Admin peut le réactiver à tout moment, et le compte retrouve
 *     exactement l'état qu'il avait avant (`is_active` n'est pas touché).
 *
 * Fichier neuf et autonome : `users.controller.js` n'est pas modifié.
 */
const { query } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');
const { emitToUser, emitToEstablishment } = require('../../realtime/emit');

const superAdminOnly = (req, res) => {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({
      success: false,
      message: 'Seul le Super Admin peut archiver ou réactiver un compte.',
      message_ar: 'المشرف العام فقط يمكنه أرشفة الحساب أو إعادة تفعيله',
    });
    return false;
  }
  return true;
};

const loadUser = async (id) => {
  const r = await query(
    `SELECT u.id, u.first_name, u.last_name, u.email, u.is_active, u.establishment_id,
            u.archived_at, u.archive_reason,
            r.code AS role_code, e.name AS establishment_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN establishments e ON e.id = u.establishment_id
      WHERE u.id = $1`,
    [id]
  );
  return r.rows[0] || null;
};

const fullName = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email;

// ─────────────────────────────────────────────────────────────
// GET /api/user-archive — liste des comptes archivés
// `?establishmentId=` restreint à un hôpital, sinon toute la plateforme.
// ─────────────────────────────────────────────────────────────
const listArchived = async (req, res) => {
  if (!superAdminOnly(req, res)) return;

  const params = [];
  let where = 'u.archived_at IS NOT NULL';
  if (req.query.establishmentId) {
    params.push(req.query.establishmentId);
    where += ` AND u.establishment_id = $${params.length}`;
  }
  if (req.query.search) {
    params.push(`%${req.query.search}%`);
    where += ` AND (u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.matricule ILIKE $${params.length})`;
  }

  const result = await query(
    `SELECT u.id, u.matricule, u.first_name, u.last_name, u.email, u.phone,
            u.avatar_url, u.is_active, u.can_login, u.last_login,
            u.archived_at, u.archive_reason,
            r.code AS role_code, r.name AS role_name,
            e.id AS establishment_id, e.name AS establishment_name,
            ab.first_name AS archived_by_first_name, ab.last_name AS archived_by_last_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN establishments e ON e.id = u.establishment_id
       LEFT JOIN users ab ON ab.id = u.archived_by
      WHERE ${where}
      ORDER BY u.archived_at DESC
      LIMIT 200`,
    params
  );

  return res.json({ success: true, data: result.rows });
};

// ─────────────────────────────────────────────────────────────
// PUT /api/user-archive/:id/archive
// ─────────────────────────────────────────────────────────────
const archiveUser = async (req, res) => {
  if (!superAdminOnly(req, res)) return;

  if (req.params.id === req.user.id) {
    return res.status(400).json({ success: false, message: 'Vous ne pouvez pas archiver votre propre compte.' });
  }

  const target = await loadUser(req.params.id);
  if (!target) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  if (target.role_code === 'super_admin') {
    return res.status(400).json({ success: false, message: 'Un compte Super Admin ne peut pas être archivé.' });
  }
  if (target.archived_at) {
    return res.status(409).json({ success: false, message: 'Ce compte est déjà archivé.' });
  }

  const reason = (req.body?.reason || '').trim() || null;

  const updated = await query(
    `UPDATE users
        SET archived_at = NOW(), archived_by = $1, archive_reason = $2,
            refresh_token = NULL, updated_at = NOW()
      WHERE id = $3 AND archived_at IS NULL
      RETURNING id, archived_at, archive_reason`,
    [req.user.id, reason, req.params.id]
  );
  if (!updated.rows[0]) {
    return res.status(409).json({ success: false, message: 'Ce compte est déjà archivé.' });
  }

  // Traçabilité — l'historique reste immuable et consultable.
  log({
    userId: req.user.id,
    action: 'user_archived',
    category: 'admin',
    description: `Compte archivé : ${fullName(target)} (${target.establishment_name})${reason ? ` — motif : ${reason}` : ''}`,
    descriptionAr: 'تمت أرشفة الحساب',
    entityType: 'users',
    entityId: target.id,
    metadata: { targetUserId: target.id, roleCode: target.role_code, reason },
    ipAddress: getIp(req),
    userAgent: req.headers['user-agent'],
    severity: 'warning',
  });

  try {
    emitToUser(req.app, target.id, 'account:archived', { userId: target.id });
    emitToEstablishment(req.app, target.establishment_id, 'user:archived', {
      userId: target.id, archived: true,
    });
  } catch (_) {}

  return res.json({
    success: true,
    message: `Compte de ${fullName(target)} archivé. L'accès est bloqué jusqu'à réactivation.`,
    data: { id: target.id, archivedAt: updated.rows[0].archived_at, archiveReason: updated.rows[0].archive_reason },
  });
};

// ─────────────────────────────────────────────────────────────
// PUT /api/user-archive/:id/unarchive
// Rend au compte l'état exact qu'il avait avant l'archivage.
// ─────────────────────────────────────────────────────────────
const unarchiveUser = async (req, res) => {
  if (!superAdminOnly(req, res)) return;

  const target = await loadUser(req.params.id);
  if (!target) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
  if (!target.archived_at) {
    return res.status(409).json({ success: false, message: 'Ce compte n\'est pas archivé.' });
  }

  await query(
    `UPDATE users
        SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = NOW()
      WHERE id = $1`,
    [req.params.id]
  );

  log({
    userId: req.user.id,
    action: 'user_unarchived',
    category: 'admin',
    description: `Compte réactivé depuis l'archive : ${fullName(target)} (${target.establishment_name})`,
    descriptionAr: 'تمت إعادة تفعيل الحساب من الأرشيف',
    entityType: 'users',
    entityId: target.id,
    metadata: { targetUserId: target.id, roleCode: target.role_code },
    ipAddress: getIp(req),
    userAgent: req.headers['user-agent'],
    severity: 'info',
  });

  try {
    emitToUser(req.app, target.id, 'account:unarchived', { userId: target.id });
    emitToEstablishment(req.app, target.establishment_id, 'user:archived', {
      userId: target.id, archived: false,
    });
  } catch (_) {}

  return res.json({
    success: true,
    message: `Compte de ${fullName(target)} réactivé.${target.is_active ? '' : ' Attention : ce compte était clôturé avant archivage, il reste inactif.'}`,
    data: { id: target.id, archivedAt: null },
  });
};

module.exports = { listArchived, archiveUser, unarchiveUser };
