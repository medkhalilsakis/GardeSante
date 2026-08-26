/**
 * ============================================================
 * RULES ENGINE — Moteur de Règles Métier Configurable
 * GardeSante · Module Chef de Service
 * ============================================================
 *
 * Ce moteur évalue les règles JSONB stockées dans `establishment_rules`
 * sur un planning (`schedule_id`) ou un ensemble de gardes.
 *
 * Types de règles supportés :
 *  - rest          : repos minimum entre 2 gardes
 *  - frequency     : max gardes / période / rôle
 *  - balance       : équilibre des gardes entre membres du service
 *  - constraint    : contraintes spécifiques (double affectation, absence, etc.)
 *  - rotation      : semaines A/B, cycles d'équipes
 *  - cross_est     : contraintes inter-établissements
 */

const { query } = require('../../config/database');
const { dutyEntries, datesBetween, dateKey } = require('./spreadsheet-reader');

/**
 * Matérialise les affectations dans la forme historique attendue par le moteur
 * de règles. Le registre moderne est prioritaire ; les anciens plannings qui ne
 * portent pas encore `metadata.spreadsheet.rows` restent lisibles via `shifts`.
 */
const readSpreadsheetShifts = async (scheduleId) => {
  const scheduleResult = await query(
    `SELECT id, schedule_type, metadata,
            TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date,
            TO_CHAR(end_date,   'YYYY-MM-DD') AS end_date,
            establishment_id
       FROM schedules WHERE id = $1`, [scheduleId]
  );
  const schedule = scheduleResult.rows[0];
  if (!schedule) return [];

  // Une liste `rows` explicite, même vide, est la source de vérité du Tableur.
  // L'absence de cette clé identifie les plannings historiques (wizard/ancien
  // assistant) pour lesquels la table `shifts` reste la seule source disponible.
  const hasSpreadsheet = Array.isArray(schedule.metadata?.spreadsheet?.rows);
  if (!hasSpreadsheet) {
    const legacyResult = await query(
      `SELECT s.id, s.user_id, TO_CHAR(s.shift_date, 'YYYY-MM-DD') AS shift_date,
              s.status, st.start_time, st.end_time, st.duration_hours,
              st.is_overnight, u.first_name, u.last_name, r.code AS role_code
         FROM shifts s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN shift_types st ON st.id = s.shift_type_id
        WHERE s.schedule_id = $1 AND s.status <> 'cancelled'
        ORDER BY s.shift_date, u.last_name`,
      [scheduleId]
    );
    return legacyResult.rows.map((shift) => ({
      id: shift.id,
      user_id: shift.user_id,
      userId: shift.user_id,
      shift_date: shift.shift_date,
      date: shift.shift_date,
      status: shift.status || 'planned',
      first_name: shift.first_name || '',
      last_name: shift.last_name || '',
      role_code: shift.role_code || null,
      start_time: shift.start_time || '07:00:00',
      end_time: shift.end_time || '19:00:00',
      shiftStart: shift.start_time || '07:00:00',
      shiftEnd: shift.end_time || '19:00:00',
      duration_hours: Number(shift.duration_hours) || null,
      is_overnight: Boolean(shift.is_overnight),
    }));
  }

  // Un registre explicitement vide signifie « aucune affectation » : seuls les
  // plannings antérieurs au registre retombent sur la table `shifts`, et le
  // retour anticipé ci-dessus les a déjà traités. La variable à interroger est
  // `schedule` : lire `row` ici levait un ReferenceError à chaque appel, donc à
  // chaque envoi de tableur.
  const hasSpreadsheetRows = Array.isArray(schedule.metadata?.spreadsheet?.rows);
  const spreadsheetEntries = hasSpreadsheetRows
    ? dutyEntries(schedule, schedule.start_date, schedule.end_date)
    : [];
  const legacyEntries = hasSpreadsheetRows
    ? []
    : (await readSpreadsheetShifts(scheduleId)).map((shift) => ({
      userId: shift.user_id,
      date: dateKey(shift.shift_date),
      shiftStart: shift.start_time || shift.shiftStart || '07:00:00',
      shiftEnd: shift.end_time || shift.shiftEnd || '19:00:00',
      firstName: shift.first_name || '',
      lastName: shift.last_name || '',
    }));
  const entries = [...spreadsheetEntries, ...legacyEntries];
  const userIds = [...new Set(entries.map((entry) => entry.userId).filter(Boolean))];
  const usersResult = userIds.length
    ? await query(
      `SELECT u.id, u.first_name, u.last_name, r.code AS role_code
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = ANY($1)`, [userIds]
    )
    : { rows: [] };
  const users = new Map(usersResult.rows.map((user) => [user.id, user]));
  return entries.map((entry, index) => {
    const user = users.get(entry.userId) || {};
    const startTime = entry.shiftStart || '07:00:00';
    const endTime = entry.shiftEnd || '19:00:00';
    const [startHour, startMinute] = String(startTime).split(':').map(Number);
    const [endHour, endMinute] = String(endTime).split(':').map(Number);
    const startMinutes = startHour * 60 + (startMinute || 0);
    const endMinutes = endHour * 60 + (endMinute || 0);
    const duration = Number.isFinite(startHour) && Number.isFinite(endHour)
      ? (endMinutes <= startMinutes ? endMinutes + 24 * 60 - startMinutes : endMinutes - startMinutes) / 60
      : 12;
    return {
      id: `spreadsheet-${schedule.id}-${entry.userId}-${entry.date}-${index}`,
      user_id: entry.userId,
      userId: entry.userId,
      shift_date: entry.date,
      date: entry.date,
      status: 'planned',
      first_name: entry.firstName || user.first_name || '',
      last_name: entry.lastName || user.last_name || '',
      role_code: user.role_code || null,
      start_time: startTime,
      end_time: endTime,
      shiftStart: startTime,
      shiftEnd: endTime,
      duration_hours: duration,
      // 07:00 -> 07:00 is the tableur convention for a full-day/overnight guard.
      is_overnight: endMinutes <= startMinutes,
      // Ligne d'origine et mode de lecture, repris tels quels de
      // `rosterOnDate` : la règle de repos s'en sert pour ne pas découper une
      // période de service continue en autant de gardes distinctes.
      rowKey: entry.rowKey || null,
      continuous: entry.continuous === true,
    };
  });
};

// ── Règles système par défaut (injectées à la création d'un établissement) ──
const DEFAULT_RULES = [
  {
    rule_code: 'REST_MIN_11H',
    rule_name: 'Repos minimum légal (11h entre 2 gardes)',
    rule_type: 'rest',
    severity: 'error',
    is_system: true,
    config: { min_hours: 11, applies_to_all_roles: true },
  },
  {
    rule_code: 'NO_DOUBLE_SAME_DAY',
    rule_name: 'Pas de double affectation le même jour',
    rule_type: 'constraint',
    severity: 'error',
    is_system: true,
    config: { check_same_day: true },
  },
  {
    rule_code: 'NO_GUARD_DURING_ABSENCE',
    rule_name: 'Pas de garde pendant une absence déclarée',
    rule_type: 'constraint',
    severity: 'error',
    is_system: true,
    config: { check_approved_absences: true, check_pending: false },
  },
  {
    rule_code: 'BALANCE_MAX_VARIANCE_20PCT',
    rule_name: 'Équilibre des gardes (variance max 20%)',
    rule_type: 'balance',
    severity: 'warning',
    is_system: false,
    config: { max_variance_pct: 20 },
  },
  {
    rule_code: 'MAX_SHIFTS_RESIDENT_10',
    rule_name: 'Maximum 10 gardes/mois pour les résidents',
    rule_type: 'frequency',
    severity: 'warning',
    is_system: false,
    config: {
      per_role: { resident: 10, senior_doctor: 8, department_head: 6 },
      period: 'monthly',
    },
  },
];

// ── Colonnes système par défaut ────────────────────────────────
const DEFAULT_COLUMNS = [
  { code: 'first_name',  label: 'Prénom',      data_type: 'text',   is_system: true,  display_order: 1 },
  { code: 'last_name',   label: 'Nom',         data_type: 'text',   is_system: true,  display_order: 2 },
  { code: 'matricule',   label: 'Matricule',   data_type: 'text',   is_system: true,  display_order: 3 },
  { code: 'role',        label: 'Fonction',    data_type: 'select', is_system: true,  display_order: 4,
    validation_rules: { options: ['Résident', 'Médecin senior', 'Chef de service', 'Superviseur'] } },
  { code: 'grade',       label: 'Grade',       data_type: 'text',   is_system: false, display_order: 5 },
  { code: 'speciality',  label: 'Spécialité',  data_type: 'text',   is_system: false, display_order: 6 },
  { code: 'phone',       label: 'Téléphone',   data_type: 'phone',  is_system: false, display_order: 7,
    validation_rules: { pattern: '^[+0-9\\s()-]{8,20}$' } },
  { code: 'department',  label: 'Service',     data_type: 'text',   is_system: false, display_order: 8 },
  { code: 'notes',       label: 'Observations',data_type: 'text',   is_system: false, display_order: 9 },
  { code: 'replacement', label: 'Remplaçant',  data_type: 'person', is_system: false, display_order: 10 },
];

// ── Type détection patterns ────────────────────────────────────
const COLUMN_TYPE_PATTERNS = [
  { pattern: /^(tel|phone|tél|telephone|mobile|portable|gsm)/i,     type: 'phone',    confidence: 0.95 },
  { pattern: /^(nom|last.?name|family.?name)/i,                      type: 'person',   confidence: 0.85 },
  { pattern: /^(prenom|first.?name|prénom)/i,                        type: 'person',   confidence: 0.85 },
  { pattern: /^(horaire|heure|time|schedule|garde)/i,               type: 'time',     confidence: 0.90 },
  { pattern: /^(période|periode).*(début|debut|fin)|^(début|debut|fin).*(période|periode)/i, type: 'date', confidence: 0.95 },
  { pattern: /^(durée|duree).*(début|debut|fin)|^(début|debut|fin).*(durée|duree)/i, type: 'time', confidence: 0.95 },
  { pattern: /^(date|jour|day)/i,                                    type: 'date',     confidence: 0.90 },
  { pattern: /^(obs|comment|note|remarque)/i,                        type: 'text',     confidence: 0.80 },
  { pattern: /^(remplaç|remplacement|replacement)/i,                 type: 'person',   confidence: 0.90 },
  { pattern: /^(service|department|dept|unit)/i,                     type: 'select',   confidence: 0.80 },
  { pattern: /^(grade|rank|niveau)/i,                                type: 'select',   confidence: 0.75 },
  { pattern: /^(matricule|id|identif|numéro)/i,                      type: 'text',     confidence: 0.85 },
  { pattern: /^(specialit|spécialit|specialty)/i,                    type: 'text',     confidence: 0.85 },
  { pattern: /^(salaire|salary|wage|pay)/i,                          type: 'number',   confidence: 0.90 },
  { pattern: /^(type|catégorie|category|classe)/i,                   type: 'select',   confidence: 0.75 },
  { pattern: /^(oui|non|yes|no|actif|active|validé)/i,              type: 'boolean',  confidence: 0.85 },
];

// ============================================================
// INITIALISATION PAR DÉFAUT
// ============================================================

/**
 * Initialise les règles et colonnes par défaut pour un nouvel établissement.
 * Appelé lors de la création d'un établissement.
 */
const initEstablishmentDefaults = async (establishmentId, createdBy = null) => {
  // 1. Colonnes système
  for (const col of DEFAULT_COLUMNS) {
    await query(
      `INSERT INTO schedule_column_models
         (establishment_id, code, label, data_type, validation_rules, is_system, is_default, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (establishment_id, code) DO NOTHING`,
      [
        establishmentId, col.code, col.label, col.data_type,
        JSON.stringify(col.validation_rules || {}),
        col.is_system, true, col.display_order,
      ]
    );
  }

  // 2. Règles système
  for (const rule of DEFAULT_RULES) {
    await query(
      `INSERT INTO establishment_rules
         (establishment_id, rule_code, rule_name, rule_type, config, severity, is_system, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (establishment_id, rule_code) DO NOTHING`,
      [
        establishmentId, rule.rule_code, rule.rule_name, rule.rule_type,
        JSON.stringify(rule.config), rule.severity, rule.is_system, createdBy,
      ]
    );
  }
};

// ============================================================
// DÉTECTION DE TYPE DE COLONNE
// ============================================================

/**
 * Détecte automatiquement le type d'une colonne à partir de son label.
 * Retourne { type, confidence, suggestion }
 */
const detectColumnType = async (rawLabel, establishmentId) => {
  const normalized = rawLabel.trim().toLowerCase().replace(/\s+/g, '_');

  // 1. Correspondance exacte avec colonnes existantes
  const existing = await query(
    `SELECT id, code, label, data_type FROM schedule_column_models
     WHERE establishment_id = $1 AND (
       LOWER(label) = LOWER($2) OR code = $3
     ) AND is_active = TRUE LIMIT 1`,
    [establishmentId, rawLabel.trim(), normalized]
  );

  if (existing.rows[0]) {
    return {
      type: existing.rows[0].data_type,
      confidence: 1.0,
      mappedToId: existing.rows[0].id,
      suggestion: `Correspondance exacte avec la colonne "${existing.rows[0].label}"`,
    };
  }

  // 2. Correspondance via learned_columns
  const learned = await query(
    `SELECT mapped_to, detected_type, confidence, times_used FROM learned_columns
     WHERE establishment_id = $1 AND was_confirmed = TRUE
       AND (LOWER(raw_label) = LOWER($2) OR LOWER(normalized_label) = LOWER($2))
     ORDER BY times_used DESC, confidence DESC LIMIT 1`,
    [establishmentId, rawLabel.trim()]
  );

  if (learned.rows[0]) {
    return {
      type: learned.rows[0].detected_type,
      confidence: parseFloat(learned.rows[0].confidence),
      mappedToId: learned.rows[0].mapped_to,
      suggestion: `Reconnu depuis l'historique (utilisé ${learned.rows[0].times_used} fois)`,
    };
  }

  // 3. Détection par pattern
  for (const { pattern, type, confidence } of COLUMN_TYPE_PATTERNS) {
    if (pattern.test(rawLabel.trim())) {
      return { type, confidence, mappedToId: null, suggestion: `Détecté automatiquement comme "${type}"` };
    }
  }

  // 4. Type par défaut
  return { type: 'text', confidence: 0.3, mappedToId: null, suggestion: 'Type texte par défaut (non reconnu)' };
};

/**
 * Enregistre une colonne apprise (confirmée ou rejetée par l'utilisateur).
 */
const saveLearnedColumn = async (establishmentId, rawLabel, detection, wasConfirmed) => {
  const normalized = rawLabel.trim().toLowerCase().replace(/\s+/g, '_');

  await query(
    `INSERT INTO learned_columns
       (establishment_id, raw_label, normalized_label, detected_type, mapped_to, confidence, was_confirmed, was_rejected)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [
      establishmentId, rawLabel.trim(), normalized,
      detection.type, detection.mappedToId || null,
      detection.confidence, wasConfirmed, !wasConfirmed,
    ]
  );
};

// ============================================================
// MOTEUR D'ÉVALUATION DES RÈGLES
// ============================================================

/**
 * Évalue toutes les règles actives d'un établissement sur un planning.
 * Retourne { errors, warnings, info, isValid }
 */
const evaluateRules = async (scheduleId, establishmentId) => {
  const violations = { errors: [], warnings: [], info: [] };

  // Charger les règles actives
  const rulesResult = await query(
    `SELECT * FROM establishment_rules
     WHERE establishment_id = $1 AND is_active = TRUE
     ORDER BY priority DESC, is_system DESC`,
    [establishmentId]
  );

  // Le registre est la source de vérité : la table `shifts` ne contient plus
  // les affectations saisies dans le tableur.
  const shifts = await readSpreadsheetShifts(scheduleId);

  for (const rule of rulesResult.rows) {
    const results = await evaluateRule(rule, shifts, scheduleId, establishmentId);
    if (results.length > 0) {
      violations[rule.severity === 'error' ? 'errors'
        : rule.severity === 'warning' ? 'warnings' : 'info'].push(...results);
    }
  }

  // Sauvegarder l'évaluation
  const allViolations = [...violations.errors, ...violations.warnings, ...violations.info];
  if (allViolations.length > 0) {
    await query(
      `INSERT INTO rule_evaluations (schedule_id, rule_code, severity, violations)
       VALUES ($1, 'GLOBAL_EVALUATION', $2, $3)`,
      [
        scheduleId,
        violations.errors.length > 0 ? 'error' : violations.warnings.length > 0 ? 'warning' : 'info',
        JSON.stringify(allViolations),
      ]
    );
  }

  return {
    errors:   violations.errors,
    warnings: violations.warnings,
    info:     violations.info,
    isValid:  violations.errors.length === 0,
    summary: {
      errorCount:   violations.errors.length,
      warningCount: violations.warnings.length,
      infoCount:    violations.info.length,
    },
  };
};

/**
 * Deux affectations appartiennent-elles au même bloc de service continu ?
 *
 * Vrai lorsqu'elles viennent de la même ligne de tableur, que cette ligne est
 * lue par sa **période** (`continuous`, cf. l'arbitrage de `spreadsheet-reader`)
 * et qu'elles portent sur deux jours qui se suivent. Dans ce cas la « fin » de
 * la première et le « début » de la seconde sont un découpage d'affichage, pas
 * deux prises de garde : il n'y a pas de repos à mesurer entre elles.
 */
const isSameContinuousBlock = (prev, curr) => {
  if (!prev?.continuous || !curr?.continuous) return false;
  if (!prev.rowKey || prev.rowKey !== curr.rowKey) return false;
  const veille = new Date(`${curr.shift_date}T12:00:00`);
  veille.setDate(veille.getDate() - 1);
  const attendu = `${veille.getFullYear()}-${String(veille.getMonth() + 1).padStart(2, '0')}-${String(veille.getDate()).padStart(2, '0')}`;
  return prev.shift_date === attendu;
};

/**
 * Évalue une règle spécifique sur un ensemble de gardes.
 */
const evaluateRule = async (rule, shifts, scheduleId, establishmentId) => {
  const violations = [];
  const config = rule.config;

  switch (rule.rule_type) {

    // ── 1. RÈGLE DE REPOS MINIMUM ────────────────────────────
    case 'rest': {
      const minHours = config.min_hours || 11;
      const byUser = groupBy(shifts, 'user_id');

      for (const [userId, userShifts] of Object.entries(byUser)) {
        const sorted = userShifts.sort((a, b) => new Date(a.shift_date) - new Date(b.shift_date));
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          // Deux jours consécutifs d'une même ligne lue par sa période ne sont
          // pas deux gardes : c'est une seule affectation continue (« de
          // service du 14 au 20 »). Mesurer un repos entre eux donnerait
          // toujours 0 h et rendrait tout planning de période insoumissible.
          // Les jours cochés, eux, restent des gardes distinctes : la règle
          // garde ses dents là où le chef a désigné des journées précises.
          if (isSameContinuousBlock(prev, curr)) continue;
          const prevEnd = new Date(`${prev.shift_date}T${prev.end_time}`);
          if (prev.is_overnight) prevEnd.setDate(prevEnd.getDate() + 1);
          const currStart = new Date(`${curr.shift_date}T${curr.start_time}`);
          const diffHours = (currStart - prevEnd) / 3600000;

          if (diffHours >= 0 && diffHours < minHours) {
            violations.push({
              rule_code: rule.rule_code,
              type: 'REST_INSUFFICIENT',
              message: `${curr.first_name} ${curr.last_name} : repos de ${diffHours.toFixed(1)}h entre ${prev.shift_date} et ${curr.shift_date} (min ${minHours}h)`,
              userId, dates: [prev.shift_date, curr.shift_date],
              shiftIds: [prev.id, curr.id],
            });
          }
        }
      }
      break;
    }

    // ── 2. DOUBLE AFFECTATION ────────────────────────────────
    case 'constraint': {
      if (config.check_same_day) {
        const byUserDate = {};
        for (const s of shifts) {
          const key = `${s.user_id}|${s.shift_date}`;
          byUserDate[key] = (byUserDate[key] || []);
          byUserDate[key].push(s);
        }
        for (const [key, dayShifts] of Object.entries(byUserDate)) {
          if (dayShifts.length > 1) {
            violations.push({
              rule_code: rule.rule_code,
              type: 'DOUBLE_ASSIGNMENT',
              message: `${dayShifts[0].first_name} ${dayShifts[0].last_name} : ${dayShifts.length} gardes le ${dayShifts[0].shift_date}`,
              userId: dayShifts[0].user_id,
              dates: [dayShifts[0].shift_date],
              shiftIds: dayShifts.map(s => s.id),
            });
          }
        }
      }

      // Garde pendant absence
      if (config.check_approved_absences) {
        const userIds = [...new Set(shifts.map(s => s.user_id))];
        if (userIds.length > 0) {
          const absResult = await query(
            `SELECT a.user_id,
                    TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
                    TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
                    u.first_name, u.last_name
             FROM absences a JOIN users u ON a.user_id = u.id
             WHERE a.user_id = ANY($1)
               AND a.status = 'approved'
               AND a.establishment_id = $2`,
            [userIds, establishmentId]
          );

          for (const abs of absResult.rows) {
            const conflicting = shifts.filter(s =>
              s.user_id === abs.user_id &&
              String(s.shift_date).slice(0, 10) >= abs.start_date &&
              String(s.shift_date).slice(0, 10) <= abs.end_date
            );
            if (conflicting.length > 0) {
              violations.push({
                rule_code: rule.rule_code,
                type: 'GUARD_DURING_ABSENCE',
                message: `${abs.first_name} ${abs.last_name} : garde planifiée pendant une absence approuvée (${abs.start_date} → ${abs.end_date})`,
                userId: abs.user_id,
                dates: conflicting.map(s => s.shift_date),
                shiftIds: conflicting.map(s => s.id),
              });
            }
          }
        }
      }
      break;
    }

    // ── 3. FRÉQUENCE MAXIMUM ─────────────────────────────────
    case 'frequency': {
      const perRole = config.per_role || {};
      const globalMax = config.max_shifts || null;
      const byUser = groupBy(shifts, 'user_id');

      for (const [userId, userShifts] of Object.entries(byUser)) {
        const roleCode = userShifts[0]?.role_code;
        const limit = perRole[roleCode] || globalMax;
        if (limit && userShifts.length > limit) {
          violations.push({
            rule_code: rule.rule_code,
            type: 'MAX_SHIFTS_EXCEEDED',
            message: `${userShifts[0].first_name} ${userShifts[0].last_name} : ${userShifts.length} gardes (max autorisé : ${limit} pour ${roleCode})`,
            userId, count: userShifts.length, limit,
          });
        }
      }
      break;
    }

    // ── 4. ÉQUILIBRE DES GARDES ──────────────────────────────
    case 'balance': {
      const maxVariancePct = config.max_variance_pct || 20;
      const byUser = groupBy(shifts, 'user_id');
      const counts = Object.values(byUser).map(s => s.length);
      if (counts.length < 2) break;

      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const maxAllowed = avg * (1 + maxVariancePct / 100);
      const minAllowed = avg * (1 - maxVariancePct / 100);

      for (const [userId, userShifts] of Object.entries(byUser)) {
        const count = userShifts.length;
        if (count > maxAllowed || count < minAllowed) {
          violations.push({
            rule_code: rule.rule_code,
            type: 'IMBALANCED_SCHEDULE',
            message: `${userShifts[0].first_name} ${userShifts[0].last_name} : ${count} gardes (moyenne ${avg.toFixed(1)}, écart > ${maxVariancePct}%)`,
            userId, count, average: avg,
          });
        }
      }
      break;
    }

    default:
      break;
  }

  return violations;
};

// ============================================================
// GÉNÉRATION DE PLANNING
// ============================================================

/**
 * Algorithme Round-Robin équitable.
 * Distribue les gardes de manière cyclique en tenant compte
 * du nombre de gardes déjà effectuées sur la période.
 */
const generateRoundRobin = (staff, dates, shiftTypeId, existingShiftCounts = {}) => {
  const generated = [];

  // Trier le staff par nombre de gardes existantes (ascending)
  const sortedStaff = [...staff].sort((a, b) =>
    (existingShiftCounts[a.id] || 0) - (existingShiftCounts[b.id] || 0)
  );

  let staffIndex = 0;
  for (const date of dates) {
    const member = sortedStaff[staffIndex % sortedStaff.length];
    generated.push({
      user_id:       member.id,
      shift_date:    date,
      shift_type_id: shiftTypeId,
    });
    staffIndex++;
  }

  return generated;
};

/**
 * Algorithme de rotation A/B.
 * Les équipes A et B alternent chaque semaine.
 */
const generateABRotation = (teamA, teamB, dates, shiftTypeId) => {
  const generated = [];

  for (const date of dates) {
    const d = new Date(date);
    const weekNum = Math.floor(d.getTime() / (7 * 24 * 3600000));
    const isWeekA = weekNum % 2 === 0;
    const team = isWeekA ? teamA : teamB;

    for (const member of team) {
      generated.push({
        user_id:       member.id,
        shift_date:    date,
        shift_type_id: shiftTypeId,
        cycle_label:   isWeekA ? 'A' : 'B',
      });
    }
  }

  return generated;
};

/**
 * Algorithme cyclique configurable.
 * Chaque membre du staff suit un pattern fixe de rotation.
 */
const generateCyclic = (staff, dates, shiftTypeId, cycleLength = null) => {
  const generated = [];
  const cycle = cycleLength || staff.length;

  for (let i = 0; i < dates.length; i++) {
    const membersForDay = staff.filter((_, idx) => idx === i % cycle);
    for (const member of membersForDay) {
      generated.push({
        user_id:       member.id,
        shift_date:    dates[i],
        shift_type_id: shiftTypeId,
      });
    }
  }

  return generated;
};

// ============================================================
// NORMALISATION NATIONALE
// ============================================================

/**
 * Génère un snapshot normalisé d'un planning pour le Super Admin.
 * Traduit les données locales en modèle national commun.
 */
const generateNationalSnapshot = async (scheduleId) => {
  const result = await query(
    `SELECT
       sch.*,
       d.name AS dept_name, d.code AS dept_code, d.department_type,
       e.name AS est_name, e.code AS est_code, e.governorate,
       TO_CHAR(sch.start_date, 'YYYY-MM-DD') AS start_date_key,
       TO_CHAR(sch.end_date,   'YYYY-MM-DD') AS end_date_key
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN establishments e ON sch.establishment_id = e.id
     WHERE sch.id = $1
    `,
    [scheduleId]
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];

  // Le tableur est la source de vérité depuis le registre : `shifts` n'est plus
  // alimentée par cette voie. Utiliser le lecteur partagé garantit que les
  // périodes multiples, les cases des plannings spéciaux et les lignes
  // proposées non validées sont interprétées comme dans le reste de la plateforme.
  const schedule = {
    ...row,
    start_date: row.start_date_key || dateKey(row.start_date),
    end_date: row.end_date_key || dateKey(row.end_date),
  };
  const entries = dutyEntries(schedule, schedule.start_date, schedule.end_date);
  const userIds = [...new Set(entries.map((entry) => entry.userId).filter(Boolean))];
  const usersResult = userIds.length
    ? await query(
      `SELECT u.id, u.first_name, u.last_name, r.code AS role_code
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = ANY($1)`,
      [userIds]
    )
    : { rows: [] };
  const usersById = new Map(usersResult.rows.map((user) => [user.id, user]));

  const durationHours = (entry) => {
    const start = String(entry.shiftStart || '').split(':').map(Number);
    const end = String(entry.shiftEnd || '').split(':').map(Number);
    if (!Number.isFinite(start[0]) || !Number.isFinite(end[0])) return 12;
    const startMinutes = start[0] * 60 + (start[1] || 0);
    const endMinutes = end[0] * 60 + (end[1] || 0);
    const minutes = endMinutes <= startMinutes
      ? (24 * 60 - startMinutes) + endMinutes
      : endMinutes - startMinutes;
    return minutes > 0 ? minutes / 60 : 12;
  };

  const staffById = new Map();
  entries.forEach((entry) => {
    if (!entry.userId) return;
    const user = usersById.get(entry.userId) || {};
    const current = staffById.get(entry.userId) || {
      id: entry.userId,
      role_code: user.role_code || null,
      shifts: 0,
      hours: 0,
    };
    current.shifts += 1;
    current.hours += durationHours(entry);
    staffById.set(entry.userId, current);
  });

  const replacementResult = await query(
    `SELECT COUNT(*) AS count
       FROM replacements
      WHERE schedule_id = $1
        AND COALESCE(confirmation_status, 'confirmed') = 'confirmed'
        AND status NOT IN ('cancelled', 'rejected')`,
    [scheduleId]
  );

  const totalShifts = entries.length;
  const totalHours = entries.reduce((total, entry) => total + durationHours(entry), 0);
  const staffCount = staffById.size;
  const periodDays = datesBetween(schedule.start_date, schedule.end_date).length;
  // Le registre ne porte pas d'état d'exécution par garde. Les anciennes lignes
  // `completed` n'étant plus disponibles dans cette source, le snapshot expose
  // zéro garde terminée plutôt qu'un agrégat inventé.
  const completedShifts = 0;
  const replacementsCount = parseInt(replacementResult.rows[0]?.count, 10) || 0;

  const snapshot = {
    version: 1,
    generated_at: new Date().toISOString(),
    period: {
      from:  schedule.start_date,
      to:    schedule.end_date,
      type:  row.period_type,
      days:  periodDays,
    },
    establishment: {
      id:          row.establishment_id,
      code:        row.est_code,
      name:        row.est_name,
      governorate: row.governorate,
    },
    department: {
      id:   row.department_id,
      code: row.dept_code,
      name: row.dept_name,
      type: row.department_type,
    },
    kpis: {
      total_shifts:       totalShifts,
      total_hours:        totalHours,
      staff_count:        staffCount,
      coverage_rate:      totalShifts > 0 ? completedShifts / totalShifts : 0,
      replacement_rate:   totalShifts > 0 ? replacementsCount / totalShifts : 0,
      avg_shifts_per_person: staffCount > 0 ? totalShifts / staffCount : 0,
      avg_hours_per_person:  staffCount > 0 ? totalHours / staffCount : 0,
    },
    staff_summary: [...staffById.values()].map((staff) => ({
      user_id: staff.id,
      role: staff.role_code,
      shifts: staff.shifts,
      hours: Number(staff.hours.toFixed(2)),
    })),
  };

  // Sauvegarder le snapshot
  const existing = await query('SELECT version FROM schedule_snapshots WHERE schedule_id=$1 ORDER BY version DESC LIMIT 1', [scheduleId]);
  const version = existing.rows[0] ? existing.rows[0].version + 1 : 1;

  await query(
    'INSERT INTO schedule_snapshots (schedule_id, snapshot, version) VALUES ($1, $2, $3) ON CONFLICT (schedule_id, version) DO UPDATE SET snapshot = $2',
    [scheduleId, JSON.stringify(snapshot), version]
  );

  return snapshot;
};

// ── Utilitaires ────────────────────────────────────────────────
const groupBy = (arr, key) => {
  return arr.reduce((acc, item) => {
    const k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
};

module.exports = {
  // Init
  initEstablishmentDefaults,
  // Colonnes
  detectColumnType,
  saveLearnedColumn,
  DEFAULT_COLUMNS,
  DEFAULT_RULES,
  // Évaluation règles
  evaluateRules,
  evaluateRule,
  // Génération
  generateRoundRobin,
  generateABRotation,
  generateCyclic,
  // Normalisation
  generateNationalSnapshot,
};
