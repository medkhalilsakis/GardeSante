/**
 * Référentiels nationaux (Lot X4) — Super Admin.
 *
 * Ce que le Super Admin peut faire ici, et qu'il ne pouvait faire nulle part :
 *
 *   1. VOIR la conformité de chaque établissement : a-t-il ses types de garde ?
 *      ses types d'absence ? ses rôles ? Le tableur n'a plus besoin d'eux — il ne
 *      connaît que « de service / pas de service » — mais un établissement sans
 *      type de garde reste un établissement dont la table `shifts`, les
 *      statistiques héritées et les remplacements n'ont rien à quoi se rattacher.
 *   2. AMORCER les types manquants en un clic, pour un établissement ou pour
 *      tous ceux qui en manquent.
 *   3. HARMONISER les horaires, durées, libellés et couleurs des types de garde
 *      et d'absence, établissement par établissement.
 *   4. CONSULTER la matrice rôles × permissions telle qu'elle est réellement en
 *      base, avec le taux de couverture national de chaque droit.
 *
 * FICHIER NEUF. `admin.controller.js` n'est pas modifié ; seules des lignes de
 * route sont ajoutées à `admin.routes.js`. Aucune migration, aucun changement de
 * schéma : ces tables existent depuis `001_schema.sql`.
 *
 * ── GARDE-FOUS (ce que le contrôleur REFUSE, et pourquoi) ────────────────────
 *
 * • Codes de garde J/S/N/G : ni supprimables, ni désactivables, code non
 *   renommable. Ce n'est plus le vocabulaire du tableur — celui-ci ne connaît
 *   qu'une seule notion, « de service / pas de service » — mais ces types
 *   alimentent toujours la table `shifts` (générateurs hérités), les
 *   statistiques établies sur elle, `rules-engine.js` et les remplacements. Les
 *   renommer ou les désactiver casserait ces flux.
 * • Codes d'absence `retard` et `absence_injustifiee` : protégés de la même
 *   façon. `absences-shift.controller.js:73` les résout par leur code littéral
 *   pour l'appel du jour ; les perdre casserait le pointage.
 * • Tout type déjà référencé (`shifts.shift_type_id`, `absences.absence_type_id`)
 *   ne peut pas être supprimé : la contrainte de clé étrangère refuserait de
 *   toute façon, mais un message métier vaut mieux qu'une erreur 500.
 *   La désactivation reste possible et n'altère aucun historique.
 */

const { query } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');
const { ensureDefaultShiftTypes, STANDARD_SHIFT_CODES } = require('../schedules/shift-types.service');
const { ensureDefaultAbsenceTypes } = require('../absences/absence-types.service');

/** Codes d'absence résolus littéralement par l'appel du jour. */
const PROTECTED_ABSENCE_CODES = ['retard', 'absence_injustifiee'];

/** Codes d'absence attendus dans tout établissement conforme. */
const STANDARD_ABSENCE_CODES = [
  'conge_annuel', 'conge_maladie', 'conge_maternite', 'conge_exceptionnel',
  'conge_formation', 'absence_injustifiee', 'retard',
];

const requireSuperAdmin = (req, res) => {
  if (req.user.isSuperAdmin) return true;
  res.status(403).json({
    success: false,
    message: 'Réservé au Super Admin',
    message_ar: 'مخصص للمشرف العام',
  });
  return false;
};

const toInt = (value) => Number(value) || 0;
const fail = (res, code, message) => res.status(code).json({ success: false, message });

/** 'HH:MM' ou 'HH:MM:SS' → 'HH:MM'. Renvoie null si la valeur n'est pas une heure. */
const parseTime = (value) => {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/** Durée en heures déduite des bornes, une garde à cheval sur minuit comprise. */
const durationBetween = (start, end) => {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const minutes = (eh * 60 + em) - (sh * 60 + sm);
  const span = minutes > 0 ? minutes : minutes + 24 * 60;
  return Math.round((span / 60) * 10) / 10 || 24;
};

const parseColor = (value, fallback) => {
  const color = String(value || '').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color.toUpperCase() : fallback;
};

const isStandardShiftCode = (code) => STANDARD_SHIFT_CODES.includes(String(code || '').toUpperCase());
const isProtectedAbsenceCode = (code) => PROTECTED_ABSENCE_CODES.includes(String(code || '').toLowerCase());

// ══════════════════════════════════════════════════════════════
// GET /api/admin/referentiels/overview
// Conformité de chaque établissement, en une requête.
// ══════════════════════════════════════════════════════════════
const getOverview = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const [estRes, permRes, roleRes] = await Promise.all([
      query(
        `SELECT e.id, e.code, e.name, e.type, e.governorate, e.is_active,
                COALESCE((
                  SELECT ARRAY_AGG(UPPER(st.code) ORDER BY st.code)
                    FROM shift_types st
                   WHERE st.establishment_id = e.id AND st.is_active = TRUE
                ), '{}') AS shift_codes,
                (SELECT COUNT(*) FROM shift_types st WHERE st.establishment_id = e.id) AS shift_total,
                COALESCE((
                  SELECT ARRAY_AGG(at.code ORDER BY at.code)
                    FROM absence_types at
                   WHERE at.establishment_id = e.id AND at.is_active = TRUE
                ), '{}') AS absence_codes,
                (SELECT COUNT(*) FROM absence_types at WHERE at.establishment_id = e.id) AS absence_total,
                (SELECT COUNT(*) FROM roles r WHERE r.establishment_id = e.id) AS roles_total,
                (SELECT COUNT(*) FROM departments d WHERE d.establishment_id = e.id) AS departments_total
           FROM establishments e
          WHERE e.type <> 'system'
          ORDER BY e.name`,
        []
      ),
      query('SELECT COUNT(*) AS total, COUNT(DISTINCT module) AS modules FROM permissions', []),
      query(
        // Même prédicat que `getPermissionMatrix` : une jointure interne exclurait
        // le rôle global `super_admin` (`establishment_id NULL`) et l'en-tête
        // annoncerait un rôle de moins que les colonnes de la matrice.
        `SELECT COUNT(DISTINCT r.code) AS role_codes
           FROM roles r
           LEFT JOIN establishments e ON e.id = r.establishment_id
          WHERE r.establishment_id IS NULL OR e.type <> 'system'`,
        []
      ),
    ]);

    const establishments = estRes.rows.map((row) => {
      const shiftCodes = row.shift_codes || [];
      const absenceCodes = row.absence_codes || [];
      const missingShift = STANDARD_SHIFT_CODES.filter((code) => !shiftCodes.includes(code));
      const missingAbsence = STANDARD_ABSENCE_CODES.filter((code) => !absenceCodes.includes(code));
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        governorate: row.governorate,
        isActive: row.is_active,
        departments: toInt(row.departments_total),
        roles: toInt(row.roles_total),
        shiftTypes: { active: shiftCodes.length, total: toInt(row.shift_total), missing: missingShift },
        absenceTypes: { active: absenceCodes.length, total: toInt(row.absence_total), missing: missingAbsence },
        // Un établissement est « prêt » quand un tableur peut y être enregistré
        // et un appel du jour y être tenu.
        ready: missingShift.length === 0 && missingAbsence.length === 0,
      };
    });

    return res.json({
      success: true,
      data: {
        establishments,
        summary: {
          establishments: establishments.length,
          ready: establishments.filter((e) => e.ready).length,
          missingShiftTypes: establishments.filter((e) => e.shiftTypes.missing.length > 0).length,
          missingAbsenceTypes: establishments.filter((e) => e.absenceTypes.missing.length > 0).length,
        },
        standards: {
          shiftCodes: STANDARD_SHIFT_CODES,
          absenceCodes: STANDARD_ABSENCE_CODES,
          protectedAbsenceCodes: PROTECTED_ABSENCE_CODES,
        },
        catalogue: {
          permissions: toInt(permRes.rows[0]?.total),
          modules: toInt(permRes.rows[0]?.modules),
          roleCodes: toInt(roleRes.rows[0]?.role_codes),
        },
      },
    });
  } catch (err) {
    console.error('adminReferentiels.getOverview error:', err);
    return fail(res, 500, 'Erreur lors du chargement des référentiels');
  }
};

// ══════════════════════════════════════════════════════════════
// TYPES DE GARDE
// ══════════════════════════════════════════════════════════════
const getShiftTypes = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { establishmentId } = req.query;
    if (!establishmentId) return fail(res, 400, 'Établissement requis');

    const result = await query(
      `SELECT st.id, st.code, st.name, st.name_ar,
              TO_CHAR(st.start_time, 'HH24:MI') AS start_time,
              TO_CHAR(st.end_time,   'HH24:MI') AS end_time,
              st.duration_hours, st.is_overnight, st.color, st.is_active,
              (SELECT COUNT(*) FROM shifts s WHERE s.shift_type_id = st.id) AS usage_count
         FROM shift_types st
        WHERE st.establishment_id = $1
        ORDER BY st.start_time, st.code`,
      [establishmentId]
    );

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        nameAr: row.name_ar,
        startTime: row.start_time,
        endTime: row.end_time,
        durationHours: Number(row.duration_hours),
        isOvernight: row.is_overnight,
        color: row.color,
        isActive: row.is_active,
        usageCount: toInt(row.usage_count),
        // Vocabulaire du tableur : protégé contre suppression et désactivation.
        isStandard: isStandardShiftCode(row.code),
      })),
    });
  } catch (err) {
    console.error('adminReferentiels.getShiftTypes error:', err);
    return fail(res, 500, 'Erreur lors du chargement des types de garde');
  }
};

const createShiftType = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { establishmentId, code, name, nameAr, startTime, endTime, durationHours, isOvernight, color } = req.body;

    if (!establishmentId) return fail(res, 400, 'Établissement requis');
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(cleanCode)) {
      return fail(res, 400, 'Le code doit contenir de 1 à 10 lettres ou chiffres, sans espace.');
    }
    if (!String(name || '').trim()) return fail(res, 400, 'Le libellé est obligatoire');

    const start = parseTime(startTime);
    const end = parseTime(endTime);
    if (!start || !end) return fail(res, 400, 'Heures de début et de fin attendues au format HH:MM');

    const duration = Number(durationHours) > 0
      ? Math.min(24, Math.round(Number(durationHours) * 10) / 10)
      : durationBetween(start, end);
    const overnight = isOvernight != null ? Boolean(isOvernight) : end <= start;

    const exists = await query(
      'SELECT 1 FROM shift_types WHERE establishment_id = $1 AND UPPER(code) = $2',
      [establishmentId, cleanCode]
    );
    if (exists.rows.length) {
      return fail(res, 409, `Le code « ${cleanCode} » existe déjà dans cet établissement.`);
    }

    const result = await query(
      `INSERT INTO shift_types
         (establishment_id, code, name, name_ar, start_time, end_time,
          duration_hours, is_overnight, color, is_active)
       VALUES ($1,$2,$3,$4,$5::time,$6::time,$7,$8,$9,TRUE)
       RETURNING id, code, name`,
      [establishmentId, cleanCode, String(name).trim(), nameAr || null,
       start, end, duration, overnight, parseColor(color, '#3B82F6')]
    );

    log({
      userId: req.user.id, action: 'referentiel_shift_type_create', category: 'admin',
      description: `Type de garde créé : ${cleanCode} — ${name}`,
      entityType: 'shift_types', entityId: result.rows[0].id, ipAddress: getIp(req),
    });

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: `Type de garde « ${cleanCode} » créé.`,
    });
  } catch (err) {
    console.error('adminReferentiels.createShiftType error:', err);
    return fail(res, 500, 'Erreur lors de la création du type de garde');
  }
};

const updateShiftType = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { id } = req.params;
    const { code, name, nameAr, startTime, endTime, durationHours, isOvernight, color, isActive } = req.body;

    const current = await query(
      `SELECT st.*, TO_CHAR(st.start_time,'HH24:MI') AS start_txt,
              TO_CHAR(st.end_time,'HH24:MI') AS end_txt
         FROM shift_types st WHERE st.id = $1`,
      [id]
    );
    const row = current.rows[0];
    if (!row) return fail(res, 404, 'Type de garde introuvable');

    const standard = isStandardShiftCode(row.code);
    const nextCode = code != null ? String(code).trim().toUpperCase() : String(row.code).toUpperCase();

    if (standard && nextCode !== String(row.code).toUpperCase()) {
      return fail(res, 409,
        `Le code « ${row.code} » est un type de garde standard, référencé par la table `
        + '`shifts`, les statistiques et les remplacements : il ne peut pas être renommé. '
        + 'Libellé, horaires et couleur restent modifiables.');
    }
    if (!standard && !/^[A-Z0-9]{1,10}$/.test(nextCode)) {
      return fail(res, 400, 'Le code doit contenir de 1 à 10 lettres ou chiffres, sans espace.');
    }
    if (standard && isActive === false) {
      return fail(res, 409,
        `Désactiver « ${row.code} » priverait de type les gardes créées par les générateurs `
        + 'hérités et par les remplacements. Ce type doit rester actif.');
    }

    if (nextCode !== String(row.code).toUpperCase()) {
      const clash = await query(
        'SELECT 1 FROM shift_types WHERE establishment_id = $1 AND UPPER(code) = $2 AND id <> $3',
        [row.establishment_id, nextCode, id]
      );
      if (clash.rows.length) return fail(res, 409, `Le code « ${nextCode} » existe déjà dans cet établissement.`);
    }

    const start = parseTime(startTime) || row.start_txt;
    const end = parseTime(endTime) || row.end_txt;
    const duration = Number(durationHours) > 0
      ? Math.min(24, Math.round(Number(durationHours) * 10) / 10)
      : durationBetween(start, end);

    const result = await query(
      `UPDATE shift_types
          SET code = $1, name = $2, name_ar = $3, start_time = $4::time, end_time = $5::time,
              duration_hours = $6, is_overnight = $7, color = $8, is_active = $9
        WHERE id = $10
        RETURNING id, code, name`,
      [
        nextCode,
        String(name ?? row.name).trim() || row.name,
        nameAr !== undefined ? (nameAr || null) : row.name_ar,
        start, end, duration,
        isOvernight != null ? Boolean(isOvernight) : row.is_overnight,
        parseColor(color, row.color),
        isActive != null ? Boolean(isActive) : row.is_active,
        id,
      ]
    );

    log({
      userId: req.user.id, action: 'referentiel_shift_type_update', category: 'admin',
      description: `Type de garde modifié : ${nextCode} — ${result.rows[0].name}`,
      entityType: 'shift_types', entityId: id, ipAddress: getIp(req),
    });

    return res.json({ success: true, data: result.rows[0], message: 'Type de garde mis à jour.' });
  } catch (err) {
    console.error('adminReferentiels.updateShiftType error:', err);
    return fail(res, 500, 'Erreur lors de la mise à jour du type de garde');
  }
};

const deleteShiftType = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { id } = req.params;

    const current = await query(
      `SELECT st.code, st.name,
              (SELECT COUNT(*) FROM shifts s WHERE s.shift_type_id = st.id) AS usage_count
         FROM shift_types st WHERE st.id = $1`,
      [id]
    );
    const row = current.rows[0];
    if (!row) return fail(res, 404, 'Type de garde introuvable');

    if (isStandardShiftCode(row.code)) {
      return fail(res, 409,
        `« ${row.code} » fait partie du vocabulaire du tableur de garde (J, S, N, G) : `
        + 'le supprimer bloquerait tous les plannings de cet établissement.');
    }
    if (toInt(row.usage_count) > 0) {
      return fail(res, 409,
        `Ce type est utilisé par ${toInt(row.usage_count)} garde(s) enregistrée(s). `
        + 'Désactivez-le plutôt que de le supprimer : l\'historique reste ainsi lisible.');
    }

    await query('DELETE FROM shift_types WHERE id = $1', [id]);

    log({
      userId: req.user.id, action: 'referentiel_shift_type_delete', category: 'admin',
      description: `Type de garde supprimé : ${row.code} — ${row.name}`,
      entityType: 'shift_types', entityId: id, ipAddress: getIp(req), severity: 'warning',
    });

    return res.json({ success: true, message: `Type de garde « ${row.code} » supprimé.` });
  } catch (err) {
    console.error('adminReferentiels.deleteShiftType error:', err);
    return fail(res, 500, 'Erreur lors de la suppression du type de garde');
  }
};

// ══════════════════════════════════════════════════════════════
// TYPES D'ABSENCE ET DE CONGÉ
// ══════════════════════════════════════════════════════════════
const getAbsenceTypes = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { establishmentId } = req.query;
    if (!establishmentId) return fail(res, 400, 'Établissement requis');

    const result = await query(
      `SELECT at.id, at.code, at.name, at.name_ar, at.requires_justification,
              at.is_paid, at.is_leave, at.color, at.is_active,
              (SELECT COUNT(*) FROM absences a WHERE a.absence_type_id = at.id) AS usage_count
         FROM absence_types at
        WHERE at.establishment_id = $1
        ORDER BY at.is_leave DESC, at.code`,
      [establishmentId]
    );

    return res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        nameAr: row.name_ar,
        requiresJustification: row.requires_justification,
        isPaid: row.is_paid,
        isLeave: row.is_leave,
        color: row.color,
        isActive: row.is_active,
        usageCount: toInt(row.usage_count),
        // `retard` / `absence_injustifiee` : résolus par code dans l'appel du jour.
        isProtected: isProtectedAbsenceCode(row.code),
      })),
    });
  } catch (err) {
    console.error('adminReferentiels.getAbsenceTypes error:', err);
    return fail(res, 500, 'Erreur lors du chargement des types d\'absence');
  }
};

const createAbsenceType = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const {
      establishmentId, code, name, nameAr,
      requiresJustification, isPaid, isLeave, color,
    } = req.body;

    if (!establishmentId) return fail(res, 400, 'Établissement requis');
    const cleanCode = String(code || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!/^[a-z0-9_]{2,30}$/.test(cleanCode)) {
      return fail(res, 400, 'Le code doit contenir de 2 à 30 caractères : lettres, chiffres ou « _ ».');
    }
    if (!String(name || '').trim()) return fail(res, 400, 'Le libellé est obligatoire');

    const exists = await query(
      'SELECT 1 FROM absence_types WHERE establishment_id = $1 AND code = $2',
      [establishmentId, cleanCode]
    );
    if (exists.rows.length) {
      return fail(res, 409, `Le code « ${cleanCode} » existe déjà dans cet établissement.`);
    }

    const result = await query(
      `INSERT INTO absence_types
         (establishment_id, code, name, name_ar, requires_justification, is_paid, is_leave, color, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
       RETURNING id, code, name`,
      [establishmentId, cleanCode, String(name).trim(), nameAr || null,
       Boolean(requiresJustification), isPaid != null ? Boolean(isPaid) : true,
       Boolean(isLeave), parseColor(color, '#EF4444')]
    );

    log({
      userId: req.user.id, action: 'referentiel_absence_type_create', category: 'admin',
      description: `Type d'absence créé : ${cleanCode} — ${name}`,
      entityType: 'absence_types', entityId: result.rows[0].id, ipAddress: getIp(req),
    });

    return res.status(201).json({
      success: true,
      data: result.rows[0],
      message: `Type « ${String(name).trim()} » créé.`,
    });
  } catch (err) {
    console.error('adminReferentiels.createAbsenceType error:', err);
    return fail(res, 500, 'Erreur lors de la création du type d\'absence');
  }
};

const updateAbsenceType = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { id } = req.params;
    const { code, name, nameAr, requiresJustification, isPaid, isLeave, color, isActive } = req.body;

    const current = await query('SELECT * FROM absence_types WHERE id = $1', [id]);
    const row = current.rows[0];
    if (!row) return fail(res, 404, 'Type d\'absence introuvable');

    const isProtected = isProtectedAbsenceCode(row.code);
    const nextCode = code != null
      ? String(code).trim().toLowerCase().replace(/\s+/g, '_')
      : row.code;

    if (isProtected && nextCode !== row.code) {
      return fail(res, 409,
        `Le code « ${row.code} » est utilisé littéralement par l'appel du jour : il ne peut pas être renommé. `
        + 'Le libellé et la couleur restent modifiables.');
    }
    if (isProtected && isActive === false) {
      return fail(res, 409,
        `Désactiver « ${row.name} » empêcherait de pointer un retard ou une absence dans l'appel du jour. `
        + 'Ce type doit rester actif.');
    }
    if (isProtected && isLeave === true) {
      return fail(res, 409,
        `« ${row.name} » relève de la garde du jour, pas des congés : ce classement ne peut pas être inversé.`);
    }
    if (!isProtected && !/^[a-z0-9_]{2,30}$/.test(nextCode)) {
      return fail(res, 400, 'Le code doit contenir de 2 à 30 caractères : lettres, chiffres ou « _ ».');
    }

    if (nextCode !== row.code) {
      const clash = await query(
        'SELECT 1 FROM absence_types WHERE establishment_id = $1 AND code = $2 AND id <> $3',
        [row.establishment_id, nextCode, id]
      );
      if (clash.rows.length) return fail(res, 409, `Le code « ${nextCode} » existe déjà dans cet établissement.`);
    }

    const result = await query(
      `UPDATE absence_types
          SET code = $1, name = $2, name_ar = $3, requires_justification = $4,
              is_paid = $5, is_leave = $6, color = $7, is_active = $8
        WHERE id = $9
        RETURNING id, code, name`,
      [
        nextCode,
        String(name ?? row.name).trim() || row.name,
        nameAr !== undefined ? (nameAr || null) : row.name_ar,
        requiresJustification != null ? Boolean(requiresJustification) : row.requires_justification,
        isPaid != null ? Boolean(isPaid) : row.is_paid,
        isLeave != null ? Boolean(isLeave) : row.is_leave,
        parseColor(color, row.color),
        isActive != null ? Boolean(isActive) : row.is_active,
        id,
      ]
    );

    log({
      userId: req.user.id, action: 'referentiel_absence_type_update', category: 'admin',
      description: `Type d'absence modifié : ${nextCode} — ${result.rows[0].name}`,
      entityType: 'absence_types', entityId: id, ipAddress: getIp(req),
    });

    return res.json({ success: true, data: result.rows[0], message: 'Type mis à jour.' });
  } catch (err) {
    console.error('adminReferentiels.updateAbsenceType error:', err);
    return fail(res, 500, 'Erreur lors de la mise à jour du type d\'absence');
  }
};

const deleteAbsenceType = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { id } = req.params;

    const current = await query(
      `SELECT at.code, at.name,
              (SELECT COUNT(*) FROM absences a WHERE a.absence_type_id = at.id) AS usage_count
         FROM absence_types at WHERE at.id = $1`,
      [id]
    );
    const row = current.rows[0];
    if (!row) return fail(res, 404, 'Type d\'absence introuvable');

    if (isProtectedAbsenceCode(row.code)) {
      return fail(res, 409,
        `« ${row.name} » est requis par l'appel du jour (code « ${row.code} ») : il ne peut pas être supprimé.`);
    }
    if (toInt(row.usage_count) > 0) {
      return fail(res, 409,
        `Ce type est utilisé par ${toInt(row.usage_count)} déclaration(s). `
        + 'Désactivez-le plutôt que de le supprimer : l\'historique reste ainsi lisible.');
    }

    await query('DELETE FROM absence_types WHERE id = $1', [id]);

    log({
      userId: req.user.id, action: 'referentiel_absence_type_delete', category: 'admin',
      description: `Type d'absence supprimé : ${row.code} — ${row.name}`,
      entityType: 'absence_types', entityId: id, ipAddress: getIp(req), severity: 'warning',
    });

    return res.json({ success: true, message: `Type « ${row.name} » supprimé.` });
  } catch (err) {
    console.error('adminReferentiels.deleteAbsenceType error:', err);
    return fail(res, 500, 'Erreur lors de la suppression du type d\'absence');
  }
};

// ══════════════════════════════════════════════════════════════
// POST /api/admin/referentiels/seed
// Amorçage en un clic : un établissement, ou tous ceux qui manquent de quoi
// travailler. Toujours additif — aucun type existant n'est réécrit.
// ══════════════════════════════════════════════════════════════
const seedReferentiels = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const { establishmentId, scope = 'all', kinds } = req.body || {};

    const wanted = Array.isArray(kinds) && kinds.length ? kinds : ['shift', 'absence'];
    const doShift = wanted.includes('shift');
    const doAbsence = wanted.includes('absence');
    if (!doShift && !doAbsence) return fail(res, 400, 'Aucun référentiel sélectionné');

    let targets;
    if (establishmentId) {
      targets = await query(
        `SELECT id, name FROM establishments WHERE id = $1 AND type <> 'system'`,
        [establishmentId]
      );
      if (!targets.rows.length) return fail(res, 404, 'Établissement introuvable');
    } else if (scope === 'all') {
      targets = await query(
        `SELECT id, name FROM establishments WHERE type <> 'system' ORDER BY name`,
        []
      );
    } else {
      return fail(res, 400, 'Portée invalide');
    }

    let shiftCreated = 0;
    let absenceTouched = 0;
    const touched = [];

    for (const est of targets.rows) {
      let createdHere = 0;
      if (doShift) {
        createdHere = await ensureDefaultShiftTypes(est.id);
        shiftCreated += createdHere;
      }
      if (doAbsence) {
        await ensureDefaultAbsenceTypes(est.id);
        absenceTouched += 1;
      }
      if (createdHere > 0) touched.push({ id: est.id, name: est.name, shiftTypes: createdHere });
    }

    log({
      userId: req.user.id, action: 'referentiel_seed', category: 'admin',
      description: establishmentId
        ? `Référentiels amorcés pour 1 établissement (${shiftCreated} type(s) de garde créé(s))`
        : `Référentiels amorcés pour ${targets.rows.length} établissement(s) (${shiftCreated} type(s) de garde créé(s))`,
      entityType: 'establishments', entityId: establishmentId || null, ipAddress: getIp(req),
    });

    const message = shiftCreated > 0
      ? `${shiftCreated} type(s) de garde créé(s) sur ${targets.rows.length} établissement(s).`
      : `Aucun type de garde manquant sur ${targets.rows.length} établissement(s).`;

    return res.json({
      success: true,
      data: {
        establishments: targets.rows.length,
        shiftTypesCreated: shiftCreated,
        absenceTypesEnsured: absenceTouched,
        touched,
      },
      message: doAbsence && shiftCreated === 0
        ? `${message} Types d'absence standards vérifiés.`
        : message,
    });
  } catch (err) {
    console.error('adminReferentiels.seedReferentiels error:', err);
    return fail(res, 500, 'Erreur lors de l\'amorçage des référentiels');
  }
};

// ══════════════════════════════════════════════════════════════
// GET /api/admin/referentiels/permissions
// Matrice rôles × permissions, LECTURE SEULE.
//
// Les rôles sont créés par établissement (`create_roles_for_establishment`,
// migration 012) : la matrice nationale doit donc dire non seulement « ce rôle
// a ce droit », mais « dans combien d'établissements ». Un droit accordé dans
// 2 hôpitaux sur 3 est une divergence qu'il faut voir, pas masquer derrière une
// simple coche.
// ══════════════════════════════════════════════════════════════
const getPermissionMatrix = async (req, res) => {
  try {
    if (!requireSuperAdmin(req, res)) return;

    const [permRes, roleRes, grantRes] = await Promise.all([
      query(
        `SELECT code, module, action, description
           FROM permissions
          ORDER BY module, action`,
        []
      ),
      query(
        `SELECT r.code,
                MIN(r.name)  AS name,
                MIN(r.level) AS level,
                BOOL_OR(r.establishment_id IS NULL) AS is_global,
                COUNT(DISTINCT r.establishment_id)  AS establishments
           FROM roles r
           LEFT JOIN establishments e ON e.id = r.establishment_id
          WHERE r.establishment_id IS NULL OR e.type <> 'system'
          GROUP BY r.code
          ORDER BY MIN(r.level), r.code`,
        []
      ),
      query(
        `SELECT r.code AS role_code, p.code AS permission_code,
                COUNT(DISTINCT r.establishment_id) AS establishments,
                COUNT(*) AS grants
           FROM role_permissions rp
           JOIN roles r       ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
           LEFT JOIN establishments e ON e.id = r.establishment_id
          WHERE r.establishment_id IS NULL OR e.type <> 'system'
          GROUP BY r.code, p.code`,
        []
      ),
    ]);

    const grants = new Map();
    for (const row of grantRes.rows) {
      grants.set(`${row.role_code}|${row.permission_code}`, {
        establishments: toInt(row.establishments),
        grants: toInt(row.grants),
      });
    }

    const permissions = permRes.rows.map((row) => ({
      code: row.code, module: row.module, action: row.action, description: row.description,
    }));

    const roles = roleRes.rows.map((row) => {
      const total = toInt(row.establishments);          // 0 pour le rôle global super_admin
      const cells = {};
      let granted = 0;
      let partial = 0;
      for (const perm of permissions) {
        const hit = grants.get(`${row.code}|${perm.code}`);
        let state = 'none';
        if (hit) {
          if (total === 0) state = hit.grants > 0 ? 'all' : 'none';
          else state = hit.establishments >= total ? 'all' : 'partial';
        }
        cells[perm.code] = state;
        if (state === 'all') granted += 1;
        if (state === 'partial') partial += 1;
      }
      return {
        code: row.code,
        name: row.name,
        level: toInt(row.level),
        isGlobal: row.is_global === true,
        establishments: total,
        granted,
        partial,
        cells,
      };
    });

    // Modules dans l'ordre d'apparition, pour un affichage groupé stable.
    const modules = [];
    for (const perm of permissions) {
      if (!modules.includes(perm.module)) modules.push(perm.module);
    }

    return res.json({
      success: true,
      data: {
        permissions,
        modules,
        roles,
        readOnly: true,
        note: 'Matrice câblée dans create_roles_for_establishment (migration 012). '
            + 'Cet écran la restitue telle qu\'elle est réellement en base ; il ne la modifie pas.',
      },
    });
  } catch (err) {
    console.error('adminReferentiels.getPermissionMatrix error:', err);
    return fail(res, 500, 'Erreur lors du chargement de la matrice des droits');
  }
};

module.exports = {
  getOverview,
  getShiftTypes,
  createShiftType,
  updateShiftType,
  deleteShiftType,
  getAbsenceTypes,
  createAbsenceType,
  updateAbsenceType,
  deleteAbsenceType,
  seedReferentiels,
  getPermissionMatrix,
};
