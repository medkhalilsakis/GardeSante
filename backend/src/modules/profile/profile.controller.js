const { query, transaction } = require('../../config/database');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// ── Répertoire d'upload ──────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'avatars');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Multer — stockage en mémoire + traitement sharp ──────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Format non supporté. Utilisez JPG, PNG ou WebP.'));
    }
    cb(null, true);
  },
});
exports.uploadMiddleware = upload.single('avatar');

// Champs modifiables AVEC approbation super_admin
const APPROVAL_FIELDS = [
  'first_name', 'last_name', 'first_name_ar', 'last_name_ar',
  'phone', 'birth_date', 'gender', 'address', 'city',
  'id_card_number', 'id_card_expiry', 'hire_date',
  'speciality', 'grade', 'bio', 'matricule',
];

// ──────────────────────────────────────────────────────────────
// GET /api/profile
// ──────────────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  const result = await query(
    `SELECT
       u.id, u.matricule, u.first_name, u.last_name, u.first_name_ar, u.last_name_ar,
       u.email, u.phone, u.speciality, u.grade, u.is_active, u.is_on_leave,
       u.avatar_url, u.preferred_language, u.last_login, u.created_at,
       u.birth_date, u.gender, u.address, u.city,
       u.id_card_number, u.id_card_expiry, u.hire_date, u.bio, u.can_login,
       r.code AS role_code, r.name AS role_name, r.name_ar AS role_name_ar,
       e.id   AS establishment_id,
       e.name AS establishment_name,
       e.code AS establishment_code,
       e.city AS establishment_city,
       e.type AS establishment_type
     FROM users u
     JOIN roles r         ON u.role_id         = r.id
     JOIN establishments e ON u.establishment_id = e.id
     WHERE u.id = $1`,
    [req.user.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ success: false, message: 'Profil introuvable' });
  }

  // Département(s)
  const depts = await query(
    `SELECT d.id, d.name, d.name_ar, d.code, d.department_type,
            ud.is_head, ud.is_primary, ud.joined_at
     FROM departments d
     JOIN user_departments ud ON d.id = ud.department_id
     WHERE ud.user_id = $1 ORDER BY ud.is_primary DESC`,
    [req.user.id]
  );

  // Demande en cours (pending)
  const pending = await query(
    `SELECT id, status, requested_data, changed_fields, submitted_at, rejection_reason
     FROM profile_change_requests
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY submitted_at DESC LIMIT 1`,
    [req.user.id]
  );

  const { password_hash, refresh_token, password_reset_token, ...safeUser } = result.rows[0];
  return res.json({
    success: true,
    data: {
      ...safeUser,
      departments: depts.rows,
      pendingRequest: pending.rows[0] || null,
    },
  });
};

// ──────────────────────────────────────────────────────────────
// POST /api/profile/avatar — Upload photo de profil
// ──────────────────────────────────────────────────────────────
const uploadAvatar = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Aucun fichier reçu' });
  }

  const filename = `avatar_${req.user.id}_${Date.now()}.webp`;
  const filePath = path.join(UPLOAD_DIR, filename);

  // Redimensionner + convertir en WebP (200×200, qualité 85)
  await sharp(req.file.buffer)
    .resize(200, 200, { fit: 'cover', position: 'center' })
    .webp({ quality: 85 })
    .toFile(filePath);

  // Supprimer l'ancien avatar si existant
  const old = await query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
  if (old.rows[0]?.avatar_url) {
    const oldFile = path.join(UPLOAD_DIR, path.basename(old.rows[0].avatar_url));
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }

  const avatarUrl = `/uploads/avatars/${filename}`;
  await query('UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2', [avatarUrl, req.user.id]);

  return res.json({
    success: true,
    data: { avatarUrl },
    message: 'Photo de profil mise à jour',
  });
};

// ──────────────────────────────────────────────────────────────
// DELETE /api/profile/avatar — Supprimer la photo
// ──────────────────────────────────────────────────────────────
const deleteAvatar = async (req, res) => {
  const old = await query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
  if (old.rows[0]?.avatar_url) {
    const oldFile = path.join(UPLOAD_DIR, path.basename(old.rows[0].avatar_url));
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }
  await query('UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1', [req.user.id]);
  return res.json({ success: true, message: 'Photo supprimée' });
};

// ──────────────────────────────────────────────────────────────
// PUT /api/profile/credentials — email et/ou mdp (direct)
// ──────────────────────────────────────────────────────────────
const updateCredentials = async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;

  const userRow = await query('SELECT password_hash, email FROM users WHERE id = $1', [req.user.id]);
  if (!userRow.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  if (newPassword) {
    if (!currentPassword) return res.status(400).json({ success: false, message: 'Mot de passe actuel requis' });
    const valid = await bcrypt.compare(currentPassword, userRow.rows[0].password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Mot de passe actuel incorrect' });
    if (newPassword.length < 8) return res.status(400).json({ success: false, message: 'Minimum 8 caractères' });
  }

  const updates = [];
  const params = [];
  let idx = 1;

  if (email && email !== userRow.rows[0].email) {
    const exists = await query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
    if (exists.rows[0]) return res.status(409).json({ success: false, message: 'Cet email est déjà utilisé' });
    updates.push(`email = $${idx}`); params.push(email); idx++;
  }

  if (newPassword) {
    const hash = await bcrypt.hash(newPassword, 10);
    updates.push(`password_hash = $${idx}`); params.push(hash); idx++;
    updates.push(`refresh_token = NULL`);
  }

  if (updates.length === 0) return res.status(400).json({ success: false, message: 'Aucune modification détectée' });

  updates.push(`updated_at = NOW()`);
  params.push(req.user.id);
  await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);

  return res.json({ success: true, message: 'Identifiants mis à jour avec succès.' });
};

// ──────────────────────────────────────────────────────────────
// POST /api/profile/request-change
// ──────────────────────────────────────────────────────────────
const requestProfileChange = async (req, res) => {
  const body = req.body;
  const requested = {};
  const changedFields = [];

  const current = await query(`SELECT ${APPROVAL_FIELDS.join(', ')} FROM users WHERE id = $1`, [req.user.id]);
  if (!current.rows[0]) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

  const currentData = current.rows[0];

  for (const field of APPROVAL_FIELDS) {
    if (body[field] !== undefined) {
      const newVal = body[field] === '' ? null : body[field];
      const oldVal = currentData[field];
      if (String(newVal ?? '') !== String(oldVal ?? '')) {
        requested[field] = newVal;
        changedFields.push(field);
      }
    }
  }

  if (changedFields.length === 0) return res.status(400).json({ success: false, message: 'Aucune modification détectée' });

  await query(
    `UPDATE profile_change_requests SET status = 'cancelled', updated_at = NOW()
     WHERE user_id = $1 AND status = 'pending'`,
    [req.user.id]
  );

  const result = await query(
    `INSERT INTO profile_change_requests (user_id, status, current_data, requested_data, changed_fields)
     VALUES ($1, 'pending', $2, $3, $4) RETURNING id, status, submitted_at`,
    [req.user.id, JSON.stringify(currentData), JSON.stringify(requested), changedFields]
  );

  try {
    await query(
      `INSERT INTO notifications (user_id, title, title_ar, message, message_ar, type, priority, related_entity_type, related_entity_id)
       SELECT u.id, 'Demande de modification de profil', 'طلب تعديل معلومات الملف',
              $2, $3, 'profile_request', 'high', 'profile_change_request', $4
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE r.code = 'super_admin' AND u.is_active = TRUE`,
      [
        req.user.id,
        `${req.user.firstName} ${req.user.lastName} a soumis une demande (${changedFields.length} champ(s))`,
        `قدّم ${req.user.firstName} ${req.user.lastName} طلب تعديل ملفه`,
        result.rows[0].id,
      ]
    );
  } catch (_) {}

  return res.status(201).json({
    success: true,
    data: result.rows[0],
    message: `Demande soumise (${changedFields.length} champ(s)). En attente d'approbation.`,
  });
};

// ──────────────────────────────────────────────────────────────
// GET /api/profile/my-requests
// ──────────────────────────────────────────────────────────────
const getMyRequests = async (req, res) => {
  const result = await query(
    `SELECT pcr.id, pcr.status, pcr.requested_data, pcr.changed_fields,
            pcr.submitted_at, pcr.reviewed_at, pcr.rejection_reason,
            reviewer.first_name AS reviewer_first, reviewer.last_name AS reviewer_last
     FROM profile_change_requests pcr
     LEFT JOIN users reviewer ON pcr.reviewed_by = reviewer.id
     WHERE pcr.user_id = $1 ORDER BY pcr.submitted_at DESC LIMIT 20`,
    [req.user.id]
  );
  return res.json({ success: true, data: result.rows });
};

// ──────────────────────────────────────────────────────────────
// PUT /api/profile/preferences
// ──────────────────────────────────────────────────────────────
const updatePreferences = async (req, res) => {
  const { preferredLanguage } = req.body;
  if (!preferredLanguage) return res.status(400).json({ success: false, message: 'Données manquantes' });
  await query('UPDATE users SET preferred_language = $1, updated_at = NOW() WHERE id = $2', [preferredLanguage, req.user.id]);
  return res.json({ success: true, message: 'Préférences mises à jour' });
};

// ══════════════════════════════════════════════════════════════
// SUPER ADMIN — Gestion des demandes
// ══════════════════════════════════════════════════════════════
const adminGetRequests = async (req, res) => {
  if (!req.user.isSuperAdmin) return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });

  const { status = 'pending', page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const result = await query(
    `SELECT pcr.id, pcr.status, pcr.current_data, pcr.requested_data,
            pcr.changed_fields, pcr.submitted_at, pcr.reviewed_at, pcr.rejection_reason,
            u.first_name, u.last_name, u.email, u.matricule, u.avatar_url,
            r.name AS role_name, r.code AS role_code,
            e.name AS establishment_name,
            reviewer.first_name AS reviewer_first, reviewer.last_name AS reviewer_last
     FROM profile_change_requests pcr
     JOIN users u          ON pcr.user_id = u.id
     JOIN roles r          ON u.role_id = r.id
     JOIN establishments e ON u.establishment_id = e.id
     LEFT JOIN users reviewer ON pcr.reviewed_by = reviewer.id
     WHERE ($1 = 'all' OR pcr.status = $1)
     ORDER BY CASE pcr.status WHEN 'pending' THEN 0 ELSE 1 END, pcr.submitted_at DESC
     LIMIT $2 OFFSET $3`,
    [status, parseInt(limit), offset]
  );

  const count = await query(
    `SELECT COUNT(*) FROM profile_change_requests WHERE ($1 = 'all' OR status = $1)`,
    [status]
  );

  return res.json({
    success: true,
    data: result.rows,
    pagination: { total: parseInt(count.rows[0].count), page: parseInt(page), limit: parseInt(limit) },
  });
};

const adminApproveRequest = async (req, res) => {
  if (!req.user.isSuperAdmin) return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });

  const reqRow = await query(
    'SELECT * FROM profile_change_requests WHERE id = $1 AND status = $2',
    [req.params.id, 'pending']
  );
  if (!reqRow.rows[0]) return res.status(404).json({ success: false, message: 'Demande introuvable ou déjà traitée' });

  const { requested_data, user_id } = reqRow.rows[0];
  const data = typeof requested_data === 'string' ? JSON.parse(requested_data) : requested_data;

  const FIELD_MAP = {
    first_name:'first_name', last_name:'last_name', first_name_ar:'first_name_ar', last_name_ar:'last_name_ar',
    phone:'phone', birth_date:'birth_date', gender:'gender', address:'address', city:'city',
    id_card_number:'id_card_number', id_card_expiry:'id_card_expiry', hire_date:'hire_date',
    speciality:'speciality', grade:'grade', bio:'bio', matricule:'matricule',
  };

  const setClauses = [];
  const params = [];
  let idx = 1;
  for (const [key, col] of Object.entries(FIELD_MAP)) {
    if (data[key] !== undefined) {
      setClauses.push(`${col} = $${idx}`);
      params.push(data[key]);
      idx++;
    }
  }

  if (setClauses.length === 0) return res.status(400).json({ success: false, message: 'Aucun champ à mettre à jour' });

  await transaction(async (client) => {
    await client.query(
      `UPDATE users SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
      [...params, user_id]
    );
    await client.query(
      `UPDATE profile_change_requests SET status='approved', reviewed_at=NOW(), reviewed_by=$1, updated_at=NOW() WHERE id=$2`,
      [req.user.id, req.params.id]
    );
  });

  try {
    await query(
      `INSERT INTO notifications (user_id, title, title_ar, message, message_ar, type, priority)
       VALUES ($1,'Profil mis à jour','تم تحديث ملفك الشخصي',
               'Votre demande de modification a été approuvée.',
               'تمت الموافقة على طلب تعديل ملفك الشخصي.','profile_approved','normal')`,
      [user_id]
    );
  } catch (_) {}

  return res.json({ success: true, message: 'Modifications approuvées et appliquées' });
};

const adminRejectRequest = async (req, res) => {
  if (!req.user.isSuperAdmin) return res.status(403).json({ success: false, message: 'Réservé au Super Admin' });

  const { reason } = req.body;
  if (!reason) return res.status(400).json({ success: false, message: 'Motif de refus obligatoire' });

  const reqRow = await query(
    'SELECT user_id FROM profile_change_requests WHERE id = $1 AND status = $2',
    [req.params.id, 'pending']
  );
  if (!reqRow.rows[0]) return res.status(404).json({ success: false, message: 'Demande introuvable ou déjà traitée' });

  await query(
    `UPDATE profile_change_requests
     SET status='rejected', reviewed_at=NOW(), reviewed_by=$1, rejection_reason=$2, updated_at=NOW()
     WHERE id=$3`,
    [req.user.id, reason, req.params.id]
  );

  try {
    await query(
      `INSERT INTO notifications (user_id, title, title_ar, message, message_ar, type, priority)
       VALUES ($1,'Demande de profil refusée','تم رفض طلب التعديل',$2,$3,'profile_rejected','normal')`,
      [
        reqRow.rows[0].user_id,
        `Votre demande a été refusée. Motif : ${reason}`,
        `تم رفض طلب تعديل ملفك. السبب : ${reason}`,
      ]
    );
  } catch (_) {}

  return res.json({ success: true, message: 'Demande refusée' });
};

const adminPendingCount = async (req, res) => {
  if (!req.user.isSuperAdmin) return res.json({ success: true, data: { count: 0 } });
  const result = await query('SELECT COUNT(*) FROM profile_change_requests WHERE status = $1', ['pending']);
  return res.json({ success: true, data: { count: parseInt(result.rows[0].count) } });
};

module.exports = {
  uploadMiddleware: exports.uploadMiddleware,
  getProfile,
  uploadAvatar,
  deleteAvatar,
  updateCredentials,
  requestProfileChange,
  getMyRequests,
  updatePreferences,
  adminGetRequests,
  adminApproveRequest,
  adminRejectRequest,
  adminPendingCount,
};
