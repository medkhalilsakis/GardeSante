/**
 * Notes / Circulaires — posts avec pièces jointes (image, PDF, ou combinaison).
 * Super Admin  -> tous les directeurs de la plateforme
 * Directeur    -> tout le personnel de son hôpital
 * Chef service -> le personnel de son service
 *
 * Pattern d'upload identique aux avatars : multer.memoryStorage() + sharp pour
 * les images, écriture disque sous backend/uploads/notes (servi par express.static).
 */

const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const sharp = require('sharp');
const { query, transaction } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToUser, emitToEstablishment } = require('../../realtime/emit');
const history = require('../history/history.controller');

const UPLOAD_DIR = path.join(__dirname, '..', '..', '..', 'uploads', 'notes');

const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf'
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Format non supporté : images (JPEG, PNG, WebP, GIF) et PDF uniquement'));
    }
    cb(null, true);
  }
});

const uploadMiddleware = upload.array('attachments', 5);

/** Détermine la portée autorisée selon le rôle. */
const resolveScope = (roleCode, isSuperAdmin) => {
  if (isSuperAdmin || roleCode === ROLES.SUPER_ADMIN) return 'platform_directors';
  // Le surveillant général n'appartient plus à aucun service (point 1) : sa
  // portée de publication est l'hôpital, comme le directeur. Le laisser sur
  // 'department' publierait dans le vide, `req.user.departmentId` étant nul.
  if ([ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN, ROLES.GENERAL_SUPERVISOR].includes(roleCode)) {
    return 'establishment_staff';
  }
  if (roleCode === ROLES.DEPARTMENT_HEAD) return 'department';
  return null;
};

/** Le SG supervise tous les services : il lit les notes de service de son hôpital. */
const readsAllDepartments = (user) =>
  user?.roleCode === ROLES.GENERAL_SUPERVISOR && !!user?.establishmentId;

/** Liste les destinataires selon la portée. */
const resolveRecipients = async (scope, { establishmentId, departmentId }) => {
  if (scope === 'platform_directors') {
    const r = await query(
      `SELECT u.id, u.establishment_id FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE r.code IN ($1, $2) AND u.is_active = TRUE`,
      [ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN]
    );
    return r.rows;
  }
  if (scope === 'establishment_staff') {
    const r = await query(
      `SELECT u.id, u.establishment_id FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.establishment_id = $1 AND u.is_active = TRUE AND r.code <> $2`,
      [establishmentId, ROLES.SUPER_ADMIN]
    );
    return r.rows;
  }
  if (scope === 'department') {
    const r = await query(
      `SELECT DISTINCT u.id, u.establishment_id FROM users u
       JOIN user_departments ud ON u.id = ud.user_id
       WHERE ud.department_id = $1 AND u.is_active = TRUE`,
      [departmentId]
    );
    return r.rows;
  }
  return [];
};

/** Écrit les pièces jointes sur disque. Images converties en webp, PDF tels quels. */
const persistAttachments = async (files, noteId) => {
  if (!files?.length) return [];
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const saved = [];
  for (const [i, file] of files.entries()) {
    const isPdf = file.mimetype === 'application/pdf';
    const stamp = `${noteId}_${i}_${Date.now()}`;

    if (isPdf) {
      const filename = `note_${stamp}.pdf`;
      await fs.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
      saved.push({
        kind: 'pdf',
        fileUrl: `/uploads/notes/${filename}`,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size
      });
    } else {
      const filename = `note_${stamp}.webp`;
      const buffer = await sharp(file.buffer)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      await fs.writeFile(path.join(UPLOAD_DIR, filename), buffer);
      saved.push({
        kind: 'image',
        fileUrl: `/uploads/notes/${filename}`,
        fileName: file.originalname,
        mimeType: 'image/webp',
        sizeBytes: buffer.length
      });
    }
  }
  return saved;
};

// ============================================================
// Publication (POST /api/notes)
// ============================================================
const publishNote = async (req, res) => {
  const scope = resolveScope(req.user.roleCode, req.user.isSuperAdmin);
  if (!scope) {
    return res.status(403).json({ success: false, message: 'Votre rôle ne permet pas de publier une note ou circulaire' });
  }

  const { title, body, category = 'note', priority = 'normal', isPinned = false, departmentId } = req.body;
  if (!title || !String(title).trim()) {
    return res.status(400).json({ success: false, message: 'Le titre est obligatoire' });
  }

  const files = req.files || [];
  if (!String(body || '').trim() && files.length === 0) {
    return res.status(400).json({ success: false, message: 'Une note doit contenir un texte ou au moins une pièce jointe' });
  }

  // Un chef de service publie pour son service ; le scope department est verrouillé
  // sur son propre service pour éviter de viser un autre service.
  const deptId = scope === 'department'
    ? (req.user.departmentId || departmentId || null)
    : (scope === 'establishment_staff' ? null : null);

  try {
    const noteId = await transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO notes
           (establishment_id, department_id, author_id, scope, title, body,
            category, priority, is_pinned, recipients_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)
         RETURNING id`,
        [
          scope === 'establishment_staff' ? req.user.establishmentId : null,
          deptId,
          req.user.id,
          scope,
          String(title).trim(),
          body || null,
          category,
          priority,
          isPinned === true || isPinned === 'true'
        ]
      );
      return inserted.rows[0].id;
    });

    // Pièces jointes (écriture disque, hors transaction) — 5 au maximum
    const attachments = await persistAttachments(files, noteId);
    for (const a of attachments) {
      await query(
        `INSERT INTO note_attachments (note_id, kind, file_url, file_name, mime_type, size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [noteId, a.kind, a.fileUrl, a.fileName, a.mimeType, a.sizeBytes]
      );
    }

    // Comptage des destinataires (pour l'indicateur « lu par N/M »)
    const recipients = await resolveRecipients(scope, {
      establishmentId: req.user.establishmentId,
      departmentId: deptId,
    });
    await query('UPDATE notes SET recipients_count = $2 WHERE id = $1', [noteId, recipients.length]);

    // Diffusion : notification individuelle à chaque destinataire + temps réel
    const { firstName, lastName } = req.user;
    const authorName = `${firstName || ''} ${lastName || ''}`.trim() || 'Un utilisateur';
    for (const r of recipients) {
      await createNotification({
        establishmentId: r.establishment_id,
        recipientId: r.id,
        senderId: req.user.id,
        type: 'note',
        title: 'Nouvelle note / circulaire',
        titleAr: 'منشور جديد',
        message: `${authorName} a publié « ${title} »`,
        messageAr: `نشر ${authorName} « ${title} »`,
        entityType: 'notes',
        entityId: noteId,
        priority,
      });
      emitToUser(req.app, r.id, 'note:published', { noteId });
      emitToUser(req.app, r.id, 'notification:new', { entityType: 'notes', entityId: noteId });
    }

    history.log({
      userId: req.user.id,
      action: 'note.publish',
      category: 'notes',
      description: `Publication de la note « ${title} » (portée ${scope})`,
      entityType: 'notes',
      entityId: noteId,
      metadata: { scope, attachments: attachments.length, recipients: recipients.length },
      ipAddress: history.getIp(req),
      severity: 'info',
    });

    return res.status(201).json({
      success: true,
      message: 'Note publiée et notifiée à toute l’audience',
      data: { id: noteId, scope, recipientsCount: recipients.length },
    });
  } catch (err) {
    console.error('publishNote error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la publication de la note' });
  }
};

// ============================================================
// Listing (GET /api/notes) — visibilité par portée
// ============================================================
const listNotes = async (req, res) => {
  const { page = 1, limit = 20, category, scope, priority, unreadOnly } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // L'utilisateur ne voit que les notes qui le concernent :
  //  - plateforme  : directeurs / admins hôpital
  //  - hôpital     : personnel de son établissement
  //  - service     : personnel de son département
  const isDirector = [ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN].includes(req.user.roleCode);

  // Les valeurs des filtres, dans l'ordre où les placeholders les consomment.
  const filterValues = [];
  if (req.user.establishmentId) filterValues.push(req.user.establishmentId);
  // Le SG lit aussi les notes de service de son hôpital : deuxième liaison de
  // l'établissement, placée juste après la première pour rester dans l'ordre
  // des placeholders construits par buildWhere().
  const sgReadsAll = readsAllDepartments(req.user);
  if (sgReadsAll) filterValues.push(req.user.establishmentId);
  if (req.user.departmentId) filterValues.push(req.user.departmentId);
  if (category) filterValues.push(category);
  if (scope) filterValues.push(scope);
  if (priority) filterValues.push(priority);
  if (unreadOnly === 'true') filterValues.push(req.user.id);

  // La clause WHERE est reconstruite avec un décalage, car la requête principale
  // lie req.user.id en $1 (accusé de lecture) alors que le COUNT ne le fait pas.
  const buildWhere = (offsetIdx) => {
    let i = offsetIdx + 1;
    const scopeClauses = [];
    if (isDirector || req.user.isSuperAdmin) {
      scopeClauses.push(`n.scope = 'platform_directors'`);
    }
    if (req.user.establishmentId) {
      scopeClauses.push(`(n.scope = 'establishment_staff' AND n.establishment_id = $${i++})`);
    }
    if (sgReadsAll) {
      // Une note de service est insérée avec establishment_id NULL : on remonte
      // à l'établissement par le service visé.
      scopeClauses.push(
        `(n.scope = 'department' AND n.department_id IN (SELECT id FROM departments WHERE establishment_id = $${i++}))`
      );
    }
    if (req.user.departmentId) {
      scopeClauses.push(`(n.scope = 'department' AND n.department_id = $${i++})`);
    }
    if (scopeClauses.length === 0) return null;

    const conditions = [`(${scopeClauses.join(' OR ')})`];
    if (category) conditions.push(`n.category = $${i++}`);
    if (scope) conditions.push(`n.scope = $${i++}`);
    if (priority) conditions.push(`n.priority = $${i++}`);
    if (unreadOnly === 'true') conditions.push(`NOT EXISTS (SELECT 1 FROM note_reads unread_nr WHERE unread_nr.note_id = n.id AND unread_nr.user_id = $${i++})`);
    return { where: conditions.join(' AND '), nextIdx: i };
  };

  const main = buildWhere(1); // $1 est réservé à req.user.id
  if (!main) {
    return res.json({ success: true, data: [], total: 0 });
  }
  const counted = buildWhere(0);

  const result = await query(
    `SELECT n.*,
            u.first_name, u.last_name,
            r.name AS author_role,
            (SELECT COUNT(*) FROM note_reads nr WHERE nr.note_id = n.id) AS read_count,
            EXISTS(SELECT 1 FROM note_reads nr2 WHERE nr2.note_id = n.id AND nr2.user_id = $1) AS is_read,
            (SELECT COUNT(*) FROM note_attachments na WHERE na.note_id = n.id) AS attachments_count
     FROM notes n
     JOIN users u ON n.author_id = u.id
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE ${main.where}
     ORDER BY n.is_pinned DESC, n.published_at DESC
     LIMIT $${main.nextIdx} OFFSET $${main.nextIdx + 1}`,
    [req.user.id, ...filterValues, parseInt(limit), offset]
  );

  const count = await query(
    `SELECT COUNT(*) FROM notes n WHERE ${counted.where}`,
    filterValues
  );

  return res.json({
    success: true,
    data: result.rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      title: r.title,
      body: r.body,
      category: r.category,
      priority: r.priority,
      isPinned: r.is_pinned,
      recipientsCount: r.recipients_count,
      publishedAt: r.published_at,
      author: `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Anonyme',
      authorRole: r.author_role,
      isAuthor: r.author_id === req.user.id || req.user.isSuperAdmin === true,
      readCount: parseInt(r.read_count),
      isRead: r.is_read,
      attachmentsCount: parseInt(r.attachments_count),
      canViewReaders: r.author_id === req.user.id || req.user.isSuperAdmin === true || isDirector,
    })),
    total: parseInt(count.rows[0].count),
  });
};

// ============================================================
// Détail + accusé de lecture (GET /api/notes/:id)
// ============================================================
const getNote = async (req, res) => {
  const result = await query(
    `SELECT n.*, u.first_name, u.last_name, r.name AS author_role
     FROM notes n
     JOIN users u ON n.author_id = u.id
     LEFT JOIN roles r ON u.role_id = r.id
     WHERE n.id = $1`,
    [req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Note introuvable' });
  }

  const note = result.rows[0];

  // Vérification de visibilité (la même logique que le listing)
  const isDirector = [ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN].includes(req.user.roleCode);
  let visible =
    (note.scope === 'platform_directors' && (isDirector || req.user.isSuperAdmin)) ||
    (note.scope === 'establishment_staff' && note.establishment_id === req.user.establishmentId) ||
    (note.scope === 'department' && note.department_id === req.user.departmentId);

  // Le SG n'a plus de service (point 1) mais supervise les leurs : une note de
  // service lui est ouverte si le service appartient bien à son hôpital.
  if (!visible && note.scope === 'department' && note.department_id && readsAllDepartments(req.user)) {
    const owner = await query(
      `SELECT 1 FROM departments WHERE id = $1 AND establishment_id = $2`,
      [note.department_id, req.user.establishmentId]
    );
    visible = owner.rows.length > 0;
  }

  if (!visible) {
    return res.status(403).json({ success: false, message: 'Cette note ne vous est pas destinée' });
  }

  // Accusé de lecture (idempotent)
  await query(
    `INSERT INTO note_reads (note_id, user_id) VALUES ($1, $2)
     ON CONFLICT (note_id, user_id) DO NOTHING`,
    [note.id, req.user.id]
  );
  await query(
    `UPDATE notifications SET is_read = TRUE, read_at = NOW()
      WHERE recipient_id = $1 AND entity_type = 'notes' AND entity_id = $2`,
    [req.user.id, note.id]
  );

  const attachments = await query(
    `SELECT id, kind, file_url, file_name, mime_type, size_bytes FROM note_attachments
     WHERE note_id = $1 ORDER BY created_at ASC`,
    [note.id]
  );

  const readCount = await query(
    `SELECT COUNT(*) FROM note_reads WHERE note_id = $1`,
    [note.id]
  );

  return res.json({
    success: true,
    data: {
      id: note.id,
      scope: note.scope,
      title: note.title,
      body: note.body,
      category: note.category,
      priority: note.priority,
      isPinned: note.is_pinned,
      recipientsCount: note.recipients_count,
      publishedAt: note.published_at,
      author: `${note.first_name || ''} ${note.last_name || ''}`.trim() || 'Anonyme',
      authorRole: note.author_role,
      isAuthor: note.author_id === req.user.id || req.user.isSuperAdmin === true,
      readCount: parseInt(readCount.rows[0].count),
      attachments: attachments.rows,
      canViewReaders: note.author_id === req.user.id || req.user.isSuperAdmin === true || isDirector,
    },
  });
};

const markNoteRead = async (req, res) => {
  const visible = await query(
    `SELECT n.id
       FROM notes n
       LEFT JOIN departments d ON d.id = n.department_id
      WHERE n.id = $1 AND (
        (n.scope = 'platform_directors' AND ($2 = ANY(ARRAY['director','hospital_admin']) OR $3 = TRUE))
        OR (n.scope = 'establishment_staff' AND n.establishment_id = $4)
        OR (n.scope = 'department' AND (n.department_id = $5 OR ($6 = 'general_supervisor' AND d.establishment_id = $4)))
      )`,
    [req.params.id, req.user.roleCode, req.user.isSuperAdmin === true, req.user.establishmentId, req.user.departmentId, req.user.roleCode]
  );
  if (!visible.rows.length) return res.status(404).json({ success: false, message: 'Note introuvable ou non destinée' });
  await query(
    `INSERT INTO note_reads (note_id, user_id) VALUES ($1, $2)
     ON CONFLICT (note_id, user_id) DO NOTHING`,
    [req.params.id, req.user.id]
  );
  await query(`UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE recipient_id = $1 AND entity_type = 'notes' AND entity_id = $2`, [req.user.id, req.params.id]);
  return res.json({ success: true, message: 'Note marquée comme lue' });
};

const listNoteReaders = async (req, res) => {
  const noteRes = await query(
    `SELECT n.id, n.author_id, n.scope, n.establishment_id, n.department_id, d.establishment_id AS department_establishment_id
       FROM notes n LEFT JOIN departments d ON d.id = n.department_id WHERE n.id = $1`,
    [req.params.id]
  );
  const note = noteRes.rows[0];
  if (!note) return res.status(404).json({ success: false, message: 'Note introuvable' });
  const canRead = req.user.isSuperAdmin === true
    || note.author_id === req.user.id
    || ([ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN].includes(req.user.roleCode)
      && (note.establishment_id === req.user.establishmentId || note.department_establishment_id === req.user.establishmentId));
  if (!canRead) return res.status(403).json({ success: false, message: 'La liste des lecteurs est réservée à la direction' });
  const readers = await query(
    `SELECT nr.user_id, nr.read_at, u.first_name, u.last_name, r.name AS role_name
       FROM note_reads nr JOIN users u ON u.id = nr.user_id LEFT JOIN roles r ON r.id = u.role_id
      WHERE nr.note_id = $1 ORDER BY nr.read_at ASC`,
    [req.params.id]
  );
  return res.json({ success: true, data: readers.rows.map(reader => ({
    userId: reader.user_id,
    name: `${reader.first_name || ''} ${reader.last_name || ''}`.trim() || 'Utilisateur',
    roleName: reader.role_name,
    readAt: reader.read_at,
  })) });
};

// ============================================================
// Suppression (DELETE /api/notes/:id) — auteur ou Super Admin
// ============================================================
const deleteNote = async (req, res) => {
  const result = await query(
    `SELECT id, author_id, title FROM notes WHERE id = $1`,
    [req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Note introuvable' });
  }
  const note = result.rows[0];
  if (note.author_id !== req.user.id && !req.user.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Seul l’auteur ou le Super Admin peut supprimer cette note' });
  }

  // Supprimer les fichiers pièces jointes du disque
  const attachments = await query(
    `SELECT file_url FROM note_attachments WHERE note_id = $1`,
    [note.id]
  );
  for (const att of attachments.rows) {
    if (att.file_url?.startsWith('/uploads/notes/')) {
      const filename = att.file_url.replace('/uploads/notes/', '');
      fs.unlink(path.join(UPLOAD_DIR, filename)).catch(() => {});
    }
  }

  // Les notifications de cette note deviendraient orphelines (pas de FK vers notes)
  // — on les retire explicitement, comme le fait la migration 023 pour les remplacements.
  await query(
    `DELETE FROM notifications WHERE entity_type = 'notes' AND entity_id = $1`,
    [note.id]
  );

  await query('DELETE FROM notes WHERE id = $1', [note.id]);

  history.log({
    userId: req.user.id,
    action: 'note.delete',
    category: 'notes',
    description: `Suppression de la note « ${note.title} »`,
    entityType: 'notes',
    entityId: note.id,
    ipAddress: history.getIp(req),
    severity: 'info',
  });

  return res.json({ success: true, message: 'Note supprimée' });
};

module.exports = {
  uploadMiddleware,
  publishNote,
  listNotes,
  getNote,
  markNoteRead,
  listNoteReaders,
  deleteNote,
  resolveScope,
  resolveRecipients,
  persistAttachments,
};
