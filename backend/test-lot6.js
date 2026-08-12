/**
 * Test d'intégration du Lot 6 — Super Admin et Directeur enrichis.
 * Contrôleurs appelés avec req/res mockés, comme les suites du journal et de
 * la supervision (le mot de passe HTTP n'est pas connu).
 *
 * Couvre : la supervision plateforme en lecture seule, l'élargissement de
 * l'historique à la direction, et l'annulation d'un congé.
 * Écrit puis nettoie ses propres lignes : aucun résidu en base.
 */
const { query } = require('./src/config/database');
const oversight = require('./src/modules/admin/admin-oversight.controller');
const history   = require('./src/modules/history/history.controller');
const leaves    = require('./src/modules/absences/leaves.controller');

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
  firstName: 'Test', lastName: 'Lot6',
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
  headers: { 'user-agent': 'test-lot6' },
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

const cleanup = { absences: [], schedules: [] };

(async () => {
  console.log('\n=== LOT 6 — SUPER ADMIN & DIRECTEUR ===\n');

  // ── 1. Supervision plateforme : gating de rôle ───────────────
  console.log('1. Gating de rôle — lecture seule, super admin seulement');
  const endpoints = [
    ['establishments', oversight.listEstablishments],
    ['schedules',      oversight.listSchedules],
    ['absences',       oversight.listAbsences],
    ['replacements',   oversight.listReplacements],
  ];

  for (const [name, fn] of endpoints) {
    const r = await call(fn, 'directeur');
    check(`${name} — directeur refusé (403)`, r.statusCode === 403, `reçu ${r.statusCode}`);
  }
  for (const [name, fn] of endpoints) {
    const r = await call(fn, 'superadmin');
    check(`${name} — super admin autorisé (200)`, r.statusCode === 200 && r.payload?.success === true, `reçu ${r.statusCode}`);
  }

  // ── 2. Supervision plateforme : états agrégés ────────────────
  console.log('\n2. Vue d\'ensemble des établissements');
  const est = await call(oversight.listEstablishments, 'superadmin');
  const ests = est.payload.data.establishments;
  check('au moins un hôpital remonté', ests.length > 0, `${ests.length}`);
  check('clés d\'agrégats présentes sur chaque hôpital', ests.every((x) =>
    ['staffCount', 'departmentCount', 'schedulesSubmitted', 'schedulesActive',
     'schedulesFinished', 'guardsToday', 'leavesToday', 'shiftAbsencesToday',
     'latesToday', 'replacementsTotal', 'replacementsPending'].every((k) => k in x)),
    JSON.stringify(Object.keys(ests[0] || {}).slice(0, 8)));
  check('résumé plateforme présent', est.payload.data.summary && Number.isInteger(est.payload.data.summary.establishments));

  // ── 3. Supervision plateforme : plannings ────────────────────
  console.log('\n3. Gardes de chaque hôpital');
  const sched = await call(oversight.listSchedules, 'superadmin', { query: { establishmentId: EST } });
  const list = sched.payload.data.schedules;
  check('enveloppe nommée { schedules }', Array.isArray(list), JSON.stringify(sched.payload.data));
  check('aucun brouillon dans la liste', list.every((s) => s.status !== 'draft'));
  const STATES = ['soumis', 'en_cours', 'termine'];
  check('état dérivé valide sur chaque ligne', list.every((s) => STATES.includes(s.state)),
    JSON.stringify(list.map((s) => s.state)));
  check('volumétrie lue depuis le tableur', list.every((s) =>
    Number.isInteger(s.guardCount) && Number.isInteger(s.staffCount)));
  check('clés camelCase cohérentes', list.every((s) =>
    s.startDate && s.endDate && 'departmentName' in s), JSON.stringify(Object.keys(list[0] || {})));
  const scoped = await call(oversight.listSchedules, 'superadmin', { query: { establishmentId: '00000000-0000-0000-0000-000000000000' } });
  check('hôpital inconnu → liste vide', scoped.payload.data.schedules.length === 0);

  // ── 4. Supervision plateforme : absences et remplacements ────
  console.log('\n4. Absences et remplacements (lecture seule)');
  const abs = await call(oversight.listAbsences, 'superadmin', { query: { establishmentId: EST } });
  check('enveloppe { absences }', Array.isArray(abs.payload.data.absences));
  const absRows = abs.payload.data.absences;
  check('clés camelCase + dates TO_CHAR', absRows.every((a) =>
    a.startDate && a.endDate && 'typeName' in a && a.firstName && a.lastName));
  const lateOnly = await call(oversight.listAbsences, 'superadmin', { query: { establishmentId: EST, kind: 'late' } });
  check('filtre kind=late appliqué', lateOnly.payload.data.absences.every((a) => a.kind === 'late'));

  const rep = await call(oversight.listReplacements, 'superadmin', { query: { establishmentId: EST } });
  check('enveloppe { replacements }', Array.isArray(rep.payload.data.replacements));
  const repRows = rep.payload.data.replacements;
  check('clés remplacements + items', repRows.every((r) =>
    'confirmationStatus' in r && 'scheduleName' in r && Array.isArray(r.items)));
  if (repRows.length) {
    check('binômes lus depuis replacement_items', repRows[0].items.every((it) => it.absentName && it.replacementName));
  }

  // ── 5. Historique élargi à la direction ──────────────────────
  console.log('\n5. Historique du personnel (directeur, portée établissement)');
  const allDir = await call(history.getAll, 'directeur');
  check('directeur autorisé (200)', allDir.statusCode === 200 && allDir.payload?.success === true);
  const allResident = await call(history.getAll, 'resident');
  check('résident toujours refusé (403)', allResident.statusCode === 403);
  check('chaque ligne porte un agent de l\'établissement', allDir.payload.data.every((r) => r.user_id || r.userId));

  const listUsers = await call(history.getUsersList, 'directeur');
  check('liste des agents accessible (200)', listUsers.statusCode === 200 && Array.isArray(listUsers.payload.data));

  const catAll = await call(history.getCategories, 'directeur');
  check('catégories (comportement inchangé) accessibles', catAll.statusCode === 200 && Array.isArray(catAll.payload.data));
  const catEst = await call(history.getCategories, 'directeur', { query: { scope: 'establishment' } });
  check('catégories étendues à l\'établissement (opt-in)', catEst.statusCode === 200 && Array.isArray(catEst.payload.data));

  // ── 6. Annulation d'un congé (jamais de DELETE) ──────────────
  console.log('\n6. Annulation d\'un congé');
  const leaveType = await query(
    `SELECT id FROM absence_types WHERE establishment_id = $1 AND is_leave = TRUE
     ORDER BY name LIMIT 1`,
    [EST]
  );
  check('un type de congé est seedé (migration 019)', leaveType.rows.length === 1);

  if (leaveType.rows.length) {
    const ins = await query(
      `INSERT INTO absences (establishment_id, department_id, user_id, absence_type_id,
                             start_date, end_date, kind, status, declared_by, reason)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, 'leave', 'approved', $7, $8) RETURNING id`,
      [EST, DEPT, USERS.resident.id, leaveType.rows[0].id,
       dayOffset(2), dayOffset(4), USERS.directeur.id, '[TEST] congé lot6']
    );
    cleanup.absences.push(ins.rows[0].id);

    const cancelAsChef = await call(leaves.cancelLeave, 'chef', { params: { id: ins.rows[0].id } });
    check('un chef de service ne peut pas annuler (403)', cancelAsChef.statusCode === 403, `reçu ${cancelAsChef.statusCode}`);

    const cancel = await call(leaves.cancelLeave, 'directeur', { params: { id: ins.rows[0].id } });
    check('le directeur annule (200)', cancel.statusCode === 200 && cancel.payload?.success === true);

    const row = await query('SELECT status FROM absences WHERE id = $1', [ins.rows[0].id]);
    check('ligne conservée, status = cancelled (trace immuable)', row.rows[0].status === 'cancelled', row.rows[0].status);

    const again = await call(leaves.cancelLeave, 'directeur', { params: { id: ins.rows[0].id } });
    check('annuler deux fois est refusé (409)', again.statusCode === 409, `reçu ${again.statusCode}`);

    // Cloisonnement inter-établissement : plutôt que de fabriquer un congé dans
    // un second hôpital (dont la base n'a pas toujours de service — or
    // `absences.department_id` est NOT NULL), on déplace le directeur. Le
    // contrôleur compare `leave.establishment_id` à celui de l'appelant : la
    // branche testée est exactement la même.
    const otherEst = await query(
      `SELECT id FROM establishments WHERE id <> $1 ORDER BY name LIMIT 1`,
      [EST]
    );

    if (otherEst.rows.length) {
      const fresh = await query(
        `INSERT INTO absences (establishment_id, department_id, user_id, absence_type_id,
                               start_date, end_date, kind, status, declared_by, reason)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, 'leave', 'approved', $7, $8) RETURNING id`,
        [EST, DEPT, USERS.resident.id, leaveType.rows[0].id,
         dayOffset(6), dayOffset(8), USERS.directeur.id, '[TEST] congé cloisonnement']
      );
      cleanup.absences.push(fresh.rows[0].id);

      const foreignCancel = await call(leaves.cancelLeave, 'directeur', {
        params: { id: fresh.rows[0].id },
        extra: { establishmentId: otherEst.rows[0].id },
      });
      check('congé d\'un autre hôpital refusé (403)', foreignCancel.statusCode === 403, `reçu ${foreignCancel.statusCode}`);

      const intact = await query('SELECT status FROM absences WHERE id = $1', [fresh.rows[0].id]);
      check('ce congé reste intact après le refus', intact.rows[0].status === 'approved', intact.rows[0].status);
    } else {
      console.log('  ⏭️  un seul établissement en base — cloisonnement non testable');
    }
  }

  // ── 7. Nettoyage ─────────────────────────────────────────────
  console.log('\n7. Nettoyage');
  if (cleanup.absences.length) {
    await query('DELETE FROM absences WHERE id = ANY($1::uuid[])', [cleanup.absences]);
  }
  await query(`DELETE FROM notifications WHERE type IN ('leave_cancelled') AND title LIKE '%[TEST]%'`);
  await query(`DELETE FROM activity_logs WHERE action IN ('conge_annule') AND user_agent = 'test-lot6'`);

  const left = await query(
    `SELECT (SELECT COUNT(*) FROM absences    WHERE reason LIKE '[TEST]%')
          + (SELECT COUNT(*) FROM notifications WHERE title LIKE '%[TEST]%') AS n`
  );
  check('aucun résidu de test', Number(left.rows[0].n) === 0, `${left.rows[0].n} restant(s)`);

  console.log(`\n=== ${pass}/${pass + fail} assertions passées ===\n`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => {
  console.error('\n💥 ERREUR:', e.message, '\n', e.stack);
  try {
    if (cleanup.absences.length) await query('DELETE FROM absences WHERE id = ANY($1::uuid[])', [cleanup.absences]);
    if (cleanup.schedules.length) await query('DELETE FROM schedules WHERE id = ANY($1::uuid[])', [cleanup.schedules]);
    await query(`DELETE FROM notifications WHERE type IN ('leave_cancelled') AND title LIKE '%[TEST]%'`);
    await query(`DELETE FROM activity_logs WHERE action IN ('conge_annule') AND user_agent = 'test-lot6'`);
    console.error('↩️  données de test nettoyées');
  } catch (c) {
    console.error('⚠️  nettoyage incomplet:', c.message);
  }
  process.exit(1);
});
