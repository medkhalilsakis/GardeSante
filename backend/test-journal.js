/**
 * Test d'intégration du module Journal de service (Lot 4).
 * Contrôleurs appelés avec req/res mockés — même approche que la suite
 * des remplacements, le mot de passe HTTP n'étant pas connu.
 *
 * Écrit puis nettoie ses propres lignes : aucun résidu en base.
 */
const { query } = require('./src/config/database');
const journal = require('./src/modules/journal/journal.controller');

const EST = 'ffc0c07f-602d-4385-a673-16852c5350c1';
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
  establishmentId: EST,
  establishmentName: 'Hôpital Habib Thameur',
  departmentId: DEPT,
  isSuperAdmin: false,
  ...extra,
});

const mockReq = (userKey, { body = {}, params = {}, query: q = {}, extra = {} } = {}) => ({
  user: asUser(userKey, extra),
  body, params, query: q,
  headers: { 'user-agent': 'test-journal' },
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

let pass = 0, fail = 0;
const check = (label, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); }
};

const created = [];

(async () => {
  console.log('\n=== JOURNAL DE SERVICE — Lot 4 ===\n');

  // ── 1. Portées ────────────────────────────────────────────────
  console.log('1. Portée déduite du rôle');
  const sSurv = await journal.resolveJournalScope(asUser('surveillant'));
  check('surveillant → departments', sSurv?.kind === 'departments', JSON.stringify(sSurv));
  const sSg = await journal.resolveJournalScope(asUser('sg'));
  check('surveillant général → establishment', sSg?.kind === 'establishment', JSON.stringify(sSg));
  const sDir = await journal.resolveJournalScope(asUser('directeur'));
  check('directeur → establishment', sDir?.kind === 'establishment');
  const sRes = await journal.resolveJournalScope(asUser('resident'));
  check('résident → aucune portée (null)', sRes === null, JSON.stringify(sRes));
  const sSa = await journal.resolveJournalScope({ isSuperAdmin: true, roleCode: 'super_admin' });
  check('super admin → platform', sSa?.kind === 'platform');
  const sSaTargeted = await journal.resolveJournalScope(
    { isSuperAdmin: true, roleCode: 'super_admin' }, { establishmentId: EST }
  );
  check('super admin ciblé → establishment', sSaTargeted?.kind === 'establishment');

  // Un chef ne peut pas élargir sa portée via le paramètre client.
  const sChefForced = await journal.resolveJournalScope(asUser('chef'), { establishmentId: EST });
  check('chef + establishmentId → reste departments', sChefForced?.kind === 'departments');

  // ── 2. Écriture : rôles autorisés ────────────────────────────
  console.log('\n2. Écriture au journal');
  const resDenied = mockRes();
  await journal.createEvent(mockReq('resident', {
    body: { departmentId: DEPT, eventType: 'remark', title: 'Tentative résident' },
  }), resDenied);
  check('résident refusé (403)', resDenied.statusCode === 403, `got ${resDenied.statusCode}`);

  const resAbsBlocked = mockRes();
  await journal.createEvent(mockReq('surveillant', {
    body: { departmentId: DEPT, eventType: 'absence', title: 'Absence via journal' },
  }), resAbsBlocked);
  check('type absence refusé (400)', resAbsBlocked.statusCode === 400, `got ${resAbsBlocked.statusCode}`);

  const resNoTitle = mockRes();
  await journal.createEvent(mockReq('surveillant', {
    body: { departmentId: DEPT, eventType: 'remark' },
  }), resNoTitle);
  check('titre manquant refusé (400)', resNoTitle.statusCode === 400);

  const resBadSev = mockRes();
  await journal.createEvent(mockReq('surveillant', {
    body: { departmentId: DEPT, eventType: 'incident', title: 'X', severity: 'apocalyptique' },
  }), resBadSev);
  check('gravité invalide refusée (400)', resBadSev.statusCode === 400);

  const resRemark = mockRes();
  await journal.createEvent(mockReq('surveillant', {
    body: { departmentId: DEPT, eventType: 'remark', title: '[TEST] Remarque de service', description: 'RAS' },
  }), resRemark);
  check('surveillant crée une remarque (201)', resRemark.statusCode === 201, JSON.stringify(resRemark.payload)?.slice(0, 140));
  if (resRemark.payload?.data?.id) created.push(resRemark.payload.data.id);

  const resIncident = mockRes();
  await journal.createEvent(mockReq('surveillant', {
    body: { departmentId: DEPT, eventType: 'incident', title: '[TEST] Incident critique', severity: 'critical' },
  }), resIncident);
  check('incident critique créé (201)', resIncident.statusCode === 201);
  if (resIncident.payload?.data?.id) created.push(resIncident.payload.data.id);

  const alertForIncident = await query(
    `SELECT id, alert_type, severity FROM service_alerts WHERE entity_id = $1`,
    [resIncident.payload?.data?.id || null]
  );
  check('incident critique génère une alerte', alertForIncident.rows.length === 1,
    JSON.stringify(alertForIncident.rows));

  const resReinf = mockRes();
  await journal.createEvent(mockReq('surveillant', {
    body: { departmentId: DEPT, eventType: 'reinforcement', title: '[TEST] Renfort demandé' },
  }), resReinf);
  check('demande de renfort créée (201)', resReinf.statusCode === 201);
  if (resReinf.payload?.data?.id) created.push(resReinf.payload.data.id);

  const reinfAlert = await query(
    `SELECT alert_type FROM service_alerts WHERE entity_id = $1`,
    [resReinf.payload?.data?.id || null]
  );
  check('renfort → alerte insufficient_staff',
    reinfAlert.rows[0]?.alert_type === 'insufficient_staff', JSON.stringify(reinfAlert.rows));

  // Étanchéité de service : un service d'un autre établissement est refusé.
  const foreign = await query(
    `SELECT id FROM departments WHERE establishment_id <> $1 LIMIT 1`, [EST]
  );
  if (foreign.rows.length) {
    const resForeign = mockRes();
    await journal.createEvent(mockReq('surveillant', {
      body: { departmentId: foreign.rows[0].id, eventType: 'remark', title: '[TEST] Hors périmètre' },
    }), resForeign);
    check('service hors périmètre refusé (403)', resForeign.statusCode === 403, `got ${resForeign.statusCode}`);
  } else {
    console.log('  ⏭️  pas de service externe en base — test de périmètre sauté');
  }

  // ── 3. Lecture du journal ────────────────────────────────────
  console.log('\n3. Lecture du journal');
  const resList = mockRes();
  await journal.listEvents(mockReq('surveillant', { query: {} }), resList);
  check('liste OK (200)', resList.statusCode === 200);
  const events = resList.payload?.data?.events || [];
  check('les 3 événements de test sont visibles',
    created.every((id) => events.some((e) => e.id === id)), `${events.length} événement(s)`);
  check('portée annoncée = departments', resList.payload?.data?.scope === 'departments');
  check('date au format YYYY-MM-DD',
    events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)), JSON.stringify(events[0]?.date));

  const resListRes = mockRes();
  await journal.listEvents(mockReq('resident', { query: {} }), resListRes);
  check('résident refusé en lecture (403)', resListRes.statusCode === 403);

  const resFiltered = mockRes();
  await journal.listEvents(mockReq('surveillant', { query: { type: 'incident' } }), resFiltered);
  check('filtre par type appliqué',
    (resFiltered.payload?.data?.events || []).every((e) => e.type === 'incident'));

  // ── 4. Alertes ───────────────────────────────────────────────
  console.log('\n4. Alertes de service');
  const resAlerts = mockRes();
  await journal.listAlerts(mockReq('surveillant', { query: {} }), resAlerts);
  check('alertes listées (200)', resAlerts.statusCode === 200);
  const alerts = resAlerts.payload?.data?.alerts || [];
  check('alertes ouvertes uniquement par défaut',
    alerts.every((a) => !a.resolvedAt), JSON.stringify(alerts.map((a) => a.resolvedAt)));

  const target = alerts.find((a) => a.id === alertForIncident.rows[0]?.id);
  if (target) {
    const resAck = mockRes();
    await journal.updateAlert(mockReq('surveillant', {
      params: { id: target.id }, body: { action: 'acknowledge' },
    }), resAck);
    check('prise en compte OK (200)', resAck.statusCode === 200, JSON.stringify(resAck.payload)?.slice(0, 120));
    check('acknowledged_at renseigné', !!resAck.payload?.data?.acknowledged_at);

    const resResolve = mockRes();
    await journal.updateAlert(mockReq('surveillant', {
      params: { id: target.id }, body: { action: 'resolve' },
    }), resResolve);
    check('résolution OK (200)', resResolve.statusCode === 200);
    check('resolved_at renseigné', !!resResolve.payload?.data?.resolved_at);

    const resBadAction = mockRes();
    await journal.updateAlert(mockReq('surveillant', {
      params: { id: target.id }, body: { action: 'supprimer' },
    }), resBadAction);
    check('action inconnue refusée (400)', resBadAction.statusCode === 400);

    const resAckResident = mockRes();
    await journal.updateAlert(mockReq('resident', {
      params: { id: target.id }, body: { action: 'resolve' },
    }), resAckResident);
    check('résident ne peut pas résoudre (403)', resAckResident.statusCode === 403);
  } else {
    console.log('  ⏭️  alerte de test introuvable dans la liste — sous-tests sautés');
  }

  const resAlert404 = mockRes();
  await journal.updateAlert(mockReq('surveillant', {
    params: { id: '00000000-0000-0000-0000-000000000000' }, body: { action: 'resolve' },
  }), resAlert404);
  check('alerte inexistante → 404', resAlert404.statusCode === 404);

  // ── 5. Vue d'ensemble ────────────────────────────────────────
  console.log('\n5. Vue d\'ensemble du service');
  const resOv = mockRes();
  await journal.getServiceOverview(mockReq('surveillant', { query: {} }), resOv);
  check('overview OK (200)', resOv.statusCode === 200, JSON.stringify(resOv.payload)?.slice(0, 160));
  const ov = resOv.payload?.data;
  check('today au format YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(ov?.today || ''));
  const s = ov?.summary || {};
  const numeric = ['guardsToday', 'guardsRemaining', 'staffOnDutyToday', 'eventsToday',
    'openAlerts', 'criticalAlerts', 'replacementsConfirmed', 'replacementsPending'];
  check('tous les compteurs sont numériques',
    numeric.every((k) => typeof s[k] === 'number'),
    JSON.stringify(s));
  check('événements du jour ≥ 3 (nos créations)', (s.eventsToday || 0) >= 3, `got ${s.eventsToday}`);
  check('activeSchedules est un tableau', Array.isArray(ov?.activeSchedules));
  check('todayGuards est un tableau', Array.isArray(ov?.todayGuards));

  const resOvRes = mockRes();
  await journal.getServiceOverview(mockReq('resident', { query: {} }), resOvRes);
  check('résident refusé sur overview (403)', resOvRes.statusCode === 403);

  const resOvSg = mockRes();
  await journal.getServiceOverview(mockReq('sg', { query: {} }), resOvSg);
  check('SG obtient la portée établissement',
    resOvSg.payload?.data?.scope === 'establishment', JSON.stringify(resOvSg.payload?.data?.scope));

  // ── 6. Étanchéité : la table shifts reste intacte ────────────
  console.log('\n6. Invariant overlay');
  const shifts = await query('SELECT COUNT(*)::int AS n FROM shifts');
  check('table shifts toujours vide (aucune écriture)', shifts.rows[0].n === 0, `${shifts.rows[0].n} ligne(s)`);

  // ── Nettoyage ────────────────────────────────────────────────
  console.log('\n7. Nettoyage');
  if (created.length) {
    await query(`DELETE FROM service_alerts WHERE entity_type = 'shift_events' AND entity_id = ANY($1::uuid[])`, [created]);
    await query('DELETE FROM shift_events WHERE id = ANY($1::uuid[])', [created]);
  }
  await query(`DELETE FROM notifications WHERE type = 'reinforcement_requested' AND title = 'Demande de renfort' AND message LIKE '[TEST]%'`);
  await query(`DELETE FROM activity_logs WHERE action IN ('journal_evenement','alerte_resolue','alerte_prise_en_compte') AND user_agent = 'test-journal'`);
  const left = await query('SELECT COUNT(*)::int AS n FROM shift_events WHERE title LIKE $1', ['[TEST]%']);
  check('aucun résidu de test', left.rows[0].n === 0, `${left.rows[0].n} restant(s)`);

  console.log(`\n=== ${pass}/${pass + fail} assertions passées ===\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\n💥 ERREUR:', e.message, '\n', e.stack);
  process.exit(1);
});
