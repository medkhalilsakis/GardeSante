/**
 * Journal de service et alertes (Lot 4).
 *
 * Deux tables introduites par la migration 021 :
 *   `shift_events`   — présences, absences, retards, incidents, remarques, renforts
 *   `service_alerts` — personnel absent, garde non couverte, remplacement en attente, urgence
 *
 * Les absences et retards ne sont PAS écrits ici : ils passent par
 * `absences-shift.controller.js`, qui alimente déjà `shift_events` et
 * `service_alerts`. Ce module lit ce journal et accepte les seuls événements
 * saisis à la main (présence, remarque, incident, renfort).
 *
 * La portée est déduite du rôle, jamais du client — même règle que
 * `scoped-statistics.controller.js`.
 */

const { query } = require('../../config/database');
const { ROLES } = require('../../config/constants');
const { createNotification } = require('../notifications/notifications.controller');
const { emitToUser, emitToDepartment, emitToEstablishment } = require('../../realtime/emit');
const { rosterOnDate, remainingDutyDays, dateKey, datesBetween } = require('../schedules/spreadsheet-reader');
const history = require('../history/history.controller');

const SCOPE_PLATFORM = 'platform';
const SCOPE_ESTABLISHMENT = 'establishment';
const SCOPE_DEPARTMENTS = 'departments';

/** Types saisis à la main. Les absences/retards restent l'affaire d'absences-shift. */
const MANUAL_EVENT_TYPES = ['presence', 'remark', 'incident', 'reinforcement'];
const SEVERITIES = ['info', 'warning', 'error', 'critical'];
const CALL_EVENT_TYPES = ['presence', 'absence', 'late'];

const EVENT_LABELS = {
  presence: 'Présence',
  absence: 'Absence',
  late: 'Retard',
  incident: 'Incident',
  remark: 'Remarque',
  reinforcement: 'Demande de renfort',
};

/** Rôles autorisés à écrire dans le journal de leur service. */
const WRITE_ROLES = [
  ROLES.DEPARTMENT_HEAD,
  ROLES.SERVICE_SUPERVISOR,
  ROLES.GENERAL_SUPERVISOR,
];

/**
 * Saisie d'un événement — appel du jour (point 6). Le directeur est ajouté ICI
 * SEULEMENT : `WRITE_ROLES` reste inchangé pour que la prise en compte des
 * alertes (`updateAlert`) conserve exactement le périmètre qu'elle avait.
 */
const EVENT_WRITE_ROLES = [...WRITE_ROLES, ROLES.DIRECTOR];

/**
 * Portée effective de l'utilisateur. `departmentIds` est vide quand l'agent
 * n'est rattaché à aucun service : l'appelant renvoie alors une liste vide
 * plutôt qu'un 500.
 */
const resolveJournalScope = async (user, queryParams = {}) => {
  if (user.isSuperAdmin || user.roleCode === ROLES.SUPER_ADMIN) {
    if (queryParams.establishmentId) {
      return { kind: SCOPE_ESTABLISHMENT, establishmentId: queryParams.establishmentId, label: 'Établissement ciblé' };
    }
    return { kind: SCOPE_PLATFORM, label: 'Plateforme' };
  }

  if ([ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN, ROLES.GENERAL_SUPERVISOR].includes(user.roleCode)) {
    return {
      kind: SCOPE_ESTABLISHMENT,
      establishmentId: user.establishmentId,
      label: user.establishmentName || 'Établissement',
    };
  }

  if ([ROLES.DEPARTMENT_HEAD, ROLES.SERVICE_SUPERVISOR].includes(user.roleCode)) {
    const { rows } = await query(
      'SELECT department_id FROM user_departments WHERE user_id = $1',
      [user.id]
    );
    return {
      kind: SCOPE_DEPARTMENTS,
      establishmentId: user.establishmentId,
      departmentIds: rows.map((r) => r.department_id),
      label: 'Mes services',
    };
  }

  return null;
};

/**
 * Traduit une portée en fragment SQL. `alias` porte les colonnes
 * establishment_id / department_id (shift_events comme service_alerts).
 */
const scopeClause = (scope, alias, params) => {
  if (scope.kind === SCOPE_PLATFORM) return '1=1';

  if (scope.kind === SCOPE_ESTABLISHMENT) {
    params.push(scope.establishmentId);
    return `${alias}.establishment_id = $${params.length}`;
  }

  params.push(scope.establishmentId);
  const est = `${alias}.establishment_id = $${params.length}`;
  params.push(scope.departmentIds);
  return `${est} AND ${alias}.department_id = ANY($${params.length}::uuid[])`;
};

/** Un chef ou surveillant n'écrit que dans un service dont il est membre. */
const assertDepartmentWritable = async (user, departmentId) => {
  if (user.isSuperAdmin || user.roleCode === ROLES.SUPER_ADMIN) return true;
  // SG et directeur ne sont rattachés à aucun service (point 1) : leur périmètre
  // d'écriture est l'établissement entier, ce que `resolveJournalScope` leur
  // accorde déjà en lecture. Sans cela un directeur serait refusé ici.
  if ([ROLES.GENERAL_SUPERVISOR, ROLES.DIRECTOR].includes(user.roleCode)) {
    const { rows } = await query(
      'SELECT id FROM departments WHERE id = $1 AND establishment_id = $2',
      [departmentId, user.establishmentId]
    );
    return rows.length > 0;
  }
  const { rows } = await query(
    'SELECT department_id FROM user_departments WHERE user_id = $1 AND department_id = $2',
    [user.id, departmentId]
  );
  return rows.length > 0;
};

// ============================================================
// GET /api/journal?departmentId=&type=&from=&to=&limit=
// Journal de service — lecture seule, ordonné du plus récent au plus ancien.
// ============================================================
const listEvents = async (req, res) => {
  try {
    const scope = await resolveJournalScope(req.user, req.query);
    if (!scope) {
      return res.status(403).json({ success: false, message: 'Aucun journal disponible pour votre rôle' });
    }
    if (scope.kind === SCOPE_DEPARTMENTS && !scope.departmentIds.length) {
      return res.json({ success: true, data: { scope: scope.kind, scopeLabel: scope.label, events: [], counts: {} } });
    }

    const params = [];
    const conditions = [scopeClause(scope, 'e', params)];

    if (req.query.departmentId) {
      params.push(req.query.departmentId);
      conditions.push(`e.department_id = $${params.length}`);
    }
    if (req.query.scheduleId) {
      params.push(req.query.scheduleId);
      conditions.push(`e.schedule_id = $${params.length}`);
    }
    if (req.query.userId) {
      params.push(req.query.userId);
      conditions.push(`e.user_id = $${params.length}`);
    }
    if (req.query.type) {
      // `type` accepte soit un type unique, soit une liste séparée par des
      // virgules (`presence,absence,late`) : l'historique de l'appel du jour
      // demande les trois issues d'un pointage en un seul appel. Un type simple
      // continue de passer par le même chemin — la liste n'en contient qu'un.
      const types = String(req.query.type)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length) {
        params.push(types);
        conditions.push(`e.event_type = ANY($${params.length}::text[])`);
      }
    }
    // Bornes en chaînes : le fuseau ne doit pas décaler la journée demandée.
    if (req.query.from) {
      params.push(String(req.query.from).slice(0, 10));
      conditions.push(`COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date) >= $${params.length}::date`);
    }
    if (req.query.to) {
      params.push(String(req.query.to).slice(0, 10));
      conditions.push(`COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date) <= $${params.length}::date`);
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    params.push(limit);

    const { rows } = await query(
      `SELECT e.id, e.event_type, e.title, e.description, e.severity, e.metadata,
              e.schedule_id, e.department_id, e.user_id,
              CASE WHEN e.event_type IN ('absence', 'late') THEN COALESCE(
                CASE
                  WHEN jsonb_typeof(e.metadata->'isJustified') = 'boolean'
                  THEN (e.metadata->>'isJustified')::boolean
                END,
                (SELECT a.is_justified
                 FROM absences a
                 WHERE a.establishment_id = e.establishment_id
                   AND a.user_id = e.user_id
                   AND a.kind = 'shift_absence'
                   AND a.status <> 'cancelled'
                   AND (
                     a.id::text = e.metadata->>'absenceId'
                     OR (
                       a.schedule_id = e.schedule_id
                       AND a.start_date = COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date)
                     )
                   )
                 ORDER BY (a.id::text = COALESCE(e.metadata->>'absenceId', '')) DESC,
                          a.created_at DESC
                 LIMIT 1)
              ) END AS is_justified,
               TO_CHAR(COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date), 'YYYY-MM-DD') AS event_date,
               TO_CHAR(e.created_at, 'YYYY-MM-DD') AS declared_date,
               TO_CHAR(e.created_at, 'HH24:MI')    AS event_hour,
              e.event_time, e.created_at,
              d.name AS department_name,
              u.first_name, u.last_name, u.avatar_url,
              r.first_name AS reporter_first_name, r.last_name AS reporter_last_name,
              s.name AS schedule_name
       FROM shift_events e
       JOIN departments d ON e.department_id = d.id
       LEFT JOIN users u  ON e.user_id = u.id
       LEFT JOIN users r  ON e.reported_by = r.id
       LEFT JOIN schedules s ON e.schedule_id = s.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY e.event_time DESC
       LIMIT $${params.length}`,
      params
    );

    const counts = {};
    for (const row of rows) {
      counts[row.event_type] = (counts[row.event_type] || 0) + 1;
    }

    return res.json({
      success: true,
      data: {
        scope: scope.kind,
        scopeLabel: scope.label,
        counts,
        events: rows.map((e) => ({
          id: e.id,
          type: e.event_type,
          typeLabel: EVENT_LABELS[e.event_type] || e.event_type,
          title: e.title,
          description: e.description,
          severity: e.severity,
          metadata: e.metadata,
          isJustified: e.is_justified,
          date: e.event_date,
          declaredDate: e.declared_date,
          hour: e.event_hour,
          scheduleId: e.schedule_id,
          scheduleName: e.schedule_name,
          departmentId: e.department_id,
          departmentName: e.department_name,
          userId: e.user_id,
          userName: e.first_name ? `${e.first_name} ${e.last_name}` : null,
          avatarUrl: e.avatar_url,
          reporterName: e.reporter_first_name ? `${e.reporter_first_name} ${e.reporter_last_name}` : null,
        })),
      },
    });
  } catch (err) {
    console.error('listEvents error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du journal' });
  }
};

// ============================================================
// POST /api/journal
// Saisie manuelle : présence, remarque, incident, demande de renfort.
// ============================================================
const createEvent = async (req, res) => {
  try {
    const { roleCode, establishmentId, id: reporterId, isSuperAdmin } = req.user;

    if (!EVENT_WRITE_ROLES.includes(roleCode) && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Seuls les chefs de service, surveillants, surveillants généraux et directeurs peuvent écrire au journal',
        message_ar: 'فقط رؤساء الأقسام والمشرفون والمديرون يمكنهم الكتابة في السجل',
      });
    }

    const {
      departmentId: requestedDepartmentId,
      scheduleId,
      eventType,
      userId,
      title,
      description,
      severity,
      dutyDate,
    } = req.body;
    let departmentId = requestedDepartmentId;

    if (
      eventType === 'incident'
      && [ROLES.DEPARTMENT_HEAD, ROLES.SERVICE_SUPERVISOR].includes(roleCode)
    ) {
      // Le service d'un incident est determine par l'affectation du declarant,
      // jamais par une valeur envoyee par le client.
      departmentId = req.user.departmentId || null;

      if (!departmentId) {
        const { rows: departmentRows } = await query(
          `SELECT ud.department_id
           FROM user_departments ud
           JOIN departments d ON d.id = ud.department_id
           WHERE ud.user_id = $1 AND d.establishment_id = $2
           ORDER BY ud.is_primary DESC NULLS LAST,
                    CASE WHEN $3::boolean THEN ud.is_head ELSE FALSE END DESC NULLS LAST,
                    ud.department_id
           LIMIT 1`,
          [reporterId, establishmentId, roleCode === ROLES.DEPARTMENT_HEAD]
        );
        departmentId = departmentRows[0]?.department_id || null;
      }

      if (!departmentId) {
        return res.status(400).json({
          success: false,
          message: 'Aucun service n\'est attribue a votre compte. Contactez l\'administration.',
        });
      }
    }

    if (!departmentId || !eventType || !title) {
      return res.status(400).json({
        success: false,
        message: 'Service, type et titre sont obligatoires',
        message_ar: 'القسم والنوع والعنوان مطلوبة',
      });
    }
    if (!MANUAL_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({
        success: false,
        message: 'Les absences et retards se signalent depuis le module absences, pas depuis le journal',
        message_ar: 'الغياب والتأخر يتم الإبلاغ عنهما من وحدة الغياب',
      });
    }
    if (roleCode === ROLES.DIRECTOR && eventType !== 'presence') {
      return res.status(403).json({ success: false, message: 'La direction consulte le journal mais ne déclare pas les incidents de service' });
    }
    if (severity && !SEVERITIES.includes(severity)) {
      return res.status(400).json({ success: false, message: 'Gravité invalide' });
    }

    if (!(await assertDepartmentWritable(req.user, departmentId))) {
      return res.status(403).json({
        success: false,
        message: 'Ce service ne fait pas partie de votre périmètre',
        message_ar: 'هذا القسم خارج نطاقك',
      });
    }

    const effectiveDate = String(dutyDate || '').slice(0, 10);
    if (dutyDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return res.status(400).json({ success: false, message: 'Date de garde invalide' });
    }
    if (dutyDate && eventType !== 'presence') {
      return res.status(400).json({ success: false, message: 'Seule une présence peut être rattrapée depuis le journal' });
    }

    if (dutyDate) {
      const today = dateKey(new Date());
      if (effectiveDate >= today) {
        return res.status(400).json({ success: false, message: 'Le rattrapage est réservé aux gardes déjà passées' });
      }
      if (!scheduleId || !userId) {
        return res.status(400).json({ success: false, message: 'Planning et agent requis pour le rattrapage' });
      }

      const { rows: schedRows } = await query(
        `SELECT s.id, s.department_id, s.establishment_id, s.metadata, s.schedule_type,
                TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(s.end_date, 'YYYY-MM-DD') AS end_date
         FROM schedules s
         WHERE s.id = $1 AND s.establishment_id = $2 AND s.department_id = $3
           AND s.status NOT IN ('draft','rejected')`,
        [scheduleId, establishmentId, departmentId]
      );
      const schedule = schedRows[0];
      const roster = schedule ? rosterOnDate(schedule, effectiveDate) : [];
      if (!schedule || !roster.some((entry) => entry.userId === userId)) {
        return res.status(400).json({ success: false, message: 'Cet agent n’était pas de garde à cette date' });
      }

      const duplicate = await query(
        `SELECT id FROM shift_events
         WHERE schedule_id = $1 AND user_id = $2
           AND COALESCE(duty_date, (event_time AT TIME ZONE 'Africa/Tunis')::date) = $3::date
           AND event_type = ANY($4::text[])
         LIMIT 1`,
        [scheduleId, userId, effectiveDate, CALL_EVENT_TYPES]
      );
      if (duplicate.rows.length) {
        return res.status(409).json({ success: false, message: 'Cet agent a déjà été pointé pour cette garde' });
      }
      const orphanAbsence = await query(
        `SELECT id FROM absences
         WHERE schedule_id = $1 AND user_id = $2 AND start_date = $3::date
           AND kind = 'shift_absence' AND status <> 'cancelled'
         LIMIT 1`,
        [scheduleId, userId, effectiveDate]
      );
      if (orphanAbsence.rows.length) {
        return res.status(409).json({ success: false, message: 'Une absence ou un retard existe déjà pour cette garde' });
      }
    }

    const { rows } = await query(
      `INSERT INTO shift_events
         (establishment_id, department_id, schedule_id, event_type,
          user_id, reported_by, title, description, severity, duty_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::date,(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Tunis')::date))
       RETURNING *`,
      [
        establishmentId, departmentId, scheduleId || null, eventType,
        userId || null, reporterId, String(title).slice(0, 255),
        description || null, severity || 'info',
        effectiveDate || null,
      ]
    );
    const event = rows[0];

    // Un incident grave et une demande de renfort méritent une alerte de service.
    const needsAlert = eventType === 'reinforcement'
      || (eventType === 'incident' && ['error', 'critical'].includes(severity));

    if (needsAlert) {
      await query(
        `INSERT INTO service_alerts
           (establishment_id, department_id, schedule_id, alert_type, severity, title, message, entity_type, entity_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'shift_events',$8)`,
        [
          establishmentId, departmentId, scheduleId || null,
          eventType === 'reinforcement' ? 'insufficient_staff' : 'urgent_notification',
          severity === 'critical' ? 'critical' : 'warning',
          eventType === 'reinforcement' ? 'Demande de renfort' : 'Incident signalé',
          String(title).slice(0, 255),
          event.id,
        ]
      );
    }

    await history.log({
      userId: reporterId,
      action: 'journal_evenement',
      category: 'schedules',
      description: `${EVENT_LABELS[eventType] || eventType} — ${title}`,
      entityType: 'shift_events',
      entityId: event.id,
      metadata: { departmentId, scheduleId, eventType, severity: severity || 'info', dutyDate: effectiveDate || null, isCatchup: Boolean(dutyDate) },
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent'],
      severity: severity === 'critical' ? 'critical' : 'info',
    });

    // Une demande de renfort remonte au chef du service et aux surveillants généraux.
    if (eventType === 'reinforcement') {
      const { rows: targets } = await query(
        `SELECT DISTINCT u.id
         FROM users u
         LEFT JOIN user_departments ud ON ud.user_id = u.id AND ud.department_id = $1
         JOIN roles ro ON u.role_id = ro.id
         WHERE u.establishment_id = $2
           AND u.is_active = TRUE
           AND u.id <> $3
           AND (
             (ro.code = $4 AND ud.is_head = TRUE)
             OR ro.code = $5
           )`,
        [departmentId, establishmentId, reporterId, ROLES.DEPARTMENT_HEAD, ROLES.GENERAL_SUPERVISOR]
      );

      for (const target of targets) {
        await createNotification({
          establishmentId,
          recipientId: target.id,
          senderId: reporterId,
          type: 'reinforcement_requested',
          title: 'Demande de renfort',
          titleAr: 'طلب تعزيز',
          message: String(title).slice(0, 255),
          entityType: 'shift_events',
          entityId: event.id,
          priority: 'high',
        });
        emitToUser(req.app, target.id, 'notification:new', { type: 'reinforcement_requested' });
      }
    }

    if (eventType === 'incident') {
      const { rows: directors } = await query(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.establishment_id = $1 AND u.is_active = TRUE
            AND r.code IN ($2, $3) AND u.id <> $4`,
        [establishmentId, ROLES.DIRECTOR, ROLES.HOSPITAL_ADMIN, reporterId]
      );
      for (const director of directors) {
        await createNotification({
          establishmentId,
          recipientId: director.id,
          senderId: reporterId,
          type: 'incident_reported',
          title: 'Incident de service signalé',
          message: String(title).slice(0, 255),
          entityType: 'shift_events',
          entityId: event.id,
          priority: ['error', 'critical'].includes(severity) ? 'urgent' : 'high',
        });
        emitToUser(req.app, director.id, 'notification:new', { type: 'incident_reported' });
      }
    }

    emitToDepartment(req.app, departmentId, 'journal:event', { eventId: event.id, eventType, departmentId });
    // Le même événement à l'échelle de l'hôpital : le directeur et le surveillant
    // général n'appartiennent à aucun service (Lot L), donc la room
    // `department:<service>` ne les atteint jamais. Sans cette ligne, « Garde en
    // direct » et l'appel du jour ne se rafraîchiraient chez eux qu'au tick de
    // 15 s. Même nom d'événement, même charge utile : les auditeurs existants
    // (`useRealtime.handleJournal`) invalident déjà les bonnes clés, et les
    // membres du service reçoivent simplement deux invalidations que
    // react-query dédoublonne.
    emitToEstablishment(req.app, establishmentId, 'journal:event', { eventId: event.id, eventType, departmentId });
    if (needsAlert) {
      emitToEstablishment(req.app, establishmentId, 'alert:new', { type: eventType, departmentId });
    }

    return res.status(201).json({ success: true, data: event, message: 'Événement enregistré' });
  } catch (err) {
    console.error('createEvent error:', err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Cet agent a déjà été pointé pour cette garde' });
    }
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement' });
  }
};

// ============================================================
// GET /api/journal/calls?from=&to=
// Gardes attendues et pointages manquants, dans la portée du rôle.
// ============================================================
const listCallRoster = async (req, res) => {
  try {
    const scope = await resolveJournalScope(req.user, req.query);
    if (!scope) return res.status(403).json({ success: false, message: 'Aucun appel disponible pour votre rôle' });
    if (scope.kind === SCOPE_DEPARTMENTS && !scope.departmentIds.length) {
      return res.json({ success: true, data: { today: dateKey(new Date()), scopeLabel: scope.label, calls: [] } });
    }

    const today = dateKey(new Date());
    const from = String(req.query.from || today).slice(0, 10);
    const requestedTo = String(req.query.to || today).slice(0, 10);
    const to = requestedTo < today ? requestedTo : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return res.status(400).json({ success: false, message: 'Période invalide' });
    }
    if (datesBetween(from, to).length > 93) {
      return res.status(400).json({ success: false, message: 'La période de rattrapage est limitée à 93 jours' });
    }

    const schedParams = [from, to];
    const conditions = [
      "s.status NOT IN ('draft','rejected')",
      's.start_date <= $2::date',
      's.end_date >= $1::date',
    ];
    if (scope.kind === SCOPE_ESTABLISHMENT) {
      schedParams.push(scope.establishmentId);
      conditions.push(`s.establishment_id = $${schedParams.length}`);
    } else if (scope.kind === SCOPE_DEPARTMENTS) {
      schedParams.push(scope.establishmentId);
      conditions.push(`s.establishment_id = $${schedParams.length}`);
      schedParams.push(scope.departmentIds);
      conditions.push(`s.department_id = ANY($${schedParams.length}::uuid[])`);
    }

    const { rows: schedules } = await query(
      `SELECT s.id, s.name, s.department_id, s.metadata, s.schedule_type,
              TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(s.end_date, 'YYYY-MM-DD') AS end_date,
              d.name AS department_name
       FROM schedules s
       JOIN departments d ON d.id = s.department_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.start_date DESC`,
      schedParams
    );

    const expected = [];
    const seen = new Set();
    for (const schedule of schedules) {
      const start = schedule.start_date > from ? schedule.start_date : from;
      const end = schedule.end_date < to ? schedule.end_date : to;
      for (const day of datesBetween(start, end)) {
        for (const entry of rosterOnDate(schedule, day)) {
          if (!entry.userId) continue;
          const key = `${day}|${schedule.id}|${entry.userId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          expected.push({
            key, date: day, userId: entry.userId,
            userName: `${entry.firstName} ${entry.lastName}`.trim() || '—',
            roleName: entry.roleName, label: entry.label,
            shiftStart: entry.shiftStart, shiftEnd: entry.shiftEnd,
            scheduleId: schedule.id, scheduleName: schedule.name,
            departmentId: schedule.department_id, departmentName: schedule.department_name,
          });
        }
      }
    }

    if (expected.length) {
      const eventParams = [];
      const eventScope = scopeClause(scope, 'e', eventParams);
      eventParams.push(CALL_EVENT_TYPES);
      const typesIndex = eventParams.length;
      eventParams.push(from);
      const fromIndex = eventParams.length;
      eventParams.push(to);
      const toIndex = eventParams.length;
      const { rows: eventRows } = await query(
        `SELECT e.schedule_id, e.user_id,
                TO_CHAR(COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date), 'YYYY-MM-DD') AS duty_date
         FROM shift_events e
         WHERE ${eventScope}
           AND e.event_type = ANY($${typesIndex}::text[])
           AND COALESCE(e.duty_date, (e.event_time AT TIME ZONE 'Africa/Tunis')::date) BETWEEN $${fromIndex}::date AND $${toIndex}::date`,
        eventParams
      );
      const declared = new Set(eventRows.map((e) => `${e.duty_date}|${e.schedule_id}|${e.user_id}`));
      expected.forEach((call) => { call.isDeclared = declared.has(call.key); });
    }

    return res.json({ success: true, data: { today, scope: scope.kind, scopeLabel: scope.label, calls: expected } });
  } catch (err) {
    console.error('listCallRoster error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des appels à rattraper' });
  }
};

// ============================================================
// GET /api/journal/alerts?resolved=&departmentId=
// ============================================================
const listAlerts = async (req, res) => {
  try {
    const scope = await resolveJournalScope(req.user, req.query);
    if (!scope) {
      return res.status(403).json({ success: false, message: 'Aucune alerte disponible pour votre rôle' });
    }
    if (scope.kind === SCOPE_DEPARTMENTS && !scope.departmentIds.length) {
      return res.json({ success: true, data: { scope: scope.kind, scopeLabel: scope.label, alerts: [], counts: {} } });
    }

    const params = [];
    const conditions = [scopeClause(scope, 'a', params)];

    // Par défaut on ne montre que les alertes ouvertes.
    if (req.query.resolved === 'true') conditions.push('a.resolved_at IS NOT NULL');
    else if (req.query.resolved !== 'all') conditions.push('a.resolved_at IS NULL');

    if (req.query.departmentId) {
      params.push(req.query.departmentId);
      conditions.push(`a.department_id = $${params.length}`);
    }
    if (req.query.type) {
      params.push(req.query.type);
      conditions.push(`a.alert_type = $${params.length}`);
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    params.push(limit);

    const { rows } = await query(
      `SELECT a.id, a.alert_type, a.severity, a.title, a.message,
              a.entity_type, a.entity_id, a.department_id, a.schedule_id,
              a.acknowledged_by, a.acknowledged_at, a.resolved_at, a.created_at,
              d.name AS department_name,
              ack.first_name AS ack_first_name, ack.last_name AS ack_last_name
       FROM service_alerts a
       LEFT JOIN departments d ON a.department_id = d.id
       LEFT JOIN users ack ON a.acknowledged_by = ack.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY
         CASE a.severity WHEN 'urgent' THEN 0 WHEN 'critical' THEN 1 WHEN 'error' THEN 2 WHEN 'warning' THEN 3 ELSE 4 END,
         a.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    const counts = {};
    for (const row of rows) {
      counts[row.severity] = (counts[row.severity] || 0) + 1;
    }

    return res.json({
      success: true,
      data: {
        scope: scope.kind,
        scopeLabel: scope.label,
        counts,
        alerts: rows.map((a) => ({
          id: a.id,
          type: a.alert_type,
          severity: a.severity,
          title: a.title,
          message: a.message,
          entityType: a.entity_type,
          entityId: a.entity_id,
          departmentId: a.department_id,
          departmentName: a.department_name,
          scheduleId: a.schedule_id,
          acknowledgedAt: a.acknowledged_at,
          acknowledgedBy: a.ack_first_name ? `${a.ack_first_name} ${a.ack_last_name}` : null,
          resolvedAt: a.resolved_at,
          createdAt: a.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('listAlerts error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des alertes' });
  }
};

// ============================================================
// PATCH /api/journal/alerts/:id  { action: 'acknowledge' | 'resolve' }
// ============================================================
const updateAlert = async (req, res) => {
  try {
    const { roleCode, establishmentId, id: userId, isSuperAdmin } = req.user;
    const { action } = req.body;

    if (!WRITE_ROLES.includes(roleCode) && !isSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Action non autorisée pour votre rôle' });
    }
    if (!['acknowledge', 'resolve'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action invalide' });
    }

    const existing = await query(
      `SELECT id, department_id, establishment_id, resolved_at FROM service_alerts WHERE id = $1`,
      [req.params.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Alerte introuvable' });
    }
    const alert = existing.rows[0];

    if (!isSuperAdmin && alert.establishment_id !== establishmentId) {
      return res.status(403).json({ success: false, message: 'Alerte hors de votre établissement' });
    }
    if (alert.department_id && !(await assertDepartmentWritable(req.user, alert.department_id))) {
      return res.status(403).json({ success: false, message: 'Ce service ne fait pas partie de votre périmètre' });
    }

    const { rows } = await query(
      action === 'resolve'
        ? `UPDATE service_alerts
             SET resolved_at = NOW(),
                 acknowledged_by = COALESCE(acknowledged_by, $2),
                 acknowledged_at = COALESCE(acknowledged_at, NOW())
           WHERE id = $1 RETURNING *`
        : `UPDATE service_alerts
             SET acknowledged_by = $2, acknowledged_at = NOW()
           WHERE id = $1 RETURNING *`,
      [req.params.id, userId]
    );

    await history.log({
      userId,
      action: action === 'resolve' ? 'alerte_resolue' : 'alerte_prise_en_compte',
      category: 'schedules',
      description: `Alerte ${req.params.id} — ${action === 'resolve' ? 'résolue' : 'prise en compte'}`,
      entityType: 'service_alerts',
      entityId: req.params.id,
      ipAddress: history.getIp(req),
      userAgent: req.headers['user-agent'],
      severity: 'info',
    });

    if (alert.department_id) {
      emitToDepartment(req.app, alert.department_id, 'alert:updated', { alertId: req.params.id, action });
    }
    emitToEstablishment(req.app, alert.establishment_id, 'alert:updated', { alertId: req.params.id, action });

    return res.json({ success: true, data: rows[0], message: action === 'resolve' ? 'Alerte résolue' : 'Alerte prise en compte' });
  } catch (err) {
    console.error('updateAlert error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la mise à jour de l\'alerte' });
  }
};

// ============================================================
// GET /api/journal/overview
// Tableau de bord rapide du surveillant : gardes restantes, mouvements du jour,
// incidents ouverts, remplacements. Les gardes proviennent du tableur
// (`schedules.metadata.spreadsheet`), pas de la table `shifts` — cf. Lot 3.
// ============================================================
const getServiceOverview = async (req, res) => {
  try {
    const scope = await resolveJournalScope(req.user, req.query);
    if (!scope) {
      return res.status(403).json({ success: false, message: 'Aucune vue disponible pour votre rôle' });
    }

    const today = dateKey(new Date());
    const empty = {
      scope: scope.kind,
      scopeLabel: scope.label,
      today,
      summary: {
        guardsToday: 0, guardsRemaining: 0, staffOnDutyToday: 0,
        eventsToday: 0, openAlerts: 0, criticalAlerts: 0,
        replacementsConfirmed: 0, replacementsPending: 0, absencesToday: 0,
      },
      activeSchedules: [],
      todayGuards: [],
    };

    if (scope.kind === SCOPE_DEPARTMENTS && !scope.departmentIds.length) {
      return res.json({ success: true, data: empty });
    }

    // --- Plannings en cours dans la portée -------------------------------
    const schedParams = [];
    const schedConditions = [];

    if (scope.kind === SCOPE_ESTABLISHMENT) {
      schedParams.push(scope.establishmentId);
      schedConditions.push(`s.establishment_id = $${schedParams.length}`);
    } else if (scope.kind === SCOPE_DEPARTMENTS) {
      schedParams.push(scope.establishmentId);
      schedConditions.push(`s.establishment_id = $${schedParams.length}`);
      schedParams.push(scope.departmentIds);
      schedConditions.push(`s.department_id = ANY($${schedParams.length}::uuid[])`);
    }
    // Seuls les plannings réellement en cours nourrissent la vue « garde courante ».
    schedConditions.push("planning_state(s.status, s.start_date, s.end_date) = 'en_cours'");

    const { rows: schedules } = await query(
      `SELECT s.id, s.name, s.department_id, s.metadata, s.status,
              TO_CHAR(s.start_date, 'YYYY-MM-DD') AS start_date,
              TO_CHAR(s.end_date,   'YYYY-MM-DD') AS end_date,
              planning_state(s.status, s.start_date, s.end_date) AS state,
              d.name AS department_name
       FROM schedules s
       LEFT JOIN departments d ON s.department_id = d.id
       ${schedConditions.length ? `WHERE ${schedConditions.join(' AND ')}` : ''}
       ORDER BY s.start_date DESC
       LIMIT 40`,
      schedParams
    );

    let guardsToday = 0;
    let guardsRemaining = 0;
    const staffToday = new Set();
    const todayGuards = [];
    const seenToday = new Set();

    // `rosterOnDate` applique la règle d'arbitrage de la ligne : cases cochées, ou
    // période de participation quand la ligne n'en porte aucune. Ne lire que les
    // cases donnait « Aucune garde à pointer aujourd'hui » sur un planning validé
    // par périodes, alors que le calendrier du tableur affichait bien ses agents.
    for (const schedule of schedules) {
      for (const entry of rosterOnDate(schedule, today)) {
        // Un même agent ne doit pas être pointé deux fois pour un planning
        // (ligne dupliquée, ou reprise d'une proposition acceptée).
        const dedup = entry.userId ? `${schedule.id}|${entry.userId}` : null;
        if (dedup) {
          if (seenToday.has(dedup)) continue;
          seenToday.add(dedup);
        }
        guardsToday += 1;
        if (entry.userId) staffToday.add(entry.userId);
        todayGuards.push({
          userId: entry.userId,
          name: `${entry.firstName} ${entry.lastName}`.trim() || '—',
          roleName: entry.roleName,
          label: entry.label,
          shiftStart: entry.shiftStart,
          shiftEnd: entry.shiftEnd,
          // Garde à domicile (Lot N) : produit par `rosterOnDate`, recopié ici
          // pour que « Garde en direct » distingue l'astreinte de la présence.
          atHome: entry.atHome === true,
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          departmentId: schedule.department_id,
          departmentName: schedule.department_name,
        });
      }
      guardsRemaining += remainingDutyDays(schedule, today);
    }

    // --- Journal du jour --------------------------------------------------
    const evParams = [];
    const evScope = scopeClause(scope, 'e', evParams);
    evParams.push(`${today} 00:00:00`);
    const { rows: evRows } = await query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE e.event_type = 'incident')::int AS incidents,
              COUNT(*) FILTER (WHERE e.event_type IN ('absence','late'))::int AS absences
       FROM shift_events e
       WHERE ${evScope} AND e.event_time >= $${evParams.length}::timestamptz`,
      evParams
    );

    // --- Alertes ouvertes -------------------------------------------------
    const alParams = [];
    const alScope = scopeClause(scope, 'a', alParams);
    const { rows: alRows } = await query(
      `SELECT COUNT(*)::int AS open,
              COUNT(*) FILTER (WHERE a.severity IN ('critical','urgent'))::int AS critical
       FROM service_alerts a
       WHERE ${alScope} AND a.resolved_at IS NULL`,
      alParams
    );

    // --- Remplacements ----------------------------------------------------
    const rpParams = [];
    const rpConditions = [];
    if (scope.kind === SCOPE_ESTABLISHMENT) {
      rpParams.push(scope.establishmentId);
      rpConditions.push(`r.establishment_id = $${rpParams.length}`);
    } else if (scope.kind === SCOPE_DEPARTMENTS) {
      rpParams.push(scope.establishmentId);
      rpConditions.push(`r.establishment_id = $${rpParams.length}`);
      rpParams.push(scope.departmentIds);
      rpConditions.push(`r.department_id = ANY($${rpParams.length}::uuid[])`);
    }
    const { rows: rpRows } = await query(
      `SELECT COUNT(*) FILTER (WHERE r.confirmation_status = 'confirmed')::int    AS confirmed,
              COUNT(*) FILTER (WHERE r.confirmation_status = 'pending_chef')::int AS pending
       FROM replacements r
       ${rpConditions.length ? `WHERE ${rpConditions.join(' AND ')}` : ''}`,
      rpParams
    );

    return res.json({
      success: true,
      data: {
        scope: scope.kind,
        scopeLabel: scope.label,
        today,
        summary: {
          guardsToday,
          guardsRemaining,
          staffOnDutyToday: staffToday.size,
          eventsToday: evRows[0]?.total || 0,
          absencesToday: evRows[0]?.absences || 0,
          incidentsToday: evRows[0]?.incidents || 0,
          openAlerts: alRows[0]?.open || 0,
          criticalAlerts: alRows[0]?.critical || 0,
          replacementsConfirmed: rpRows[0]?.confirmed || 0,
          replacementsPending: rpRows[0]?.pending || 0,
        },
        activeSchedules: schedules.map((s) => ({
          id: s.id,
          name: s.name,
          state: s.state,
          status: s.status,
          startDate: s.start_date,
          endDate: s.end_date,
          departmentId: s.department_id,
          departmentName: s.department_name,
        })),
        todayGuards,
      },
    });
  } catch (err) {
    console.error('getServiceOverview error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement de la vue d\'ensemble' });
  }
};

module.exports = {
  resolveJournalScope,
  scopeClause,
  listEvents,
  createEvent,
  listAlerts,
  updateAlert,
  getServiceOverview,
  listCallRoster,
  EVENT_LABELS,
  MANUAL_EVENT_TYPES,
};
