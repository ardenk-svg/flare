// Focused live checks against a LOCAL SpacetimeDB database. Resets that database first.
// Usage: FLARE_DB=flare-dev npm run check   (requires `spacetime` CLI logged in as the module publisher)
import { execFileSync } from 'node:child_process';
import type { CallerFactPatch, Evidence, ExtractionResult, Intent, Recommendation } from '@flare/contracts';
import {
  ackNotification,
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
  recordExtractionFailure,
  recordInbound,
  recordSentQuestion,
  resolveIncident,
  FlareOpError,
  type FlareConnection,
} from '../src/index.ts';

const URI = process.env.SPACETIMEDB_URI ?? 'ws://127.0.0.1:3000';
const DB = process.env.FLARE_DB ?? 'flare-dev';
const SERVER = 'local'; // never run this against the shared integration database

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
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

  // --- Route privacy ---
  const visible = (c: FlareConnection) =>
    JSON.stringify([...c.conn.db.incidentView.iter(), ...c.conn.db.assignmentView.iter(), ...c.conn.db.unitView.iter(), ...c.conn.db.myRole.iter(), ...c.conn.db.agentConversation.iter(), ...c.conn.db.agentInbound.iter(), ...c.conn.db.agentNotification.iter()], (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  check('route fields invisible to dispatcher and responder', [dispatcher, fire, ems, outsider].every(c => !visible(c).includes('space-check') && !visible(c).includes('check-line')));

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
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
