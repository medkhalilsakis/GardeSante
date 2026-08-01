/**
 * ============================================================
 * SCHEDULE TEMPLATES CONTROLLER
 * Gestion des modèles de planning + règles + colonnes
 * ============================================================
 */

const { query } = require('../../config/database');
const { initEstablishmentDefaults, detectColumnType, saveLearnedColumn } = require('../schedules/rules-engine');
const { log, getIp } = require('../history/history.controller');

// ─────────────────────────────────────────────────────────────
// MODÈLES DE COLONNES
// ─────────────────────────────────────────────────────────────

// GET /api/schedule-config/columns
const getColumns = async (req, res) => {
  const estId = req.user.establishmentId;
  const result = await query(
    `SELECT * FROM schedule_column_models
     WHERE establishment_id = $1 AND is_active = TRUE
     ORDER BY display_order, created_at`,
    [estId]
  );
  return res.json({ success: true, data: result.rows });
};

// POST /api/schedule-config/columns
const createColumn = async (req, res) => {
  const estId = req.user.establishmentId;
  const { code, label, labelAr, dataType, validationRules, displayOrder } = req.body;

  if (!code || !label || !dataType) {
    return res.status(400).json({ success: false, message: 'code, label et dataType sont requis' });
  }

  const result = await query(
    `INSERT INTO schedule_column_models
       (establishment_id, code, label, label_ar, data_type, validation_rules, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (establishment_id, code) DO UPDATE
       SET label = $3, label_ar = $4, data_type = $5,
           validation_rules = $6, display_order = $7, is_active = TRUE
     RETURNING *`,
    [estId, code.toLowerCase(), label, labelAr || null, dataType,
     JSON.stringify(validationRules || {}), displayOrder || 99]
  );

  log({ userId: req.user.id, action: 'column_create', category: 'admin', description: `Colonne créée : ${label}`, entityType: 'schedule_column_models', entityId: result.rows[0].id, ipAddress: getIp(req) });
  return res.status(201).json({ success: true, data: result.rows[0], message: 'Colonne créée' });
};

// POST /api/schedule-config/columns/detect
const detectColumn = async (req, res) => {
  const { rawLabel } = req.body;
  const estId = req.user.establishmentId;
  if (!rawLabel) return res.status(400).json({ success: false, message: 'rawLabel requis' });

  const detection = await detectColumnType(rawLabel, estId);
  return res.json({ success: true, data: { rawLabel, ...detection } });
};

// POST /api/schedule-config/columns/confirm-detection
const confirmColumnDetection = async (req, res) => {
  const { rawLabel, detection, wasConfirmed } = req.body;
  const estId = req.user.establishmentId;

  await saveLearnedColumn(estId, rawLabel, detection, wasConfirmed);
  return res.json({ success: true, message: wasConfirmed ? 'Apprentissage enregistré' : 'Rejet enregistré' });
};

// DELETE /api/schedule-config/columns/:id
const deleteColumn = async (req, res) => {
  const estId = req.user.establishmentId;
  const result = await query(
    `UPDATE schedule_column_models SET is_active = FALSE
     WHERE id = $1 AND establishment_id = $2 AND is_system = FALSE RETURNING label`,
    [req.params.id, estId]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Colonne introuvable ou système' });
  return res.json({ success: true, message: `Colonne "${result.rows[0].label}" supprimée` });
};

// ─────────────────────────────────────────────────────────────
// RÈGLES MÉTIER
// ─────────────────────────────────────────────────────────────

// GET /api/schedule-config/rules
const getRules = async (req, res) => {
  const estId = req.user.establishmentId;
  const result = await query(
    `SELECT * FROM establishment_rules
     WHERE establishment_id = $1
     ORDER BY priority DESC, is_system DESC, created_at`,
    [estId]
  );
  return res.json({ success: true, data: result.rows });
};

// POST /api/schedule-config/rules
const createRule = async (req, res) => {
  if (!req.user.permissions?.includes('establishment.manage_rules') && req.user.roleCode !== 'director') {
    return res.status(403).json({ success: false, message: 'Réservé au directeur' });
  }

  const estId = req.user.establishmentId;
  const { ruleCode, ruleName, ruleNameAr, ruleType, config, severity, priority } = req.body;

  if (!ruleCode || !ruleName || !ruleType || !config) {
    return res.status(400).json({ success: false, message: 'ruleCode, ruleName, ruleType et config sont requis' });
  }

  const result = await query(
    `INSERT INTO establishment_rules
       (establishment_id, rule_code, rule_name, rule_name_ar, rule_type, config, severity, priority, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (establishment_id, rule_code) DO UPDATE
       SET rule_name = $3, config = $6, severity = $7, priority = $8, updated_at = NOW()
     RETURNING *`,
    [estId, ruleCode, ruleName, ruleNameAr || null, ruleType,
     JSON.stringify(config), severity || 'warning', priority || 0, req.user.id]
  );

  log({ userId: req.user.id, action: 'rule_create', category: 'admin', description: `Règle créée : ${ruleName}`, entityType: 'establishment_rules', entityId: result.rows[0].id, ipAddress: getIp(req) });
  return res.status(201).json({ success: true, data: result.rows[0], message: 'Règle créée' });
};

// PUT /api/schedule-config/rules/:id/toggle
const toggleRule = async (req, res) => {
  const estId = req.user.establishmentId;
  const result = await query(
    `UPDATE establishment_rules SET is_active = NOT is_active, updated_at = NOW()
     WHERE id = $1 AND establishment_id = $2 AND is_system = FALSE RETURNING rule_name, is_active`,
    [req.params.id, estId]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Règle introuvable ou système' });
  return res.json({ success: true, message: `Règle ${result.rows[0].is_active ? 'activée' : 'désactivée'}`, isActive: result.rows[0].is_active });
};

// DELETE /api/schedule-config/rules/:id
const deleteRule = async (req, res) => {
  const estId = req.user.establishmentId;
  const result = await query(
    `DELETE FROM establishment_rules WHERE id = $1 AND establishment_id = $2 AND is_system = FALSE RETURNING rule_name`,
    [req.params.id, estId]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Règle introuvable ou système' });
  return res.json({ success: true, message: `Règle "${result.rows[0].rule_name}" supprimée` });
};

// ─────────────────────────────────────────────────────────────
// TEMPLATES DE PLANNING
// ─────────────────────────────────────────────────────────────

// GET /api/schedule-config/templates
const getTemplates = async (req, res) => {
  const estId = req.user.establishmentId;
  const { departmentId } = req.query;

  let sql = `SELECT t.*, d.name AS dept_name
             FROM schedule_templates t
             LEFT JOIN departments d ON t.department_id = d.id
             WHERE t.establishment_id = $1 AND t.is_active = TRUE`;
  const params = [estId];

  if (departmentId) {
    params.push(departmentId);
    sql += ` AND (t.department_id = $${params.length} OR t.department_id IS NULL)`;
  }

  sql += ' ORDER BY t.is_default DESC, t.times_used DESC, t.created_at DESC';

  const result = await query(sql, params);
  return res.json({ success: true, data: result.rows });
};

// POST /api/schedule-config/templates
const createTemplate = async (req, res) => {
  const estId = req.user.establishmentId;
  const { name, description, departmentId, periodType, weekMode, generationAlgo, columnIds, shiftTypeIds, config, isDefault } = req.body;

  if (!name || !periodType) {
    return res.status(400).json({ success: false, message: 'name et periodType sont requis' });
  }

  // Si isDefault, retirer le flag des autres templates du service
  if (isDefault && departmentId) {
    await query(
      'UPDATE schedule_templates SET is_default = FALSE WHERE establishment_id = $1 AND department_id = $2',
      [estId, departmentId]
    );
  }

  const result = await query(
    `INSERT INTO schedule_templates
       (establishment_id, department_id, name, description, period_type, week_mode,
        generation_algo, column_ids, shift_type_ids, config, is_default, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [estId, departmentId || null, name, description || null,
     periodType, weekMode || 'standard', generationAlgo || 'round_robin',
     columnIds || [], shiftTypeIds || [],
     JSON.stringify(config || {}), isDefault || false, req.user.id]
  );

  return res.status(201).json({ success: true, data: result.rows[0], message: 'Template créé' });
};

// PUT /api/schedule-config/templates/:id
const updateTemplate = async (req, res) => {
  const estId = req.user.establishmentId;
  const { name, description, periodType, weekMode, generationAlgo, columnIds, shiftTypeIds, config, isDefault } = req.body;

  const result = await query(
    `UPDATE schedule_templates
     SET name = COALESCE($1, name), description = COALESCE($2, description),
         period_type = COALESCE($3, period_type), week_mode = COALESCE($4, week_mode),
         generation_algo = COALESCE($5, generation_algo),
         column_ids = COALESCE($6, column_ids), shift_type_ids = COALESCE($7, shift_type_ids),
         config = COALESCE($8, config), is_default = COALESCE($9, is_default),
         updated_at = NOW()
     WHERE id = $10 AND establishment_id = $11
     RETURNING *`,
    [name, description, periodType, weekMode, generationAlgo,
     columnIds, shiftTypeIds, config ? JSON.stringify(config) : null,
     isDefault, req.params.id, estId]
  );

  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Template introuvable' });
  return res.json({ success: true, data: result.rows[0], message: 'Template mis à jour' });
};

// DELETE /api/schedule-config/templates/:id
const deleteTemplate = async (req, res) => {
  const estId = req.user.establishmentId;
  const result = await query(
    `DELETE FROM schedule_templates WHERE id = $1 AND establishment_id = $2 RETURNING name`,
    [req.params.id, estId]
  );
  if (!result.rows[0]) return res.status(404).json({ success: false, message: 'Template introuvable' });
  return res.json({ success: true, message: `Template "${result.rows[0].name}" supprimé` });
};

// ─────────────────────────────────────────────────────────────
// INITIALISATION ÉTABLISSEMENT
// ─────────────────────────────────────────────────────────────

// POST /api/schedule-config/init
const initEstablishment = async (req, res) => {
  if (!req.user.isSuperAdmin && req.user.roleCode !== 'director') {
    return res.status(403).json({ success: false, message: 'Accès non autorisé' });
  }

  const estId = req.params.establishmentId || req.user.establishmentId;
  await initEstablishmentDefaults(estId, req.user.id);

  return res.json({ success: true, message: 'Règles et colonnes par défaut initialisées' });
};

module.exports = {
  // Colonnes
  getColumns, createColumn, detectColumn, confirmColumnDetection, deleteColumn,
  // Règles
  getRules, createRule, toggleRule, deleteRule,
  // Templates
  getTemplates, createTemplate, updateTemplate, deleteTemplate,
  // Init
  initEstablishment,
};
