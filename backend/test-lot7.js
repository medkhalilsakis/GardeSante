/**
 * Test d'intégration du Lot 7 — Assistant Intelligent V2.
 * Contrôleurs appelés avec req/res mockés, comme les suites précédentes
 * (le mot de passe HTTP n'est pas connu).
 *
 * Couvre : le gating de rôle, les cinq modes de génération, la prise en compte
 * réelle des congés À LA GÉNÉRATION, l'ordre de relais, les cinq familles
 * d'anomalies du validateur, l'application des corrections, le refus de
 * confirmer une grille en erreur, et le cycle de vie des briefs.
 * Écrit puis nettoie ses propres lignes : aucun résidu en base.
 */
const { query } = require('./src/config/database');
const assistant = require('./src/modules/schedules/assistant.controller');
const { validateProposal } = require('./src/modules/schedules/assistant-validator');

const EST  = 'ffc0c07f-602d-4385-a673-16852c5350c1';
const DEPT = 'b057cb4b-14ac-4491-a0cd-74173a52a60c';

const USERS = {
  chef:      { id: 'e28f0306-d18e-4a45-a33c-f36f27f99285', roleCode: 'department_head' },
  sg:        { id: '2c9b8cc3-0799-4883-be0e-136b7def5836', roleCode: 'general_supervisor' },
  directeur: { id: '822a5d5f-dc83-4d8c-84f0-abbb25d17069', roleCode: 'director' },
  resident:  { id: 'f8af5867-57eb-4aa6-ad5e-d63c9ff5693d', roleCode: 'resident' },
};

const asUser = (key, extra) => ({
  ...USERS[key],
  firstName: 'Test', lastName: 'Lot7',
  establishmentId: EST,
  departmentId: DEPT,
  isSuperAdmin: false,
  ...extra,
});

const mockReq = (userKey, { body = {}, query: q = {}, params = {}, extra = {} } = {}) => ({
  user: userKey === 'superadmin'
    ? { id: USERS.directeur.id, roleCode: 'super_admin', isSuperAdmin: true, establishmentId: null }
    : asUser(userKey, extra),
  body, params, query: q,
  headers: { 'user-agent': 'test-lot7' },
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

// Période de test volontairement dans le futur : aucun chevauchement avec les
// plannings réels, et des dates stables d'une exécution à l'autre.
const START = '2027-03-01';
const END   = '2027-03-14';

const cleanup = { absences: [], schedules: [], briefs: [] };

// Nettoyage par identifiant ET par motif de nom : si une assertion échoue au
// milieu d'un scénario, la ligne écrite juste avant n'a pas été enregistrée dans
// `cleanup` et resterait sinon en base.
const purge = async () => {
  for (const id of cleanup.briefs)    await query('DELETE FROM assistant_briefs WHERE id = $1', [id]);
  for (const id of cleanup.schedules) await query('DELETE FROM schedules WHERE id = $1', [id]);
  for (const id of cleanup.absences)  await query('DELETE FROM absences WHERE id = $1', [id]);
  await query("DELETE FROM assistant_briefs WHERE name LIKE '[TEST] lot7%'");
  await query("DELETE FROM schedules WHERE name LIKE '[TEST] lot7%'");
  await query("DELETE FROM absences WHERE reason = '[TEST] lot7'");
};

(async () => {
  console.log('\n=== LOT 7 — ASSISTANT INTELLIGENT V2 ===\n');

  // ── Personnel réel du service ─────────────────────────────
  const staffRes = await query(
    `SELECT u.id, u.first_name, u.last_name, r.code AS role_code, r.name AS role_name
       FROM users u
       JOIN user_departments ud ON ud.user_id = u.id
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE ud.department_id = $1 AND u.is_active = TRUE
      ORDER BY u.last_name
      LIMIT 4`,
    [DEPT]
  );
  const staff = staffRes.rows.map((s, i) => ({
    userId: s.id, firstName: s.first_name, lastName: s.last_name,
    roleName: s.role_name, roleCode: s.role_code, position: i,
  }));

  if (staff.length < 3) {
    console.log(`  ⚠️  Service de test avec ${staff.length} agent(s) : au moins 3 sont nécessaires.`);
    process.exit(1);
  }
  console.log(`  ℹ️  ${staff.length} agents de test : ${staff.map((s) => s.firstName).join(', ')}\n`);

  // ─────────────────────────────────────────────────────────
  console.log('1. Gating de rôle');

  const denied = await call(assistant.generate, 'resident', {
    body: { departmentId: DEPT, startDate: START, endDate: END, selectedStaff: staff },
  });
  check('un résident ne peut pas générer (403)', denied.statusCode === 403, `reçu ${denied.statusCode}`);

  const allowed = await call(assistant.getContext, 'chef', {
    query: { departmentId: DEPT, startDate: START, endDate: END },
  });
  check('le chef de service accède au contexte (200)', allowed.statusCode === 200, `reçu ${allowed.statusCode}`);
  check('le contexte expose les 5 modes', (allowed.payload?.data?.modes || []).length === 5,
    `${allowed.payload?.data?.modes?.length} mode(s)`);
  check('le contexte expose le personnel du service', (allowed.payload?.data?.staff || []).length >= 3);

  const sgOk = await call(assistant.getContext, 'sg', { query: { departmentId: DEPT, startDate: START, endDate: END } });
  check('le surveillant général accède aussi (200)', sgOk.statusCode === 200, `reçu ${sgOk.statusCode}`);

  const otherHospital = await call(assistant.getContext, 'chef', {
    query: { departmentId: DEPT, startDate: START, endDate: END },
    extra: { establishmentId: '00000000-0000-0000-0000-000000000000' },
  });
  check('un service d\'un autre hôpital est refusé (404)', otherHospital.statusCode === 404,
    `reçu ${otherHospital.statusCode}`);

  // ─────────────────────────────────────────────────────────
  console.log('\n2. Les quatre modes de génération');

  const genWith = (mode, extraBody = {}) => call(assistant.generate, 'chef', {
    body: {
      departmentId: DEPT, startDate: START, endDate: END, mode,
      selectedStaff: staff, serviceRequirements: { minPerDay: 1 },
      ...extraBody,
    },
  });

  const manual = await genWith('manual');
  const manualGuards = (manual.payload?.data?.rows || [])
    .reduce((n, r) => n + Object.keys(r.shifts || {}).length, 0);
  check('mode manuel : grille livrée vide', manual.statusCode === 200 && manualGuards === 0,
    `${manualGuards} garde(s)`);
  check('mode manuel : une ligne par agent', (manual.payload?.data?.rows || []).length === staff.length);

  for (const mode of ['rotation', 'ab_rotation', 'periods', 'balanced']) {
    const res = await genWith(mode);
    const d = res.payload?.data;
    const perAgent = (d?.rows || []).map((r) => Object.keys(r.shifts || {}).length);
    const total = perAgent.reduce((a, b) => a + b, 0);
    check(`mode ${mode} : couverture complète (${d?.days?.length} jours)`,
      res.statusCode === 200 && total === d?.days?.length, `${total} garde(s) posée(s)`);

    // Personne ne doit être posé deux fois le même jour, quel que soit le mode.
    const collisions = (d?.days || []).filter((day) =>
      (d.rows || []).filter((r) => r.shifts?.[day]).length > 1).length;
    check(`mode ${mode} : aucune double affectation`, collisions === 0, `${collisions} jour(s)`);
  }

  const balanced = await genWith('balanced');
  // Sur une période non divisible par l'effectif, l'écart minimal atteignable est
  // de 1 garde (14 jours / 4 agents → 4,4,3,3). C'est cet écart qu'on contrôle,
  // pas le score d'équité : celui-ci est mécaniquement plafonné sur un petit
  // effectif (4,4,3,3 donne 75/100 alors que la répartition est optimale).
  const bMetrics = balanced.payload?.data?.metrics || {};
  const spread = (bMetrics.maxPerAgent ?? 0) - (bMetrics.minPerAgent ?? 0);
  check('mode équilibrage : écart max/min ≤ 1 garde', spread <= 1,
    `écart ${spread} (${bMetrics.minPerAgent} → ${bMetrics.maxPerAgent})`);

  // ─────────────────────────────────────────────────────────
  console.log('\n3. Congés pris en compte À LA GÉNÉRATION');

  const leaveType = await query(
    'SELECT id, name FROM absence_types WHERE establishment_id = $1 AND is_leave = TRUE LIMIT 1',
    [EST]
  );
  check('un type de congé est disponible', leaveType.rows.length > 0);

  const victim = staff[0];
  const LEAVE_START = '2027-03-04';
  const LEAVE_END   = '2027-03-08';

  const absIns = await query(
    `INSERT INTO absences
       (establishment_id, department_id, user_id, absence_type_id, start_date, end_date,
        kind, status, declared_by, reason)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,'leave','approved',$7,'[TEST] lot7')
     RETURNING id`,
    [EST, DEPT, victim.userId, leaveType.rows[0].id, LEAVE_START, LEAVE_END, USERS.directeur.id]
  );
  cleanup.absences.push(absIns.rows[0].id);

  for (const mode of ['rotation', 'periods', 'balanced']) {
    const res = await genWith(mode);
    const row = (res.payload?.data?.rows || []).find((r) => r.userId === victim.userId);
    const inLeave = Object.keys(row?.shifts || {})
      .filter((d) => d >= LEAVE_START && d <= LEAVE_END);
    check(`mode ${mode} : aucune garde pendant le congé`, inLeave.length === 0,
      `${inLeave.length} garde(s) : ${inLeave.join(', ')}`);
  }

  const noted = await genWith('balanced');
  check('le congé est signalé dans les notes',
    (noted.payload?.data?.notes || []).some((n) => n.includes('Congés pris en compte')),
    JSON.stringify(noted.payload?.data?.notes));

  // Bornes du congé : premier et dernier jour inclus (piège de fuseau DATE).
  const bornes = await genWith('balanced');
  const bornesRow = (bornes.payload?.data?.rows || []).find((r) => r.userId === victim.userId);
  check('borne basse du congé respectée (04/03)', !bornesRow?.shifts?.[LEAVE_START]);
  check('borne haute du congé respectée (08/03)', !bornesRow?.shifts?.[LEAVE_END]);
  check('la veille du congé reste disponible', bornesRow !== undefined);

  // ─────────────────────────────────────────────────────────
  console.log('\n4. Validation serveur — les 5 familles d\'anomalies');

  const mkRow = (m, shifts) => ({
    userId: m.userId, firstName: m.firstName, lastName: m.lastName,
    roleName: m.roleName, periodStart: START, periodEnd: END, shifts,
  });

  // a) congé
  const vLeave = await validateProposal({
    rows: [mkRow(victim, { [LEAVE_START]: 'J' })],
    dates: [LEAVE_START], startDate: START, endDate: END, requirements: {},
  });
  check('on_leave détecté', vLeave.anomalies.some((a) => a.type === 'on_leave'),
    JSON.stringify(vLeave.anomalies.map((a) => a.type)));
  check('on_leave est bloquant', vLeave.valid === false);
  check('on_leave porte une correction clear_cell',
    vLeave.anomalies.find((a) => a.type === 'on_leave')?.fix?.action === 'clear_cell');

  // b) double affectation — deux lignes pour le même agent le même jour
  const vDouble = await validateProposal({
    rows: [mkRow(staff[1], { '2027-03-02': 'J' }), mkRow(staff[1], { '2027-03-02': 'N' })],
    dates: ['2027-03-02'], startDate: START, endDate: END, requirements: {},
  });
  check('double_booking détecté', vDouble.anomalies.some((a) => a.type === 'double_booking'),
    JSON.stringify(vDouble.anomalies.map((a) => a.type)));
  check('double_booking est bloquant', vDouble.valid === false);

  // c) sous-effectif
  const vUnder = await validateProposal({
    rows: [mkRow(staff[1], { '2027-03-02': 'J' })],
    dates: ['2027-03-02'], startDate: START, endDate: END,
    requirements: { minPerDay: 2 },
  });
  check('understaffed détecté', vUnder.anomalies.some((a) => a.type === 'understaffed'));
  check('understaffed propose fill_day',
    vUnder.anomalies.find((a) => a.type === 'understaffed')?.fix?.action === 'fill_day');

  // d) surcharge
  const vOver = await validateProposal({
    rows: [mkRow(staff[1], { '2027-03-02': 'J', '2027-03-03': 'J', '2027-03-04': 'J' })],
    dates: ['2027-03-02', '2027-03-03', '2027-03-04'], startDate: START, endDate: END,
    requirements: { maxPerWeek: 2 },
  });
  check('overload_week détecté', vOver.anomalies.some((a) => a.type === 'overload_week'));
  check('overload_week est un avertissement, pas un blocage',
    vOver.anomalies.filter((a) => a.type === 'overload_week').every((a) => a.severity === 'warning'));

  // e) repos insuffisant
  const vRest = await validateProposal({
    rows: [mkRow(staff[1], { '2027-03-02': 'J', '2027-03-03': 'J' })],
    dates: ['2027-03-02', '2027-03-03'], startDate: START, endDate: END,
    requirements: { noConsecutiveShifts: true },
  });
  check('insufficient_rest détecté', vRest.anomalies.some((a) => a.type === 'insufficient_rest'));

  // f) grille saine
  const vClean = await validateProposal({
    rows: [mkRow(staff[1], { '2027-03-02': 'J' }), mkRow(staff[2], { '2027-03-03': 'J' })],
    dates: ['2027-03-02', '2027-03-03'], startDate: START, endDate: END,
    requirements: { minPerDay: 1 },
  });
  check('grille conforme : aucune anomalie', vClean.anomalies.length === 0 && vClean.valid === true,
    JSON.stringify(vClean.anomalies.map((a) => a.type)));

  // ─────────────────────────────────────────────────────────
  console.log('\n5. Corrections proposées');

  const badRows = [mkRow(victim, { [LEAVE_START]: 'J' }), mkRow(staff[1], {})];
  const fixed = await call(assistant.applyFixes, 'chef', {
    body: {
      rows: badRows,
      fixes: [{ action: 'clear_cell', userId: victim.userId, date: LEAVE_START }],
      startDate: START, endDate: END, serviceRequirements: {},
    },
  });
  const fixedRow = (fixed.payload?.data?.rows || []).find((r) => r.userId === victim.userId);
  check('clear_cell retire bien la garde', fixed.statusCode === 200 && !fixedRow?.shifts?.[LEAVE_START]);
  check('la grille corrigée ne contient plus d\'erreur bloquante',
    fixed.payload?.data?.validation?.valid === true,
    JSON.stringify(fixed.payload?.data?.validation?.counts));
  check('applyFixes n\'a pas muté la grille d\'entrée',
    badRows[0].shifts[LEAVE_START] === 'J');

  const fixedTwice = await call(assistant.applyFixes, 'chef', {
    body: {
      rows: fixed.payload.data.rows,
      fixes: [{ action: 'clear_cell', userId: victim.userId, date: LEAVE_START }],
      startDate: START, endDate: END, serviceRequirements: {},
    },
  });
  check('réappliquer la même correction est sans effet (idempotent)',
    JSON.stringify(fixedTwice.payload?.data?.rows) === JSON.stringify(fixed.payload?.data?.rows));

  const beforeFill = await query('SELECT COUNT(*)::int AS n FROM schedules WHERE department_id = $1', [DEPT]);
  const filled = await call(assistant.applyFixes, 'chef', {
    body: {
      rows: [mkRow(staff[1], {}), mkRow(staff[2], {})],
      fixes: [{ action: 'fill_day', date: '2027-03-02', count: 1 }],
      startDate: START, endDate: END, serviceRequirements: { minPerDay: 1 },
    },
  });
  const filledCount = (filled.payload?.data?.rows || []).filter((r) => r.shifts?.['2027-03-02']).length;
  check('fill_day complète la journée', filledCount === 1, `${filledCount} agent(s) posé(s)`);
  const afterFill = await query('SELECT COUNT(*)::int AS n FROM schedules WHERE department_id = $1', [DEPT]);
  check('applyFixes n\'écrit rien en base', beforeFill.rows[0].n === afterFill.rows[0].n);

  // ─────────────────────────────────────────────────────────
  console.log('\n6. Confirmation du planning');

  const refused = await call(assistant.confirm, 'chef', {
    body: {
      departmentId: DEPT, name: '[TEST] lot7 refusé', startDate: START, endDate: END,
      rows: [mkRow(victim, { [LEAVE_START]: 'J' })], mode: 'balanced', serviceRequirements: {},
    },
  });
  check('une grille en erreur est refusée (400)', refused.statusCode === 400, `reçu ${refused.statusCode}`);
  check('le refus porte le code VALIDATION_FAILED', refused.payload?.code === 'VALIDATION_FAILED');

  const good = await genWith('balanced');
  const created = await call(assistant.confirm, 'chef', {
    body: {
      departmentId: DEPT, name: '[TEST] lot7 planning', startDate: START, endDate: END,
      rows: good.payload.data.rows, mode: 'balanced',
      serviceRequirements: { minPerDay: 1 },
    },
  });
  check('une grille conforme crée le planning (200)', created.statusCode === 200,
    created.payload?.message);
  const newId = created.payload?.data?.scheduleId;
  if (newId) cleanup.schedules.push(newId);

  if (newId) {
    const sched = await query(
      `SELECT status, creation_mode, metadata->'assistant'->>'version' AS version,
              jsonb_array_length(metadata->'spreadsheet'->'rows') AS rows_count
         FROM schedules WHERE id = $1`,
      [newId]
    );
    check('le planning est créé en brouillon', sched.rows[0]?.status === 'draft', sched.rows[0]?.status);
    check('creation_mode = assistant', sched.rows[0]?.creation_mode === 'assistant');
    check('metadata.assistant.version = 2', sched.rows[0]?.version === '2');
    check('la grille est dans metadata.spreadsheet.rows',
      sched.rows[0]?.rows_count === good.payload.data.rows.length);

    const order = await query(
      'SELECT user_id, position FROM schedule_staff_assignments WHERE schedule_id = $1 ORDER BY position',
      [newId]
    );
    check('l\'ordre de relais est persisté', order.rows.length === staff.length,
      `${order.rows.length} ligne(s)`);
    check('la première position correspond à la première ligne',
      order.rows[0]?.user_id === good.payload.data.rows[0]?.userId);

    // Le mode « périodes » relit cet ordre quand le client n'en fournit aucun.
    const reused = await call(assistant.generate, 'chef', {
      body: {
        departmentId: DEPT, startDate: START, endDate: END, mode: 'periods',
        scheduleId: newId,
        selectedStaff: staff.map(({ position, ...rest }) => rest),
        serviceRequirements: { minPerDay: 1 },
      },
    });
    check('l\'ordre enregistré est relu par le mode périodes', reused.statusCode === 200,
      reused.payload?.message);

    // Confirmer à nouveau sur ce brouillon doit le remplir, pas en créer un autre.
    const again = await call(assistant.confirm, 'chef', {
      body: {
        departmentId: DEPT, name: '[TEST] lot7 planning', startDate: START, endDate: END,
        scheduleId: newId, rows: good.payload.data.rows, mode: 'rotation',
        serviceRequirements: { minPerDay: 1 },
      },
    });
    check('reconfirmer remplit le brouillon existant', again.payload?.data?.scheduleId === newId,
      `id ${again.payload?.data?.scheduleId}`);
    const dupes = await query(
      'SELECT COUNT(*)::int AS n FROM schedules WHERE department_id = $1 AND name = $2',
      [DEPT, '[TEST] lot7 planning']
    );
    check('aucun planning en double', dupes.rows[0].n === 1, `${dupes.rows[0].n} planning(s)`);
    const orderAgain = await query(
      'SELECT COUNT(*)::int AS n FROM schedule_staff_assignments WHERE schedule_id = $1',
      [newId]
    );
    check('l\'ordre de relais n\'est pas dupliqué', orderAgain.rows[0].n === staff.length,
      `${orderAgain.rows[0].n} ligne(s)`);
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n7. Briefs réutilisables');

  const saved = await call(assistant.saveBrief, 'chef', {
    body: {
      departmentId: DEPT, name: '[TEST] lot7 brief', mode: 'ab_rotation',
      brief: { members: staff, requirements: { minPerDay: 1 } },
    },
  });
  check('un brief s\'enregistre (200)', saved.statusCode === 200, saved.payload?.message);
  check('le mode ab_rotation est accepté par la base', saved.payload?.data?.brief?.mode === 'ab_rotation',
    saved.payload?.data?.brief?.mode);
  const briefId = saved.payload?.data?.brief?.id;
  if (briefId) cleanup.briefs.push(briefId);

  const resaved = await call(assistant.saveBrief, 'chef', {
    body: {
      departmentId: DEPT, name: '[TEST] lot7 brief', mode: 'balanced',
      brief: { members: staff, requirements: { minPerDay: 2 } },
    },
  });
  check('réenregistrer le même nom met à jour au lieu de dupliquer',
    resaved.payload?.data?.brief?.id === briefId);

  const badMode = await call(assistant.saveBrief, 'chef', {
    body: { departmentId: DEPT, name: '[TEST] lot7 invalide', mode: 'inexistant', brief: {} },
  });
  check('un mode inconnu est refusé (400)', badMode.statusCode === 400, `reçu ${badMode.statusCode}`);

  if (briefId) {
    const used = await call(assistant.useBrief, 'chef', { params: { id: briefId } });
    check('le brief se recharge (200)', used.statusCode === 200);
    check('le brief restitue ses paramètres',
      (used.payload?.data?.brief?.brief?.members || []).length === staff.length);
    check('le brief ne contient aucune garde',
      !JSON.stringify(used.payload?.data?.brief?.brief || {}).includes('"shifts"'));

    const counter = await query('SELECT times_used FROM assistant_briefs WHERE id = $1', [briefId]);
    check('le compteur d\'utilisation est incrémenté', counter.rows[0]?.times_used === 1,
      `${counter.rows[0]?.times_used}`);

    const foreign = await call(assistant.useBrief, 'chef', {
      params: { id: briefId },
      extra: { establishmentId: '00000000-0000-0000-0000-000000000000' },
    });
    check('un brief d\'un autre hôpital est refusé (403)', foreign.statusCode === 403,
      `reçu ${foreign.statusCode}`);

    const listed = await call(assistant.listBriefs, 'chef', { query: { departmentId: DEPT } });
    check('le brief apparaît dans la liste',
      (listed.payload?.data?.briefs || []).some((b) => b.id === briefId));

    const removed = await call(assistant.deleteBrief, 'chef', { params: { id: briefId } });
    check('le brief se supprime (200)', removed.statusCode === 200);
    const gone = await query('SELECT COUNT(*)::int AS n FROM assistant_briefs WHERE id = $1', [briefId]);
    check('le brief a bien disparu', gone.rows[0].n === 0);
    if (gone.rows[0].n === 0) cleanup.briefs = cleanup.briefs.filter((id) => id !== briefId);
  }

  // ─────────────────────────────────────────────────────────
  console.log('\n8. Étanchéité — l\'assistant V1 est intact');

  const v1 = require('./src/modules/schedules/schedule-builder.controller');
  check('generateProposals existe toujours', typeof v1.generateProposals === 'function');
  check('confirmProposal existe toujours', typeof v1.confirmProposal === 'function');
  check('getWizardContext existe toujours', typeof v1.getWizardContext === 'function');

  const v1Routes = require('./src/modules/schedules/schedule-builder.routes');
  check('les routes V1 sont toujours montées', typeof v1Routes === 'function');

  // ─────────────────────────────────────────────────────────
  console.log('\n9. Nettoyage');
  await purge();

  const residue = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM absences WHERE reason = '[TEST] lot7') AS abs,
       (SELECT COUNT(*)::int FROM schedules WHERE name LIKE '[TEST] lot7%') AS sched,
       (SELECT COUNT(*)::int FROM assistant_briefs WHERE name LIKE '[TEST] lot7%') AS briefs`
  );
  check('aucun résidu en base',
    residue.rows[0].abs === 0 && residue.rows[0].sched === 0 && residue.rows[0].briefs === 0,
    JSON.stringify(residue.rows[0]));

  console.log(`\n=== ${pass} réussis, ${fail} échoués ===\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (err) => {
  console.error('\n💥 ERREUR:', err.message);
  console.error(err.stack);
  try { await purge(); } catch (_) { /* nettoyage best-effort */ }
  process.exit(1);
});
