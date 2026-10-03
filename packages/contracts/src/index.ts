// Shared application contract for Flare. Mirrors docs/CONTRACT.md.
// IDs are strings and timestamps are ISO 8601 UTC strings at every boundary.

export type Intent = "REPORT" | "CORRECTION" | "STATUS_QUERY" | "OTHER";
export type Service = "POLICE" | "FIRE" | "EMS";

export const SERVICES: readonly Service[] = ["POLICE", "FIRE", "EMS"];
export const INTENTS: readonly Intent[] = ["REPORT", "CORRECTION", "STATUS_QUERY", "OTHER"];

export interface CallerFacts {
  incidentType: string | null;
  locationText: string | null;
  peopleInvolved: number | null;
  callerReportedConscious: boolean | null;
  callerReportedBreathing: boolean | null;
  fireOrSmoke: boolean | null;
  trappedPerson: boolean | null;
  violentThreat: boolean | null;
  injuryReported: boolean | null;
}

export type CallerFactField = keyof CallerFacts;
export type CallerFactPatch = Partial<CallerFacts>;

export const CALLER_FACT_KINDS = {
  incidentType: "text",
  locationText: "text",
  peopleInvolved: "count",
  callerReportedConscious: "bool",
  callerReportedBreathing: "bool",
  fireOrSmoke: "bool",
  trappedPerson: "bool",
  violentThreat: "bool",
  injuryReported: "bool",
} as const satisfies Record<CallerFactField, "text" | "count" | "bool">;

export const CALLER_FACT_FIELDS = Object.keys(CALLER_FACT_KINDS) as CallerFactField[];

export function emptyFacts(): CallerFacts {
  return {
    incidentType: null,
    locationText: null,
    peopleInvolved: null,
    callerReportedConscious: null,
    callerReportedBreathing: null,
    fireOrSmoke: null,
    trappedPerson: null,
    violentThreat: null,
    injuryReported: null,
  };
}

/** Omitted keeps the stored value; null clears to unknown; a value replaces it. */
export function mergeFacts(current: CallerFacts, patch: CallerFactPatch): CallerFacts {
  const merged = { ...current };
  for (const field of CALLER_FACT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && patch[field] !== undefined) {
      (merged as unknown as Record<string, unknown>)[field] = patch[field];
    }
  }
  return merged;
}

export interface CallerMessage {
  id: string; // supplied by the messaging adapter
  text: string;
  receivedAt: string; // ISO UTC, supplied by the adapter
}

export interface InboundTurn {
  conversationKey: string; // trusted internal routing key
  intakeRevision: number;
  messages: CallerMessage[]; // new ordered caller messages
  recentMessages: CallerMessage[]; // bounded prior caller context
  currentFacts: CallerFacts;
  currentSummary: string;
  lastQuestion: string | null;
}

export interface Evidence {
  field: CallerFactField;
  messageId: string;
  quote: string;
}

export interface ExtractionResult {
  intent: Intent;
  patch: CallerFactPatch;
  summary: string;
  evidence: Evidence[];
  corrections: CallerFactField[];
  unresolvedFields: CallerFactField[];
  proposedQuestion: string | null;
}

export interface Recommendation {
  services: Service[];
  ruleIds: string[];
  reason: string;
}

export type ExtractionErrorCode = "TIMEOUT" | "RATE_LIMIT" | "INVALID_OUTPUT" | "PROVIDER_ERROR";

export type ExtractionOutcome =
  | { ok: true; result: ExtractionResult }
  | {
      ok: false;
      error: {
        code: ExtractionErrorCode;
        message: string; // sanitized explanation, never credentials
        retryable: boolean;
      };
    };

// App-owned functions implemented by Person 2 in packages/intake.
export type ExtractTurn = (turn: InboundTurn) => Promise<ExtractionOutcome>;
export type RecommendServices = (facts: CallerFacts) => Recommendation;

export const NO_RULE_REASON = "No demo rule matched; dispatcher review required.";

// ---- Persistent state ----

export type IncidentStatus = "COLLECTING" | "READY_FOR_REVIEW" | "DISPATCHED" | "RESOLVED";
export type AssignmentStatus = "OFFERED" | "ACCEPTED" | "EN_ROUTE" | "ON_SCENE" | "COMPLETED";
export type UnitStatus = "AVAILABLE" | "BUSY";
export type InboundStatus = "RECEIVED" | "APPLIED";
export type NotificationKind = "DISPATCH_CONFIRMED" | "ASSIGNMENT_EN_ROUTE" | "INFO_REPLY";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED";
export type QuestionDelivery = "SENT" | "FAILED";
export type Role = "ADMIN" | "AGENT" | "DISPATCHER" | "RESPONDER";
export type ExtractionState = "OK" | "PENDING" | "FAILED";

/**
 * Minimum provider route needed to reopen the original destination after restart.
 * For Spectrum iMessage: platform "iMessage", spaceId = space.id, line = the cloud line phone
 * (space.phone) when present. Agent-private; never shown in dispatcher/responder projections.
 */
export interface ConversationRoute {
  platform: string;
  spaceId: string;
  line: string | null;
}

export const ASSIGNMENT_ORDER: readonly AssignmentStatus[] = [
  "OFFERED",
  "ACCEPTED",
  "EN_ROUTE",
  "ON_SCENE",
  "COMPLETED",
];

export function nextAssignmentStatus(current: AssignmentStatus): AssignmentStatus | null {
  const i = ASSIGNMENT_ORDER.indexOf(current);
  return i >= 0 && i < ASSIGNMENT_ORDER.length - 1 ? ASSIGNMENT_ORDER[i + 1] : null;
}

export interface StoredEvidence extends Evidence {
  intakeRevision: number;
}

export interface Incident {
  id: string;
  facts: CallerFacts;
  evidence: StoredEvidence[];
  summary: string;
  intakeRevision: number;
  unresolvedFields: CallerFactField[];
  lastCorrections: CallerFactField[];
  recommendedServices: Service[];
  recommendationRuleIds: string[];
  recommendationReason: string;
  confirmedServices: Service[];
  status: IncidentStatus;
  needsReview: boolean;
  /** PENDING while current-case input awaits extraction; FAILED keeps the last verified facts. */
  extractionState: ExtractionState;
  extractionError: string | null;
  /** Intake case number within its conversation. */
  caseEpoch: number;
  createdAt: string;
  updatedAt: string;
}

export interface Unit {
  id: string;
  service: Service;
  status: UnitStatus;
}

export interface Assignment {
  id: string;
  incidentId: string;
  unitId: string;
  service: Service;
  status: AssignmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationContext {
  conversationKey: string;
  route: ConversationRoute;
  /** Current intake case. Messages and questions from earlier cases are excluded below. */
  caseEpoch: number;
  activeIncident: Incident | null;
  intakeRevision: number; // 0 when there is no active incident
  currentFacts: CallerFacts;
  currentSummary: string;
  lastQuestion: string | null;
  lastQuestionDelivery: QuestionDelivery | null;
  /** RECEIVED (not yet applied) caller messages, oldest first. */
  pendingMessages: CallerMessage[];
  /** Bounded APPLIED caller messages, oldest first. */
  recentMessages: CallerMessage[];
  /** Last sanitized extraction failure for these pending messages, if any. */
  lastExtractionError: string | null;
}

export interface PendingNotification {
  id: string;
  conversationKey: string;
  route: ConversationRoute;
  incidentId: string | null;
  assignmentId: string | null;
  kind: NotificationKind;
  /** Committed, simulation-labelled text rendered when the event committed. */
  text: string;
  /** Assignment status at the time of the event, for staleness checks. */
  eventAssignmentStatus: AssignmentStatus | null;
  eventAt: string;
  attempts: number;
  lastError: string | null;
}
