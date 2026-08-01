/**
 * ============================================================
 * IMPORT CONTROLLER — Import Excel / CSV vers Planning
 * ============================================================
 */

const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const { query } = require('../../config/database');
const { detectColumnType } = require('./rules-engine');
const { log, getIp } = require('../history/history.controller');

/**
 * POST /api/schedule-builder/import/preview
 * Upload + parse file → return preview JSON for confirmation
 */
const importPreview = async (req, res) => {
  const estId = req.user.establishmentId;

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Aucun fichier fourni' });
  }

  const { originalname, mimetype, buffer } = req.file;
  const ext = originalname.split('.').pop().toLowerCase();

  let rawData = [];
  let detectedHeaders = [];

  try {
    // ── EXCEL (.xlsx, .xls) ────────────────────────────────
    if (['xlsx', 'xls'].includes(ext)) {
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      rawData = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (rawData.length > 0) {
        detectedHeaders = Object.keys(rawData[0]);
      }
    }
    // ── CSV ────────────────────────────────────────────────
    else if (ext === 'csv') {
      const csvString = buffer.toString('utf-8');
      rawData = parse(csvString, {
        columns: true, skip_empty_lines: true,
        trim: true, bom: true,
      });
      if (rawData.length > 0) {
        detectedHeaders = Object.keys(rawData[0]);
      }
    }
    else {
      return res.status(400).json({
        success: false,
        message: `Format "${ext}" non supporte. Utilisez Excel (.xlsx) ou CSV (.csv).`,
      });
    }
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: `Erreur de lecture du fichier : ${err.message}`,
    });
  }

  if (rawData.length === 0) {
    return res.status(400).json({ success: false, message: 'Le fichier est vide ou ne contient pas de donnees exploitables.' });
  }

  // ── Column detection ───────────────────────────────────
  const columnMappings = [];
  for (const header of detectedHeaders) {
    const detection = await detectColumnType(header, estId);
    columnMappings.push({
      originalHeader: header,
      suggestedCode: detection.suggestedCode || header.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      suggestedType: detection.suggestedType || 'text',
      confidence: detection.confidence || 0,
      sampleValues: rawData.slice(0, 5).map(row => row[header]).filter(v => v !== '' && v != null),
    });
  }

  // ── Staff matching (try to find existing users) ────────
  const staffRes = await query(
    `SELECT id, first_name, last_name, matricule FROM users
     WHERE establishment_id = $1 AND is_active = TRUE`,
    [estId]
  );
  const existingStaff = staffRes.rows;

  // Try to match rows to users
  const matchedRows = rawData.slice(0, 50).map((row, idx) => {
    const firstName = row['Prénom'] || row['Prenom'] || row['prenom'] || row['first_name'] || '';
    const lastName = row['Nom'] || row['nom'] || row['last_name'] || '';
    const matricule = row['Matricule'] || row['matricule'] || row['ID'] || '';

    let matchedUser = null;
    if (matricule) {
      matchedUser = existingStaff.find(u => u.matricule === String(matricule));
    }
    if (!matchedUser && firstName && lastName) {
      matchedUser = existingStaff.find(u =>
        u.first_name.toLowerCase() === firstName.toLowerCase() &&
        u.last_name.toLowerCase() === lastName.toLowerCase()
      );
    }

    return {
      rowIndex: idx,
      data: row,
      matchedUserId: matchedUser?.id || null,
      matchedUserName: matchedUser ? `${matchedUser.first_name} ${matchedUser.last_name}` : null,
      isMatched: !!matchedUser,
    };
  });

  return res.json({
    success: true,
    data: {
      fileName: originalname,
      format: ext,
      totalRows: rawData.length,
      headers: detectedHeaders,
      columnMappings,
      preview: matchedRows,
      matchedCount: matchedRows.filter(r => r.isMatched).length,
      unmatchedCount: matchedRows.filter(r => !r.isMatched).length,
    },
    message: `${rawData.length} lignes detectees dans "${originalname}"`,
  });
};

/**
 * POST /api/schedule-builder/import/confirm
 * Confirm import → create schedule + shifts
 */
const importConfirm = async (req, res) => {
  const estId = req.user.establishmentId;
  const {
    departmentId, name, startDate, endDate,
    shiftTypeId, columnMappings, rows,
  } = req.body;

  if (!departmentId || !startDate || !endDate || !shiftTypeId) {
    return res.status(400).json({ success: false, message: 'departmentId, dates et shiftTypeId requis' });
  }

  // Create schedule
  const schedName = name || `Import — ${new Date().toLocaleDateString('fr-FR')}`;
  const newSched = await query(
    `INSERT INTO schedules
       (establishment_id, department_id, name, start_date, end_date, created_by,
        period_type, creation_mode, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'monthly','spreadsheet',$7)
     RETURNING id`,
    [estId, departmentId, schedName, startDate, endDate, req.user.id,
     JSON.stringify({ importSource: 'file', columnMappings })]
  );
  const scheduleId = newSched.rows[0].id;

  // Insert shifts from matched rows
  let insertedCount = 0;
  let skippedCount = 0;
  for (const row of (rows || [])) {
    if (!row.matchedUserId || !row.shiftDate) {
      skippedCount++;
      continue;
    }
    try {
      await query(
        `INSERT INTO shifts (schedule_id, establishment_id, department_id, user_id, shift_type_id, shift_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [scheduleId, estId, departmentId, row.matchedUserId, shiftTypeId, row.shiftDate, req.user.id]
      );
      insertedCount++;
    } catch { skippedCount++; }
  }

  log({
    userId: req.user.id, action: 'schedule_import', category: 'schedule',
    description: `Planning importe : ${insertedCount} gardes (${skippedCount} ignorees)`,
    entityType: 'schedules', entityId: scheduleId, ipAddress: getIp(req),
  });

  return res.json({
    success: true,
    data: { scheduleId, insertedCount, skippedCount },
    message: `${insertedCount} gardes importees avec succes`,
  });
};

/**
 * GET /api/schedule-builder/import/template
 * Download a pre-filled Excel template
 */
const downloadTemplate = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Planning Template');

    // Header row
    const today = new Date();
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      days.push(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`);
    }
    const headers = ['Nom', 'Prenom', 'Matricule', 'Telephone', 'Role', ...days];

    const headerRow = ws.addRow(headers);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
      cell.font = { color: { argb: 'FFCBD5E1' }, bold: true, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } };
    });
    ws.getRow(1).height = 24;

    // Example rows
    const examples = [
      ['Ben Ali', 'Khalil', 'MED-001', '+216 22 111 222', 'Médecin', 'J', 'N', '', 'J', '', 'G', 'R'],
      ['Hamdi', 'Sara', 'INF-002', '+216 25 333 444', 'Infirmier', '', 'J', 'N', '', 'S', '', ''],
      ['Mansour', 'Ali', 'AID-003', '+216 28 555 666', 'Aide-soignant', 'R', '', 'J', 'N', '', '', 'J'],
    ];
    const shiftColors = { J: 'FFDBEAFE', N: 'FFEDE9FE', S: 'FFD1FAE5', G: 'FFFEF3C7', R: 'FFF3F4F6' };
    examples.forEach((row, ri) => {
      const r = ws.addRow(row);
      r.height = 20;
      r.eachCell((cell, ci) => {
        cell.font = { size: 10 };
        if (ci > 5) { // day cells
          const code = cell.value;
          if (code && shiftColors[code]) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: shiftColors[code] } };
            cell.font = { bold: true, size: 10 };
          }
          cell.alignment = { horizontal: 'center' };
        }
      });
    });

    // Legend sheet
    const legend = wb.addWorksheet('Légende');
    legend.addRow(['Code', 'Signification', 'Description']);
    [['J','Jour','Garde de jour (8h-20h)'], ['N','Nuit','Garde de nuit (20h-8h)'], ['S','Soir','Garde de soir (14h-22h)'], ['G','Garde','Garde générale'], ['R','Repos','Jour de repos']].forEach(r => legend.addRow(r));

    // Column widths
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 12;
    ws.getColumn(3).width = 12;
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 14;
    for (let i = 6; i <= headers.length; i++) ws.getColumn(i).width = 11;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_planning.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Template export error:', err);
    res.status(500).json({ success: false, message: 'Erreur de génération du template' });
  }
};

module.exports = { importPreview, importConfirm, downloadTemplate };

