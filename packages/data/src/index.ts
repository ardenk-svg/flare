// Thin data adapter over the generated SpacetimeDB bindings.
// Converts native IDs/timestamps to the string/ISO shapes in @flare/contracts.
import { Timestamp, type Identity } from 'spacetimedb';
import {
  CALLER_FACT_FIELDS,
  CALLER_FACT_KINDS,
  emptyFacts,
  type Assignment,
  type AssignmentStatus,
  type CallerFactField,
  type CallerFacts,
  type CallerMessage,
  type ConversationContext,
  type ExtractionOutcome,
  type ExtractionResult,
  type Incident,
  type IncidentStatus,
  type NotificationKind,
  type PendingNotification,
  type QuestionDelivery,
  type Recommendation,
  type Role,
  type Service,
  type StoredEvidence,
  type Unit,
  type UnitStatus,
} from '@flare/contracts';
import { DbConnection, tables, type ErrorContext } from './bindings/index';

export { DbConnection, tables } from './bindings/index';

type IncidentRow = ReturnType<DbConnection['db']['incidentView']['iter']> extends Iterable<infer R> ? R : never;
type AssignmentRow = ReturnType<DbConnection['db']['assignmentView']['iter']> extends Iterable<infer R> ? R : never;
type UnitRow = ReturnType<DbConnection['db']['unitView']['iter']> extends Iterable<infer R> ? R : never;
type NotificationRow = ReturnType<DbConnection['db']['agentNotification']['iter']> extends Iterable<infer R>
  ? R
  : never;

/** Every authorized projection. Each returns rows only for the matching role. */
export const ALL_VIEWS = [
  tables.myRole,
  tables.unitView,
  tables.incidentView,
  tables.assignmentView,
  tables.agentConversation,
  tables.agentInbound,
  tables.agentNotification,
];

// ---- Errors ----

/** Reducer rejection. `code` is the prefix before ':' (e.g. STALE_REVISION, UNIT_CONFLICT, UNAUTHORIZED). */
export class FlareOpError extends Error {
  readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = 'FlareOpError';
    this.code = message.split(':')[0].trim();
  }
}

async function call(op: Promise<void>): Promise<void> {
  try {
    await op;
  } catch (err) {
    throw new FlareOpError(err instanceof Error ? err.message : String(err));
  }
}

// ---- Conversions ----

export const toIso = (ts: Timestamp): string => ts.toDate().toISOString();
export const fromIso = (iso: string): Timestamp => Timestamp.fromDate(new Date(iso));
export const toId = (id: bigint): string => id.toString();
export const fromId = (id: string): bigint => BigInt(id);
const nul = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

export function toFacts(row: IncidentRow['facts']): CallerFacts {
  const facts = emptyFacts();
  for (const f of CALLER_FACT_FIELDS) (facts as unknown as Record<string, unknown>)[f] = nul(row[f]);
  return facts;
}

export function toIncident(row: IncidentRow): Incident {
  return {
    id: toId(row.id),
    facts: toFacts(row.facts),
    evidence: row.evidence.map(e => ({ ...e, field: e.field as CallerFactField }) as StoredEvidence),
    summary: row.summary,
    intakeRevision: row.intakeRevision,
    unresolvedFields: row.unresolvedFields as CallerFactField[],
    lastCorrections: row.lastCorrections as CallerFactField[],
    recommendedServices: row.recommendedServices as Service[],
    recommendationRuleIds: row.recommendationRuleIds,
    recommendationReason: row.recommendationReason,
    confirmedServices: row.confirmedServices as Service[],
    status: row.status as IncidentStatus,
    needsReview: row.needsReview,
    extractionError: nul(row.extractionError),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: toId(row.id),
    incidentId: toId(row.incidentId),
    unitId: row.unitId,
    service: row.service as Service,
    status: row.status as AssignmentStatus,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export function toUnit(row: UnitRow): Unit {
  return { id: row.id, service: row.service as Service, status: row.status as UnitStatus };
}

export function toPendingNotification(row: NotificationRow): PendingNotification {
  return {
    id: toId(row.id),
    conversationKey: row.conversationKey,
    incidentId: row.incidentId === undefined ? null : toId(row.incidentId),
    assignmentId: row.assignmentId === undefined ? null : toId(row.assignmentId),
    kind: row.kind as NotificationKind,
    text: row.text,
    eventAssignmentStatus: nul(row.eventAssignmentStatus) as AssignmentStatus | null,
    eventAt: toIso(row.eventAt),
    attempts: row.attempts,
    lastError: nul(row.lastError),
  };
}

// ---- Connection ----

export interface ConnectOptions {
  uri: string; // e.g. ws://127.0.0.1:3000
  database: string; // e.g. flare-dev
  token?: string; // persisted identity token; omit to mint a new identity
  onDisconnect?: (error?: Error) => void;
}

export interface FlareConnection {
  conn: DbConnection;
  identity: Identity;
  identityHex: string;
  token: string;
}

/** Connects and resolves once every authorized view's initial subscription has applied. */
export function connectFlare(opts: ConnectOptions): Promise<FlareConnection> {
  return new Promise((resolve, reject) => {
    DbConnection.builder()
      .withUri(opts.uri)
      .withDatabaseName(opts.database)
      .withToken(opts.token)
      .onConnect((conn, identity, token) => {
        conn
          .subscriptionBuilder()
          .onApplied(() => resolve({ conn, identity, identityHex: identity.toHexString(), token }))
          .onError(ctx => reject(ctx.event ?? new Error('subscription failed')))
          .subscribe(ALL_VIEWS);
      })
      .onConnectError((_ctx: ErrorContext, err: Error) => reject(err))
      .onDisconnect((_ctx, err) => opts.onDisconnect?.(err ?? undefined))
      .build();
  });
}

export function getMyRole(conn: DbConnection): { role: Role; unitId: string | null } | null {
  for (const r of conn.db.myRole.iter()) return { role: r.role as Role, unitId: nul(r.unitId) };
  return null;
}

// ---- Shared reads ----

export const listIncidents = (conn: DbConnection): Incident[] =>
  [...conn.db.incidentView.iter()].map(toIncident).sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));

export const listAssignments = (conn: DbConnection): Assignment[] =>
  [...conn.db.assignmentView.iter()].map(toAssignment).sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));

export const listUnits = (conn: DbConnection): Unit[] =>
  [...conn.db.unitView.iter()].map(toUnit).sort((a, b) => a.id.localeCompare(b.id));

// ---- Agent operations ----

const RECENT_LIMIT = 10;

/** Committed context for one conversation, or null if no message was ever recorded for it. */
export function getConversationContext(conn: DbConnection, conversationKey: string): ConversationContext | null {
  const convo = [...conn.db.agentConversation.iter()].find(c => c.conversationKey === conversationKey);
  if (!convo) return null;
  const incidentRow =
    convo.activeIncidentId === undefined
      ? undefined
      : [...conn.db.incidentView.iter()].find(i => i.id === convo.activeIncidentId);
  const activeIncident = incidentRow ? toIncident(incidentRow) : null;
  const rows = [...conn.db.agentInbound.iter()]
    .filter(m => m.conversationId === convo.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const asMessage = (m: (typeof rows)[number]): CallerMessage => ({
    id: m.messageId,
    text: m.text,
    receivedAt: toIso(m.receivedAt),
  });
  const pending = rows.filter(m => m.status !== 'APPLIED');
  const lastError = [...pending].reverse().find(m => m.lastError !== undefined)?.lastError;
  return {
    conversationKey,
    activeIncident,
    intakeRevision: activeIncident?.intakeRevision ?? 0,
    currentFacts: activeIncident?.facts ?? emptyFacts(),
    currentSummary: activeIncident?.summary ?? '',
    lastQuestion: nul(convo.lastQuestion),
    lastQuestionDelivery: nul(convo.lastQuestionDelivery) as QuestionDelivery | null,
    pendingMessages: pending.map(asMessage),
    recentMessages: rows.filter(m => m.status === 'APPLIED').slice(-RECENT_LIMIT).map(asMessage),
    lastExtractionError: nul(lastError),
  };
}

/** Saves caller messages idempotently (provider + conversation + message ID) and returns committed context. */
export async function recordInbound(
  conn: DbConnection,
  input: { provider: string; conversationKey: string; messages: CallerMessage[] }
): Promise<ConversationContext> {
  await call(
    conn.reducers.recordInbound({
      provider: input.provider,
      conversationKey: input.conversationKey,
      messages: input.messages.map(m => ({ messageId: m.id, text: m.text, receivedAt: fromIso(m.receivedAt) })),
    })
  );
  return getConversationContext(conn, input.conversationKey)!;
}

/** Records a typed extraction failure. Messages stay RECEIVED and retryable; facts are untouched. */
export function recordExtractionFailure(
  conn: DbConnection,
  input: {
    conversationKey: string;
    messageIds: string[];
    error: Extract<ExtractionOutcome, { ok: false }>['error'];
  }
): Promise<void> {
  return call(
    conn.reducers.recordExtractionFailure({
      conversationKey: input.conversationKey,
      messageIds: input.messageIds,
      code: input.error.code,
      message: input.error.message,
    })
  );
}

/** Converts a contract patch (omitted = keep, null = unknown) into the reducer's change list. */
export function patchToChanges(patch: ExtractionResult['patch']) {
  const changes = [];
  for (const field of CALLER_FACT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const v = patch[field];
    if (v === undefined) continue;
    if (v === null) {
      changes.push({ field, value: { tag: 'Unknown' as const, value: {} } });
      continue;
    }
    const kind = CALLER_FACT_KINDS[field];
    if (kind === 'bool') changes.push({ field, value: { tag: 'Bool' as const, value: v as boolean } });
    else if (kind === 'count') changes.push({ field, value: { tag: 'Count' as const, value: v as number } });
    else changes.push({ field, value: { tag: 'Text' as const, value: v as string } });
  }
  return changes;
}

/**
 * Applies an accepted REPORT/CORRECTION. Rejects with FlareOpError code STALE_REVISION if another
 * result committed first: reload context with getConversationContext and retry unapplied messages.
 * Re-applying an already APPLIED batch is a no-op.
 */
export function applyIntakePatch(
  conn: DbConnection,
  input: {
    conversationKey: string;
    expectedRevision: number;
    sourceMessageIds: string[];
    result: ExtractionResult;
    recommendation: Recommendation;
  }
): Promise<void> {
  const { result, recommendation } = input;
  return call(
    conn.reducers.applyIntakePatch({
      conversationKey: input.conversationKey,
      expectedRevision: input.expectedRevision,
      sourceMessageIds: input.sourceMessageIds,
      intent: result.intent,
      changes: patchToChanges(result.patch),
      summary: result.summary,
      evidence: result.evidence,
      corrections: result.corrections,
      unresolvedFields: result.unresolvedFields,
      recommendedServices: recommendation.services,
      recommendationRuleIds: recommendation.ruleIds,
      recommendationReason: recommendation.reason,
    })
  );
}

/** Marks STATUS_QUERY/OTHER messages APPLIED; optionally queues the reply as a notification job. */
export function completeInboundWithoutPatch(
  conn: DbConnection,
  input: { conversationKey: string; messageIds: string[]; intent: 'STATUS_QUERY' | 'OTHER'; replyText?: string }
): Promise<void> {
  return call(
    conn.reducers.completeInboundWithoutPatch({
      conversationKey: input.conversationKey,
      messageIds: input.messageIds,
      intent: input.intent,
      replyText: input.replyText,
    })
  );
}

export function recordSentQuestion(
  conn: DbConnection,
  input: { conversationKey: string; question: string; delivered: boolean; error?: string }
): Promise<void> {
  return call(conn.reducers.recordSentQuestion(input));
}

/** Unsent (PENDING or FAILED) notification jobs, oldest first. */
export function listPendingNotifications(conn: DbConnection): PendingNotification[] {
  return [...conn.db.agentNotification.iter()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(toPendingNotification);
}

/** Calls `cb` for each newly committed notification job. Returns an unsubscribe function. */
export function onNotification(conn: DbConnection, cb: (job: PendingNotification) => void): () => void {
  const handler = (_ctx: unknown, row: NotificationRow) => cb(toPendingNotification(row));
  conn.db.agentNotification.onInsert(handler);
  return () => conn.db.agentNotification.removeOnInsert(handler);
}

export function ackNotification(
  conn: DbConnection,
  input: { notificationId: string; delivered: boolean; error?: string }
): Promise<void> {
  return call(
    conn.reducers.ackNotification({
      notificationId: fromId(input.notificationId),
      delivered: input.delivered,
      error: input.error,
    })
  );
}

// ---- Dispatcher operations ----

/** One-time initial dispatch. Rejects with UNIT_CONFLICT if a selected unit was reserved first. */
export function confirmDispatchAndAssign(
  conn: DbConnection,
  input: { incidentId: string; confirmedServices: Service[]; unitIds: string[] }
): Promise<void> {
  return call(
    conn.reducers.confirmDispatchAndAssign({
      incidentId: fromId(input.incidentId),
      confirmedServices: input.confirmedServices,
      unitIds: input.unitIds,
    })
  );
}

export function resolveIncident(conn: DbConnection, input: { incidentId: string }): Promise<void> {
  return call(conn.reducers.resolveIncident({ incidentId: fromId(input.incidentId) }));
}

// ---- Responder operations ----

export function advanceAssignment(
  conn: DbConnection,
  input: { assignmentId: string; nextStatus: AssignmentStatus }
): Promise<void> {
  return call(
    conn.reducers.advanceAssignment({ assignmentId: fromId(input.assignmentId), nextStatus: input.nextStatus })
  );
}

// ---- Admin operations ----

export function grantRole(
  conn: DbConnection,
  input: { identityHex: string; role: Role; unitId?: string }
): Promise<void> {
  return call(
    conn.reducers.grantRole({ identityHex: input.identityHex, role: input.role, unitId: input.unitId })
  );
}

export function resetDemo(conn: DbConnection): Promise<void> {
  return call(conn.reducers.resetDemo({}));
}
