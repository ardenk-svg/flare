// Flare SpacetimeDB module. Behavior follows docs/CONTRACT.md.
// All state tables are private; clients read role-gated views only.
import { schema, table, t, SenderError, type InferSchema, type ReducerCtx } from 'spacetimedb/server';
import { Identity } from 'spacetimedb';

// ---- Vocabulary (keep in sync with packages/contracts) ----

const SERVICES = ['POLICE', 'FIRE', 'EMS'];
const ROLES = ['ADMIN', 'AGENT', 'DISPATCHER', 'RESPONDER'];
const ASSIGNMENT_ORDER = ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED'];
const BOOL_FIELDS = [
  'callerReportedConscious',
  'callerReportedBreathing',
  'fireOrSmoke',
  'trappedPerson',
  'violentThreat',
  'injuryReported',
];
const TEXT_FIELDS = ['incidentType', 'locationText'];
const COUNT_FIELDS = ['peopleInvolved'];
const FACT_FIELDS = [...TEXT_FIELDS, ...COUNT_FIELDS, ...BOOL_FIELDS];
const RECENT_MESSAGE_LIMIT = 10;
const SEED_UNITS = [
  { id: 'FIRE-01', service: 'FIRE' },
  { id: 'EMS-01', service: 'EMS' },
  { id: 'POLICE-01', service: 'POLICE' },
];

// ---- Types ----

const CallerFacts = t.object('CallerFacts', {
  incidentType: t.option(t.string()),
  locationText: t.option(t.string()),
  peopleInvolved: t.option(t.u32()),
  callerReportedConscious: t.option(t.bool()),
  callerReportedBreathing: t.option(t.bool()),
  fireOrSmoke: t.option(t.bool()),
  trappedPerson: t.option(t.bool()),
  violentThreat: t.option(t.bool()),
  injuryReported: t.option(t.bool()),
});

/** One field of a CallerFactPatch. `Unknown` is an explicit null; omitted fields are absent. */
const FactValue = t.enum('FactValue', {
  Unknown: t.unit(),
  Bool: t.bool(),
  Count: t.u32(),
  Text: t.string(),
});

const FactChange = t.object('FactChange', {
  field: t.string(),
  value: FactValue,
});

const EvidenceInput = t.object('EvidenceInput', {
  field: t.string(),
  messageId: t.string(),
  quote: t.string(),
});

const StoredEvidence = t.object('StoredEvidence', {
  field: t.string(),
  messageId: t.string(),
  quote: t.string(),
  intakeRevision: t.u32(),
});

/** Minimum provider route needed to reopen the original destination after restart. Agent-private. */
const RouteInput = t.object('RouteInput', {
  platform: t.string(),
  spaceId: t.string(),
  line: t.option(t.string()),
});

const InboundInput = t.object('InboundInput', {
  messageId: t.string(),
  text: t.string(),
  receivedAt: t.timestamp(),
});

// ---- Tables ----

const roleGrant = table(
  { name: 'role_grant' },
  {
    identity: t.identity().primaryKey(),
    role: t.string(),
    unitId: t.option(t.string()),
  }
);

const unit = table(
  { name: 'unit' },
  {
    id: t.string().primaryKey(),
    service: t.string(),
    status: t.string(),
  }
);

const incident = table(
  { name: 'incident' },
  {
    id: t.u64().primaryKey().autoInc(),
    conversationId: t.u64().index('btree'),
    facts: CallerFacts,
    evidence: t.array(StoredEvidence),
    summary: t.string(),
    intakeRevision: t.u32(),
    unresolvedFields: t.array(t.string()),
    lastCorrections: t.array(t.string()),
    recommendedServices: t.array(t.string()),
    recommendationRuleIds: t.array(t.string()),
    recommendationReason: t.string(),
    confirmedServices: t.array(t.string()),
    status: t.string(),
    needsReview: t.bool(),
    extractionError: t.option(t.string()),
    extractionState: t.string(),
    caseEpoch: t.u32(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
    closeReason: t.option(t.string()).default(undefined),
  }
);

const assignment = table(
  { name: 'assignment' },
  {
    id: t.u64().primaryKey().autoInc(),
    incidentId: t.u64().index('btree'),
    unitId: t.string().index('btree'),
    service: t.string(),
    status: t.string(),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const conversation = table(
  { name: 'conversation' },
  {
    id: t.u64().primaryKey().autoInc(),
    conversationKey: t.string().unique(),
    activeIncidentId: t.option(t.u64()),
    lastQuestion: t.option(t.string()),
    lastQuestionDelivery: t.option(t.string()),
    lastQuestionError: t.option(t.string()),
    lastQuestionAt: t.option(t.timestamp()),
    caseEpoch: t.u32(),
    routePlatform: t.string(),
    routeSpaceId: t.string(),
    routeLine: t.option(t.string()),
    createdAt: t.timestamp(),
    updatedAt: t.timestamp(),
  }
);

const inboundMessage = table(
  { name: 'inbound_message' },
  {
    id: t.u64().primaryKey().autoInc(),
    dedupeKey: t.string().unique(),
    conversationId: t.u64().index('btree'),
    messageId: t.string(),
    text: t.string(),
    receivedAt: t.timestamp(),
    status: t.string(),
    attempts: t.u32(),
    lastError: t.option(t.string()),
    appliedAt: t.option(t.timestamp()),
    caseEpoch: t.u32(),
  }
);

const notification = table(
  { name: 'notification' },
  {
    id: t.u64().primaryKey().autoInc(),
    conversationId: t.u64().index('btree'),
    incidentId: t.option(t.u64()),
    assignmentId: t.option(t.u64()),
    kind: t.string(),
    text: t.string(),
    eventAssignmentStatus: t.option(t.string()),
    eventAt: t.timestamp(),
    status: t.string(),
    attempts: t.u32(),
    lastError: t.option(t.string()),
    sentAt: t.option(t.timestamp()),
  }
);

const spacetimedb = schema({
  roleGrant,
  unit,
  incident,
  assignment,
  conversation,
  inboundMessage,
  notification,
});
export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
type Grant = { identity: Identity; role: string; unitId: string | undefined };
type ReadCtx = { sender: Identity; db: { roleGrant: { identity: { find(id: Identity): Grant | null } } } };

// ---- Helpers (not exported) ----

function roleOf(ctx: ReadCtx) {
  return ctx.db.roleGrant.identity.find(ctx.sender) ?? undefined;
}

function hasRole(ctx: ReadCtx, ...roles: string[]) {
  const grant = roleOf(ctx);
  return grant !== undefined && (roles.includes(grant.role) || grant.role === 'ADMIN');
}

function requireRole(ctx: Ctx, ...roles: string[]) {
  if (!hasRole(ctx, ...roles)) throw new SenderError(`UNAUTHORIZED: requires ${roles.join(' or ')}`);
  return roleOf(ctx)!;
}

function requireConversation(ctx: Ctx, conversationKey: string) {
  const convo = ctx.db.conversation.conversationKey.find(conversationKey);
  if (!convo) throw new SenderError(`NOT_FOUND: conversation`);
  return convo;
}

function activeIncident(ctx: Ctx, convo: { activeIncidentId: bigint | undefined }) {
  if (convo.activeIncidentId === undefined) return undefined;
  return ctx.db.incident.id.find(convo.activeIncidentId) ?? undefined;
}

/** Source messages by provider ID. Rows from an earlier case are rejected as STALE_CASE. */
function messagesFor(ctx: Ctx, convo: { id: bigint; caseEpoch: number }, messageIds: string[]) {
  const byId = new Map<string, ReturnType<typeof ctx.db.inboundMessage.insert>>();
  for (const row of ctx.db.inboundMessage.conversationId.filter(convo.id)) {
    byId.set(row.messageId, row);
  }
  return messageIds.map(id => {
    const row = byId.get(id);
    if (!row) throw new SenderError(`UNKNOWN_MESSAGE: ${id}`);
    if (row.caseEpoch !== convo.caseEpoch) throw new SenderError(`STALE_CASE: ${id}`);
    return row;
  });
}

function hasPendingInbound(ctx: Ctx, convo: { id: bigint; caseEpoch: number }) {
  for (const row of ctx.db.inboundMessage.conversationId.filter(convo.id)) {
    if (row.caseEpoch === convo.caseEpoch && row.status === 'RECEIVED') return true;
  }
  return false;
}

/** After a successful completion: OK unless more current-case input is still waiting. Clears a stale error. */
function settleExtractionState(ctx: Ctx, convo: { id: bigint; caseEpoch: number; activeIncidentId: bigint | undefined }) {
  const fresh = ctx.db.conversation.id.find(convo.id);
  const inc = fresh ? activeIncident(ctx, fresh) : undefined;
  if (!inc) return;
  const pending = hasPendingInbound(ctx, convo);
  ctx.db.incident.id.update({
    ...inc,
    extractionState: pending ? 'PENDING' : 'OK',
    extractionError: pending ? inc.extractionError : undefined,
    updatedAt: ctx.timestamp,
  });
}

function emptyFacts() {
  return {
    incidentType: undefined,
    locationText: undefined,
    peopleInvolved: undefined,
    callerReportedConscious: undefined,
    callerReportedBreathing: undefined,
    fireOrSmoke: undefined,
    trappedPerson: undefined,
    violentThreat: undefined,
    injuryReported: undefined,
  };
}

function checkServices(services: string[], label: string) {
  for (const s of services) {
    if (!SERVICES.includes(s)) throw new SenderError(`INVALID_SERVICE: ${label} ${s}`);
  }
  if (new Set(services).size !== services.length) throw new SenderError(`DUPLICATE_SERVICE: ${label}`);
}

function parseIdentity(hex: string) {
  const clean = hex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{64}$/i.test(clean)) throw new SenderError('INVALID_IDENTITY');
  return Identity.fromString(clean);
}

function clip(text: string, max = 500) {
  return text.length > max ? text.slice(0, max) : text;
}

function readiness(summary: string, locationText: string | undefined) {
  return summary.trim() !== '' && (locationText ?? '').trim() !== '' ? 'READY_FOR_REVIEW' : 'COLLECTING';
}

function enqueue(
  ctx: Ctx,
  job: {
    conversationId: bigint;
    incidentId?: bigint;
    assignmentId?: bigint;
    kind: string;
    text: string;
    eventAssignmentStatus?: string;
  }
) {
  ctx.db.notification.insert({
    id: 0n,
    conversationId: job.conversationId,
    incidentId: job.incidentId,
    assignmentId: job.assignmentId,
    kind: job.kind,
    text: job.text,
    eventAssignmentStatus: job.eventAssignmentStatus,
    eventAt: ctx.timestamp,
    status: 'PENDING',
    attempts: 0,
    lastError: undefined,
    sentAt: undefined,
  });
}

// ---- Lifecycle ----

/** The publishing identity becomes the demo administrator. */
export const init = spacetimedb.init(ctx => {
  ctx.db.roleGrant.insert({ identity: ctx.sender, role: 'ADMIN', unitId: undefined });
  for (const u of SEED_UNITS) ctx.db.unit.insert({ ...u, status: 'AVAILABLE' });
});

// ---- Admin: operator-controlled allowlist, seed and reset ----

export const grantRole = spacetimedb.reducer(
  { identityHex: t.string(), role: t.string(), unitId: t.option(t.string()) },
  (ctx, { identityHex, role, unitId }) => {
    requireRole(ctx, 'ADMIN');
    const identity = parseIdentity(identityHex);
    if (!ROLES.includes(role)) throw new SenderError(`INVALID_ROLE: ${role}`);
    if (role === 'RESPONDER') {
      if (!unitId || !ctx.db.unit.id.find(unitId)) throw new SenderError('RESPONDER_REQUIRES_UNIT');
    } else if (unitId !== undefined) {
      throw new SenderError('UNIT_ONLY_FOR_RESPONDER');
    }
    const row = { identity, role, unitId };
    if (ctx.db.roleGrant.identity.find(identity)) ctx.db.roleGrant.identity.update(row);
    else ctx.db.roleGrant.insert(row);
  }
);

export const revokeRole = spacetimedb.reducer({ identityHex: t.string() }, (ctx, { identityHex }) => {
  requireRole(ctx, 'ADMIN');
  const identity = parseIdentity(identityHex);
  if (identity.isEqual(ctx.sender)) throw new SenderError('CANNOT_REVOKE_SELF');
  ctx.db.roleGrant.identity.delete(identity);
});

/** Clears demo incidents, conversations, messages and notifications; reseeds units. Keeps role grants. */
export const resetDemo = spacetimedb.reducer(ctx => {
  requireRole(ctx, 'ADMIN');
  for (const row of [...ctx.db.notification.iter()]) ctx.db.notification.id.delete(row.id);
  for (const row of [...ctx.db.assignment.iter()]) ctx.db.assignment.id.delete(row.id);
  for (const row of [...ctx.db.incident.iter()]) ctx.db.incident.id.delete(row.id);
  for (const row of [...ctx.db.inboundMessage.iter()]) ctx.db.inboundMessage.id.delete(row.id);
  for (const row of [...ctx.db.conversation.iter()]) ctx.db.conversation.id.delete(row.id);
  for (const u of SEED_UNITS) {
    const row = { ...u, status: 'AVAILABLE' };
    if (ctx.db.unit.id.find(u.id)) ctx.db.unit.id.update(row);
    else ctx.db.unit.insert(row);
  }
});

// ---- Agent intake operations ----

export const recordInbound = spacetimedb.reducer(
  { provider: t.string(), conversationKey: t.string(), route: RouteInput, messages: t.array(InboundInput) },
  (ctx, { provider, conversationKey, route, messages }) => {
    requireRole(ctx, 'AGENT');
    if (conversationKey.trim() === '') throw new SenderError('INVALID_CONVERSATION_KEY');
    if (route.platform.trim() === '' || route.spaceId.trim() === '') throw new SenderError('INVALID_ROUTE');
    let convo = ctx.db.conversation.conversationKey.find(conversationKey);
    if (!convo) {
      convo = ctx.db.conversation.insert({
        id: 0n,
        conversationKey,
        activeIncidentId: undefined,
        lastQuestion: undefined,
        lastQuestionDelivery: undefined,
        lastQuestionError: undefined,
        lastQuestionAt: undefined,
        caseEpoch: 1,
        routePlatform: route.platform,
        routeSpaceId: route.spaceId,
        routeLine: route.line,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
    } else if (
      convo.routePlatform !== route.platform ||
      convo.routeSpaceId !== route.spaceId ||
      convo.routeLine !== route.line
    ) {
      convo = { ...convo, routePlatform: route.platform, routeSpaceId: route.spaceId, routeLine: route.line, updatedAt: ctx.timestamp };
      ctx.db.conversation.id.update(convo);
    }
    let inserted = false;
    for (const m of messages) {
      const dedupeKey = `${provider}\u0000${conversationKey}\u0000${m.messageId}`;
      if (ctx.db.inboundMessage.dedupeKey.find(dedupeKey)) continue; // duplicate delivery: no-op
      ctx.db.inboundMessage.insert({
        id: 0n,
        dedupeKey,
        conversationId: convo.id,
        messageId: m.messageId,
        text: m.text,
        receivedAt: m.receivedAt,
        status: 'RECEIVED',
        attempts: 0,
        lastError: undefined,
        appliedAt: undefined,
        caseEpoch: convo.caseEpoch,
      });
      inserted = true;
    }
    const inc = activeIncident(ctx, convo);
    if (inserted && inc && inc.extractionState !== 'PENDING') {
      ctx.db.incident.id.update({ ...inc, extractionState: 'PENDING', updatedAt: ctx.timestamp });
    }
  }
);

export const recordExtractionFailure = spacetimedb.reducer(
  { conversationKey: t.string(), messageIds: t.array(t.string()), code: t.string(), message: t.string() },
  (ctx, { conversationKey, messageIds, code, message }) => {
    requireRole(ctx, 'AGENT');
    const convo = requireConversation(ctx, conversationKey);
    const error = clip(`${code}: ${message}`);
    for (const row of messagesFor(ctx, convo, messageIds)) {
      if (row.status !== 'RECEIVED') continue;
      ctx.db.inboundMessage.id.update({ ...row, attempts: row.attempts + 1, lastError: error });
    }
    const inc = activeIncident(ctx, convo);
    if (inc) {
      ctx.db.incident.id.update({ ...inc, extractionError: error, extractionState: 'FAILED', updatedAt: ctx.timestamp });
    }
  }
);

export const applyIntakePatch = spacetimedb.reducer(
  {
    conversationKey: t.string(),
    expectedRevision: t.u32(),
    sourceMessageIds: t.array(t.string()),
    intent: t.string(),
    changes: t.array(FactChange),
    summary: t.string(),
    evidence: t.array(EvidenceInput),
    corrections: t.array(t.string()),
    unresolvedFields: t.array(t.string()),
    recommendedServices: t.array(t.string()),
    recommendationRuleIds: t.array(t.string()),
    recommendationReason: t.string(),
  },
  (ctx, args) => {
    requireRole(ctx, 'AGENT');
    const convo = requireConversation(ctx, args.conversationKey);
    if (args.intent !== 'REPORT' && args.intent !== 'CORRECTION') {
      throw new SenderError('INVALID_INTENT: use completeInboundWithoutPatch for STATUS_QUERY/OTHER');
    }
    if (args.sourceMessageIds.length === 0) throw new SenderError('NO_SOURCE_MESSAGES');
    const sources = messagesFor(ctx, convo, args.sourceMessageIds);
    const applied = sources.filter(m => m.status === 'APPLIED').length;
    if (applied === sources.length) return; // duplicate batch already committed: harmless no-op
    if (applied > 0) throw new SenderError('PARTIALLY_APPLIED_SOURCES');

    let inc = activeIncident(ctx, convo);
    const currentRevision = inc?.intakeRevision ?? 0;
    if (args.expectedRevision !== currentRevision) {
      throw new SenderError(`STALE_REVISION: expected ${args.expectedRevision}, current ${currentRevision}`);
    }

    // Validate patch shape.
    const changed = new Set<string>();
    for (const c of args.changes) {
      if (!FACT_FIELDS.includes(c.field)) throw new SenderError(`INVALID_FIELD: ${c.field}`);
      if (changed.has(c.field)) throw new SenderError(`DUPLICATE_FIELD: ${c.field}`);
      changed.add(c.field);
      const tag = c.value.tag;
      const ok =
        tag === 'Unknown' ||
        (tag === 'Bool' && BOOL_FIELDS.includes(c.field)) ||
        (tag === 'Text' && TEXT_FIELDS.includes(c.field)) ||
        (tag === 'Count' && COUNT_FIELDS.includes(c.field));
      if (!ok) throw new SenderError(`INVALID_VALUE_TYPE: ${c.field}`);
    }
    for (const f of [...args.corrections, ...args.unresolvedFields]) {
      if (!FACT_FIELDS.includes(f)) throw new SenderError(`INVALID_FIELD: ${f}`);
    }
    checkServices(args.recommendedServices, 'recommended');

    // Every changed fact needs evidence quoted from a caller message of this conversation's current case.
    const known = new Map<string, string>();
    for (const row of ctx.db.inboundMessage.conversationId.filter(convo.id)) {
      if (row.caseEpoch === convo.caseEpoch) known.set(row.messageId, row.text);
    }
    for (const e of args.evidence) {
      if (!FACT_FIELDS.includes(e.field)) throw new SenderError(`INVALID_FIELD: ${e.field}`);
      const text = known.get(e.messageId);
      if (text === undefined) throw new SenderError(`UNKNOWN_EVIDENCE_MESSAGE: ${e.messageId}`);
      if (e.quote.trim() === '' || !text.includes(e.quote)) {
        throw new SenderError(`EVIDENCE_QUOTE_MISMATCH: ${e.field}`);
      }
    }
    for (const f of changed) {
      if (!args.evidence.some(e => e.field === f)) throw new SenderError(`MISSING_EVIDENCE: ${f}`);
    }

    // Create the partial incident on the first accepted report/correction.
    if (!inc) {
      inc = ctx.db.incident.insert({
        id: 0n,
        conversationId: convo.id,
        facts: emptyFacts(),
        evidence: [],
        summary: '',
        intakeRevision: 0,
        unresolvedFields: [],
        lastCorrections: [],
        recommendedServices: [],
        recommendationRuleIds: [],
        recommendationReason: '',
        confirmedServices: [],
        status: 'COLLECTING',
        needsReview: false,
        extractionError: undefined,
        extractionState: 'PENDING',
        caseEpoch: convo.caseEpoch,
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
        closeReason: undefined,
      });
      ctx.db.conversation.id.update({ ...convo, activeIncidentId: inc.id, updatedAt: ctx.timestamp });
    }

    const nextRevision = inc.intakeRevision + 1;
    const facts: Record<string, unknown> = { ...inc.facts };
    for (const c of args.changes) facts[c.field] = c.value.tag === 'Unknown' ? undefined : c.value.value;
    const evidence = [
      ...inc.evidence.filter(e => !changed.has(e.field)),
      ...args.evidence.map(e => ({ ...e, intakeRevision: nextRevision })),
    ];

    let status = inc.status;
    let needsReview = inc.needsReview;
    if (status === 'COLLECTING' || status === 'READY_FOR_REVIEW') {
      status = readiness(args.summary, facts.locationText as string | undefined);
    } else if (changed.size > 0) {
      needsReview = true; // after dispatch: keep lifecycle, flag material changes
    }

    ctx.db.incident.id.update({
      ...inc,
      facts: facts as typeof inc.facts,
      evidence,
      summary: args.summary,
      intakeRevision: nextRevision,
      unresolvedFields: args.unresolvedFields,
      lastCorrections: args.corrections,
      recommendedServices: args.recommendedServices,
      recommendationRuleIds: args.recommendationRuleIds,
      recommendationReason: args.recommendationReason,
      status,
      needsReview,
      extractionError: undefined,
      updatedAt: ctx.timestamp,
    });
    for (const m of sources) {
      ctx.db.inboundMessage.id.update({ ...m, status: 'APPLIED', lastError: undefined, appliedAt: ctx.timestamp });
    }
    settleExtractionState(ctx, convo);
  }
);

export const completeInboundWithoutPatch = spacetimedb.reducer(
  { conversationKey: t.string(), messageIds: t.array(t.string()), intent: t.string(), replyText: t.option(t.string()) },
  (ctx, { conversationKey, messageIds, intent, replyText }) => {
    requireRole(ctx, 'AGENT');
    if (intent !== 'STATUS_QUERY' && intent !== 'OTHER') throw new SenderError(`INVALID_INTENT: ${intent}`);
    const convo = requireConversation(ctx, conversationKey);
    const sources = messagesFor(ctx, convo, messageIds);
    if (sources.every(m => m.status === 'APPLIED')) return; // duplicate: no-op, no second reply
    for (const m of sources) {
      if (m.status === 'APPLIED') continue;
      ctx.db.inboundMessage.id.update({ ...m, status: 'APPLIED', lastError: undefined, appliedAt: ctx.timestamp });
    }
    settleExtractionState(ctx, convo);
    if (replyText !== undefined && replyText.trim() !== '') {
      enqueue(ctx, {
        conversationId: convo.id,
        incidentId: convo.activeIncidentId,
        kind: 'INFO_REPLY',
        text: replyText,
      });
    }
  }
);

export const recordSentQuestion = spacetimedb.reducer(
  { conversationKey: t.string(), question: t.string(), delivered: t.bool(), error: t.option(t.string()) },
  (ctx, { conversationKey, question, delivered, error }) => {
    requireRole(ctx, 'AGENT');
    const convo = requireConversation(ctx, conversationKey);
    ctx.db.conversation.id.update({
      ...convo,
      lastQuestion: question,
      lastQuestionDelivery: delivered ? 'SENT' : 'FAILED',
      lastQuestionError: delivered ? undefined : clip(error ?? 'delivery failed'),
      lastQuestionAt: ctx.timestamp,
      updatedAt: ctx.timestamp,
    });
  }
);

export const ackNotification = spacetimedb.reducer(
  { notificationId: t.u64(), delivered: t.bool(), error: t.option(t.string()) },
  (ctx, { notificationId, delivered, error }) => {
    requireRole(ctx, 'AGENT');
    const job = ctx.db.notification.id.find(notificationId);
    if (!job) throw new SenderError('NOT_FOUND: notification');
    if (job.status === 'SENT') return; // already acknowledged
    ctx.db.notification.id.update({
      ...job,
      attempts: job.attempts + 1,
      status: delivered ? 'SENT' : 'FAILED',
      lastError: delivered ? undefined : clip(error ?? 'delivery failed'),
      sentAt: delivered ? ctx.timestamp : undefined,
    });
  }
);

// ---- Dispatcher operations ----

export const confirmDispatchAndAssign = spacetimedb.reducer(
  { incidentId: t.u64(), confirmedServices: t.array(t.string()), unitIds: t.array(t.string()) },
  (ctx, { incidentId, confirmedServices, unitIds }) => {
    requireRole(ctx, 'DISPATCHER');
    const inc = ctx.db.incident.id.find(incidentId);
    if (!inc) throw new SenderError('NOT_FOUND: incident');
    if (inc.status === 'DISPATCHED' || inc.status === 'RESOLVED') throw new SenderError('ALREADY_DISPATCHED');
    if (inc.status === 'CLOSED') throw new SenderError('INCIDENT_CLOSED');
    if (inc.status !== 'READY_FOR_REVIEW') throw new SenderError('NOT_READY');
    if (confirmedServices.length === 0) throw new SenderError('NO_CONFIRMED_SERVICES');
    if (unitIds.length === 0) throw new SenderError('NO_UNITS_SELECTED');
    checkServices(confirmedServices, 'confirmed');
    if (new Set(unitIds).size !== unitIds.length) throw new SenderError('DUPLICATE_UNIT');

    const units = unitIds.map(id => {
      const u = ctx.db.unit.id.find(id);
      if (!u) throw new SenderError(`NOT_FOUND: unit ${id}`);
      if (!confirmedServices.includes(u.service)) throw new SenderError(`UNIT_SERVICE_MISMATCH: ${id}`);
      if (u.status !== 'AVAILABLE') throw new SenderError(`UNIT_CONFLICT: ${id} is ${u.status}`);
      return u;
    });
    for (const s of confirmedServices) {
      if (!units.some(u => u.service === s)) throw new SenderError(`SERVICE_WITHOUT_UNIT: ${s}`);
    }

    for (const u of units) {
      ctx.db.unit.id.update({ ...u, status: 'BUSY' });
      ctx.db.assignment.insert({
        id: 0n,
        incidentId,
        unitId: u.id,
        service: u.service,
        status: 'OFFERED',
        createdAt: ctx.timestamp,
        updatedAt: ctx.timestamp,
      });
    }
    ctx.db.incident.id.update({ ...inc, confirmedServices, status: 'DISPATCHED', updatedAt: ctx.timestamp });
    enqueue(ctx, {
      conversationId: inc.conversationId,
      incidentId,
      kind: 'DISPATCH_CONFIRMED',
      text:
        `[SIMULATION] A dispatcher assigned mock unit(s) ${unitIds.join(', ')} ` +
        `(${confirmedServices.join(', ')}) to your report. No real emergency services were contacted.`,
    });
  }
);

/** Ends the conversation's association with a finished incident and starts a fresh intake case. */
function endCase(ctx: Ctx, inc: { id: bigint; conversationId: bigint }) {
  const convo = ctx.db.conversation.id.find(inc.conversationId);
  if (!convo || convo.activeIncidentId !== inc.id) return undefined;
  // Later context reads exclude this case's messages and question.
  ctx.db.conversation.id.update({
    ...convo,
    activeIncidentId: undefined,
    caseEpoch: convo.caseEpoch + 1,
    lastQuestion: undefined,
    lastQuestionDelivery: undefined,
    lastQuestionError: undefined,
    lastQuestionAt: undefined,
    updatedAt: ctx.timestamp,
  });
  return convo;
}

export const resolveIncident = spacetimedb.reducer({ incidentId: t.u64() }, (ctx, { incidentId }) => {
  requireRole(ctx, 'DISPATCHER');
  const inc = ctx.db.incident.id.find(incidentId);
  if (!inc) throw new SenderError('NOT_FOUND: incident');
  if (inc.status !== 'DISPATCHED') throw new SenderError(`NOT_DISPATCHED: ${inc.status}`);
  const assignments = [...ctx.db.assignment.incidentId.filter(incidentId)];
  if (assignments.length === 0 || assignments.some(a => a.status !== 'COMPLETED')) {
    throw new SenderError('ASSIGNMENTS_NOT_COMPLETED');
  }
  ctx.db.incident.id.update({ ...inc, status: 'RESOLVED', updatedAt: ctx.timestamp });
  endCase(ctx, inc);
});

/** Closes a never-dispatched incident (test text, duplicate, no unit needed) so the caller can start a new case. */
export const closeIncident = spacetimedb.reducer(
  { incidentId: t.u64(), reason: t.string() },
  (ctx, { incidentId, reason }) => {
    requireRole(ctx, 'DISPATCHER');
    const inc = ctx.db.incident.id.find(incidentId);
    if (!inc) throw new SenderError('NOT_FOUND: incident');
    if (inc.status !== 'COLLECTING' && inc.status !== 'READY_FOR_REVIEW') {
      throw new SenderError(`NOT_CLOSABLE: ${inc.status}`);
    }
    if (!ctx.db.assignment.incidentId.filter(incidentId).next().done) throw new SenderError('HAS_ASSIGNMENTS');
    if (reason.trim() === '') throw new SenderError('REASON_REQUIRED');
    ctx.db.incident.id.update({ ...inc, status: 'CLOSED', closeReason: clip(reason.trim(), 200), updatedAt: ctx.timestamp });
    if (endCase(ctx, inc)) {
      enqueue(ctx, {
        conversationId: inc.conversationId,
        incidentId,
        kind: 'INFO_REPLY',
        text:
          '[SIMULATION] A dispatcher closed your mock report without dispatching a unit. ' +
          'No real emergency services were contacted. Text again to start a new report.',
      });
    }
  }
);

// ---- Responder operations ----

export const advanceAssignment = spacetimedb.reducer(
  { assignmentId: t.u64(), nextStatus: t.string() },
  (ctx, { assignmentId, nextStatus }) => {
    const grant = requireRole(ctx, 'RESPONDER');
    const a = ctx.db.assignment.id.find(assignmentId);
    if (!a) throw new SenderError('NOT_FOUND: assignment');
    if (grant.role === 'RESPONDER' && grant.unitId !== a.unitId) throw new SenderError('UNAUTHORIZED: not your unit');
    const expected = ASSIGNMENT_ORDER[ASSIGNMENT_ORDER.indexOf(a.status) + 1];
    if (expected === undefined || nextStatus !== expected) {
      throw new SenderError(`INVALID_TRANSITION: ${a.status} -> ${nextStatus}`);
    }
    ctx.db.assignment.id.update({ ...a, status: nextStatus, updatedAt: ctx.timestamp });

    if (nextStatus === 'COMPLETED') {
      const u = ctx.db.unit.id.find(a.unitId);
      if (u) ctx.db.unit.id.update({ ...u, status: 'AVAILABLE' });
    }
    if (nextStatus === 'EN_ROUTE') {
      const inc = ctx.db.incident.id.find(a.incidentId);
      if (inc) {
        enqueue(ctx, {
          conversationId: inc.conversationId,
          incidentId: inc.id,
          assignmentId: a.id,
          kind: 'ASSIGNMENT_EN_ROUTE',
          eventAssignmentStatus: 'EN_ROUTE',
          text: `[SIMULATION] Mock unit ${a.unitId} (${a.service}) is marked en route. This is a simulated status update.`,
        });
      }
    }
  }
);

// ---- Views (authorized projections) ----

const MyRole = t.object('RoleInfo', {
  role: t.string(),
  unitId: t.option(t.string()),
});

const AgentConversation = t.row('ConversationContextRow', {
  id: t.u64().primaryKey(),
  conversationKey: t.string(),
  activeIncidentId: t.option(t.u64()),
  lastQuestion: t.option(t.string()),
  lastQuestionDelivery: t.option(t.string()),
  lastQuestionError: t.option(t.string()),
  caseEpoch: t.u32(),
  routePlatform: t.string(),
  routeSpaceId: t.string(),
  routeLine: t.option(t.string()),
});

const AgentInbound = t.row('InboundContextRow', {
  id: t.u64().primaryKey(),
  conversationId: t.u64(),
  messageId: t.string(),
  text: t.string(),
  receivedAt: t.timestamp(),
  status: t.string(),
  attempts: t.u32(),
  lastError: t.option(t.string()),
  caseEpoch: t.u32(),
});

const AgentNotification = t.row('PendingNotificationRow', {
  id: t.u64().primaryKey(),
  conversationKey: t.string(),
  routePlatform: t.string(),
  routeSpaceId: t.string(),
  routeLine: t.option(t.string()),
  incidentId: t.option(t.u64()),
  assignmentId: t.option(t.u64()),
  kind: t.string(),
  text: t.string(),
  eventAssignmentStatus: t.option(t.string()),
  eventAt: t.timestamp(),
  status: t.string(),
  attempts: t.u32(),
  lastError: t.option(t.string()),
});

export const myRole = spacetimedb.view({ name: 'my_role', public: true }, t.option(MyRole), ctx => {
  const grant = ctx.db.roleGrant.identity.find(ctx.sender);
  return grant ? { role: grant.role, unitId: grant.unitId } : undefined;
});

export const unitView = spacetimedb.view({ name: 'unit_view', public: true }, t.array(unit.rowType), ctx =>
  hasRole(ctx, 'DISPATCHER', 'RESPONDER', 'AGENT') ? [...ctx.db.unit.iter()] : []
);

/** Dispatcher/agent: every incident. Responder: incidents its unit is assigned to. */
export const incidentView = spacetimedb.view(
  { name: 'incident_view', public: true },
  t.array(incident.rowType),
  ctx => {
    const grant = roleOf(ctx);
    if (!grant) return [];
    if (grant.role !== 'RESPONDER') return [...ctx.db.incident.iter()];
    const ids = new Set<bigint>();
    for (const a of ctx.db.assignment.unitId.filter(grant.unitId ?? '')) ids.add(a.incidentId);
    return [...ids].map(id => ctx.db.incident.id.find(id)).filter(i => i !== null && i !== undefined);
  }
);

/** Dispatcher/agent: every assignment. Responder: its own unit's assignments. */
export const assignmentView = spacetimedb.view(
  { name: 'assignment_view', public: true },
  t.array(assignment.rowType),
  ctx => {
    const grant = roleOf(ctx);
    if (!grant) return [];
    if (grant.role !== 'RESPONDER') return [...ctx.db.assignment.iter()];
    return [...ctx.db.assignment.unitId.filter(grant.unitId ?? '')];
  }
);

export const agentConversation = spacetimedb.view(
  { name: 'agent_conversation', public: true },
  t.array(AgentConversation),
  ctx => {
    if (!hasRole(ctx, 'AGENT')) return [];
    return [...ctx.db.conversation.iter()].map(c => ({
      id: c.id,
      conversationKey: c.conversationKey,
      activeIncidentId: c.activeIncidentId,
      lastQuestion: c.lastQuestion,
      lastQuestionDelivery: c.lastQuestionDelivery,
      lastQuestionError: c.lastQuestionError,
      caseEpoch: c.caseEpoch,
      routePlatform: c.routePlatform,
      routeSpaceId: c.routeSpaceId,
      routeLine: c.routeLine,
    }));
  }
);

/** Agent: current-case unapplied messages plus the most recent applied ones. Earlier cases stay stored but hidden. */
export const agentInbound = spacetimedb.view({ name: 'agent_inbound', public: true }, t.array(AgentInbound), ctx => {
  if (!hasRole(ctx, 'AGENT')) return [];
  const out = [];
  for (const c of ctx.db.conversation.iter()) {
    const rows = [...ctx.db.inboundMessage.conversationId.filter(c.id)].filter(r => r.caseEpoch === c.caseEpoch).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
    const applied = rows.filter(r => r.status === 'APPLIED').slice(-RECENT_MESSAGE_LIMIT);
    const pending = rows.filter(r => r.status !== 'APPLIED');
    for (const r of [...applied, ...pending]) {
      out.push({
        id: r.id,
        conversationId: r.conversationId,
        messageId: r.messageId,
        text: r.text,
        receivedAt: r.receivedAt,
        status: r.status,
        attempts: r.attempts,
        lastError: r.lastError,
        caseEpoch: r.caseEpoch,
      });
    }
  }
  return out;
});

/** Agent: notification jobs not yet acknowledged as sent. */
export const agentNotification = spacetimedb.view(
  { name: 'agent_notification', public: true },
  t.array(AgentNotification),
  ctx => {
    if (!hasRole(ctx, 'AGENT')) return [];
    const out = [];
    for (const n of ctx.db.notification.iter()) {
      if (n.status === 'SENT') continue;
      const convo = ctx.db.conversation.id.find(n.conversationId);
      if (!convo) continue;
      out.push({
        id: n.id,
        conversationKey: convo.conversationKey,
        routePlatform: convo.routePlatform,
        routeSpaceId: convo.routeSpaceId,
        routeLine: convo.routeLine,
        incidentId: n.incidentId,
        assignmentId: n.assignmentId,
        kind: n.kind,
        text: n.text,
        eventAssignmentStatus: n.eventAssignmentStatus,
        eventAt: n.eventAt,
        status: n.status,
        attempts: n.attempts,
        lastError: n.lastError,
      });
    }
    return out;
  }
);
