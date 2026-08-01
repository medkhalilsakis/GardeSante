/**
 * ============================================================
 * EXPORT CONTROLLER — Export Planning vers Excel / PDF
 * ============================================================
 */

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { query } = require('../../config/database');
const { log, getIp } = require('../history/history.controller');

// ── Helpers ───────────────────────────────────────────────────
const getDaysInRange = (start, end) => {
  const days = []; const d = new Date(start);
  while (d <= new Date(end)) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
};

/**
 * GET /api/schedule-builder/:scheduleId/export/excel
 */
const exportExcel = async (req, res) => {
  const { scheduleId } = req.params;
  const estId = req.user.establishmentId;

  // Fetch data
  const sched = await query(
    `SELECT sch.*, d.name AS dept_name, e.name AS est_name
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN establishments e ON sch.establishment_id = e.id
     WHERE sch.id = $1 AND sch.establishment_id = $2`,
    [scheduleId, estId]
  );
  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const schedule = sched.rows[0];

  const shifts = await query(
    `SELECT s.*, u.first_name, u.last_name, u.matricule, u.phone, u.speciality, u.grade,
            r.name AS role_name, st.name AS shift_type_name, st.code AS shift_type_code,
            st.start_time, st.end_time
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN roles r ON u.role_id = r.id
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.schedule_id = $1
     ORDER BY u.last_name, s.shift_date`,
    [scheduleId]
  );

  // Build workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GardeSanté';
  wb.created = new Date();

  const ws = wb.addWorksheet('Planning', {
    properties: { defaultColWidth: 14 },
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  // ── Header section ──────────────────────────────────────
  const days = getDaysInRange(schedule.start_date, schedule.end_date);
  const totalCols = 5 + days.length; // Fixed cols + day cols

  // Title row
  ws.mergeCells(1, 1, 1, totalCols);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${schedule.est_name} — ${schedule.dept_name}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1B4FCA' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Subtitle
  ws.mergeCells(2, 1, 2, totalCols);
  const subCell = ws.getCell(2, 1);
  subCell.value = `Planning des gardes : ${schedule.name} | ${new Date(schedule.start_date).toLocaleDateString('fr-FR')} — ${new Date(schedule.end_date).toLocaleDateString('fr-FR')}`;
  subCell.font = { size: 11, color: { argb: 'FF6B7280' } };
  subCell.alignment = { horizontal: 'center' };

  // Blank row
  ws.getRow(3).height = 8;

  // ── Column headers (row 4) ──────────────────────────────
  const headerRow = ws.getRow(4);
  const fixedHeaders = ['#', 'Nom', 'Prenom', 'Fonction', 'Tel'];
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  const headerFont = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };

  fixedHeaders.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = headerFont;
    cell.fill = headerFill;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF334155' } } };
  });

  days.forEach((day, i) => {
    const cell = headerRow.getCell(6 + i);
    const dow = day.getDay();
    cell.value = day.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    cell.font = { bold: true, size: 9, color: { argb: dow === 0 || dow === 6 ? 'FFEF4444' : 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dow === 0 || dow === 6 ? 'FF312E81' : 'FF1E293B' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getColumn(6 + i).width = 8;
  });

  headerRow.height = 28;

  // ── Data rows ───────────────────────────────────────────
  // Group by user
  const userMap = new Map();
  shifts.rows.forEach(s => {
    if (!userMap.has(s.user_id)) {
      userMap.set(s.user_id, {
        firstName: s.first_name, lastName: s.last_name,
        matricule: s.matricule, phone: s.phone,
        roleName: s.role_name, shifts: {},
      });
    }
    const date = typeof s.shift_date === 'string' ? s.shift_date.split('T')[0] : s.shift_date.toISOString().split('T')[0];
    userMap.get(s.user_id).shifts[date] = s.shift_type_code?.charAt(0) || 'G';
  });

  let rowNum = 5;
  let idx = 1;
  userMap.forEach((person) => {
    const row = ws.getRow(rowNum);
    row.getCell(1).value = idx;
    row.getCell(2).value = person.lastName;
    row.getCell(3).value = person.firstName;
    row.getCell(4).value = person.roleName;
    row.getCell(5).value = person.phone || '';

    // Style fixed cells
    for (let c = 1; c <= 5; c++) {
      const cell = row.getCell(c);
      cell.font = { size: 10 };
      cell.alignment = { vertical: 'middle' };
      if (rowNum % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    }

    // Day cells
    days.forEach((day, i) => {
      const dateStr = day.toISOString().split('T')[0];
      const code = person.shifts[dateStr];
      const cell = row.getCell(6 + i);
      cell.value = code || '';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = { size: 10, bold: !!code, color: { argb: code ? 'FF1B4FCA' : 'FFD1D5DB' } };
      if (code) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
      }
      const dow = day.getDay();
      if ((dow === 0 || dow === 6) && !code) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
      }
    });

    rowNum++;
    idx++;
  });

  // ── Column widths ───────────────────────────────────────
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 12;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 14;

  // ── Send response ───────────────────────────────────────
  const fileName = `Planning_${schedule.dept_name.replace(/[^a-zA-Z0-9]/g, '_')}_${schedule.start_date}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  await wb.xlsx.write(res);

  log({
    userId: req.user.id, action: 'schedule_export_excel', category: 'schedule',
    description: `Export Excel : ${schedule.name}`,
    entityType: 'schedules', entityId: scheduleId, ipAddress: getIp(req),
  });

  res.end();
};

/**
 * GET /api/schedule-builder/:scheduleId/export/pdf
 */
const exportPDF = async (req, res) => {
  const { scheduleId } = req.params;
  const estId = req.user.establishmentId;

  const sched = await query(
    `SELECT sch.*, d.name AS dept_name, e.name AS est_name
     FROM schedules sch
     JOIN departments d ON sch.department_id = d.id
     JOIN establishments e ON sch.establishment_id = e.id
     WHERE sch.id = $1 AND sch.establishment_id = $2`,
    [scheduleId, estId]
  );
  if (!sched.rows[0]) return res.status(404).json({ success: false, message: 'Planning introuvable' });
  const schedule = sched.rows[0];

  const shifts = await query(
    `SELECT s.*, u.first_name, u.last_name, u.matricule, u.phone,
            r.name AS role_name, st.name AS shift_type_name, st.code AS shift_type_code,
            st.start_time, st.end_time
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     JOIN roles r ON u.role_id = r.id
     JOIN shift_types st ON s.shift_type_id = st.id
     WHERE s.schedule_id = $1
     ORDER BY u.last_name, s.shift_date`,
    [scheduleId]
  );

  const days = getDaysInRange(schedule.start_date, schedule.end_date);

  // Group by user
  const userMap = new Map();
  shifts.rows.forEach(s => {
    if (!userMap.has(s.user_id)) {
      userMap.set(s.user_id, {
        firstName: s.first_name, lastName: s.last_name,
        roleName: s.role_name, shifts: {},
      });
    }
    const date = typeof s.shift_date === 'string' ? s.shift_date.split('T')[0] : s.shift_date.toISOString().split('T')[0];
    userMap.get(s.user_id).shifts[date] = s.shift_type_code?.charAt(0) || 'G';
  });
  const users = [...userMap.values()];

  // ── Build PDF ───────────────────────────────────────────
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const fileName = `Planning_${schedule.dept_name.replace(/[^a-zA-Z0-9]/g, '_')}_${schedule.start_date}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  doc.pipe(res);

  // Title
  doc.fontSize(16).fillColor('#1B4FCA')
    .text(schedule.est_name, { align: 'center' });
  doc.fontSize(12).fillColor('#374151')
    .text(`${schedule.dept_name} — Planning des gardes`, { align: 'center' });
  doc.fontSize(9).fillColor('#6B7280')
    .text(`${new Date(schedule.start_date).toLocaleDateString('fr-FR')} — ${new Date(schedule.end_date).toLocaleDateString('fr-FR')}`, { align: 'center' });
  doc.moveDown(0.8);

  // Table
  const startX = 30;
  const startY = doc.y;
  const colWidths = { num: 20, name: 80, role: 70 };
  const dayColW = Math.min(22, (doc.page.width - 60 - colWidths.num - colWidths.name - colWidths.role) / days.length);
  const rowH = 16;

  // Header
  doc.rect(startX, startY, doc.page.width - 60, rowH).fill('#1E293B');
  doc.fillColor('#FFFFFF').fontSize(7);
  doc.text('#', startX + 2, startY + 4, { width: colWidths.num });
  doc.text('Nom Prenom', startX + colWidths.num + 2, startY + 4, { width: colWidths.name });
  doc.text('Fonction', startX + colWidths.num + colWidths.name + 2, startY + 4, { width: colWidths.role });

  days.forEach((day, i) => {
    const x = startX + colWidths.num + colWidths.name + colWidths.role + i * dayColW;
    const dow = day.getDay();
    const label = day.getDate().toString();
    doc.fillColor(dow === 0 || dow === 6 ? '#EF4444' : '#FFFFFF');
    doc.text(label, x, startY + 4, { width: dayColW, align: 'center' });
  });

  // Rows
  let y = startY + rowH;
  users.forEach((person, idx) => {
    if (y + rowH > doc.page.height - 40) {
      doc.addPage();
      y = 30;
    }

    if (idx % 2 === 0) {
      doc.rect(startX, y, doc.page.width - 60, rowH).fill('#F8FAFC');
    }

    doc.fillColor('#1F2937').fontSize(7);
    doc.text(String(idx + 1), startX + 2, y + 4, { width: colWidths.num });
    doc.text(`${person.lastName} ${person.firstName}`, startX + colWidths.num + 2, y + 4, { width: colWidths.name });
    doc.text(person.roleName, startX + colWidths.num + colWidths.name + 2, y + 4, { width: colWidths.role });

    days.forEach((day, i) => {
      const dateStr = day.toISOString().split('T')[0];
      const code = person.shifts[dateStr];
      const x = startX + colWidths.num + colWidths.name + colWidths.role + i * dayColW;
      doc.fillColor(code ? '#1B4FCA' : '#D1D5DB').fontSize(8);
      doc.text(code || '—', x, y + 3, { width: dayColW, align: 'center' });
    });

    y += rowH;
  });

  // Footer
  doc.fontSize(7).fillColor('#9CA3AF')
    .text(`Genere par GardeSante le ${new Date().toLocaleDateString('fr-FR')} a ${new Date().toLocaleTimeString('fr-FR')}`,
      30, doc.page.height - 25, { align: 'center' });

  doc.end();

  log({
    userId: req.user.id, action: 'schedule_export_pdf', category: 'schedule',
    description: `Export PDF : ${schedule.name}`,
    entityType: 'schedules', entityId: scheduleId, ipAddress: getIp(req),
  });
};

module.exports = { exportExcel, exportPDF };
