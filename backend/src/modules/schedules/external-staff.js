/**
 * Personnel externe dans le tableur de garde — couche non bloquante.
 *
 * Règle métier : un chef de service peut ajouter dans son tableur un agent d'un
 * autre service, mais le chef propriétaire doit accepter. La version précédente
 * appliquait cette règle en REFUSANT l'enregistrement du tableur tant que
 * l'accord n'était pas donné — ce qui bloquait aussi le brouillon et l'envoi de
 * tout le planning.
 *
 * Ici la règle devient une couche par-dessus :
 *   • l'ajout est accepté immédiatement, le tableur s'enregistre et s'envoie ;
 *   • une demande d'approbation part automatiquement au chef propriétaire ;
 *   • tant qu'il n'a pas répondu, la ligne est signalée en attente (couleur) ;
 *   • s'il accepte, la ligne redevient normale ;
 *   • s'il refuse, seule cette ligne disparaît — le planning garde son état
 *     (brouillon ou publié) et le reste du tableur est intact.
 *
 * Aucun autre module n'est modifié : ce fichier est appelé depuis `saveDraft`
 * (création des demandes), `getScheduleDetail` (état des lignes) et
 * `decideLoan` (retrait de la ligne refusée).
 */

const { query, transaction } = require('../../config/database');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToUser, emitToDepartment } = require('../../realtime/emit');

const toDateKey = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
};

const OPEN_STATUSES = ['pending', 'approved', 'auto_approved'];

/**
 * Qui, dans ce roster, appartient à un autre service ?
 * Un agent sans aucun service est autorisé sans demande (exception de la spec).
 *
 * @returns {Promise<Array<{userId, ownerDepartmentId, ownerDepartmentName, ownerChiefId}>>}
 */
const findExternalStaff = async (staffIds, ownDepartmentId) => {
  if (!staffIds.length) return [];
  const rows = await query(
    `SELECT ud.user_id, ud.department_id, d.name AS department_name,
            (SELECT u.id FROM users u
               JOIN user_departments ud2 ON ud2.user_id = u.id
              WHERE ud2.department_id = ud.department_id
                AND ud2.is_head = TRUE
                AND u.is_active = TRUE
              LIMIT 1) AS chief_id
       FROM user_departments ud
       JOIN departments d ON d.id = ud.department_id
      WHERE ud.user_id = ANY($1)`,
    [staffIds]
  );

  const byUser = new Map();
  for (const r of rows.rows) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }

  const external = [];
  for (const userId of staffIds) {
    const depts = byUser.get(userId);
    if (!depts || depts.length === 0) continue;                       // aucun service → libre
    if (depts.some((d) => d.department_id === ownDepartmentId)) continue; // déjà du service
    const owner = depts[0];
    external.push({
      userId,
      ownerDepartmentId: owner.department_id,
      ownerDepartmentName: owner.department_name,
      ownerChiefId: owner.chief_id || null,
    });
  }
  return external;
};

/**
 * État des demandes de prêt d'un planning, indexé par agent.
 * Une seule demande vivante par (planning, agent) : la plus récente fait foi.
 *
 * @returns {Promise<Object<string, {id, status, ownerDepartmentName, ownerChiefName, respondedAt, reason}>>}
 */
const getScheduleLoanStates = async (scheduleId) => {
  const rows = await query(
    `SELECT DISTINCT ON (l.staff_user_id)
            l.id, l.staff_user_id, l.status, l.response_reason, l.responded_at,
            od.name AS owner_department_name,
            oc.first_name AS owner_chief_first, oc.last_name AS owner_chief_last
       FROM staff_loan_requests l
       LEFT JOIN departments od ON od.id = l.owner_department_id
       LEFT JOIN users oc ON oc.id = l.owner_chief_id
      WHERE l.schedule_id = $1
      ORDER BY l.staff_user_id, l.requested_at DESC`,
    [scheduleId]
  );
  const map = {};
  for (const r of rows.rows) {
    map[r.staff_user_id] = {
      id: r.id,
      status: r.status,
      ownerDepartmentName: r.owner_department_name || null,
      ownerChiefName: r.owner_chief_first ? `${r.owner_chief_first} ${r.owner_chief_last}` : null,
      respondedAt: r.responded_at,
      reason: r.response_reason || null,
    };
  }
  return map;
};

/**
 * Crée les demandes d'approbation manquantes pour les agents externes du roster.
 * N'échoue JAMAIS l'appelant : toute erreur est journalisée et ignorée, car le
 * tableur doit s'enregistrer quoi qu'il arrive.
 *
 * Granularité : une demande par (planning, agent). La date portée est celle du
 * début du planning — la colonne `shift_date` est NOT NULL et sert ici de
 * marqueur de période, pas de garde précise.
 *
 * @returns {Promise<{pending: string[], autoApproved: string[], created: number}>}
 */
const syncExternalStaffLoans = async ({ schedule, roster, actor, app }) => {
  const result = { pending: [], autoApproved: [], created: 0 };
  try {
    const staffIds = [...new Set(roster.map((r) => r.userId).filter(Boolean))];
    if (!staffIds.length) return result;

    const external = await findExternalStaff(staffIds, schedule.department_id);
    if (!external.length) return result;

    // Une demande vivante suffit : on ne re-sollicite pas le chef à chaque sauvegarde.
    const existing = await query(
      `SELECT staff_user_id, status FROM staff_loan_requests
        WHERE schedule_id = $1 AND staff_user_id = ANY($2) AND status = ANY($3)`,
      [schedule.id, external.map((e) => e.userId), OPEN_STATUSES]
    );
    const alive = new Map(existing.rows.map((r) => [r.staff_user_id, r.status]));

    const markerDate = toDateKey(schedule.start_date);

    for (const ext of external) {
      const current = alive.get(ext.userId);
      if (current === 'pending') { result.pending.push(ext.userId); continue; }
      if (current === 'approved' || current === 'auto_approved') { result.autoApproved.push(ext.userId); continue; }

      // Service propriétaire sans chef désigné : personne ne peut répondre.
      // On auto-approuve plutôt que de laisser la ligne en attente indéfiniment.
      if (!ext.ownerChiefId) {
        await query(
          `INSERT INTO staff_loan_requests
             (establishment_id, schedule_id, requesting_department_id, requesting_chief_id,
              staff_user_id, owner_department_id, owner_chief_id, shift_date, status,
              responded_at, response_reason)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7::date,'auto_approved',NOW(),$8)`,
          [schedule.establishment_id, schedule.id, schedule.department_id, actor.id,
           ext.userId, ext.ownerDepartmentId, markerDate,
           `Aucun chef désigné pour le service ${ext.ownerDepartmentName || ''}`.trim()]
        );
        result.autoApproved.push(ext.userId);
        result.created += 1;
        continue;
      }

      const inserted = await query(
        `INSERT INTO staff_loan_requests
           (establishment_id, schedule_id, requesting_department_id, requesting_chief_id,
            staff_user_id, owner_department_id, owner_chief_id, shift_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,'pending')
         RETURNING id`,
        [schedule.establishment_id, schedule.id, schedule.department_id, actor.id,
         ext.userId, ext.ownerDepartmentId, ext.ownerChiefId, markerDate]
      );
      const loanId = inserted.rows[0].id;
      result.pending.push(ext.userId);
      result.created += 1;

      const staffRow = roster.find((r) => r.userId === ext.userId) || {};
      const staffName = `${staffRow.lastName || ''} ${staffRow.firstName || ''}`.trim() || 'un agent';
      const requesterName = `${actor.firstName || ''} ${actor.lastName || ''}`.trim() || 'Un chef de service';

      try {
        await createNotification({
          establishmentId: schedule.establishment_id,
          recipientId: ext.ownerChiefId,
          senderId: actor.id,
          type: 'staff_loan_requested',
          title: 'Demande de prêt de personnel',
          titleAr: 'طلب إعارة موظف',
          message: `${requesterName} souhaite affecter ${staffName} au planning « ${schedule.name || 'garde'} » (${markerDate}). La ligne reste en attente de votre réponse.`,
          entityType: 'staff_loan_requests',
          entityId: loanId,
          priority: 'high',
        });
        if (app) {
          emitToUser(app, ext.ownerChiefId, 'staff-loan:requested', { loanId, scheduleId: schedule.id });
          emitToUser(app, ext.ownerChiefId, 'notification:new', { type: 'staff_loan_requested' });
        }
      } catch (notifyErr) {
        console.error('syncExternalStaffLoans notification error:', notifyErr.message);
      }
    }
  } catch (err) {
    // Le tableur doit s'enregistrer même si la couche d'approbation échoue.
    console.error('syncExternalStaffLoans error:', err.message);
  }
  return result;
};

/**
 * Retire un agent d'un planning sans toucher à l'état du planning.
 * Utilisé quand le chef propriétaire refuse le prêt : seule la ligne saute,
 * le planning reste brouillon ou publié tel qu'il est.
 *
 * @returns {Promise<{removed: boolean, scheduleId: string, departmentId: string|null}>}
 */
const removeStaffFromSchedule = async ({ scheduleId, staffUserId }) => {
  const schedRes = await query(
    'SELECT id, department_id, establishment_id, name, metadata FROM schedules WHERE id = $1',
    [scheduleId]
  );
  const schedule = schedRes.rows[0];
  if (!schedule) return { removed: false, scheduleId, departmentId: null };

  const spreadsheet = schedule.metadata?.spreadsheet;
  const rows = Array.isArray(spreadsheet?.rows) ? spreadsheet.rows : null;
  const nextRows = rows ? rows.filter((r) => r.userId !== staffUserId) : null;
  const rowRemoved = rows ? nextRows.length !== rows.length : false;

  await transaction(async (client) => {
    await client.query('DELETE FROM shifts WHERE schedule_id = $1 AND user_id = $2', [scheduleId, staffUserId]);
    await client.query('DELETE FROM schedule_staff_assignments WHERE schedule_id = $1 AND user_id = $2', [scheduleId, staffUserId]);
    if (rowRemoved) {
      await client.query(
        `UPDATE schedules
            SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [scheduleId, JSON.stringify({
          spreadsheet: {
            ...spreadsheet,
            rows: nextRows,
            savedAt: new Date().toISOString(),
          },
        })]
      );
    }
    // `schedules.status` n'est volontairement PAS touché.
  });

  return { removed: true, rowRemoved, scheduleId, departmentId: schedule.department_id, establishmentId: schedule.establishment_id, scheduleName: schedule.name };
};

/**
 * Prévient le service demandeur qu'une ligne vient d'être retirée.
 * Séparé du retrait pour que l'échec d'un socket n'annule pas une suppression.
 *
 * `staffUserId` est dans la charge utile pour que le client retire la ligne du
 * cache immédiatement, sans attendre le rechargement du planning.
 * `requestingChiefId` déclenche en plus un envoi direct dans la room
 * `user:<chef>` : filet de sécurité si la room du service n'a pas été rejointe.
 */
const announceStaffRemoval = ({ app, removal, staffName, ownerChiefName, staffUserId, requestingChiefId }) => {
  if (!app) return;
  const payload = {
    scheduleId: removal?.scheduleId,
    staffUserId: staffUserId || null,
    staffName,
    ownerChiefName,
  };
  try {
    if (removal?.departmentId) {
      emitToDepartment(app, removal.departmentId, 'schedule:staff-removed', payload);
      emitToDepartment(app, removal.departmentId, 'schedule:updated', { scheduleId: removal.scheduleId });
    }
    if (requestingChiefId) {
      emitToUser(app, requestingChiefId, 'schedule:staff-removed', payload);
      emitToUser(app, requestingChiefId, 'schedule:updated', { scheduleId: removal?.scheduleId });
    }
  } catch (err) {
    console.error('announceStaffRemoval error:', err.message);
  }
};

module.exports = {
  findExternalStaff,
  getScheduleLoanStates,
  syncExternalStaffLoans,
  removeStaffFromSchedule,
  announceStaffRemoval,
};
