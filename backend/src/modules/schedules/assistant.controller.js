/**
 * Assistant Intelligent V2 (Lot 7) — contrôleur.
 *
 * Fichier NEUF. `schedule-builder.controller.js` n'est pas modifié : son
 * `generateProposals` (3 variantes A/B/C) et son `confirmProposal` restent en
 * place et continuent de servir l'assistant actuel. Ce module vit à côté, sur
 * ses propres routes, et apporte ce que le plan identifie comme manquant :
 *
 *   - les congés réellement pris en compte à la génération (règle I) ;
 *   - un ordre de rotation explicite (`schedule_staff_assignments`) ;
 *   - 4 modes de génération au lieu de 3 variantes figées ;
 *   - une validation SERVEUR (congés, doubles affectations, sous-effectif,
 *     surcharge, repos insuffisant) assortie de corrections applicables ;
 *   - des propositions modifiables avant envoi, et un brief réutilisable.
 *
 * Écriture : uniquement `assistant_briefs` (table neuve) et, à la confirmation,
 * `schedules` + `schedule_staff_assignments` — exactement comme le fait déjà le
 * builder. La table `shifts` n'est pas alimentée ici : le tableur vit dans
 * `schedules.metadata.spreadsheet`.
 */

const { query, transaction } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');
const { generateV2, MODES, computeMetrics } = require('./assistant-generator');
const { validateProposal } = require('./assistant-validator');
const { datesBetween, isGuard } = require('./spreadsheet-reader');
const { emitToDepartment } = require('../../realtime/emit');

/** Rôles autorisés à piloter l'assistant : ceux qui construisent un planning. */
const BUILDER_ROLES = new Set(['department_head', 'service_supervisor', 'general_supervisor']);

const canBuild = (user) => user.isSuperAdmin || BUILDER_ROLES.has(user.roleCode);

const denyBuild = (res) =>
  res.status(403).json({
    success: false,
    message: 'Seul un chef de service ou un surveillant peut utiliser l\'assistant',
  });

/** Le service demandé doit appartenir à l'hôpital de l'appelant. */
const assertDepartment = async (departmentId, estId) => {
  const dept = await query(
    'SELECT id, name FROM departments WHERE id = $1 AND establishment_id = $2',
    [departmentId, estId]
  );
  return dept.rows[0] || null;
};

// ──────────────────────────────────────────────────────────────
// GET /api/assistant/context
// Personnel du service + congés de la période + modes disponibles.
// ──────────────────────────────────────────────────────────────
const getContext = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);

    const { departmentId, startDate, endDate } = req.query;
    const estId = req.user.establishmentId;
    if (!departmentId) {
      return res.status(400).json({ success: false, message: 'departmentId requis' });
    }

    const dept = await assertDepartment(departmentId, estId);
    if (!dept) return res.status(404).json({ success: false, message: 'Service introuvable' });

    const staff = await query(
      `SELECT u.id, u.first_name, u.last_name, u.matricule, u.phone, u.avatar_url,
              r.code AS role_code, r.name AS role_name, r.level AS role_level
       FROM users u
       JOIN user_departments ud ON ud.user_id = u.id
       JOIN roles r ON r.id = u.role_id
       WHERE ud.department_id = $1 AND u.establishment_id = $2 AND u.is_active = TRUE
       ORDER BY r.level DESC, u.last_name`,
      [departmentId, estId]
    );

    // Congés de la période : affichés dans l'écran d'équipe pour que le chef voie
    // *avant* de générer qui sera écarté, et pourquoi.
    let leaves = [];
    if (startDate && endDate && staff.rows.length) {
      const leaveRes = await query(
        `SELECT a.user_id,
                TO_CHAR(a.start_date, 'YYYY-MM-DD') AS start_date,
                TO_CHAR(a.end_date,   'YYYY-MM-DD') AS end_date,
                at.name AS type_name, at.color AS type_color
         FROM absences a
         JOIN absence_types at ON at.id = a.absence_type_id
         WHERE a.user_id = ANY($1::uuid[])
           AND a.kind = 'leave'
           AND a.status NOT IN ('cancelled', 'rejected')
           AND a.start_date <= $3::date AND a.end_date >= $2::date
         ORDER BY a.start_date`,
        [staff.rows.map((s) => s.id), startDate, endDate]
      );
      leaves = leaveRes.rows.map((row) => ({
        userId: row.user_id,
        startDate: row.start_date,
        endDate: row.end_date,
        typeName: row.type_name,
        typeColor: row.type_color,
      }));
    }

    const briefs = await query(
      `SELECT id, name, mode, times_used,
              TO_CHAR(last_used_at, 'YYYY-MM-DD') AS last_used_at
       FROM assistant_briefs
       WHERE department_id = $1
       ORDER BY updated_at DESC
       LIMIT 20`,
      [departmentId]
    );

    return res.json({
      success: true,
      data: {
        department: { id: dept.id, name: dept.name },
        staff: staff.rows.map((s) => ({
          id: s.id,
          firstName: s.first_name,
          lastName: s.last_name,
          matricule: s.matricule,
          phone: s.phone,
          avatarUrl: s.avatar_url,
          roleCode: s.role_code,
          roleName: s.role_name,
          roleLevel: s.role_level,
        })),
        leaves,
        briefs: briefs.rows.map((b) => ({
          id: b.id, name: b.name, mode: b.mode,
          timesUsed: b.times_used, lastUsedAt: b.last_used_at,
        })),
        modes: Object.entries(MODES).map(([id, m]) => ({ id, label: m.label })),
        daysCount: startDate && endDate ? datesBetween(startDate, endDate).length : 0,
      },
    });
  } catch (err) {
    console.error('assistant.getContext error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du contexte' });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/assistant/generate
// Génère une proposition selon le mode choisi, puis la valide immédiatement.
// ──────────────────────────────────────────────────────────────
const generate = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);

    const {
      departmentId, startDate, endDate, scheduleId = null,
      mode = 'balanced', selectedStaff = [], serviceRequirements = {},
    } = req.body;

    if (!departmentId || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'departmentId, startDate et endDate sont requis' });
    }
    const dept = await assertDepartment(departmentId, req.user.establishmentId);
    if (!dept) return res.status(404).json({ success: false, message: 'Service introuvable' });

    const generated = await generateV2({
      members: selectedStaff,
      startDate, endDate, scheduleId, mode,
      requirements: serviceRequirements,
    });

    const validation = await validateProposal({
      rows: generated.rows,
      dates: generated.days,
      startDate, endDate,
      requirements: serviceRequirements,
    });

    return res.json({
      success: true,
      data: {
        mode: generated.mode,
        modeLabel: generated.modeLabel,
        rows: generated.rows,
        days: generated.days,
        metrics: generated.metrics,
        notes: generated.notes,
        validation,
      },
    });
  } catch (err) {
    console.error('assistant.generate error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la génération' });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/assistant/validate
// Revalide une grille éditée à la main, avant confirmation.
// ──────────────────────────────────────────────────────────────
const validate = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);

    const { rows = [], startDate, endDate, serviceRequirements = {} } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate et endDate sont requis' });
    }

    const days = datesBetween(startDate, endDate);
    const validation = await validateProposal({
      rows, dates: days, startDate, endDate, requirements: serviceRequirements,
    });

    return res.json({
      success: true,
      data: { validation, metrics: computeMetrics(rows, days, serviceRequirements) },
    });
  } catch (err) {
    console.error('assistant.validate error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la validation' });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/assistant/apply-fixes
// Applique les corrections proposées par le validateur. Purement calculatoire :
// rien n'est écrit en base, la grille corrigée revient au client qui décide.
// ──────────────────────────────────────────────────────────────
const applyFixes = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);

    const { rows = [], fixes = [], startDate, endDate, serviceRequirements = {} } = req.body;
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'startDate et endDate sont requis' });
    }

    const days = datesBetween(startDate, endDate);
    // Copie profonde des cases : on ne mute jamais la charge utile reçue.
    const next = rows.map((r) => ({ ...r, shifts: { ...(r.shifts || {}) } }));
    const byUser = new Map(next.filter((r) => r.userId).map((r) => [r.userId, r]));
    const applied = [];

    const clearCell = (userId, date) => {
      const row = byUser.get(userId);
      if (!row || !row.shifts[date]) return false;
      delete row.shifts[date];
      return true;
    };

    for (const fix of fixes) {
      if (!fix?.action) continue;

      if (fix.action === 'clear_cell') {
        if (clearCell(fix.userId, String(fix.date).slice(0, 10))) {
          applied.push({ ...fix, done: true });
        }
        continue;
      }

      if (fix.action === 'trim_extra' || fix.action === 'trim_week') {
        const row = byUser.get(fix.userId);
        if (!row) continue;
        const dates = Object.keys(row.shifts)
          .filter((d) => isGuard(row.shifts[d]))
          .sort();
        const scoped = fix.action === 'trim_week'
          ? dates.filter((d) => {
            const monday = new Date(`${d}T12:00:00`);
            monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
            const key = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
            return key === fix.week;
          })
          : dates;
        // On retire les dernières gardes de la fenêtre : les plus faciles à
        // redistribuer, et les moins susceptibles d'être déjà annoncées.
        const excess = Math.max(0, scoped.length - (Number(fix.keep) || 0));
        for (const date of scoped.slice(scoped.length - excess)) clearCell(fix.userId, date);
        if (excess) applied.push({ ...fix, done: true, removed: excess });
        continue;
      }

      if (fix.action === 'fill_day' || fix.action === 'fill_day_senior') {
        const date = String(fix.date).slice(0, 10);
        const wanted = Math.max(1, Number(fix.count) || 1);
        const seniorOnly = fix.action === 'fill_day_senior';

        // Rejouer le générateur sur la seule journée manquante réutilise toute la
        // logique de disponibilité (congés, périodes, jours exclus) sans la dupliquer.
        const candidates = next.filter((r) => r.userId && !isGuard(r.shifts[date]));
        const single = await generateV2({
          members: candidates.map((r) => ({
            ...r,
            periodStart: r.periodStart || startDate,
            periodEnd: r.periodEnd || endDate,
          })),
          startDate: date,
          endDate: date,
          mode: 'balanced',
          requirements: {
            minPerDay: wanted,
            seniorCount: seniorOnly ? wanted : 0,
          },
        });

        let filled = 0;
        for (const candidate of single.rows) {
          if (!isGuard(candidate.shifts[date])) continue;
          const row = byUser.get(candidate.userId);
          if (!row || isGuard(row.shifts[date])) continue;
          row.shifts[date] = candidate.shifts[date];
          filled += 1;
          if (filled >= wanted) break;
        }
        if (filled) applied.push({ ...fix, done: true, filled });
        continue;
      }
    }

    const validation = await validateProposal({
      rows: next, dates: days, startDate, endDate, requirements: serviceRequirements,
    });

    return res.json({
      success: true,
      data: {
        rows: next,
        applied,
        skipped: fixes.length - applied.length,
        validation,
        metrics: computeMetrics(next, days, serviceRequirements),
      },
    });
  } catch (err) {
    console.error('assistant.applyFixes error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'application des corrections' });
  }
};

// ──────────────────────────────────────────────────────────────
// POST /api/assistant/confirm
// Crée le planning en BROUILLON depuis la grille validée. Le chef garde la main :
// la soumission reste un geste distinct, via le flux existant.
// ──────────────────────────────────────────────────────────────
const confirm = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);

    const {
      departmentId, name, startDate, endDate, scheduleId = null,
      rows = [], mode = 'balanced', periodType = 'monthly',
      scheduleType = 'normal', serviceRequirements = {},
    } = req.body;

    if (!departmentId || !startDate || !endDate || !rows.length) {
      return res.status(400).json({ success: false, message: 'Données du planning incomplètes' });
    }
    const estId = req.user.establishmentId;
    const dept = await assertDepartment(departmentId, estId);
    if (!dept) return res.status(404).json({ success: false, message: 'Service introuvable' });

    // Dernier rempart : une grille en erreur ne devient jamais un planning.
    const validation = await validateProposal({
      rows,
      dates: datesBetween(startDate, endDate),
      startDate, endDate,
      requirements: serviceRequirements,
    });
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_FAILED',
        message: `${validation.counts.errors} anomalie(s) bloquante(s) empêchent la création du planning.`,
        data: { validation },
      });
    }

    const roster = rows.filter((r) => r.userId);
    const schedName = name?.trim() || `Planning assisté (${startDate} → ${endDate})`;

    // Un brouillon a déjà été créé à l'étape « informations » du tableau de bord.
    // On le remplit plutôt que d'en créer un second, qui resterait vide à côté.
    // Le remplissage n'est autorisé que sur un brouillon du même service : un
    // planning soumis ou validé n'est jamais réécrit par l'assistant.
    let target = null;
    if (scheduleId) {
      const existing = await query(
        `SELECT id, status FROM schedules
         WHERE id = $1 AND department_id = $2 AND establishment_id = $3`,
        [scheduleId, departmentId, estId]
      );
      if (existing.rows[0]?.status === 'draft') target = existing.rows[0].id;
    }

    const finalId = await transaction(async (client) => {
      if (target) {
        await client.query(
          `UPDATE schedules
              SET name = $2,
                  start_date = $3::date,
                  end_date = $4::date,
                  schedule_type = $5,
                  creation_mode = 'assistant',
                  period_type = $6,
                  metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            target, schedName, startDate, endDate, scheduleType, periodType,
            JSON.stringify({
              spreadsheet: { rows, customCols: [], savedAt: new Date().toISOString() },
              schedule_kind: scheduleType === 'special_weekend_holiday' ? 'weekend_holiday' : 'normal',
              special_days_only: scheduleType === 'special_weekend_holiday',
              assistant: { version: 2, mode, requirements: serviceRequirements },
            }),
          ]
        );
        // L'ordre de relais est réécrit intégralement : c'est celui du dernier
        // passage de l'assistant qui fait foi.
        await client.query('DELETE FROM schedule_staff_assignments WHERE schedule_id = $1', [target]);
        for (const [position, row] of roster.entries()) {
          await client.query(
            `INSERT INTO schedule_staff_assignments (schedule_id, user_id, period_start, period_end, position)
             VALUES ($1, $2, $3::date, $4::date, $5)`,
            [target, row.userId, row.periodStart || startDate, row.periodEnd || endDate, position]
          );
        }
        return target;
      }

      const inserted = await client.query(
        `INSERT INTO schedules
           (establishment_id, department_id, name, start_date, end_date, schedule_type,
            status, creation_mode, period_type, created_by, metadata)
         VALUES ($1, $2, $3, $4::date, $5::date, $6, 'draft', 'assistant', $7, $8, $9::jsonb)
         RETURNING id`,
        [
          estId, departmentId, schedName, startDate, endDate, scheduleType,
          periodType, req.user.id,
          JSON.stringify({
            spreadsheet: { rows, customCols: [], savedAt: new Date().toISOString() },
            schedule_kind: scheduleType === 'special_weekend_holiday' ? 'weekend_holiday' : 'normal',
            special_days_only: scheduleType === 'special_weekend_holiday',
            assistant: { version: 2, mode, requirements: serviceRequirements },
          }),
        ]
      );
      const id = inserted.rows[0].id;

      // L'ordre de relais est persisté : c'est lui que relira le mode « périodes »
      // à la prochaine génération sur ce planning.
      for (const [position, row] of roster.entries()) {
        await client.query(
          `INSERT INTO schedule_staff_assignments (schedule_id, user_id, period_start, period_end, position)
           VALUES ($1, $2, $3::date, $4::date, $5)`,
          [id, row.userId, row.periodStart || startDate, row.periodEnd || endDate, position]
        );
      }
      return id;
    });

    log({
      userId: req.user.id,
      action: 'schedule_assistant_v2_generate',
      category: 'schedule',
      description: `Planning « ${schedName} » ${target ? 'rempli' : 'créé'} par l'Assistant V2 (mode ${MODES[mode]?.label || mode}, ${validation.counts.guards} gardes)`,
      entityType: 'schedules',
      entityId: finalId,
      ipAddress: getIp(req),
    });

    emitToDepartment(req.app, departmentId, 'schedule:created', {
      scheduleId: finalId, name: schedName, departmentId,
    });

    return res.json({
      success: true,
      data: { scheduleId: finalId, name: schedName, validation },
      message: `Planning « ${schedName} » ${target ? 'mis à jour' : 'créé'} en brouillon.`,
    });
  } catch (err) {
    console.error('assistant.confirm error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la création du planning' });
  }
};

// ──────────────────────────────────────────────────────────────
// Briefs réutilisables
// ──────────────────────────────────────────────────────────────
const listBriefs = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);
    const { departmentId } = req.query;
    if (!departmentId) return res.status(400).json({ success: false, message: 'departmentId requis' });

    const dept = await assertDepartment(departmentId, req.user.establishmentId);
    if (!dept) return res.status(404).json({ success: false, message: 'Service introuvable' });

    const result = await query(
      `SELECT b.id, b.name, b.mode, b.brief, b.times_used,
              TO_CHAR(b.last_used_at, 'YYYY-MM-DD') AS last_used_at,
              TRIM(u.first_name || ' ' || u.last_name) AS author_name
       FROM assistant_briefs b
       JOIN users u ON u.id = b.created_by
       WHERE b.department_id = $1
       ORDER BY b.updated_at DESC`,
      [departmentId]
    );

    return res.json({
      success: true,
      data: {
        briefs: result.rows.map((b) => ({
          id: b.id, name: b.name, mode: b.mode, brief: b.brief || {},
          timesUsed: b.times_used, lastUsedAt: b.last_used_at, authorName: b.author_name,
        })),
      },
    });
  } catch (err) {
    console.error('assistant.listBriefs error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement des briefs' });
  }
};

const saveBrief = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);
    const { departmentId, name, mode = 'balanced', brief = {} } = req.body;

    if (!departmentId || !name?.trim()) {
      return res.status(400).json({ success: false, message: 'departmentId et name sont requis' });
    }
    if (!MODES[mode]) {
      return res.status(400).json({ success: false, message: 'Mode de génération inconnu' });
    }
    const dept = await assertDepartment(departmentId, req.user.establishmentId);
    if (!dept) return res.status(404).json({ success: false, message: 'Service introuvable' });

    // Réenregistrer sous le même nom met à jour : le chef affine son brief au fil
    // des mois plutôt que d'accumuler des doublons.
    const result = await query(
      `INSERT INTO assistant_briefs (establishment_id, department_id, name, mode, brief, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (department_id, name) DO UPDATE
         SET mode = EXCLUDED.mode, brief = EXCLUDED.brief, updated_at = NOW()
       RETURNING id, name, mode`,
      [req.user.establishmentId, departmentId, name.trim(), mode, JSON.stringify(brief), req.user.id]
    );

    return res.json({
      success: true,
      data: { brief: result.rows[0] },
      message: `Brief « ${result.rows[0].name} » enregistré.`,
    });
  } catch (err) {
    console.error('assistant.saveBrief error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de l\'enregistrement du brief' });
  }
};

const useBrief = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);
    const { id } = req.params;

    const result = await query(
      `SELECT id, department_id, establishment_id, name, mode, brief
       FROM assistant_briefs WHERE id = $1`,
      [id]
    );
    const brief = result.rows[0];
    if (!brief) return res.status(404).json({ success: false, message: 'Brief introuvable' });
    if (brief.establishment_id !== req.user.establishmentId) {
      return res.status(403).json({ success: false, message: 'Ce brief appartient à un autre hôpital' });
    }

    await query(
      'UPDATE assistant_briefs SET times_used = times_used + 1, last_used_at = NOW() WHERE id = $1',
      [id]
    );

    return res.json({
      success: true,
      data: {
        brief: {
          id: brief.id, name: brief.name, mode: brief.mode,
          departmentId: brief.department_id, brief: brief.brief || {},
        },
      },
    });
  } catch (err) {
    console.error('assistant.useBrief error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors du chargement du brief' });
  }
};

const deleteBrief = async (req, res) => {
  try {
    if (!canBuild(req.user)) return denyBuild(res);
    const { id } = req.params;

    const result = await query(
      'SELECT id, name, establishment_id FROM assistant_briefs WHERE id = $1',
      [id]
    );
    const brief = result.rows[0];
    if (!brief) return res.status(404).json({ success: false, message: 'Brief introuvable' });
    if (brief.establishment_id !== req.user.establishmentId) {
      return res.status(403).json({ success: false, message: 'Ce brief appartient à un autre hôpital' });
    }

    await query('DELETE FROM assistant_briefs WHERE id = $1', [id]);
    return res.json({ success: true, message: `Brief « ${brief.name} » supprimé.` });
  } catch (err) {
    console.error('assistant.deleteBrief error:', err);
    return res.status(500).json({ success: false, message: 'Erreur lors de la suppression du brief' });
  }
};

module.exports = {
  getContext,
  generate,
  validate,
  applyFixes,
  confirm,
  listBriefs,
  saveBrief,
  useBrief,
  deleteBrief,
};
