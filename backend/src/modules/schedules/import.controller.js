/**
 * ============================================================
 * IMPORT CONTROLLER — Importation intelligente Excel / CSV
 * Prise en charge des plannings normaux et spéciaux (week-ends & jours fériés)
 * Correspondance du personnel, détection des dates et création/mise à jour du Tableur
 * ============================================================
 */

const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const { query, transaction } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');
const { normalizePeriods, periodBounds } = require('./periods');
// Règle de lecture unique du tableur : « de service / pas de service ».
const { isMarked, dutyEntries } = require('./spreadsheet-reader');

// ── Utility: Flexible Date String Parser ────────────────────────────────
const parseFlexDate = (val) => {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number' && val > 30000 && val < 60000) {
    try {
      const dateObj = XLSX.SSF.parse_date_code(val);
      if (dateObj) {
        const y = dateObj.y;
        const m = String(dateObj.m).padStart(2, '0');
        const d = String(dateObj.d).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch { /* fallback */ }
  }
  const str = String(val).trim();
  // Format YYYY-MM-DD or YYYY/MM/DD
  let match = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Format DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  match = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    const [, d, m, y] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Format DD/MM (assume current year)
  match = str.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (match) {
    const y = new Date().getFullYear();
    const [, d, m] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
};

// ── Normalize text for matching ──────────────────────────────────────────
const normText = (str) => String(str || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/g, '')
  .trim();

// ── Garde à domicile ────────────────────────────────────────────────────
// Colonne FACULTATIVE : un fichier qui ne la porte pas s'importe exactement
// comme avant, tous les agents en garde à l'hôpital. Seuls des marqueurs
// affirmatifs explicites valent « à domicile » ; tout le reste (vide, « Non »,
// « 0 », un texte quelconque) reste une garde en présence.
const AT_HOME_TRUE = new Set([
  'oui', 'o', 'yes', 'y', '1', 'x', 'true', 'vrai',
  'domicile', 'adomicile', 'astreinte', 'athome', 'home',
]);
const parseAtHome = (raw) => AT_HOME_TRUE.has(normText(raw));

const parsePeriods = (raw) => {
  if (!raw) return [];
  const matches = String(raw).match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/g) || [];
  const dates = matches.map(parseFlexDate).filter(Boolean);
  const periods = [];
  for (let index = 0; index < dates.length; index += 2) {
    periods.push({ startDate: dates[index], endDate: dates[index + 1] || dates[index] });
  }
  return periods.sort((a, b) => a.startDate.localeCompare(b.startDate));
};

// ── POST /api/schedule-builder/import/preview ──────────────────────────
const importPreview = async (req, res) => {
  const estId = req.user.establishmentId;

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
  }

  const { originalname, buffer } = req.file;
  const ext = originalname.split('.').pop().toLowerCase();

  let rawData = [];
  let detectedHeaders = [];

  try {
    if (['xlsx', 'xls'].includes(ext)) {
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rawData = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
      if (rawData.length > 0) {
        detectedHeaders = Object.keys(rawData[0]);
      }
    } else if (ext === 'csv') {
      const csvString = buffer.toString('utf-8');
      rawData = parse(csvString, {
        columns: true, skip_empty_lines: true,
        trim: true, bom: true,
      });
      if (rawData.length > 0) {
        detectedHeaders = Object.keys(rawData[0]);
      }
    } else {
      return res.status(400).json({
        success: false,
        message: `Format "${ext}" non supporté. Utilisez Excel (.xlsx) ou CSV (.csv).`,
      });
    }
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: `Erreur de lecture du fichier : ${err.message}`,
    });
  }

  if (rawData.length === 0) {
    return res.status(400).json({ success: false, message: 'Le fichier est vide ou ne contient pas de données exploitables.' });
  }

  // ── Analyse des colonnes et détection des dates ──────────────────────
  const dateColumns = [];
  const metaColumns = {};

  detectedHeaders.forEach(header => {
    const cleanH = normText(header);
    const parsedDate = parseFlexDate(header);

    if (parsedDate) {
      dateColumns.push({ original: header, dateKey: parsedDate });
    } else if (['domicile', 'astreinte', 'athome'].some(k => cleanH.includes(k))) {
      // Testée avant les autres : « Garde a domicile » ne doit jamais être
      // happée par un motif plus large de la chaîne (id, code, mat, fin…).
      metaColumns.atHome = header;
    } else if (['nom', 'lastname', 'familyname'].some(k => cleanH.includes(k))) {
      metaColumns.lastName = header;
    } else if (['prenom', 'firstname', 'givenname'].some(k => cleanH.includes(k))) {
      metaColumns.firstName = header;
    } else if (['matricule', 'id', 'code', 'mat'].some(k => cleanH.includes(k))) {
      metaColumns.matricule = header;
    } else if (['telephone', 'phone', 'tel', 'mobile'].some(k => cleanH.includes(k))) {
      metaColumns.phone = header;
    } else if (['role', 'fonction', 'specialite', 'speciality', 'grade', 'title'].some(k => cleanH.includes(k))) {
      metaColumns.roleName = header;
    } else if (['multiperiod', 'periodes', 'plages', 'periodesaffectation'].some(k => cleanH.includes(k))) {
      metaColumns.periods = header;
    } else if (['periodedebut', 'periodstart', 'debut', 'startdate'].some(k => cleanH.includes(k))) {
      metaColumns.periodStart = header;
    } else if (['periodefin', 'periodend', 'fin', 'enddate'].some(k => cleanH.includes(k))) {
      metaColumns.periodEnd = header;
    }
  });

  // Tri des dates détectées
  dateColumns.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

  // Détection des dates min/max du fichier
  let detectedStartDate = dateColumns.length > 0 ? dateColumns[0].dateKey : null;
  let detectedEndDate = dateColumns.length > 0 ? dateColumns[dateColumns.length - 1].dateKey : null;

  // Si pas de colonnes dates entêtes, chercher dans les lignes periodStart / periodEnd
  if (!detectedStartDate) {
    for (const row of rawData) {
      const rowPeriods = parsePeriods(row[metaColumns.periods]);
      const pStart = parseFlexDate(row[metaColumns.periodStart]);
      const pEnd = parseFlexDate(row[metaColumns.periodEnd]);
      if (rowPeriods[0]?.startDate && (!detectedStartDate || rowPeriods[0].startDate < detectedStartDate)) detectedStartDate = rowPeriods[0].startDate;
      if (rowPeriods.at(-1)?.endDate && (!detectedEndDate || rowPeriods.at(-1).endDate > detectedEndDate)) detectedEndDate = rowPeriods.at(-1).endDate;
      if (pStart && (!detectedStartDate || pStart < detectedStartDate)) detectedStartDate = pStart;
      if (pEnd && (!detectedEndDate || pEnd > detectedEndDate)) detectedEndDate = pEnd;
    }
  }

  // Fallback si aucune date trouvée : mois courant
  if (!detectedStartDate || !detectedEndDate) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    detectedStartDate = `${y}-${m}-01`;
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    detectedEndDate = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
  }

  // ── Vérification si type spécial (seuls week-ends & jours fériés dans les colonnes) ──
  const targetYear = parseInt(detectedStartDate.substring(0, 4));
  const holidaysRes = await query(
    `SELECT start_date::text, end_date::text FROM public_holidays WHERE year = $1`,
    [targetYear]
  );
  const publicHolidays = holidaysRes.rows;

  let isAllSpecialDays = dateColumns.length > 0;
  for (const dateCol of dateColumns) {
    const dObj = new Date(`${dateCol.dateKey}T12:00:00`);
    const isWeekend = dObj.getDay() === 0 || dObj.getDay() === 6;
    const isHoliday = publicHolidays.some(h => dateCol.dateKey >= h.start_date && dateCol.dateKey <= h.end_date);
    if (!isWeekend && !isHoliday) {
      isAllSpecialDays = false;
      break;
    }
  }
  const suggestedScheduleType = isAllSpecialDays ? 'special_weekend_holiday' : 'normal';

  // ── Staff Matching avec la Base de Données ───────────────────────────
  const staffRes = await query(
    `SELECT u.id, u.first_name, u.last_name, u.matricule, u.phone, r.name AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.establishment_id = $1 AND u.is_active = TRUE`,
    [estId]
  );
  const existingStaff = staffRes.rows;

  const parsedRows = rawData.map((row, idx) => {
    const lastName  = String(row[metaColumns.lastName] || '').trim();
    const firstName = String(row[metaColumns.firstName] || '').trim();
    const matricule = String(row[metaColumns.matricule] || '').trim();
    const phone     = String(row[metaColumns.phone] || '').trim();
    const roleName  = String(row[metaColumns.roleName] || '').trim();
    const importedPeriods = parsePeriods(row[metaColumns.periods]);
    const pStart    = parseFlexDate(row[metaColumns.periodStart]) || detectedStartDate;
    const pEnd      = parseFlexDate(row[metaColumns.periodEnd]) || detectedEndDate;
    const periods   = importedPeriods.length ? importedPeriods : [{ startDate: pStart, endDate: pEnd }];
    const bounds    = periodBounds(periods);

    // Tentative de correspondance
    let matchedUser = null;
    if (matricule) {
      matchedUser = existingStaff.find(u => u.matricule && normText(u.matricule) === normText(matricule));
    }
    if (!matchedUser && firstName && lastName) {
      matchedUser = existingStaff.find(u =>
        normText(u.first_name) === normText(firstName) && normText(u.last_name) === normText(lastName)
      );
      if (!matchedUser) {
        matchedUser = existingStaff.find(u =>
          normText(u.first_name) === normText(lastName) && normText(u.last_name) === normText(firstName)
        );
      }
    }

    // Journées de service cochées dans le fichier. Toute cellule non vide vaut
    // « de service » ; seul l'ancien code « R » (Repos) reste ignoré, pour que
    // les fichiers antérieurs s'importent sans surprise.
    const shiftMap = {};
    dateColumns.forEach(dateCol => {
      const rawVal = String(row[dateCol.original] || '').trim();
      if (isMarked(rawVal)) shiftMap[dateCol.dateKey] = true;
    });

    return {
      rowIndex: idx + 1,
      lastName: lastName || (matchedUser ? matchedUser.last_name : ''),
      firstName: firstName || (matchedUser ? matchedUser.first_name : ''),
      matricule: matricule || (matchedUser ? matchedUser.matricule : ''),
      phone: phone || (matchedUser ? matchedUser.phone : ''),
      roleName: roleName || (matchedUser ? matchedUser.role_name : ''),
      periods,
      periodStart: bounds.startDate,
      periodEnd: bounds.endDate,
      atHome: metaColumns.atHome ? parseAtHome(row[metaColumns.atHome]) : false,
      matchedUserId: matchedUser ? matchedUser.id : null,
      matchedUserName: matchedUser ? `${matchedUser.first_name} ${matchedUser.last_name}` : null,
      isMatched: !!matchedUser,
      shifts: shiftMap,
    };
  });

  const titleName = originalname.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

  return res.json({
    success: true,
    data: {
      fileName: originalname,
      suggestedTitle: `Planning Importé — ${titleName}`,
      detectedStartDate,
      detectedEndDate,
      suggestedScheduleType,
      dateColumnsCount: dateColumns.length,
      totalRows: parsedRows.length,
      matchedCount: parsedRows.filter(r => r.isMatched).length,
      unmatchedCount: parsedRows.filter(r => !r.isMatched).length,
      headers: detectedHeaders,
      rows: parsedRows,
    },
    message: `${parsedRows.length} ligne(s) analysée(s) dans "${originalname}" (${parsedRows.filter(r => r.isMatched).length} personnel(s) reconnu(s))`,
  });
};

// ── POST /api/schedule-builder/import/confirm ──────────────────────────
const importConfirm = async (req, res) => {
  const estId = req.user.establishmentId;
  const {
    departmentId,
    scheduleId,       // Facultatif : si renseigné, met à jour le planning existant
    name,
    startDate,
    endDate,
    scheduleType = 'normal',
    rows = [],
  } = req.body;

  if (!departmentId || !startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'departmentId, startDate et endDate sont requis' });
  }

  let targetScheduleId = scheduleId;
  const schedName = name?.trim() || `Planning Importé (${startDate} → ${endDate})`;

  // 1. Créer ou Mettre à Jour la fiche planning
  if (targetScheduleId) {
    await query(
      `UPDATE schedules
       SET name = COALESCE($1, name), start_date = $2, end_date = $3, schedule_type = $4, updated_at = NOW()
       WHERE id = $5 AND establishment_id = $6`,
      [schedName, startDate, endDate, scheduleType, targetScheduleId, estId]
    );
  } else {
    const newSched = await query(
      `INSERT INTO schedules
         (establishment_id, department_id, name, start_date, end_date, schedule_type,
          status, creation_mode, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', 'spreadsheet', $7, $8::jsonb)
       RETURNING id`,
      [
        estId, departmentId, schedName, startDate, endDate, scheduleType,
        req.user.id,
        JSON.stringify({
          schedule_kind: scheduleType === 'special_weekend_holiday' ? 'weekend_holiday' : 'normal',
          special_days_only: scheduleType === 'special_weekend_holiday',
        }),
      ]
    );
    targetScheduleId = newSched.rows[0].id;
  }

  // 2. Construire la liste des lignes pour le Tableur (SmartSpreadsheet)
  const rosterRows = rows.map((r, idx) => {
    const rowUserId = r.matchedUserId || null;
    const periods = scheduleType === 'special_weekend_holiday'
      ? normalizePeriods(r, startDate, endDate)
      : normalizePeriods({ ...r, periods: Array.isArray(r.periods) ? r.periods : undefined }, startDate, endDate);
    const bounds = periodBounds(periods);
    return {
      id: rowUserId ? `row-${rowUserId}` : `import-row-${Date.now()}-${idx}`,
      userId: rowUserId,
      lastName: r.lastName || '',
      firstName: r.firstName || '',
      roleName: r.roleName || '',
      phone: r.phone || '',
      matricule: r.matricule || '',
      periods,
      periodStart: bounds.startDate || startDate,
      periodEnd: bounds.endDate || endDate,
      shiftStart: '07:00',
      shiftEnd: '07:00',
      // La revue peut avoir corrigé la case : on lit ce que le client renvoie,
      // sinon `false` — jamais de garde à domicile par défaut.
      atHome: r.atHome === true,
      deptId: departmentId,
      shifts: r.shifts || {},
      isNew: false,
      custom: {},
    };
  });

  if (scheduleType !== 'special_weekend_holiday') {
    for (const row of rosterRows) {
      const name = `${row.lastName} ${row.firstName}`.trim() || `Ligne ${row.id}`;
      if (!row.periods.length) return res.status(400).json({ success: false, message: `${name} : ajoutez au moins une période.` });
      for (const [index, period] of row.periods.entries()) {
        if (!period.startDate || !period.endDate || period.startDate > period.endDate) {
          return res.status(400).json({ success: false, message: `${name} : la période ${index + 1} est invalide.` });
        }
        if (period.startDate < startDate || period.endDate > endDate) {
          return res.status(400).json({ success: false, message: `${name} : la période ${index + 1} doit rester entre le ${startDate} et le ${endDate}.` });
        }
        if (index > 0 && period.startDate <= row.periods[index - 1].endDate) {
          return res.status(400).json({ success: false, message: `${name} : les périodes ${index} et ${index + 1} se chevauchent.` });
        }
      }
    }
  }

  // 3. Décompte annoncé au chef : les journées de service telles que le tableur
  //    les lira ensuite (cases cochées du fichier, ou période de participation
  //    pour les lignes qui n'en portent aucune). Aucune conversion en `shifts` :
  //    le tableur est la seule source de vérité.
  const dutyDaysCount = dutyEntries(
    {
      start_date: startDate,
      end_date: endDate,
      schedule_type: scheduleType,
      metadata: { spreadsheet: { rows: rosterRows } },
    },
    startDate,
    endDate
  ).length;

  // 4. Enregistrer dans PostgreSQL via Transaction
  await transaction(async (client) => {
    // Mettre à jour les métadonnées pour SmartSpreadsheet
    const metaDataToUpdate = {
      spreadsheet: {
        rows: rosterRows,
        customCols: [],
        savedAt: new Date().toISOString(),
      },
      importSource: 'excel_csv',
      schedule_kind: scheduleType === 'special_weekend_holiday' ? 'weekend_holiday' : 'normal',
      special_days_only: scheduleType === 'special_weekend_holiday',
    };

    await client.query(
      `UPDATE schedules SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
      [targetScheduleId, JSON.stringify(metaDataToUpdate)]
    );

    // Le tableur ne peuple plus la table `shifts`. On purge malgré tout les
    // lignes héritées de ce planning : laissées en place, elles referaient
    // surface dans la fusion de l'export et contrediraient le fichier importé.
    await client.query(`DELETE FROM shifts WHERE schedule_id = $1`, [targetScheduleId]);

    await client.query('DELETE FROM schedule_staff_periods WHERE schedule_id = $1', [targetScheduleId]);
    await client.query('DELETE FROM schedule_staff_assignments WHERE schedule_id = $1', [targetScheduleId]);
    for (const [position, row] of rosterRows.filter((item) => item.userId).entries()) {
      await client.query(
        `INSERT INTO schedule_staff_assignments (schedule_id, user_id, period_start, period_end, position)
         VALUES ($1,$2,$3::date,$4::date,$5)`,
        [targetScheduleId, row.userId, row.periodStart, row.periodEnd, position]
      );
      for (const [periodPosition, period] of row.periods.entries()) {
        await client.query(
          `INSERT INTO schedule_staff_periods (schedule_id, user_id, period_start, period_end, position)
           VALUES ($1,$2,$3::date,$4::date,$5)`,
          [targetScheduleId, row.userId, period.startDate, period.endDate, periodPosition]
        );
      }
    }
  });

  log({
    userId: req.user.id,
    action: scheduleId ? 'schedule_import_update' : 'schedule_import_create',
    category: 'schedule',
    description: `Planning « ${schedName} » ${scheduleId ? 'mis à jour' : 'créé'} via import Excel/CSV (${rosterRows.length} agents, ${dutyDaysCount} journées de service)`,
    entityType: 'schedules',
    entityId: targetScheduleId,
    ipAddress: getIp(req),
  });

  return res.json({
    success: true,
    data: {
      scheduleId: targetScheduleId,
      name: schedName,
      scheduleType,
      totalRows: rosterRows.length,
      dutyDaysCount,
    },
    message: `Planning « ${schedName} » importé avec succès (${rosterRows.length} lignes dans le Tableur).`,
  });
};

// ── GET /api/schedule-builder/import/template ──────────────────────────
const downloadTemplate = async (req, res) => {
  try {
    const { departmentId } = req.query;
    const estId = req.user.establishmentId;
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tableau de Garde');

    // Récupérer le personnel réel du service si departmentId est fourni
    let staffList = [];
    if (departmentId) {
      const staffRes = await query(
        `SELECT u.first_name, u.last_name, u.matricule, u.phone, r.name AS role_name
         FROM users u
         JOIN user_departments ud ON u.id = ud.user_id
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE ud.department_id = $1 AND u.is_active = TRUE AND u.establishment_id = $2
         ORDER BY r.level DESC, u.last_name`,
        [departmentId, estId]
      );
      staffList = staffRes.rows;
    }

    if (staffList.length === 0) {
      staffList = [
        { last_name: 'Ben Ali', first_name: 'Khalil', matricule: 'MED-001', phone: '+216 22 111 222', role_name: 'Médecin' },
        { last_name: 'Hamdi', first_name: 'Sara', matricule: 'INF-002', phone: '+216 25 333 444', role_name: 'Infirmier' },
        { last_name: 'Mansour', first_name: 'Ali', matricule: 'AID-003', phone: '+216 28 555 666', role_name: 'Aide-soignant' },
      ];
    }

    // Générer 14 jours de démonstration à partir de la date courante
    const today = new Date();
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      days.push(`${dd}/${mm}/${d.getFullYear()}`);
    }

    // La colonne « Garde a domicile » est facultative à l'import : elle figure
    // dans le modèle pour être découvrable, mais un fichier qui ne l'a pas
    // s'importe exactement comme avant (tous les agents en présence).
    const headers = ['Nom', 'Prenom', 'Matricule', 'Telephone', 'Role', 'Periodes', 'Garde a domicile', ...days];
    const AT_HOME_COL = 7;

    // Style en-tête
    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell, i) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.font = { color: { argb: 'FFCBD5E1' }, bold: true, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF334155' } } };
    });
    ws.getRow(1).height = 26;

    // Remplissage avec le personnel réel. Une seule notion à saisir : « X » quand
    // l'agent est de service ce jour-là, cellule vide sinon.
    const DUTY_MARK = 'X';
    const DUTY_FILL = 'FFDBEAFE';

    staffList.forEach((person, idx) => {
      // Exemple lisible : un jour de service sur deux, décalé d'un agent à l'autre.
      const sampleShifts = days.map((_, di) => ((idx + di) % 2 === 0 ? DUTY_MARK : ''));
      const sampleAtHome = idx === 1 ? 'Oui' : 'Non';
      const samplePeriods = idx === 1 && days.length >= 4
        ? `${days[0]} au ${days[Math.min(2, days.length - 1)]}; ${days[Math.min(3, days.length - 1)]} au ${days.at(-1)}`
        : `${days[0]} au ${days.at(-1)}`;
      const rowVals = [person.last_name, person.first_name, person.matricule || '', person.phone || '', person.role_name || '', samplePeriods, sampleAtHome, ...sampleShifts];
      const r = ws.addRow(rowVals);
      r.height = 22;
      r.eachCell((cell, colIdx) => {
        cell.font = { size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: colIdx >= AT_HOME_COL ? 'center' : 'left' };
        if (colIdx === AT_HOME_COL) {
          // Colonne « Garde a domicile » : teintée quand elle vaut Oui.
          if (String(cell.value || '').toLowerCase() === 'oui') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
            cell.font = { bold: true, size: 10, color: { argb: 'FF6D28D9' } };
          }
        } else if (colIdx > AT_HOME_COL) {
          if (String(cell.value || '').trim()) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DUTY_FILL } };
            cell.font = { bold: true, size: 10 };
          }
        }
      });
    });

    // Onglet Légende
    const legendWs = wb.addWorksheet('Légende & Instructions');
    legendWs.addRow(['Colonne', 'Intitulé', 'Description']);
    legendWs.getRow(1).font = { bold: true };
    [
      ['X', 'De service', "L'agent est de service ce jour-là. Toute autre marque (1, O, V…) est acceptée."],
      ['Vide', 'Pas de service', "Laissez la cellule vide quand l'agent n'est pas de service."],
      ['', 'Colonnes de jours facultatives', "Si vous ne cochez aucun jour, la « Periodes » de l'agent fait foi : il est de service sur toute sa plage."],
      ['', '', ''],
      ['Periodes', 'Une ou plusieurs plages', 'Exemple : 01/08/2026 au 10/08/2026; 18/08/2026 au 31/08/2026. Séparez les plages par un point-virgule.'],
      ['', 'Période complète', 'Une seule plage couvrant tout le planning reste acceptée.'],
      ['Garde a domicile', 'Colonne facultative', "Oui / 1 / X ⇒ l'agent assure sa garde à domicile (astreinte). Non / vide ⇒ garde à l'hôpital, en présence."],
      ['', 'Compatibilité', "Un fichier sans cette colonne s'importe normalement : tous les agents sont alors en garde à l'hôpital."],
    ].forEach(row => legendWs.addRow(row));

    // Largeurs de colonnes
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 16;
    ws.getColumn(6).width = 42;   // Périodes
    ws.getColumn(7).width = 17;   // Garde a domicile
    for (let i = AT_HOME_COL + 1; i <= headers.length; i++) ws.getColumn(i).width = 13;
    legendWs.getColumn(1).width = 18;
    legendWs.getColumn(2).width = 22;
    legendWs.getColumn(3).width = 88;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_planning_gardes.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Template export error:', err);
    res.status(500).json({ success: false, message: 'Erreur lors de la génération du template Excel' });
  }
};

module.exports = {
  importPreview,
  importConfirm,
  downloadTemplate,
};
