/**
 * Diffusion d'une circulaire — qui a lu, qui n'a pas lu, relance (Lot X5).
 *
 * Ce que la plateforme savait déjà faire : compter les lecteurs
 * (`notes.controller.js` → `listNoteReaders`, indicateur « Lu par N/M »).
 * Ce qu'elle ne savait pas faire, et que ce module ajoute :
 *
 *  1. **Nommer les non-lecteurs.** Une circulaire nationale « lue par 2/9 » ne
 *     disait pas lesquels des sept directeurs restants n'avaient rien ouvert.
 *     C'est pourtant la seule information actionnable.
 *
 *  2. **Rattraper les destinataires arrivés après la publication.**
 *     `notes.recipients_count` est figé au moment de l'envoi. Un directeur
 *     nommé le lendemain n'a jamais reçu la circulaire et n'apparaissait dans
 *     aucun compteur. Ici l'audience est recalculée à l'instant de la
 *     consultation : ces destinataires sont marqués `neverNotified`.
 *
 *  3. **Relancer, en laissant une trace.** Chaque relance écrit dans
 *     `note_reminders` (migration 036) : qui, par qui, quand. L'exigence de
 *     traçabilité constante s'applique aussi à l'insistance de la direction.
 *
 * Aucun handler existant n'est modifié : les deux routes ajoutées vivent à côté
 * de celles de `notes.controller.js`, et la règle d'accès est exactement celle
 * de `listNoteReaders` (Super Admin, auteur, ou directeur de l'établissement
 * concerné) pour qu'aucune audience ne s'ouvre par cette porte.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToUser } = require('../../realtime/emit');
const history = require('../history/history.controller');

/** Au-delà, une relance de masse relève de l'erreur de manipulation. */
const MAX_REMINDERS_PER_CALL = 500;

/** Deux relances à la minute sur la même circulaire n'apportent rien. */
const REMINDER_COOLDOWN_MINUTES = 10;

const fail = (res, code, message) => res.status(code).json({ success: false, message });

/**
 * Charge la note et vérifie le droit de consulter/relancer sa diffusion.
 * Renvoie `{ note }` ou `{ error: { code, message } }`.
 */
const loadNoteForDiffusion = async (noteId, user) => {
  const found = await query(
    `SELECT n.id, n.author_id, n.scope, n.establishment_id, n.department_id,
            n.title, n.priority, n.category, n.recipients_count,
            n.published_at,
            d.establishment_id AS department_establishment_id,
            au.first_name AS author_first, au.last_name AS author_last
       FROM notes n
       LEFT JOIN departments d ON d.id = n.department_id
       LEFT JOIN users au ON au.id = n.author_id
      WHERE n.id = $1`,
    [noteId]
  );
  const note = found.rows[0];
  if (!note) return { error: { code: 404, message: 'Circulaire introuvable' } };

  // Même prédicat que `listNoteReaders` : ne pas élargir l'accès aux
  // destinataires nommés par une route parallèle.
  const isDirector = [ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN].includes(user.roleCode);
  const allowed = user.isSuperAdmin === true
    || note.author_id === user.id
    || (isDirector
      && (note.establishment_id === user.establishmentId
        || note.department_establishment_id === user.establishmentId));

  if (!allowed) {
    return { error: { code: 403, message: 'Le suivi de diffusion est réservé à l\'auteur et à la direction' } };
  }
  return { note };
};

/**
 * Audience courante d'une note, recalculée maintenant — pas le compteur figé.
 * Même logique de portée que `resolveRecipients`, enrichie des noms et de
 * l'établissement pour que la direction sache à qui elle s'adresse.
 */
const currentAudience = async (note) => {
  if (note.scope === 'platform_directors') {
    const r = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.establishment_id,
              r.name AS role_name, e.name AS establishment_name, e.code AS establishment_code
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN establishments e ON e.id = u.establishment_id
        WHERE r.code IN ($1, $2) AND u.is_active = TRUE
        ORDER BY e.name NULLS LAST, u.last_name`,
      [ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN]
    );
    return r.rows;
  }
  if (note.scope === 'establishment_staff') {
    const r = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.establishment_id,
              r.name AS role_name, e.name AS establishment_name, e.code AS establishment_code
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN establishments e ON e.id = u.establishment_id
        WHERE u.establishment_id = $1 AND u.is_active = TRUE AND r.code <> $2
        ORDER BY r.level, u.last_name`,
      [note.establishment_id, ROLES.SUPER_ADMIN]
    );
    return r.rows;
  }
  if (note.scope === 'department') {
    const r = await query(
      `SELECT DISTINCT u.id, u.first_name, u.last_name, u.email, u.establishment_id,
              r.name AS role_name, e.name AS establishment_name, e.code AS establishment_code
         FROM users u
         JOIN user_departments ud ON ud.user_id = u.id
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN establishments e ON e.id = u.establishment_id
        WHERE ud.department_id = $1 AND u.is_active = TRUE
        ORDER BY u.last_name`,
      [note.department_id]
    );
    return r.rows;
  }
  return [];
};

const fullName = (row) =>
  `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Utilisateur';

// ============================================================
// GET /api/notes/:id/diffusion — lecteurs, non-lecteurs, relances
// ============================================================
const getDiffusion = async (req, res) => {
  try {
    const { note, error } = await loadNoteForDiffusion(req.params.id, req.user);
    if (error) return fail(res, error.code, error.message);

    const audience = await currentAudience(note);

    const [reads, reminders, notified] = await Promise.all([
      query('SELECT user_id, read_at FROM note_reads WHERE note_id = $1', [note.id]),
      query(
        `SELECT user_id, COUNT(*)::int AS times, MAX(sent_at) AS last_sent
           FROM note_reminders WHERE note_id = $1 GROUP BY user_id`,
        [note.id]
      ),
      // Une notification prouve que le destinataire a bien été touché à la
      // publication : son absence signale un directeur nommé depuis.
      query(
        `SELECT recipient_id, MIN(created_at) AS first_sent
           FROM notifications
          WHERE entity_type = 'notes' AND entity_id = $1
          GROUP BY recipient_id`,
        [note.id]
      ),
    ]);

    const readAt = new Map(reads.rows.map((r) => [r.user_id, r.read_at]));
    const remindMap = new Map(reminders.rows.map((r) => [r.user_id, r]));
    const notifiedAt = new Map(notified.rows.map((r) => [r.recipient_id, r.first_sent]));

    const read = [];
    const unread = [];
    for (const person of audience) {
      const rem = remindMap.get(person.id);
      const entry = {
        userId: person.id,
        name: fullName(person),
        email: person.email,
        roleName: person.role_name,
        establishmentId: person.establishment_id,
        establishmentName: person.establishment_name,
        establishmentCode: person.establishment_code,
        readAt: readAt.get(person.id) || null,
        notifiedAt: notifiedAt.get(person.id) || null,
        // Nommé après la publication : jamais notifié, donc jamais en faute.
        neverNotified: !notifiedAt.has(person.id),
        remindersSent: rem ? rem.times : 0,
        lastReminderAt: rem ? rem.last_sent : null,
      };
      (entry.readAt ? read : unread).push(entry);
    }

    read.sort((a, b) => new Date(a.readAt) - new Date(b.readAt));

    // Des lecteurs peuvent avoir quitté l'audience (mutation, désactivation) :
    // ils comptent dans `note_reads` mais plus dans l'audience courante. On les
    // signale plutôt que de laisser un total incohérent.
    const audienceIds = new Set(audience.map((p) => p.id));
    const readOutsideAudience = reads.rows.filter((r) => !audienceIds.has(r.user_id)).length;

    const lastReminder = reminders.rows.reduce(
      (acc, r) => (!acc || new Date(r.last_sent) > new Date(acc) ? r.last_sent : acc),
      null
    );

    return res.json({
      success: true,
      data: {
        note: {
          id: note.id,
          title: note.title,
          scope: note.scope,
          category: note.category,
          priority: note.priority,
          publishedAt: note.published_at,
          author: `${note.author_first || ''} ${note.author_last || ''}`.trim() || 'Anonyme',
          // Compteur figé à l'envoi, conservé tel quel pour comparaison.
          recipientsAtPublish: note.recipients_count,
        },
        read,
        unread,
        summary: {
          audience: audience.length,
          read: read.length,
          unread: unread.length,
          rate: audience.length ? Math.round((read.length / audience.length) * 100) : 0,
          neverNotified: unread.filter((u) => u.neverNotified).length,
          readOutsideAudience,
          remindersTotal: reminders.rows.reduce((s, r) => s + r.times, 0),
          lastReminderAt: lastReminder,
        },
        canRemind: unread.length > 0,
        cooldownMinutes: REMINDER_COOLDOWN_MINUTES,
      },
    });
  } catch (err) {
    console.error('getDiffusion error:', err);
    return fail(res, 500, 'Erreur lors du calcul de la diffusion');
  }
};

// ============================================================
// POST /api/notes/:id/remind — relancer les non-lecteurs
// ============================================================
const remindUnread = async (req, res) => {
  try {
    const { note, error } = await loadNoteForDiffusion(req.params.id, req.user);
    if (error) return fail(res, error.code, error.message);

    // Garde-fou de cadence : une relance toutes les dix minutes au plus, sinon
    // la circulaire devient du harcèlement et la trace illisible.
    const recent = await query(
      `SELECT MAX(sent_at) AS last_sent FROM note_reminders WHERE note_id = $1`,
      [note.id]
    );
    const last = recent.rows[0]?.last_sent;
    if (last) {
      const elapsedMin = (Date.now() - new Date(last).getTime()) / 60000;
      if (elapsedMin < REMINDER_COOLDOWN_MINUTES) {
        const wait = Math.max(1, Math.ceil(REMINDER_COOLDOWN_MINUTES - elapsedMin));
        return fail(res, 429,
          `Une relance vient d'être envoyée. Patientez ${wait} minute(s) avant la suivante.`);
      }
    }

    const audience = await currentAudience(note);
    const reads = await query('SELECT user_id FROM note_reads WHERE note_id = $1', [note.id]);
    const hasRead = new Set(reads.rows.map((r) => r.user_id));

    // Un destinataire explicite est accepté pour relancer une seule personne.
    const only = req.body?.userIds;
    const restrict = Array.isArray(only) && only.length ? new Set(only) : null;

    const targets = audience.filter(
      (p) => !hasRead.has(p.id) && (!restrict || restrict.has(p.id))
    );

    if (!targets.length) {
      return res.json({
        success: true,
        message: restrict
          ? 'Ces destinataires ont déjà lu la circulaire : aucune relance envoyée.'
          : 'Toute l\'audience a lu cette circulaire : aucune relance nécessaire.',
        data: { reminded: 0, targets: [] },
      });
    }
    if (targets.length > MAX_REMINDERS_PER_CALL) {
      return fail(res, 400,
        `${targets.length} destinataires à relancer : au-delà de ${MAX_REMINDERS_PER_CALL}, `
        + 'restreignez la sélection.');
    }

    const { firstName, lastName } = req.user;
    const senderName = `${firstName || ''} ${lastName || ''}`.trim() || 'La direction';

    for (const person of targets) {
      await createNotification({
        establishmentId: person.establishment_id,
        recipientId: person.id,
        senderId: req.user.id,
        type: 'note',
        title: 'Rappel : circulaire non lue',
        titleAr: 'تذكير: منشور غير مقروء',
        message: `${senderName} vous rappelle la circulaire « ${note.title} »`,
        messageAr: `يذكّرك ${senderName} بالمنشور « ${note.title} »`,
        entityType: 'notes',
        entityId: note.id,
        // Une relance monte d'un cran : elle n'a de sens que si elle se voit.
        priority: note.priority === 'urgent' ? 'urgent' : 'high',
      });
      await query(
        'INSERT INTO note_reminders (note_id, user_id, sent_by) VALUES ($1, $2, $3)',
        [note.id, person.id, req.user.id]
      );
      emitToUser(req.app, person.id, 'note:reminder', { noteId: note.id, title: note.title });
      emitToUser(req.app, person.id, 'notification:new', { entityType: 'notes', entityId: note.id });
    }

    history.log({
      userId: req.user.id,
      action: 'note.remind',
      category: 'notes',
      description: `Relance de la circulaire « ${note.title} » à ${targets.length} destinataire(s) non lecteur(s)`,
      descriptionAr: `تذكير بالمنشور « ${note.title} »`,
      entityType: 'notes',
      entityId: note.id,
      metadata: {
        scope: note.scope,
        reminded: targets.length,
        selective: Boolean(restrict),
        recipients: targets.map((p) => p.id),
      },
      ipAddress: history.getIp(req),
      severity: 'info',
    });

    return res.json({
      success: true,
      message: targets.length === 1
        ? `Relance envoyée à ${fullName(targets[0])}.`
        : `Relance envoyée à ${targets.length} destinataire(s) n'ayant pas lu la circulaire.`,
      data: {
        reminded: targets.length,
        targets: targets.map((p) => ({
          userId: p.id,
          name: fullName(p),
          establishmentName: p.establishment_name,
        })),
      },
    });
  } catch (err) {
    console.error('remindUnread error:', err);
    return fail(res, 500, 'Erreur lors de l\'envoi de la relance');
  }
};

module.exports = {
  getDiffusion,
  remindUnread,
  // Exportés pour les vérifications et une éventuelle réutilisation.
  currentAudience,
  loadNoteForDiffusion,
  REMINDER_COOLDOWN_MINUTES,
};
