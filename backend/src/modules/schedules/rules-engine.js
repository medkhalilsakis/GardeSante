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

  // Charger les gardes du planning avec contexte
  const shiftsResult = await query(
    `SELECT s.id, s.user_id, s.shift_date, s.status,
            u.first_name, u.last_name,
            r.code AS role_code,
            st.start_time, st.end_time, st.duration_hours, st.is_overnight
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN roles r ON u.role_id = r.id
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.schedule_id = $1 AND s.status != 'cancelled'
     ORDER BY s.user_id, s.shift_date`,
    [scheduleId]
  );

  const shifts = shiftsResult.rows;

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
            `SELECT a.user_id, a.start_date, a.end_date, u.first_name, u.last_name
             FROM absences a JOIN users u ON a.user_id = u.id
             WHERE a.user_id = ANY($1)
               AND a.status = 'approved'
               AND a.establishment_id = $2`,
            [userIds, establishmentId]
          );

          for (const abs of absResult.rows) {
            const absStart = new Date(abs.start_date);
            const absEnd   = new Date(abs.end_date);
            const conflicting = shifts.filter(s =>
              s.user_id === abs.user_id &&
              new Date(s.shift_date) >= absStart &&
              new Date(s.shift_date) <= absEnd
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
       COUNT(DISTINCT s.id) AS total_shifts,
       COUNT(DISTINCT s.user_id) AS staff_count,
       SUM(st.duration_hours) AS total_hours,
       COUNT(DISTINCT s.id) FILTER (WHERE s.status = 'completed') AS completed_shifts,
       COUNT(DISTINCT rep.id) AS replacements_count
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN establishments e ON sch.establishment_id = e.id
     LEFT JOIN shifts s ON s.schedule_id = sch.id AND s.status != 'cancelled'
     LEFT JOIN shift_types st ON s.shift_type_id = st.id
     LEFT JOIN replacements rep ON rep.shift_id = s.id
     WHERE sch.id = $1
     GROUP BY sch.id, d.id, e.id`,
    [scheduleId]
  );

  if (!result.rows[0]) return null;
  const row = result.rows[0];

  // Résumé par personne
  const staffSummary = await query(
    `SELECT u.id, u.first_name, u.last_name,
            r.code AS role_code,
            COUNT(s.id) AS shifts,
            SUM(st.duration_hours) AS hours
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN roles r ON u.role_id = r.id
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.schedule_id = $1 AND s.status != 'cancelled'
     GROUP BY u.id, r.code`,
    [scheduleId]
  );

  const totalShifts  = parseInt(row.total_shifts) || 0;
  const totalHours   = parseFloat(row.total_hours) || 0;
  const staffCount   = parseInt(row.staff_count) || 0;
  const periodDays   = Math.ceil((new Date(row.end_date) - new Date(row.start_date)) / 86400000) + 1;

  const snapshot = {
    version: 1,
    generated_at: new Date().toISOString(),
    period: {
      from:  row.start_date,
      to:    row.end_date,
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
      coverage_rate:      totalShifts > 0 ? parseFloat(row.completed_shifts) / totalShifts : 0,
      replacement_rate:   totalShifts > 0 ? parseInt(row.replacements_count) / totalShifts : 0,
      avg_shifts_per_person: staffCount > 0 ? totalShifts / staffCount : 0,
      avg_hours_per_person:  staffCount > 0 ? totalHours / staffCount : 0,
    },
    staff_summary: staffSummary.rows.map(s => ({
      user_id:   s.id,
      role:      s.role_code,
      shifts:    parseInt(s.shifts),
      hours:     parseFloat(s.hours),
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
