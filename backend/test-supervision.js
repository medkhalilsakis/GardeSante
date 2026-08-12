/**
 * Test d'intégration du module Supervision hôpital (Lot 5).
 * Contrôleurs appelés avec req/res mockés — même approche que la suite
 * du journal, le mot de passe HTTP n'étant pas connu.
 *
 * Écrit puis nettoie ses propres lignes : aucun résidu en base.
 */
const { query } = require('./src/config/database');
const supervision = require('./src/modules/supervision/supervision.controller');
const staffLoans = require('./src/modules/schedules/staff-loans.controller');

const EST  = 'ffc0c07f-602d-4385-a673-16852c5350c1';
const DEPT = 'b057cb4b-14ac-4491-a0cd-74173a52a60c';

const USERS = {
  surveillant: { id: '7758b79f-a3f4-4408-b9d7-f5726721ea57', roleCode: 'service_supervisor' },
  chef:        { id: 'e28f0306-d18e-4a45-a33c-f36f27f99285', roleCode: 'department_head' },
  sg:          { id: '2c9b8cc3-0799-4883-be0e-136b7def5836', roleCode: 'general_supervisor' },
  directeur:   { id: '822a5d5f-dc83-4d8c-84f0-abbb25d17069', roleCode: 'director' },
  resident:    { id: 'f8af5867-57eb-4aa6-ad5e-d63c9ff5693d', roleCode: 'resident' },
};

const asUser = (key, extra = {}) => ({
  ...USERS[key],
  firstName: 'Test', lastName: 'Supervision',
  establishmentId: EST,
  departmentId: DEPT,
  isSuperAdmin: false,
  ...extra,
});

const mockReq = (userKey, { body = {}, query: q = {}, extra = {} } = {}) => ({
  user: userKey === 'superadmin'
    ? { id: USERS.directeur.id, roleCode: 'super_admin', isSuperAdmin: true, establishmentId: EST }
    : asUser(userKey, extra),
  body, params: {}, query: q,
  headers: { 'user-agent': 'test-supervision' },
  app: { get: () => null },          // io absent → emit silencieux
  ip: '127.0.0.1',
  connection: { remoteAddress: '127.0.0.1' },
});

const mockRes = () => {
  const r = { statusCode: 200, payload: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (p) => { r.payload = p; return r; };
  return r;
};

const call = async (fn, userKey, opts) => {
  const req = mockReq(userKey, opts);
  const res = mockRes();
  await fn(req, res);
  return res;
};

let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

const dayOffset = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const cleanup = { departments: [], schedules: [], absences: [] };
(async () => {
  console.log('\n=== SUPERVISION HÔPITAL — Lot 5 ===\n');

  // ── 1. Gating de rôle ─────────────────────────────────────────
  console.log('1. Gating de rôle');
  const endpoints = [
    ['overview',  supervision.getOverview],
    ['schedules', supervision.listSchedules],
    ['conflicts', supervision.listConflicts],
    ['loans',     supervision.listLoans],
  ];

  for (const [name, fn] of endpoints) {
    const r = await call(fn, 'resident');
    check(`${name} — résident refusé (403)`, r.statusCode === 403, `reçu ${r.statusCode}`);
  }
  const chefSched = await call(supervision.listSchedules, 'chef');
  check('schedules — chef de service refusé (403)', chefSched.statusCode === 403, `reçu ${chefSched.statusCode}`);
  const survSched = await call(supervision.listSchedules, 'surveillant');
  check('schedules — surveillant de service refusé (403)', survSched.statusCode === 403, `reçu ${survSched.statusCode}`);

  for (const [name, fn] of endpoints) {
    const r = await call(fn, 'sg');
    check(`${name} — surveillant général autorisé (200)`, r.statusCode === 200 && r.payload?.success === true, `reçu ${r.statusCode}`);
  }
  const dirOv = await call(supervision.getOverview, 'directeur');
  check('overview — directeur autorisé (200)', dirOv.statusCode === 200);
  const saOv = await call(supervision.getOverview, 'superadmin', { query: { establishmentId: EST } });
  check('overview — super admin ciblant un hôpital (200)', saOv.statusCode === 200 && saOv.payload?.data?.scopeLabel);

  // ── 2. Plannings reçus ────────────────────────────────────────
  console.log('\n2. Plannings soumis à la supervision');
  const sched = await call(supervision.listSchedules, 'sg');
  const list = sched.payload.data.schedules;
  check('au moins un planning remonté', list.length > 0, `${list.length}`);
  check('aucun brouillon dans la liste', list.every((s) => s.status !== 'draft'));
  const STATES = ['soumis', 'en_cours', 'termine'];
  check('état dérivé valide sur chaque ligne', list.every((s) => STATES.includes(s.state)),
    JSON.stringify(list.map((s) => s.state)));
  check('volumétrie lue depuis le tableur', list.every((s) => Number.isInteger(s.guardCount) && Number.isInteger(s.staffCount)));
  check('compteur de propositions présent', list.every((s) => Number.isInteger(s.pendingProposals)));

  const filtered = await call(supervision.listSchedules, 'sg', { query: { departmentId: DEPT } });
  check('filtre par service appliqué', filtered.payload.data.schedules.every((s) => s.departmentId === DEPT));
  const badDept = await call(supervision.listSchedules, 'sg', { query: { departmentId: '00000000-0000-0000-0000-000000000000' } });
  check('service inconnu → liste vide', badDept.payload.data.schedules.length === 0);
  const stateFilter = await call(supervision.listSchedules, 'sg', { query: { state: 'soumis' } });
  check('filtre par état appliqué', stateFilter.payload.data.schedules.every((s) => s.state === 'soumis'));
  // ── 3. Cohérence inter-services (données synthétiques) ────────
  console.log('\n3. Détection des conflits');
  const base = await call(supervision.listConflicts, 'sg');
  check('analyse renvoyée sans planning synthétique', base.statusCode === 200 && Array.isArray(base.payload.data.conflicts));

  const agent = USERS.surveillant.id;
  const clash = dayOffset(2);
  const sheet = (userId, date) => ({
    schedule_kind: 'normal',
    spreadsheet: {
      rows: [{
        id: `row-${userId}`, userId, isNew: false, isProposedNewRow: false,
        firstName: '[TEST]', lastName: 'Supervision', roleName: 'Surveillant de Service',
        deptId: null, custom: {}, shifts: { [date]: 'G' },
      }],
      savedAt: new Date().toISOString(),
    },
  });

  // Deux services distincts, même agent, même jour → double affectation.
  const deptB = await query(
    `INSERT INTO departments (establishment_id, code, name, is_active)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    [EST, 'TESTSUP', '[TEST] Service supervision']
  );
  cleanup.departments.push(deptB.rows[0].id);

  for (const deptId of [DEPT, deptB.rows[0].id]) {
    const ins = await query(
      `INSERT INTO schedules (establishment_id, department_id, name, start_date, end_date,
                              status, created_by, metadata)
       VALUES ($1, $2, $3, $4::date, $5::date, 'submitted', $6, $7::jsonb) RETURNING id`,
      [EST, deptId, '[TEST] Planning supervision', dayOffset(0), dayOffset(5),
       USERS.chef.id, JSON.stringify(sheet(agent, clash))]
    );
    cleanup.schedules.push(ins.rows[0].id);
  }

  const leaveType = await query(
    `SELECT id FROM absence_types WHERE establishment_id = $1
     ORDER BY is_leave DESC NULLS LAST LIMIT 1`,
    [EST]
  );
  check('un type d\'absence est seedé (migration 019)', leaveType.rows.length === 1);

  if (leaveType.rows.length) {
    const abs = await query(
      `INSERT INTO absences (establishment_id, department_id, user_id, absence_type_id,
                             start_date, end_date, kind, status, declared_by, reason)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, 'leave', 'approved', $7, $8) RETURNING id`,
      [EST, DEPT, agent, leaveType.rows[0].id, dayOffset(0), dayOffset(3),
       USERS.directeur.id, '[TEST] congé supervision']
    );
    cleanup.absences.push(abs.rows[0].id);
  }

  const after = await call(supervision.listConflicts, 'sg');
  const found = after.payload.data.conflicts;
  const mine = found.filter((c) => c.userId === agent && c.date === clash);
  check('double affectation détectée', mine.some((c) => c.type === 'double_booking'),
    JSON.stringify(mine.map((c) => c.type)));
  check('double affectation notée critique', mine.filter((c) => c.type === 'double_booking').every((c) => c.severity === 'critical'));
  check('les deux services sont nommés dans le détail',
    mine.some((c) => c.type === 'double_booking' && c.detail.includes('[TEST] Service supervision')));
  check('garde pendant un congé détectée (règle I)', mine.some((c) => c.type === 'on_leave'),
    JSON.stringify(mine.map((c) => c.type)));
  const uncovered = found.filter((c) => c.type === 'uncovered_day' && c.detail.includes('[TEST] Planning supervision'));
  check('journées sans garde détectées', uncovered.length === 2, `${uncovered.length} planning(s)`);
  check('plus de 3 journées vides → gravité error', uncovered.every((c) => c.severity === 'error'));
  const order = { critical: 0, error: 1, warning: 2, info: 3 };
  check('conflits triés par gravité', found.every((c, i) => i === 0 || order[found[i - 1].severity] <= order[c.severity]));
  check('résumé cohérent avec la liste',
    after.payload.data.summary.total === found.length
    && after.payload.data.summary.critical === found.filter((c) => c.severity === 'critical').length);
  // ── 4. Supervision de tous les services ───────────────────────
  console.log('\n4. Vue d\'ensemble');
  const ov = (await call(supervision.getOverview, 'sg')).payload.data;
  check('libellé de portée renseigné', typeof ov.scopeLabel === 'string' && ov.scopeLabel.length > 0, ov.scopeLabel);
  check('date du jour au format ISO court', /^\d{4}-\d{2}-\d{2}$/.test(ov.today), ov.today);
  const KPIS = ['departments', 'departmentsCovered', 'guardsToday', 'staffOnDutyToday',
    'schedulesSubmitted', 'schedulesActive', 'leavesToday', 'shiftAbsencesToday', 'latesToday',
    'incidentsToday', 'reinforcementsToday', 'openAlerts', 'criticalAlerts',
    'replacementsPending', 'replacementsConfirmed', 'loansPending'];
  check('les 16 indicateurs sont des entiers',
    KPIS.every((k) => Number.isInteger(ov.summary[k])),
    KPIS.filter((k) => !Number.isInteger(ov.summary[k])).join(', '));
  check('le service de test remonte dans les services',
    ov.departments.some((d) => d.name === '[TEST] Service supervision'));
  check('couverture ≤ nombre de services', ov.summary.departmentsCovered <= ov.summary.departments);
  check('congé du jour compté', ov.summary.leavesToday >= 1, `${ov.summary.leavesToday}`);
  check('agents de garde ≤ gardes du jour', ov.summary.staffOnDutyToday <= ov.summary.guardsToday);

  // ── 5. Prêts de personnel ─────────────────────────────────────
  console.log('\n5. Prêts de personnel (lecture seule)');
  const loans = (await call(supervision.listLoans, 'sg')).payload.data;
  check('liste des prêts renvoyée', Array.isArray(loans.loans));
  check('résumé des prêts cohérent', loans.summary.total === loans.loans.length);
  const badStatus = await call(supervision.listLoans, 'sg', { query: { status: 'inexistant' } });
  check('filtre par statut appliqué', badStatus.payload.data.loans.length === 0);
  check('aucune écriture exposée sur les prêts',
    !Object.keys(supervision).some((k) => /respond|approve|reject|decide/i.test(k)),
    Object.keys(supervision).join(', '));
  if (typeof staffLoans.listLoans === 'function') {
    const own = await call(staffLoans.listLoans, 'sg');
    check('le contrôleur Lot 1 reste inchangé (SG hors demandeur/propriétaire)',
      own.statusCode === 200, `reçu ${own.statusCode}`);
  }

  // ── 6. Rapport à la direction ─────────────────────────────────
  console.log('\n6. Transmission d\'un rapport');
  const noTitle = await call(supervision.sendReport, 'sg', { body: { summary: 'sans titre' } });
  check('titre obligatoire (400)', noTitle.statusCode === 400, `reçu ${noTitle.statusCode}`);
  const denied = await call(supervision.sendReport, 'resident', { body: { title: '[TEST] refus' } });
  check('résident refusé (403)', denied.statusCode === 403, `reçu ${denied.statusCode}`);

  const before = await query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'supervision_report'`
  );
  const sent = await call(supervision.sendReport, 'sg', {
    body: { title: '[TEST] Rapport de couverture', summary: '[TEST] synthèse', priority: 'urgent' },
  });
  check('rapport transmis (201)', sent.statusCode === 201, `reçu ${sent.statusCode} ${JSON.stringify(sent.payload)}`);
  const notifs = await query(
    `SELECT priority, title FROM notifications
     WHERE type = 'supervision_report' AND title LIKE '%[TEST]%'`
  );
  check('une notification par destinataire', notifs.rows.length >= 1
    && notifs.rows.length === (await query(`SELECT COUNT(*)::int AS n FROM notifications WHERE type = 'supervision_report'`)).rows[0].n - before.rows[0].n,
    `${notifs.rows.length}`);
  check('priorité urgente respectée', notifs.rows.every((r) => r.priority === 'urgent'));
  const logged = await query(
    `SELECT COUNT(*)::int AS n FROM activity_logs
     WHERE action = 'supervision_report_sent' AND user_agent = 'test-supervision'`
  );
  check('action tracée dans l\'historique immuable', logged.rows[0].n === 1, `${logged.rows[0].n}`);
  // ── 7. Invariants ─────────────────────────────────────────────
  console.log('\n7. Invariants');
  const shifts = await query('SELECT COUNT(*)::int AS n FROM shifts');
  check('table shifts toujours vide (aucune écriture)', shifts.rows[0].n === 0, `${shifts.rows[0].n} ligne(s)`);
  const routes = require('fs').readFileSync('./src/modules/supervision/supervision.routes.js', 'utf8');
  check('une seule route d\'écriture (le rapport)', (routes.match(/router\.(post|put|patch|delete)/g) || []).length === 1);
  check('aucune route de confirmation de remplacement', !/replacement/i.test(routes));

  // ── 8. Nettoyage ──────────────────────────────────────────────
  console.log('\n8. Nettoyage');
  if (cleanup.absences.length) {
    await query('DELETE FROM absences WHERE id = ANY($1::uuid[])', [cleanup.absences]);
  }
  if (cleanup.schedules.length) {
    await query('DELETE FROM schedules WHERE id = ANY($1::uuid[])', [cleanup.schedules]);
  }
  if (cleanup.departments.length) {
    await query('DELETE FROM departments WHERE id = ANY($1::uuid[])', [cleanup.departments]);
  }
  await query(`DELETE FROM notifications WHERE type = 'supervision_report' AND title LIKE '%[TEST]%'`);
  await query(`DELETE FROM activity_logs WHERE action = 'supervision_report_sent' AND user_agent = 'test-supervision'`);

  const left = await query(
    `SELECT (SELECT COUNT(*) FROM schedules   WHERE name LIKE '[TEST]%')
          + (SELECT COUNT(*) FROM departments WHERE name LIKE '[TEST]%')
          + (SELECT COUNT(*) FROM absences    WHERE reason LIKE '[TEST]%')
          + (SELECT COUNT(*) FROM notifications WHERE title LIKE '%[TEST]%') AS n`
  );
  check('aucun résidu de test', Number(left.rows[0].n) === 0, `${left.rows[0].n} restant(s)`);

  const finalConflicts = await call(supervision.listConflicts, 'sg');
  check('les conflits synthétiques ont disparu',
    !finalConflicts.payload.data.conflicts.some((c) => (c.detail || '').includes('[TEST]')));

  console.log(`\n=== ${pass}/${pass + fail} assertions passées ===\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('\n💥 ERREUR:', e.message, '\n', e.stack);
  // Nettoyage de secours : ne jamais laisser de données de test derrière soi.
  try {
    if (cleanup.absences.length)   await query('DELETE FROM absences WHERE id = ANY($1::uuid[])', [cleanup.absences]);
    if (cleanup.schedules.length)  await query('DELETE FROM schedules WHERE id = ANY($1::uuid[])', [cleanup.schedules]);
    if (cleanup.departments.length) await query('DELETE FROM departments WHERE id = ANY($1::uuid[])', [cleanup.departments]);
    await query(`DELETE FROM notifications WHERE type = 'supervision_report' AND title LIKE '%[TEST]%'`);
    await query(`DELETE FROM activity_logs WHERE action = 'supervision_report_sent' AND user_agent = 'test-supervision'`);
    console.error('↩️  données de test nettoyées');
  } catch (c) {
    console.error('⚠️  nettoyage incomplet:', c.message);
  }
  process.exit(1);
});




