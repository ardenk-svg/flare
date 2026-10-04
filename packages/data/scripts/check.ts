// Focused live checks against a LOCAL SpacetimeDB database. Resets that database first.
// Usage: FLARE_DB=flare-dev npm run check   (requires `spacetime` CLI logged in as the module publisher)
import { execFileSync } from 'node:child_process';
import { emptyFacts } from '@flare/contracts';
import type { CallerFactPatch, Evidence, ExtractionResult, Intent, Recommendation } from '@flare/contracts';
import {
  ackNotification,
  recordInboundTranslation, prepareNotificationTranslation,
  advanceAssignment,
  applyIntakePatch,
  completeInboundWithoutPatch,
  confirmDispatchAndAssign,
  connectFlare,
  getConversationContext,
  getMyRole,
  listAssignments,
  listIncidents,
  listPendingConversationContexts,
  listPendingNotifications,
  listUnits,
  closeIncident,
  listConversation,
  listIncidentEvents,
  recordSharedLocation,
  recordExtractionFailure,
  recordInbound,
  recordSentQuestion,
  resolveIncident,
  FlareOpError,
  toFacts,
  toIncident,
  type FlareConnection,
} from '../src/index.ts';

const URI = process.env.SPACETIMEDB_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.FLARE_DB ?? 'flare-dev';
const endpoint = new URL(URI);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) throw new Error('Adapter checks reset data; use a local database only.');
const SERVER = `http://${endpoint.host}`;

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  -- ${detail}` : ''}`);
}

async function rejects(name: string, op: Promise<unknown>, code: string) {
  try {
    await op;
    check(name, false, `expected ${code}, but it succeeded`);
  } catch (e) {
    const got = e instanceof FlareOpError ? e.code : String(e);
    check(name, got === code, `expected ${code}, got ${got}`);
  }
}

function cli(...args: string[]) {
  execFileSync('spacetime', ['call', '--server', SERVER, DB, ...args], { stdio: 'pipe' });
}

async function waitFor(name: string, fn: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${name}`);
}

async function client(role?: string, unitId?: string): Promise<FlareConnection> {
  const c = await connectFlare({ uri: URI, database: DB });
  if (role) {
    cli('grant_role', c.identityHex, role, unitId ? JSON.stringify({ some: unitId }) : '{"none":[]}');
    await waitFor(`${role} grant`, () => getMyRole(c.conn)?.role === role);
  }
  return c;
}

const route = (key: string) => ({ platform: 'check', spaceId: `space-${key}`, line: 'check-line' });
const msg = (id: string, text: string) => ({ id, text, receivedAt: new Date().toISOString() });

function result(intent: Intent, patch: CallerFactPatch, evidence: Evidence[], summary: string): ExtractionResult {
  return {
    intent,
    patch,
    summary,
    evidence,
    corrections: intent === 'CORRECTION' ? (Object.keys(patch) as ExtractionResult['corrections']) : [],
    unresolvedFields: [],
    proposedQuestion: null,
  };
}

const recordPin = (conn: FlareConnection['conn'], input: Omit<Parameters<typeof recordSharedLocation>[1], 'provider' | 'route' | 'receivedAt'>) =>
  recordSharedLocation(conn, { provider: 'check', route: route(input.conversationKey), receivedAt: new Date().toISOString(), ...input });

const FIRE_REC: Recommendation = { services: ['FIRE'], ruleIds: ['DEMO_FIRE'], reason: 'Caller reported fire or smoke.' };

async function main() {
  cli('reset_demo');
  const agent = await client('AGENT');
  const dispatcher = await client('DISPATCHER');
  const dispatcher2 = await client('DISPATCHER');
  const fire = await client('RESPONDER', 'FIRE-01');
  const ems = await client('RESPONDER', 'EMS-01');
  const outsider = await client();
  const A = agent.conn;
  const KEY = 'check:conversation-1';
  check('six demo units seeded, two per service', listUnits(dispatcher.conn).map(u => u.id).join() === 'EMS-01,EMS-02,FIRE-01,FIRE-02,POLICE-01,POLICE-02' && listUnits(dispatcher.conn).every(u => u.status === 'AVAILABLE'));

  const roster = listUnits(dispatcher.conn);
  check('reset seeds two available units per service and preserves existing IDs',
    roster.map(u => u.id).join() === 'EMS-01,EMS-02,FIRE-01,FIRE-02,POLICE-01,POLICE-02' &&
    roster.every(u => u.status === 'AVAILABLE' && u.id.startsWith(u.service)));
  check('reset preserves existing responder grants', getMyRole(fire.conn)?.unitId === 'FIRE-01');
  const legacyFacts = toFacts({ fireOrSmoke: true, peopleInvolved: 0 });
  check('legacy facts decode all missing fields as null, preserving zero and true',
    JSON.stringify(legacyFacts) === JSON.stringify({ ...emptyFacts(), fireOrSmoke: true, peopleInvolved: 0 }));

  // --- Intake: receive, duplicate, failure, first report ---
  let ctx = await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('m1', 'Simulation: I see smoke outside.')] });
  check('recordInbound stores RECEIVED message', ctx.pendingMessages.length === 1 && ctx.activeIncident === null);
  ctx = await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('m1', 'Simulation: I see smoke outside.')] });
  check('duplicate source ID is a no-op', ctx.pendingMessages.length === 1);

  await recordExtractionFailure(A, {
    conversationKey: KEY,
    messageIds: ['m1'],
    error: { code: 'TIMEOUT', message: 'Gemini timed out', retryable: true },
  });
  ctx = getConversationContext(A, KEY)!;
  check('extraction failure leaves message RECEIVED and retryable', ctx.pendingMessages.length === 1 && ctx.lastExtractionError?.startsWith('TIMEOUT') === true);
  check('extraction failure creates no incident', ctx.activeIncident === null && listIncidents(A).length === 0);

  await rejects(
    'evidence quote must appear in the source message',
    applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ['m1'], result: result('REPORT', { fireOrSmoke: true }, [{ field: 'fireOrSmoke', messageId: 'm1', quote: 'flames everywhere' }], 'Smoke.'), recommendation: FIRE_REC }),
    'EVIDENCE_QUOTE_MISMATCH'
  );
  await rejects(
    'changed fact requires evidence',
    applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ['m1'], result: result('REPORT', { fireOrSmoke: true }, [], 'Smoke.'), recommendation: FIRE_REC }),
    'MISSING_EVIDENCE'
  );

  const r1 = result('REPORT', { fireOrSmoke: true }, [{ field: 'fireOrSmoke', messageId: 'm1', quote: 'I see smoke outside' }], 'Caller reports smoke outside; location unknown.');
  await applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ['m1'], result: r1, recommendation: FIRE_REC });
  ctx = getConversationContext(A, KEY)!;
  const inc1 = ctx.activeIncident!;
  check('first report creates partial COLLECTING incident', inc1?.status === 'COLLECTING' && inc1.intakeRevision === 1);
  check('unsupported facts stay null', inc1.facts.fireOrSmoke === true && inc1.facts.locationText === null && inc1.facts.trappedPerson === null);
  check('recommendation stored separately from confirmed services', inc1.recommendedServices.join() === 'FIRE' && inc1.confirmedServices.length === 0);
  check('applied message leaves pending and clears error', ctx.pendingMessages.length === 0 && ctx.lastExtractionError === null && inc1.extractionError === null);
  check('incidents without new fact claims or a shared location decode them as null',
    inc1.sharedLocation === null && inc1.facts.weaponPresent === null && inc1.facts.suspectCount === null &&
    inc1.facts.callerStatus === null && inc1.facts.vehicleCount === null && inc1.facts.patientAge === null && inc1.facts.roadBlocked === null);
  const oldRow = [...A.db.incidentView.iter()].find(i => i.id.toString() === inc1.id)!;
  check('adapter defaults an absent sharedLocation to null', toIncident({ ...oldRow, sharedLocation: undefined }).sharedLocation === null);


  await applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ['m1'], result: r1, recommendation: FIRE_REC });
  check('re-applying an APPLIED batch is a harmless no-op', getConversationContext(A, KEY)!.intakeRevision === 1 && listIncidents(A).length === 1);

  await recordSentQuestion(A, { conversationKey: KEY, question: 'Which building and entrance?', delivered: true });
  check('sent question persisted', getConversationContext(A, KEY)!.lastQuestion === 'Which building and entrance?');

  // --- Location, then correction with stale-result protection ---
  check('incident extraction state OK after accepted patch', getConversationContext(A, KEY)!.activeIncident?.extractionState === 'OK');
  await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('m2', 'North entrance of the demo student center.')] });
  check('new input on active incident sets PENDING', getConversationContext(A, KEY)!.activeIncident?.extractionState === 'PENDING');
  await recordExtractionFailure(A, { conversationKey: KEY, messageIds: ['m2'], error: { code: 'RATE_LIMIT', message: 'retry later', retryable: true } });
  ctx = getConversationContext(A, KEY)!;
  check('PENDING -> FAILED keeps verified facts and revision', ctx.activeIncident?.extractionState === 'FAILED' && ctx.activeIncident.extractionError?.startsWith('RATE_LIMIT') === true && ctx.activeIncident.facts.fireOrSmoke === true && ctx.intakeRevision === 1 && ctx.pendingMessages.length === 1);
  await applyIntakePatch(A, {
    conversationKey: KEY, expectedRevision: 1, sourceMessageIds: ['m2'],
    result: result('REPORT', { locationText: 'North entrance of the demo student center' }, [{ field: 'locationText', messageId: 'm2', quote: 'North entrance of the demo student center' }], 'Smoke outside the north entrance of the demo student center.'),
    recommendation: FIRE_REC,
  });
  ctx = getConversationContext(A, KEY)!;
  check('location makes incident READY_FOR_REVIEW', ctx.activeIncident?.status === 'READY_FOR_REVIEW');
  check('successful retry returns FAILED -> OK and clears error', ctx.activeIncident?.extractionState === 'OK' && ctx.activeIncident.extractionError === null && ctx.activeIncident.facts.fireOrSmoke === true);

  await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('m3', 'Correction: south entrance, not north.')] });
  const correction = result('CORRECTION', { locationText: 'south entrance' }, [{ field: 'locationText', messageId: 'm3', quote: 'south entrance' }], 'Smoke outside the south entrance of the demo student center.');
  await rejects('stale expected revision is rejected', applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 1, sourceMessageIds: ['m3'], result: correction, recommendation: FIRE_REC }), 'STALE_REVISION');
  check('stale rejection leaves message RECEIVED', getConversationContext(A, KEY)!.pendingMessages.some(m => m.id === 'm3'));
  await applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 2, sourceMessageIds: ['m3'], result: correction, recommendation: FIRE_REC });
  let inc = getConversationContext(A, KEY)!.activeIncident!;
  check('correction replaces location on the same incident', inc.id === inc1.id && inc.facts.locationText === 'south entrance' && inc.facts.fireOrSmoke === true);
  check('correction evidence replaces old evidence for that field', inc.evidence.filter(e => e.field === 'locationText').map(e => e.messageId).join() === 'm3');

  // --- Authorization ---
  await rejects('outsider cannot dispatch', confirmDispatchAndAssign(outsider.conn, { incidentId: inc.id, confirmedServices: ['FIRE'], unitIds: ['FIRE-01'] }), 'UNAUTHORIZED');
  await rejects('responder cannot dispatch', confirmDispatchAndAssign(fire.conn, { incidentId: inc.id, confirmedServices: ['FIRE'], unitIds: ['FIRE-01'] }), 'UNAUTHORIZED');
  await rejects('dispatcher cannot write intake', recordInbound(dispatcher.conn, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('x', 'x')] }), 'UNAUTHORIZED');
  check('outsider sees no incidents, units, or agent context', listIncidents(outsider.conn).length === 0 && listUnits(outsider.conn).length === 0 && [...outsider.conn.db.agentInbound.iter()].length === 0);
  check('context and notifications carry the durable route', getConversationContext(A, KEY)!.route.spaceId === `space-${KEY}` && getConversationContext(A, KEY)!.route.line === 'check-line');
  check('dispatcher cannot read raw caller messages', [...dispatcher.conn.db.agentInbound.iter()].length === 0 && [...dispatcher.conn.db.agentConversation.iter()].length === 0);

  // --- Dispatch ---
  await rejects('unit must match confirmed service', confirmDispatchAndAssign(dispatcher.conn, { incidentId: inc.id, confirmedServices: ['FIRE'], unitIds: ['EMS-01'] }), 'UNIT_SERVICE_MISMATCH');
  await confirmDispatchAndAssign(dispatcher.conn, { incidentId: inc.id, confirmedServices: ['FIRE'], unitIds: ['FIRE-01'] });
  inc = listIncidents(dispatcher.conn).find(i => i.id === inc1.id)!;
  const fireAssign = listAssignments(dispatcher.conn).find(a => a.incidentId === inc.id)!;
  check('dispatch sets DISPATCHED with OFFERED assignment and BUSY unit', inc.status === 'DISPATCHED' && fireAssign?.status === 'OFFERED' && listUnits(dispatcher.conn).find(u => u.id === 'FIRE-01')?.status === 'BUSY');
  await waitFor('dispatch notification', () => listPendingNotifications(A).some(n => n.kind === 'DISPATCH_CONFIRMED'));
  check('dispatch notification queued for agent', listPendingNotifications(A).filter(n => n.kind === 'DISPATCH_CONFIRMED' && n.conversationKey === KEY).length === 1);
  await rejects('second dispatch confirmation rejected', confirmDispatchAndAssign(dispatcher.conn, { incidentId: inc.id, confirmedServices: ['FIRE'], unitIds: ['FIRE-01'] }), 'ALREADY_DISPATCHED');

  // --- Responder progress ---
  await waitFor('responder sees assignment', () => listAssignments(fire.conn).length === 1);
  check('responder sees only its incident', listIncidents(fire.conn).length === 1 && listIncidents(ems.conn).length === 0);
  await rejects('other responder cannot advance', advanceAssignment(ems.conn, { assignmentId: fireAssign.id, nextStatus: 'ACCEPTED' }), 'UNAUTHORIZED');
  await rejects('agent cannot advance', advanceAssignment(A, { assignmentId: fireAssign.id, nextStatus: 'ACCEPTED' }), 'UNAUTHORIZED');
  await rejects('cannot skip a stage', advanceAssignment(fire.conn, { assignmentId: fireAssign.id, nextStatus: 'EN_ROUTE' }), 'INVALID_TRANSITION');
  await advanceAssignment(fire.conn, { assignmentId: fireAssign.id, nextStatus: 'ACCEPTED' });
  await advanceAssignment(fire.conn, { assignmentId: fireAssign.id, nextStatus: 'EN_ROUTE' });
  await waitFor('dispatcher sees EN_ROUTE', () => listAssignments(dispatcher.conn).find(a => a.id === fireAssign.id)?.status === 'EN_ROUTE');
  check('dispatcher subscription observes EN_ROUTE', true);
  await waitFor('en route notification', () => listPendingNotifications(A).some(n => n.kind === 'ASSIGNMENT_EN_ROUTE'));
  check('EN_ROUTE notification queued with event status', listPendingNotifications(A).find(n => n.kind === 'ASSIGNMENT_EN_ROUTE')?.eventAssignmentStatus === 'EN_ROUTE');

  // --- Status query, post-dispatch correction ---
  await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('m4', 'Any update?')] });
  await completeInboundWithoutPatch(A, { conversationKey: KEY, messageIds: ['m4'], intent: 'STATUS_QUERY', replyText: '[SIMULATION] Mock unit FIRE-01 is en route.' });
  ctx = getConversationContext(A, KEY)!;
  check('status query APPLIED without revision change or new incident', ctx.pendingMessages.length === 0 && ctx.intakeRevision === 3 && listIncidents(A).length === 1);
  await completeInboundWithoutPatch(A, { conversationKey: KEY, messageIds: ['m4'], intent: 'STATUS_QUERY', replyText: 'dup' });
  check('duplicate status completion queues no second reply', listPendingNotifications(A).filter(n => n.kind === 'INFO_REPLY').length === 1);

  await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('m5', 'Someone may be trapped inside.')] });
  await applyIntakePatch(A, {
    conversationKey: KEY, expectedRevision: 3, sourceMessageIds: ['m5'],
    result: result('REPORT', { trappedPerson: true }, [{ field: 'trappedPerson', messageId: 'm5', quote: 'Someone may be trapped inside' }], 'Smoke at the south entrance; caller says someone may be trapped.'),
    recommendation: { services: ['FIRE', 'EMS'], ruleIds: ['DEMO_FIRE', 'DEMO_TRAPPED'], reason: 'Fire/smoke and trapped person reported.' },
  });
  await waitFor('dispatcher sees review flag', () => listIncidents(dispatcher.conn).find(i => i.id === inc1.id)?.needsReview === true);
  inc = listIncidents(dispatcher.conn).find(i => i.id === inc1.id)!;
  check('post-dispatch change flags review, keeps lifecycle and confirmed services', inc.status === 'DISPATCHED' && inc.needsReview && inc.confirmedServices.join() === 'FIRE' && inc.recommendedServices.join() === 'FIRE,EMS');

  // --- Notification acknowledgment ---
  for (const n of listPendingNotifications(A)) await ackNotification(A, { notificationId: n.id, delivered: n.kind !== 'INFO_REPLY', error: 'provider error' });
  const left = listPendingNotifications(A);
  check('acked jobs leave queue; failed delivery stays visible', left.length === 1 && left[0].kind === 'INFO_REPLY' && left[0].attempts === 1 && left[0].lastError === 'provider error');
  await rejects('dispatcher cannot ack notifications', ackNotification(dispatcher.conn, { notificationId: left[0].id, delivered: true }), 'UNAUTHORIZED');

  // --- Resolve ---
  await rejects('resolve requires completed assignments', resolveIncident(dispatcher.conn, { incidentId: inc.id }), 'ASSIGNMENTS_NOT_COMPLETED');
  await advanceAssignment(fire.conn, { assignmentId: fireAssign.id, nextStatus: 'ON_SCENE' });
  await advanceAssignment(fire.conn, { assignmentId: fireAssign.id, nextStatus: 'COMPLETED' });
  await waitFor('dispatcher sees COMPLETED', () => listAssignments(dispatcher.conn).find(a => a.id === fireAssign.id)?.status === 'COMPLETED');
  check('completed assignment releases unit', listUnits(dispatcher.conn).find(u => u.id === 'FIRE-01')?.status === 'AVAILABLE');
  check('completing assignment does not resolve incident', listIncidents(dispatcher.conn).find(i => i.id === inc.id)?.status === 'DISPATCHED');
  await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('m6', 'Old case message that never got processed.')] });
  await resolveIncident(dispatcher.conn, { incidentId: inc.id });
  await waitFor('agent sees resolution', () => getConversationContext(A, KEY)!.activeIncident === null);
  check('resolve sets RESOLVED and ends active association', listIncidents(dispatcher.conn).find(i => i.id === inc.id)?.status === 'RESOLVED');

  // --- Case B in the same conversation ---
  ctx = getConversationContext(A, KEY)!;
  check('resolve advances the case and clears the question', ctx.caseEpoch === 2 && ctx.lastQuestion === null && ctx.lastQuestionDelivery === null);
  check('old-case pending input is excluded from the new case', ctx.pendingMessages.length === 0 && ctx.recentMessages.length === 0 && !listPendingConversationContexts(A).some(c => c.conversationKey === KEY));
  await recordInbound(A, { provider: 'check', conversationKey: KEY, route: route(KEY), messages: [msg('b1', 'Simulation: someone collapsed in the demo gym lobby.')] });
  ctx = getConversationContext(A, KEY)!;
  check('case B starts with empty facts, summary, revision, and only its own messages', ctx.activeIncident === null && ctx.intakeRevision === 0 && ctx.currentSummary === '' && Object.values(ctx.currentFacts).every(v => v === null) && ctx.pendingMessages.map(m => m.id).join() === 'b1' && ctx.recentMessages.length === 0);
  await rejects('old-case message cannot be applied to the new case', applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ['m6'], result: result('REPORT', {}, [], 'x'), recommendation: FIRE_REC }), 'STALE_CASE');
  await rejects('old-case evidence is rejected', applyIntakePatch(A, { conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ['b1'], result: result('REPORT', { fireOrSmoke: true }, [{ field: 'fireOrSmoke', messageId: 'm1', quote: 'I see smoke outside' }], 'x'), recommendation: FIRE_REC }), 'UNKNOWN_EVIDENCE_MESSAGE');
  await applyIntakePatch(A, {
    conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ['b1'],
    result: result('REPORT', { locationText: 'demo gym lobby' }, [{ field: 'locationText', messageId: 'b1', quote: 'demo gym lobby' }], 'Someone collapsed in the demo gym lobby.'),
    recommendation: { services: [], ruleIds: [], reason: 'No demo rule matched; dispatcher review required.' },
  });
  const caseB = getConversationContext(A, KEY)!.activeIncident!;
  check('case B creates a separate incident without case-A facts', caseB.id !== inc1.id && caseB.caseEpoch === 2 && caseB.facts.fireOrSmoke === null && caseB.facts.trappedPerson === null && caseB.evidence.every(e => e.messageId === 'b1'));
  await waitFor('dispatcher sees case B', () => listIncidents(dispatcher.conn).some(i => i.id === caseB.id));
  check('case A history remains stored', listIncidents(dispatcher.conn).find(i => i.id === inc1.id)?.status === 'RESOLVED');

  // --- Trapped-person fixture: unknown vs false, independent assignments ---
  const KEY2 = 'check:conversation-2';
  await recordInbound(A, { provider: 'check', conversationKey: KEY2, route: route(KEY2), messages: [msg('t1', 'Simulation: a person is trapped in the demo garage, level 2. Nobody is threatening anyone. Not sure if anyone is hurt.')] });
  await applyIntakePatch(A, {
    conversationKey: KEY2, expectedRevision: 0, sourceMessageIds: ['t1'],
    result: result('REPORT', { trappedPerson: true, locationText: 'demo garage, level 2', violentThreat: false, injuryReported: null }, [
      { field: 'trappedPerson', messageId: 't1', quote: 'a person is trapped' },
      { field: 'locationText', messageId: 't1', quote: 'demo garage, level 2' },
      { field: 'violentThreat', messageId: 't1', quote: 'Nobody is threatening anyone' },
      { field: 'injuryReported', messageId: 't1', quote: 'Not sure if anyone is hurt' },
    ], 'Person trapped in demo garage level 2; injuries unknown.'),
    recommendation: { services: ['FIRE', 'EMS'], ruleIds: ['DEMO_TRAPPED'], reason: 'Trapped person reported.' },
  });
  const inc2 = getConversationContext(A, KEY2)!.activeIncident!;
  check('explicit false and explicit unknown are distinct', inc2.facts.violentThreat === false && inc2.facts.injuryReported === null && inc2.status === 'READY_FOR_REVIEW');
  await rejects('every confirmed service needs a unit', confirmDispatchAndAssign(dispatcher.conn, { incidentId: inc2.id, confirmedServices: ['FIRE', 'EMS'], unitIds: ['FIRE-01'] }), 'SERVICE_WITHOUT_UNIT');
  await confirmDispatchAndAssign(dispatcher.conn, { incidentId: inc2.id, confirmedServices: ['FIRE', 'EMS'], unitIds: ['FIRE-01', 'EMS-01'] });
  await waitFor('ems assignment visible', () => listAssignments(ems.conn).some(a => a.incidentId === inc2.id));
  const emsAssign = listAssignments(ems.conn).find(a => a.incidentId === inc2.id)!;
  for (const s of ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED'] as const) await advanceAssignment(ems.conn, { assignmentId: emsAssign.id, nextStatus: s });
  await waitFor('dispatcher sees EMS COMPLETED', () => listAssignments(dispatcher.conn).some(a => a.id === emsAssign.id && a.status === 'COMPLETED'));
  const both = listAssignments(dispatcher.conn).filter(a => a.incidentId === inc2.id);
  check('one assignment completing leaves the other intact', both.find(a => a.unitId === 'EMS-01')?.status === 'COMPLETED' && both.find(a => a.unitId === 'FIRE-01')?.status === 'OFFERED');
  check('only the completed unit is released', listUnits(dispatcher.conn).find(u => u.id === 'EMS-01')?.status === 'AVAILABLE' && listUnits(dispatcher.conn).find(u => u.id === 'FIRE-01')?.status === 'BUSY');

  // --- Concurrent reservation of one unit ---
  const ready: string[] = [];
  for (const k of ['check:conversation-3', 'check:conversation-4']) {
    await recordInbound(A, { provider: 'check', conversationKey: k, route: route(k), messages: [msg('p1', 'Simulation: a person is threatening people at the demo library entrance.')] });
    await applyIntakePatch(A, {
      conversationKey: k, expectedRevision: 0, sourceMessageIds: ['p1'],
      result: result('REPORT', { violentThreat: true, locationText: 'demo library entrance' }, [
        { field: 'violentThreat', messageId: 'p1', quote: 'a person is threatening people' },
        { field: 'locationText', messageId: 'p1', quote: 'demo library entrance' },
      ], 'Threat reported at the demo library entrance.'),
      recommendation: { services: ['POLICE'], ruleIds: ['DEMO_THREAT'], reason: 'Violent threat reported.' },
    });
    ready.push(getConversationContext(A, k)!.activeIncident!.id);
  }
  await waitFor('dispatcher2 sees incidents', () => ready.every(id => listIncidents(dispatcher2.conn).some(i => i.id === id)));
  const race = await Promise.allSettled([
    confirmDispatchAndAssign(dispatcher.conn, { incidentId: ready[0], confirmedServices: ['POLICE'], unitIds: ['POLICE-01'] }),
    confirmDispatchAndAssign(dispatcher2.conn, { incidentId: ready[1], confirmedServices: ['POLICE'], unitIds: ['POLICE-01'] }),
  ]);
  const wins = race.filter(r => r.status === 'fulfilled').length;
  const conflict = race.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
  check('two simultaneous reservations: exactly one succeeds', wins === 1);
  check('loser receives explicit UNIT_CONFLICT', conflict?.reason instanceof FlareOpError && conflict.reason.code === 'UNIT_CONFLICT');
  check('losing incident unchanged', listIncidents(dispatcher.conn).filter(i => ready.includes(i.id) && i.status === 'READY_FOR_REVIEW').length === 1);

  // --- Close without dispatch (issue #15) ---
  const KEY5 = 'check:conversation-5';
  await recordInbound(A, { provider: 'check', conversationKey: KEY5, route: route(KEY5), messages: [msg('c1', 'Simulation: just testing, I see smoke.')] });
  await applyIntakePatch(A, {
    conversationKey: KEY5, expectedRevision: 0, sourceMessageIds: ['c1'],
    result: result('REPORT', { fireOrSmoke: true }, [{ field: 'fireOrSmoke', messageId: 'c1', quote: 'I see smoke' }], 'Caller says they see smoke; location unknown.'),
    recommendation: FIRE_REC,
  });
  await recordSentQuestion(A, { conversationKey: KEY5, question: 'Where are you?', delivered: true });
  const collecting = getConversationContext(A, KEY5)!.activeIncident!;
  await waitFor('dispatcher sees collecting incident', () => listIncidents(dispatcher.conn).some(i => i.id === collecting.id));
  await rejects('responder cannot close', closeIncident(fire.conn, { incidentId: collecting.id, reason: 'test' }), 'UNAUTHORIZED');
  await rejects('agent cannot close', closeIncident(A, { incidentId: collecting.id, reason: 'test' }), 'UNAUTHORIZED');
  await rejects('close requires a reason', closeIncident(dispatcher.conn, { incidentId: collecting.id, reason: '  ' }), 'REASON_REQUIRED');
  await rejects('dispatched incident cannot be closed', closeIncident(dispatcher.conn, { incidentId: inc2.id, reason: 'test' }), 'NOT_CLOSABLE');
  await closeIncident(dispatcher.conn, { incidentId: collecting.id, reason: 'Test text' });
  await waitFor('agent sees close', () => getConversationContext(A, KEY5)!.activeIncident === null);
  const closed = listIncidents(dispatcher.conn).find(i => i.id === collecting.id)!;
  check('dispatcher closes a COLLECTING incident', closed.status === 'CLOSED' && closed.closeReason === 'Test text');
  ctx = getConversationContext(A, KEY5)!;
  check('close starts a new case and clears the question', ctx.caseEpoch === 2 && ctx.lastQuestion === null && ctx.pendingMessages.length === 0 && ctx.recentMessages.length === 0);
  await waitFor('close notification', () => listPendingNotifications(A).some(n => n.conversationKey === KEY5));
  check('close queues one simulated reply to the caller', listPendingNotifications(A).filter(n => n.conversationKey === KEY5 && n.kind === 'INFO_REPLY' && n.text.startsWith('[SIMULATION]')).length === 1);
  await rejects('closed incident cannot be dispatched', confirmDispatchAndAssign(dispatcher.conn, { incidentId: collecting.id, confirmedServices: ['FIRE'], unitIds: ['FIRE-01'] }), 'INCIDENT_CLOSED');
  await rejects('closed incident cannot be closed again', closeIncident(dispatcher.conn, { incidentId: collecting.id, reason: 'again' }), 'NOT_CLOSABLE');
  await recordInbound(A, { provider: 'check', conversationKey: KEY5, route: route(KEY5), messages: [msg('c2', 'Simulation: someone fell at the demo track.')] });
  await applyIntakePatch(A, {
    conversationKey: KEY5, expectedRevision: 0, sourceMessageIds: ['c2'],
    result: result('REPORT', { locationText: 'demo track' }, [{ field: 'locationText', messageId: 'c2', quote: 'demo track' }], 'Someone fell at the demo track.'),
    recommendation: { services: [], ruleIds: [], reason: 'No demo rule matched; dispatcher review required.' },
  });
  const afterClose = getConversationContext(A, KEY5)!.activeIncident!;
  check('next message after close creates a new incident without old facts', afterClose.id !== collecting.id && afterClose.caseEpoch === 2 && afterClose.facts.fireOrSmoke === null && afterClose.evidence.every(e => e.messageId === 'c2'));
  check('READY_FOR_REVIEW incident starts ready', afterClose.status === 'READY_FOR_REVIEW');
  await closeIncident(dispatcher.conn, { incidentId: afterClose.id, reason: 'Duplicate report' });
  await waitFor('ready incident closed', () => listIncidents(dispatcher.conn).find(i => i.id === afterClose.id)?.status === 'CLOSED');
  await waitFor('agent sees second close', () => getConversationContext(A, KEY5)!.caseEpoch === 3);
  check('dispatcher closes a READY_FOR_REVIEW incident', getConversationContext(A, KEY5)!.activeIncident === null);

  // --- New caller facts (#28) ---
  const KEY6 = 'check:conversation-6';
  await recordInbound(A, { provider: 'check', conversationKey: KEY6, route: route(KEY6), messages: [msg('r1', 'Simulation: two guys with a knife robbed the demo bookstore, I am hiding in the back.')] });
  await rejects('fact value must match its kind', A.reducers.applyIntakePatch({
    conversationKey: KEY6, expectedRevision: 0, sourceMessageIds: ['r1'], intent: 'REPORT',
    changes: [{ field: 'weaponPresent', value: { tag: 'Count', value: 1 } }],
    summary: 'x', evidence: [{ field: 'weaponPresent', messageId: 'r1', quote: 'with a knife' }],
    corrections: [], unresolvedFields: [], recommendedServices: [], recommendationRuleIds: [], recommendationReason: '',
  }).catch(e => { throw new FlareOpError(e.message); }), 'INVALID_VALUE_TYPE');
  await applyIntakePatch(A, {
    conversationKey: KEY6, expectedRevision: 0, sourceMessageIds: ['r1'],
    result: result('REPORT', { weaponPresent: true, suspectCount: 2, callerStatus: 'hiding', vehicleCount: null, locationText: 'demo bookstore' }, [
      { field: 'weaponPresent', messageId: 'r1', quote: 'with a knife' },
      { field: 'suspectCount', messageId: 'r1', quote: 'two guys' },
      { field: 'callerStatus', messageId: 'r1', quote: 'I am hiding in the back' },
      { field: 'vehicleCount', messageId: 'r1', quote: 'robbed the demo bookstore' },
      { field: 'locationText', messageId: 'r1', quote: 'demo bookstore' },
    ], 'Armed robbery at the demo bookstore; caller hiding.'),
    recommendation: { services: [], ruleIds: [], reason: 'No demo rule matched; dispatcher review required.' },
  });
  const robbery = getConversationContext(A, KEY6)!.activeIncident!;
  check('new facts stored with their kinds; unknown stays null', robbery.facts.weaponPresent === true && robbery.facts.suspectCount === 2 && robbery.facts.callerStatus === 'hiding' && robbery.facts.vehicleCount === null && robbery.facts.patientAge === null && robbery.facts.roadBlocked === null);

  // --- Shared location (#28) ---
  const KEY7 = 'check:conversation-7';
  const pin = { provider: 'check', conversationKey: KEY7, route: route(KEY7), messageId: 'loc1', receivedAt: new Date().toISOString(), latitude: 42.2808, longitude: -83.743, accuracyMeters: 12, label: 'Demo Diag', source: 'IMESSAGE_PIN' as const };
  await rejects('only the agent records shared locations', recordSharedLocation(dispatcher.conn, pin), 'UNAUTHORIZED');
  await rejects('latitude is range-checked', recordSharedLocation(A, { ...pin, messageId: 'bad', latitude: 91 }), 'INVALID_LATITUDE');
  await rejects('location source is validated', recordSharedLocation(A, { ...pin, messageId: 'bad2', source: 'GUESS' as never }), 'INVALID_LOCATION_SOURCE');
  await recordSharedLocation(A, pin);
  ctx = getConversationContext(A, KEY7)!;
  const pinned = ctx.activeIncident!;
  check('pin with no incident opens a partial COLLECTING incident', pinned?.status === 'COLLECTING' && pinned.sharedLocation?.label === 'Demo Diag' && pinned.sharedLocation.source === 'IMESSAGE_PIN' && pinned.extractionState === 'OK' && pinned.intakeRevision === 0);
  check('pin leaves typed location and facts untouched', pinned.facts.locationText === null && Object.values(pinned.facts).every(v => v === null) && ctx.pendingMessages.length === 0);
  await recordSharedLocation(A, pin);
  check('duplicate pin is a no-op', listIncidents(A).filter(i => i.sharedLocation?.label === 'Demo Diag').length === 1);
  await recordInbound(A, { provider: 'check', conversationKey: KEY7, route: route(KEY7), messages: [msg('s1', 'Simulation: someone fainted here.')] });
  await applyIntakePatch(A, {
    conversationKey: KEY7, expectedRevision: 0, sourceMessageIds: ['s1'],
    result: result('REPORT', { incidentType: 'fainting' }, [{ field: 'incidentType', messageId: 's1', quote: 'someone fainted' }], 'Someone fainted at the shared location.'),
    recommendation: { services: [], ruleIds: [], reason: 'No demo rule matched; dispatcher review required.' },
  });
  const pinnedReady = getConversationContext(A, KEY7)!.activeIncident!;
  check('shared location satisfies the location gate', pinnedReady.id === pinned.id && pinnedReady.status === 'READY_FOR_REVIEW' && pinnedReady.facts.locationText === null);
  await waitFor('dispatcher sees shared location', () => listIncidents(dispatcher.conn).some(i => i.id === pinned.id && i.sharedLocation !== null));
  check('shared location visible in dispatcher incident view', listIncidents(dispatcher.conn).find(i => i.id === pinned.id)?.sharedLocation?.latitude === 42.2808);

  // --- Transcript (#29) ---
  await waitFor('transcript arrives', () => listConversation(dispatcher.conn, inc1.id).length > 0);
  const tA = listConversation(dispatcher.conn, inc1.id);
  check('transcript has case-A caller messages and agent replies in time order', tA.filter(m => m.sender === 'CALLER').map(m => m.text).includes('Simulation: I see smoke outside.') && tA.some(m => m.sender === 'AGENT' && m.text === 'Which building and entrance?' && m.delivery === 'SENT') && tA.every((m, i) => i === 0 || tA[i - 1].at <= m.at));
  check('delivered and failed notifications appear once each', tA.filter(m => m.sender === 'AGENT' && m.text.includes('assigned mock unit')).length === 1 && tA.some(m => m.sender === 'AGENT' && m.delivery === 'FAILED'));
  const tB = listConversation(dispatcher.conn, caseB.id);
  check('transcript is case-isolated', tB.length === 1 && tB[0].text.startsWith('Simulation: someone collapsed') && !tA.some(m => m.text.startsWith('Simulation: someone collapsed')));
  check('shared pin shows as a caller transcript line', listConversation(dispatcher.conn, pinned.id).some(m => m.sender === 'CALLER' && m.text === '[Shared location: Demo Diag]'));
  check('responders see only assigned case transcripts; agents and outsiders see none', [...fire.conn.db.incidentConversationView.iter()].every(m => listAssignments(fire.conn).some(a => a.incidentId === m.incidentId.toString())) && [...A.db.incidentConversationView.iter()].length === 0 && [...outsider.conn.db.incidentEventView.iter()].length === 0);

  // --- Activity log (#29) ---
  const kindsA = listIncidentEvents(dispatcher.conn, inc1.id).map(e => e.kind);
  const expectedA = ['INCIDENT_CREATED', 'FACTS_UPDATED', 'SERVICES_RECOMMENDED', 'CALLER_MESSAGE', 'EXTRACTION_FAILED', 'LOCATION_RECEIVED', 'DISPATCH_CONFIRMED', 'UNIT_ASSIGNED', 'UNIT_ACCEPTED', 'UNIT_EN_ROUTE', 'CALLER_NOTIFIED', 'UNIT_ON_SCENE', 'UNIT_COMPLETED', 'INCIDENT_RESOLVED'];
  check('full run logs every lifecycle event', expectedA.every(k => kindsA.includes(k as never)) && kindsA[0] === 'INCIDENT_CREATED' && kindsA[kindsA.length - 1] === 'INCIDENT_RESOLVED', kindsA.join(','));
  const evA = listIncidentEvents(dispatcher.conn, inc1.id);
  check('event order follows commits', kindsA.indexOf('DISPATCH_CONFIRMED') < kindsA.indexOf('UNIT_ACCEPTED') && kindsA.indexOf('UNIT_ACCEPTED') < kindsA.indexOf('UNIT_EN_ROUTE') && kindsA.indexOf('UNIT_EN_ROUTE') < kindsA.indexOf('UNIT_COMPLETED') && evA.every((e, i) => i === 0 || evA[i - 1].at <= e.at));
  check('events carry fields, services and units', evA.some(e => e.kind === 'FACTS_UPDATED' && e.fields.includes('fireOrSmoke')) && evA.some(e => e.kind === 'DISPATCH_CONFIRMED' && e.services.join() === 'FIRE') && evA.some(e => e.kind === 'UNIT_EN_ROUTE' && e.unitId === 'FIRE-01'));
  const kindsClosed = listIncidentEvents(dispatcher.conn, collecting.id).map(e => e.kind);
  check('close-without-dispatch logs created then closed', kindsClosed[0] === 'INCIDENT_CREATED' && kindsClosed[kindsClosed.length - 1] === 'INCIDENT_CLOSED' && !kindsClosed.includes('DISPATCH_CONFIRMED'), kindsClosed.join(','));
  check('pin logs LOCATION_RECEIVED once', listIncidentEvents(dispatcher.conn, pinned.id).filter(e => e.kind === 'LOCATION_RECEIVED').length === 1);

  {
    // --- Additional issue #28 boundary checks ---
    const KEY28 = 'check:console-schema';
    const consoleText = 'Simulation: weapon present, 2 suspects, hiding, 3 vehicles, patient age 25, road not blocked.';
    const consolePatch = { weaponPresent: true, suspectCount: 2, callerStatus: 'hiding', vehicleCount: 3, patientAge: 25, roadBlocked: false };
    const consoleEvidence: Evidence[] = [
      { field: 'weaponPresent', messageId: 'f1', quote: 'weapon present' },
      { field: 'suspectCount', messageId: 'f1', quote: '2 suspects' },
      { field: 'callerStatus', messageId: 'f1', quote: 'hiding' },
      { field: 'vehicleCount', messageId: 'f1', quote: '3 vehicles' },
      { field: 'patientAge', messageId: 'f1', quote: 'patient age 25' },
      { field: 'roadBlocked', messageId: 'f1', quote: 'road not blocked' },
    ];
    await recordInbound(A, { provider: 'check', conversationKey: KEY28, route: route(KEY28), messages: [msg('f1', consoleText)] });
    await rejects('new caller facts still require evidence', applyIntakePatch(A, {
      conversationKey: KEY28, expectedRevision: 0, sourceMessageIds: ['f1'],
      result: result('REPORT', consolePatch, [], 'Caller reports a collision and a threat.'), recommendation: FIRE_REC,
    }), 'MISSING_EVIDENCE');
    await applyIntakePatch(A, {
      conversationKey: KEY28, expectedRevision: 0, sourceMessageIds: ['f1'],
      result: result('REPORT', consolePatch, consoleEvidence, 'Caller reports a collision and a threat.'), recommendation: FIRE_REC,
    });
    let consoleInc = getConversationContext(A, KEY28)!.activeIncident!;
    check('all six new facts round trip with types and evidence', Object.entries(consolePatch).every(([k, v]) =>
      consoleInc.facts[k as keyof typeof consolePatch] === v && consoleInc.evidence.some(e => e.field === k)));
    check('facts without any location leave the incident COLLECTING', consoleInc.status === 'COLLECTING');

    const pin = { conversationKey: KEY28, messageId: 'pin1', latitude: 42.28, longitude: -83.74, accuracyMeters: 5, label: 'Demo entrance', source: 'IMESSAGE_PIN' as const };
    for (const c of [dispatcher, fire, outsider]) {
      await rejects('only the agent can record a shared location', recordPin(c.conn, pin), 'UNAUTHORIZED');
    }
    for (const invalid of [{ values: { latitude: 91 }, code: 'INVALID_LATITUDE' }, { values: { longitude: -181 }, code: 'INVALID_LONGITUDE' }, { values: { latitude: NaN }, code: 'INVALID_LATITUDE' }, { values: { longitude: Infinity }, code: 'INVALID_LONGITUDE' }, { values: { accuracyMeters: -1 }, code: 'INVALID_ACCURACY' }, { values: { accuracyMeters: NaN }, code: 'INVALID_ACCURACY' }, { values: { accuracyMeters: Infinity }, code: 'INVALID_ACCURACY' }]) {
      await rejects('invalid coordinates or accuracy are rejected', recordPin(A, { ...pin, ...invalid.values }), invalid.code);
    }
    await rejects('unknown location source is rejected', recordPin(A, { ...pin, source: 'MODEL' as never }), 'INVALID_LOCATION_SOURCE');
    await rejects('location message ID must be nonempty', recordPin(A, { ...pin, messageId: ' ' }), 'INVALID_MESSAGE_ID');
    await rejects('location requires a nonempty conversation key', recordPin(A, { ...pin, conversationKey: ' ' }), 'INVALID_CONVERSATION_KEY');
    check('rejected locations leave incident, revision and readiness unchanged',
      JSON.stringify(getConversationContext(A, KEY28)!.activeIncident) === JSON.stringify(consoleInc));

    await recordPin(A, pin);
    consoleInc = getConversationContext(A, KEY28)!.activeIncident!;
    check('shared location satisfies readiness without inventing a typed location',
      consoleInc.status === 'READY_FOR_REVIEW' && consoleInc.facts.locationText === null && consoleInc.intakeRevision === 1);
    check('shared location maps coordinates, metadata and committed timestamp',
      consoleInc.sharedLocation?.latitude === pin.latitude && consoleInc.sharedLocation.longitude === pin.longitude &&
      consoleInc.sharedLocation.accuracyMeters === 5 && consoleInc.sharedLocation.label === 'Demo entrance' &&
      consoleInc.sharedLocation.source === 'IMESSAGE_PIN' && Number.isFinite(Date.parse(consoleInc.sharedLocation.sharedAt)));
    await waitFor('dispatcher receives location through subscription', () =>
      listIncidents(dispatcher.conn).find(i => i.id === consoleInc.id)?.sharedLocation?.latitude === pin.latitude);
    check('dispatcher subscription exposes the shared location', true);
    await recordPin(A, { ...pin, latitude: 1 });
    check('duplicate location delivery does not overwrite coordinates or increment revision',
      JSON.stringify(getConversationContext(A, KEY28)!.activeIncident) === JSON.stringify(consoleInc));

    const clearText = 'Simulation: no weapon, zero suspects, caller safe, zero vehicles, age unknown, road status unknown, location text unknown.';
    const clearPatch = { weaponPresent: false, suspectCount: 0, callerStatus: 'safe', vehicleCount: 0, patientAge: null, roadBlocked: null, locationText: null };
    const clearEvidence = Object.keys(clearPatch).map(field => ({ field: field as Evidence['field'], messageId: 'f2', quote: clearText }));
    await recordInbound(A, { provider: 'check', conversationKey: KEY28, route: route(KEY28), messages: [msg('f2', clearText)] });
    await rejects('stale extraction remains rejected after a shared location', applyIntakePatch(A, {
      conversationKey: KEY28, expectedRevision: 0, sourceMessageIds: ['f2'],
      result: result('CORRECTION', clearPatch, clearEvidence, 'Caller is safe; other details corrected.'), recommendation: FIRE_REC,
    }), 'STALE_REVISION');
    await applyIntakePatch(A, {
      conversationKey: KEY28, expectedRevision: 1, sourceMessageIds: ['f2'],
      result: result('CORRECTION', clearPatch, clearEvidence, 'Caller is safe; other details corrected.'), recommendation: FIRE_REC,
    });
    consoleInc = getConversationContext(A, KEY28)!.activeIncident!;
    check('new facts distinguish false, zero and explicit null on correction',
      Object.entries(clearPatch).every(([k, v]) => consoleInc.facts[k as keyof typeof clearPatch] === v));
    check('clearing typed location keeps readiness when a shared location exists', consoleInc.status === 'READY_FOR_REVIEW' && consoleInc.sharedLocation?.latitude === pin.latitude);
    await recordPin(A, { conversationKey: KEY28, messageId: 'pin2', latitude: 0, longitude: 0, accuracyMeters: 0, source: 'FIND_MY' });
    consoleInc = getConversationContext(A, KEY28)!.activeIncident!;
    check('FIND_MY location replaces the pin, preserving valid zero coordinates and accuracy',
      consoleInc.sharedLocation?.source === 'FIND_MY' && consoleInc.sharedLocation.latitude === 0 &&
      consoleInc.sharedLocation.longitude === 0 && consoleInc.sharedLocation.accuracyMeters === 0 && consoleInc.sharedLocation.label === null);
    await confirmDispatchAndAssign(dispatcher.conn, { incidentId: consoleInc.id, confirmedServices: ['EMS'], unitIds: ['EMS-01', 'EMS-02'] });
    check('two units of the same service can be assigned, leaving none available',
      listAssignments(dispatcher.conn).filter(a => a.incidentId === consoleInc.id).length === 2 &&
      listUnits(dispatcher.conn).filter(u => u.service === 'EMS').every(u => u.status === 'BUSY'));
    await recordPin(A, { ...pin, messageId: 'pin3' });
    consoleInc = getConversationContext(A, KEY28)!.activeIncident!;
    check('post-dispatch location flags review and preserves lifecycle and assignments',
      consoleInc.status === 'DISPATCHED' && consoleInc.needsReview && consoleInc.confirmedServices.join() === 'EMS');

    const LOCATION_KEY = 'check:location-first';
    await recordInbound(A, { provider: 'check', conversationKey: LOCATION_KEY, route: route(LOCATION_KEY), messages: [] });
    const firstPin = { conversationKey: LOCATION_KEY, messageId: 'first-pin', latitude: 42, longitude: -83, source: 'IMESSAGE_PIN' as const };
    await recordPin(A, firstPin);
    const locationFirst = getConversationContext(A, LOCATION_KEY)!.activeIncident!;
    check('location-only event opens a partial incident with empty facts and no invented summary',
      locationFirst.status === 'COLLECTING' && locationFirst.summary === '' && locationFirst.extractionState === 'OK' &&
      Object.values(locationFirst.facts).every(v => v === null) && locationFirst.sharedLocation?.accuracyMeters === null);
    await recordInbound(A, { provider: 'check', conversationKey: LOCATION_KEY, route: route(LOCATION_KEY), messages: [msg('after-pin', 'Simulation: smoke here.')] });
    await applyIntakePatch(A, {
      conversationKey: LOCATION_KEY, expectedRevision: 0, sourceMessageIds: ['after-pin'],
      result: result('REPORT', { fireOrSmoke: true }, [{ field: 'fireOrSmoke', messageId: 'after-pin', quote: 'smoke here' }], 'Caller reports smoke.'), recommendation: FIRE_REC,
    });
    check('subsequent extraction uses the location-only incident and satisfies readiness',
      getConversationContext(A, LOCATION_KEY)!.activeIncident?.id === locationFirst.id && getConversationContext(A, LOCATION_KEY)!.activeIncident?.status === 'READY_FOR_REVIEW');
    await waitFor('dispatcher sees location-only case', () => listIncidents(dispatcher.conn).some(i => i.id === locationFirst.id));
    await closeIncident(dispatcher.conn, { incidentId: locationFirst.id, reason: 'Simulation complete' });
    await waitFor('location case closes', () => getConversationContext(A, LOCATION_KEY)!.activeIncident === null);
    await recordPin(A, firstPin);
    check('replaying a closed case pin cannot reopen a case or leak its coordinates',
      getConversationContext(A, LOCATION_KEY)!.activeIncident === null && getConversationContext(A, LOCATION_KEY)!.caseEpoch === 2);
    await recordPin(A, { ...firstPin, messageId: 'second-pin', latitude: 43 });
    const nextLocationCase = getConversationContext(A, LOCATION_KEY)!.activeIncident!;
    check('fresh pin starts the next case with no prior facts or location', nextLocationCase.id !== locationFirst.id &&
      nextLocationCase.caseEpoch === 2 && nextLocationCase.sharedLocation?.latitude === 43 && Object.values(nextLocationCase.facts).every(v => v === null));
    await rejects('unassigned responder cannot record a shared location',
      recordPin(ems.conn, firstPin), 'UNAUTHORIZED');
    check('unassigned responder and outsider do not see shared-location incidents',
      [fire, ems, outsider].every(c => !listIncidents(c.conn).some(i => i.id === nextLocationCase.id)));
  }

  // --- Route privacy ---
  const visible = (c: FlareConnection) =>
    JSON.stringify([...c.conn.db.incidentView.iter(), ...c.conn.db.assignmentView.iter(), ...c.conn.db.unitView.iter(), ...c.conn.db.myRole.iter(), ...c.conn.db.agentConversation.iter(), ...c.conn.db.agentInbound.iter(), ...c.conn.db.agentNotification.iter(), ...c.conn.db.incidentConversationView.iter(), ...c.conn.db.incidentEventView.iter()], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  check('route fields invisible to dispatcher and responder', [dispatcher, fire, ems, outsider].every(c => !visible(c).includes('space-check') && !visible(c).includes('check-line')));

  // --- Translation persistence and per-case language isolation ---
  const translationKey = 'check:translation';
  const spanish = 'Hay humo en la biblioteca.';
  await recordInbound(A, { provider: 'check', conversationKey: translationKey, route: route(translationKey), messages: [msg('es-1', spanish)] });
  await rejects('responder cannot write machine translations', recordInboundTranslation(fire.conn, { conversationKey: translationKey, messageId: 'es-1', language: 'es', translatedText: 'There is smoke in the library.' }), 'UNAUTHORIZED');
  await recordInboundTranslation(A, { conversationKey: translationKey, messageId: 'es-1', language: 'es', translatedText: 'There is smoke in the library.' });
  await applyIntakePatch(A, { conversationKey: translationKey, expectedRevision: 0, sourceMessageIds: ['es-1'], result: { ...result('REPORT', { fireOrSmoke: true, incidentType: 'smoke', locationText: 'biblioteca' }, ['fireOrSmoke', 'incidentType', 'locationText'].map(field => ({ field: field as keyof CallerFactPatch, messageId: 'es-1', quote: spanish })), 'Smoke at the library.'), unresolvedFields: ['trappedPerson'] }, recommendation: FIRE_REC });
  const translatedInc = getConversationContext(A, translationKey)!.activeIncident!;
  await recordSentQuestion(A, { conversationKey: translationKey, question: 'Is anyone injured?', delivered: true, language: 'es', translatedText: '¿Hay alguien herido?' });
  await waitFor('translation arrives in dispatcher transcript', () => listConversation(dispatcher.conn, translatedInc.id).some(m => m.sender === 'CALLER' && m.translatedText === 'There is smoke in the library.'));
  check('translation storage view remains agent-private', [dispatcher, fire, ems, outsider].every(c => [...c.conn.db.agentMessageTranslation.iter()].length === 0));
  check('translated transcript retains original text and language', listConversation(dispatcher.conn, translatedInc.id).some(m => m.text === spanish && m.language === 'es'));
  check('question transcript stores both authored and delivered language', listConversation(dispatcher.conn, translatedInc.id).some(m => m.text === 'Is anyone injured?' && m.translatedText === '¿Hay alguien herido?'));
  await recordInbound(A, { provider: 'check', conversationKey: translationKey, route: route(translationKey), messages: [msg('es-2', 'No hay heridos.')] });
  await applyIntakePatch(A, { conversationKey: translationKey, expectedRevision: 1, sourceMessageIds: ['es-2'], result: result('REPORT', { injuryReported: false }, [{ field: 'injuryReported', messageId: 'es-2', quote: 'No hay heridos.' }], 'Smoke; nobody injured.'), recommendation: FIRE_REC });
  check('previous unknown answers persist across later turns', getConversationContext(A, translationKey)!.activeIncident!.unresolvedFields.includes('trappedPerson'));
  await recordInbound(A, { provider: 'check', conversationKey: translationKey, route: route(translationKey), messages: [msg('es-status', 'Actualización?')] });
  await completeInboundWithoutPatch(A, { conversationKey: translationKey, messageIds: ['es-status'], intent: 'STATUS_QUERY', replyText: '[SIMULATION] No mock unit assigned yet.' });
  const translatedJob = listPendingNotifications(A).find(n => n.incidentId === translatedInc.id)!;
  check('notifications inherit this case language', translatedJob.callerLanguage === 'es');
  await prepareNotificationTranslation(A, { notificationId: translatedJob.id, language: 'es', translatedText: '[SIMULATION] No hay unidad asignada.' });
  await ackNotification(A, { notificationId: translatedJob.id, delivered: true });
  await waitFor('localized notification is projected', () => listConversation(dispatcher.conn, translatedInc.id).some(m => m.translatedText === '[SIMULATION] No hay unidad asignada.'));
  await closeIncident(dispatcher.conn, { incidentId: translatedInc.id, reason: 'Translation test complete' });
  check('later case does not inherit the prior caller language', getConversationContext(A, translationKey)!.callerLanguage === 'en');
  await rejects('late translation cannot cross a case boundary', recordInboundTranslation(A, { conversationKey: translationKey, messageId: 'es-1', language: 'es', translatedText: 'Stale' }), 'UNKNOWN_MESSAGE');

  // --- Restart recovery: pending intake and unacknowledged notifications ---
  await recordInbound(A, { provider: 'check', conversationKey: KEY2, route: route(KEY2), messages: [msg('t2', 'Still waiting here.')] });
  const before = getConversationContext(A, KEY2);
  const pendingJobsBefore = listPendingNotifications(A).map(n => n.id).join();
  A.disconnect();
  const again = await connectFlare({ uri: URI, database: DB, token: agent.token });
  const after = getConversationContext(again.conn, KEY2);
  check('reconnect restores identity and committed context', again.identityHex === agent.identityHex && JSON.stringify(before) === JSON.stringify(after));
  const pendingContexts = listPendingConversationContexts(again.conn);
  check('reconnect enumerates pending intake with route', pendingContexts.some(c => c.conversationKey === KEY2 && c.pendingMessages.some(m => m.id === 't2') && c.route.spaceId === `space-${KEY2}`));
  const jobs = listPendingNotifications(again.conn);
  check('reconnect enumerates unacknowledged notifications with route', jobs.length > 0 && jobs.map(n => n.id).join() === pendingJobsBefore && jobs.every(n => n.route.spaceId.startsWith('space-check')));

  for (const c of [again, dispatcher, dispatcher2, fire, ems, outsider]) c.conn.disconnect();
  console.log(`\n${checks - failures}/${checks} checks passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
