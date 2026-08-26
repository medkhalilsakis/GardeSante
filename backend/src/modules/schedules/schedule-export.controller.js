const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { query } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');
const { normalizePeriods } = require('./periods');
// Règle de lecture unique du tableur : « de service / pas de service ».
const { rowOnDuty } = require('./spreadsheet-reader');

const dateKey = (value) => {
  if (!value) return '';
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const datesBetween = (start, end) => {
  const result = [];
  const cursor = new Date(`${dateKey(start)}T12:00:00`);
  const last = new Date(`${dateKey(end)}T12:00:00`);
  while (cursor <= last) {
    result.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
};

const displayDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
const safeName = (value) => String(value || 'planning').replace(/[^a-zA-Z0-9_-]/g, '_');
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

async function loadSpreadsheet(scheduleId, establishmentId) {
  const scheduleResult = await query(
    `SELECT sch.*, d.name AS dept_name, e.name AS est_name
       FROM schedules sch
       JOIN departments d ON d.id = sch.department_id
       JOIN establishments e ON e.id = sch.establishment_id
      WHERE sch.id = $1 AND sch.establishment_id = $2`,
    [scheduleId, establishmentId]
  );
  const schedule = scheduleResult.rows[0];
  if (!schedule) return null;

  const shiftResult = await query(
    `SELECT s.user_id, s.shift_date::text, st.code AS shift_code,
            u.first_name, u.last_name, u.phone, u.matricule, r.name AS role_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN roles r ON r.id = u.role_id
       JOIN shift_types st ON st.id = s.shift_type_id
      WHERE s.schedule_id = $1
      ORDER BY u.last_name, u.first_name, s.shift_date`,
    [scheduleId]
  );

  const metadata = schedule.metadata || {};
  // An explicit rows array, including [], is authoritative for the Tableur.
  const hasSpreadsheet = Array.isArray(metadata.spreadsheet?.rows);
  const savedRows = hasSpreadsheet ? metadata.spreadsheet.rows : [];
  const customColumns = Array.isArray(metadata.spreadsheet?.customCols) ? metadata.spreadsheet.customCols : [];
  const configuredDates = metadata.special_days_only && Array.isArray(metadata.special_dates)
    ? metadata.special_dates.map(dateKey).filter(Boolean)
    : null;
  const dates = configuredDates?.length ? [...new Set(configuredDates)].sort() : datesBetween(schedule.start_date, schedule.end_date);

  const rowsByPerson = new Map();
  const addRow = (source, fallback = {}) => {
    const personId = source.userId || source.user_id || source.id || source.matricule || `${source.lastName || source.last_name}-${source.firstName || source.first_name}`;
    if (!personId || rowsByPerson.has(personId)) return;
    rowsByPerson.set(personId, {
      personId,
      lastName: source.lastName || source.last_name || fallback.last_name || '',
      firstName: source.firstName || source.first_name || fallback.first_name || '',
      phone: source.phone || fallback.phone || '',
      matricule: source.matricule || fallback.matricule || '',
      roleName: source.roleName || source.role_name || fallback.role_name || '',
      periods: normalizePeriods(source, dateKey(schedule.start_date), dateKey(schedule.end_date)),
      periodStart: dateKey(source.periodStart || source.period_start) || dateKey(schedule.start_date),
      periodEnd: dateKey(source.periodEnd || source.period_end) || dateKey(schedule.end_date),
      shiftStart: source.shiftStart || '07:00',
      shiftEnd: source.shiftEnd || '07:00',
      custom: source.custom || {},
      shifts: { ...(source.shifts || {}) },
    });
  };

  savedRows.forEach(row => addRow(row));
  if (!hasSpreadsheet) {
    shiftResult.rows.forEach(shift => addRow({ userId: shift.user_id }, shift));
    shiftResult.rows.forEach(shift => {
      const target = rowsByPerson.get(shift.user_id);
    // Le tableur n'alimente plus `shifts` ; les lignes héritées restent lues et
    // valent « de service » ce jour-là, sans plus aucune notion de code.
      if (target) target.shifts[dateKey(shift.shift_date)] = true;
    });
  }

  return { schedule, dates, rows: [...rowsByPerson.values()], customColumns };
}

const isSpecialSchedule = schedule => schedule.schedule_type === 'special_weekend_holiday'
  || schedule.metadata?.schedule_kind === 'weekend_holiday'
  || schedule.metadata?.special_days_only === true;

/** Marque portée par une colonne de jour : « X » quand l'agent est de service. */
const DUTY_MARK = 'X';

/**
 * Contexte d'arbitrage d'un planning, à passer à `rowOnDuty`.
 *
 * Gain au passage : jusqu'ici ces colonnes ne montraient que les cases codées,
 * donc restaient vides pour tout planning exprimé par périodes — c'est-à-dire la
 * quasi-totalité. Elles portent désormais les bonnes journées.
 */
const dutyContext = schedule => ({
  isSpecial: isSpecialSchedule(schedule),
  scheduleStart: dateKey(schedule.start_date),
  scheduleEnd: dateKey(schedule.end_date),
});

const dutyCell = (row, date, context) => (rowOnDuty(row, date, context) ? DUTY_MARK : '');

function spreadsheetHeaders(customColumns, dates, schedule) {
  return [
    '#', 'Nom', 'Prénom', 'Tél', 'Matricule', 'Fonction',
    ...(isSpecialSchedule(schedule) ? [] : ['Périodes']),
    'Durée - début', 'Durée - fin',
    ...customColumns.map(column => column.label || column.name || column.key),
    ...dates.map(displayDate),
  ];
}

function spreadsheetValues(data) {
  const { rows, customColumns, dates, schedule } = data;
  const context = dutyContext(schedule);
  return rows.map((row, index) => [
    index + 1, row.lastName, row.firstName, row.phone, row.matricule, row.roleName,
    ...(isSpecialSchedule(schedule) ? [] : [row.periods.map(period => `${period.startDate} au ${period.endDate}`).join('; ')]),
    row.shiftStart, row.shiftEnd,
    ...customColumns.map(column => row.custom?.[column.key] || ''),
    ...dates.map(date => dutyCell(row, date, context)),
  ]);
}

async function exportExcel(req, res) {
  const data = await loadSpreadsheet(req.params.scheduleId, req.user.establishmentId);
  if (!data) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const { schedule, dates, rows, customColumns } = data;
  const headers = spreadsheetHeaders(customColumns, dates, schedule);
  const values = spreadsheetValues(data);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GardeSante';
  const sheet = workbook.addWorksheet('Tableur de garde', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = `${schedule.est_name} - ${schedule.dept_name}`;
  sheet.getCell(1, 1).font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(1, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4FCA' } };
  sheet.getCell(1, 1).alignment = { horizontal: 'center' };
  sheet.mergeCells(2, 1, 2, headers.length);
  sheet.getCell(2, 1).value = `${schedule.name} | ${dateKey(schedule.start_date)} au ${dateKey(schedule.end_date)}`;
  sheet.getCell(2, 1).alignment = { horizontal: 'center' };
  sheet.getRow(4).values = headers;
  sheet.getRow(4).height = 30;
  sheet.getRow(4).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  values.forEach(value => sheet.addRow(value));
  for (let rowNumber = 5; rowNumber < 5 + values.length; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 20;
    row.eachCell(cell => {
      cell.alignment = { vertical: 'middle', horizontal: cell.col > 10 + customColumns.length ? 'center' : 'left' };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } };
      if (rowNumber % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    });
  }
  const widths = [5, 16, 16, 15, 14, 20, ...(isSpecialSchedule(schedule) ? [] : [34]), 14, 14, ...customColumns.map(() => 16), ...dates.map(() => 9)];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.views = [{ state: 'frozen', ySplit: 4, xSplit: 2 }];
  const filename = `Tableur_${safeName(schedule.name)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
  log({ userId: req.user.id, action: 'schedule_export_excel', category: 'schedule', description: `Export Excel : ${schedule.name}`, entityType: 'schedules', entityId: req.params.scheduleId, ipAddress: getIp(req) });
}

async function exportCSV(req, res) {
  const data = await loadSpreadsheet(req.params.scheduleId, req.user.establishmentId);
  if (!data) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const content = [spreadsheetHeaders(data.customColumns, data.dates, data.schedule), ...spreadsheetValues(data)]
    .map(row => row.map(csvCell).join(';')).join('\r\n');
  const filename = `Tableur_${safeName(data.schedule.name)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${content}`);
  log({ userId: req.user.id, action: 'schedule_export_csv', category: 'schedule', description: `Export CSV : ${data.schedule.name}`, entityType: 'schedules', entityId: req.params.scheduleId, ipAddress: getIp(req) });
}

function drawTableHeader(doc, x, y, columns) {
  doc.rect(x, y, columns.reduce((sum, col) => sum + col.width, 0), 22).fill('#1E293B');
  let cursor = x;
  columns.forEach(col => {
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(6.5).text(col.label, cursor + 2, y + 7, { width: col.width - 4, align: 'center', lineBreak: false });
    cursor += col.width;
  });
}

async function exportPDF(req, res) {
  const data = await loadSpreadsheet(req.params.scheduleId, req.user.establishmentId);
  if (!data) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const { schedule, dates, rows, customColumns } = data;
  const fixed = [
    { key: 'index', label: '#', width: 18 }, { key: 'lastName', label: 'Nom', width: 62 }, { key: 'firstName', label: 'Prénom', width: 58 },
    { key: 'phone', label: 'Tél', width: 58 }, { key: 'matricule', label: 'Matricule', width: 54 }, { key: 'roleName', label: 'Fonction', width: 70 },
    ...(isSpecialSchedule(schedule) ? [] : [{ key: 'periods', label: 'Périodes', width: 92 }]),
    { key: 'shiftStart', label: 'H. début', width: 42 }, { key: 'shiftEnd', label: 'H. fin', width: 42 },
    ...customColumns.map(column => ({ key: `custom:${column.key}`, label: column.label || column.key, width: 60 })),
  ];
  const dateColumns = dates.map(date => ({ key: `date:${date}`, label: displayDate(date).replace(/\s/g, '\n'), width: 30 }));
  const columns = [...fixed, ...dateColumns];
  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0);
  const pageWidth = Math.max(842, Math.min(2000, tableWidth + 48));
  const doc = new PDFDocument({ size: [pageWidth, 595], layout: 'landscape', margin: 24 });
  const filename = `Tableur_${safeName(schedule.name)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  const drawPage = (startY) => {
    doc.fillColor('#1B4FCA').font('Helvetica-Bold').fontSize(15).text(schedule.est_name, 24, 22, { width: pageWidth - 48, align: 'center' });
    doc.fillColor('#334155').fontSize(10).text(`${schedule.dept_name} - ${schedule.name}`, 24, 42, { width: pageWidth - 48, align: 'center' });
    doc.fillColor('#64748B').font('Helvetica').fontSize(8).text(`${dateKey(schedule.start_date)} au ${dateKey(schedule.end_date)} | ${rows.length} personnel(s)`, 24, 57, { width: pageWidth - 48, align: 'center' });
    drawTableHeader(doc, 24, startY, columns);
  };
  const context = dutyContext(schedule);
  let y = 88;
  drawPage(y);
  y += 22;
  rows.forEach((row, index) => {
    if (y + 20 > 565) { doc.addPage(); y = 88; drawPage(y); y += 22; }
    if (index % 2 === 0) doc.rect(24, y, tableWidth, 20).fill('#F8FAFC');
    let x = 24;
    columns.forEach(column => {
      let value = '';
      if (column.key === 'index') value = String(index + 1);
      else if (column.key.startsWith('custom:')) value = row.custom?.[column.key.slice(7)] || '';
      else if (column.key.startsWith('date:')) value = dutyCell(row, column.key.slice(5), context);
      else if (column.key === 'periods') value = row.periods.map(period => `${period.startDate} au ${period.endDate}`).join('; ');
      else value = row[column.key] || '';
      doc.fillColor(column.key.startsWith('date:') && value ? '#1B4FCA' : '#1F2937').font(value && column.key.startsWith('date:') ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.5)
        .text(String(value), x + 2, y + 7, { width: column.width - 4, align: column.key.startsWith('date:') ? 'center' : 'left', lineBreak: false });
      x += column.width;
    });
    y += 20;
  });
  doc.end();
  log({ userId: req.user.id, action: 'schedule_export_pdf', category: 'schedule', description: `Export PDF : ${schedule.name}`, entityType: 'schedules', entityId: req.params.scheduleId, ipAddress: getIp(req) });
}

async function exportDetailedCalendarPDF(req, res) {
  const data = await loadSpreadsheet(req.params.scheduleId, req.user.establishmentId);
  if (!data) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const { schedule, dates, rows } = data;
  const palette = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DB2777', '#0891B2', '#4F46E5', '#EA580C', '#0D9488', '#DC2626'];
  const personnel = rows.map((row, index) => ({ ...row, color: palette[index % palette.length] }));
  const context = dutyContext(schedule);
  const pageWidth = Math.min(1800, Math.max(842, dates.length > 30 ? 1500 : 1120));
  const doc = new PDFDocument({ size: [pageWidth, 595], layout: 'landscape', margin: 24 });
  const filename = `Calendrier_detaille_${safeName(schedule.name)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  const columns = pageWidth >= 1400 ? 4 : 3;
  const gap = 12;
  const cardWidth = (pageWidth - 48 - gap * (columns - 1)) / columns;
  const cardHeight = 112;
  const drawHeader = () => {
    doc.fillColor('#1B4FCA').font('Helvetica-Bold').fontSize(16).text('Calendrier détaillé des gardes', 24, 22, { width: pageWidth - 48, align: 'center' });
    doc.fillColor('#475569').font('Helvetica').fontSize(9).text(`${schedule.dept_name} - ${schedule.name} | ${dateKey(schedule.start_date)} au ${dateKey(schedule.end_date)}`, 24, 43, { width: pageWidth - 48, align: 'center' });
    let lx = 24;
    personnel.slice(0, 14).forEach(person => {
      doc.circle(lx + 4, 67, 4).fill(person.color);
      doc.fillColor('#334155').fontSize(7).text(`${person.lastName} ${person.firstName}`.trim(), lx + 11, 63, { width: 82, lineBreak: false });
      lx += 94;
    });
  };
  drawHeader();
  let y = 84;
  dates.forEach((date, index) => {
    const column = index % columns;
    if (column === 0 && y + cardHeight > 570) { doc.addPage(); drawHeader(); y = 84; }
    const x = 24 + column * (cardWidth + gap);
    const assigned = personnel.filter(person => rowOnDuty(person, date, context));
    doc.roundedRect(x, y, cardWidth, cardHeight, 8).fillAndStroke('#F8FAFC', '#CBD5E1');
    doc.fillColor('#1E293B').font('Helvetica-Bold').fontSize(10).text(displayDate(date), x + 10, y + 10);
    doc.fillColor('#64748B').font('Helvetica').fontSize(7).text(`${assigned.length} agent(s) affecté(s)`, x + 10, y + 25);
    assigned.slice(0, 5).forEach((person, rowIndex) => {
      const py = y + 43 + rowIndex * 12;
      doc.circle(x + 14, py + 3, 4).fill(person.color);
      doc.fillColor('#1F2937').font('Helvetica-Bold').fontSize(7).text(`${person.lastName} ${person.firstName}`.trim(), x + 23, py, { width: cardWidth - 68, lineBreak: false });
      doc.fillColor('#1B4FCA').fontSize(7).text(DUTY_MARK, x + cardWidth - 28, py, { width: 18, align: 'center' });
    });
    if (assigned.length > 5) doc.fillColor('#64748B').fontSize(7).text(`+ ${assigned.length - 5} autre(s)`, x + 10, y + 101);
    if (column === columns - 1) y += cardHeight + gap;
  });
  doc.end();
  log({ userId: req.user.id, action: 'schedule_export_detailed_calendar_pdf', category: 'schedule', description: `Export calendrier détaillé PDF : ${schedule.name}`, entityType: 'schedules', entityId: req.params.scheduleId, ipAddress: getIp(req) });
}

module.exports = { exportExcel, exportCSV, exportPDF, exportDetailedCalendarPDF };
