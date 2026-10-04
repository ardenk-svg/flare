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
  /** Robbery/assault: caller reports a weapon. */
  weaponPresent: boolean | null;
  /** Robbery/assault: number of suspects the caller reports. */
  suspectCount: number | null;
  /** Short caller-supplied phrase about themselves, e.g. "hiding", "safe", "injured". */
  callerStatus: string | null;
  /** Traffic collision: vehicles involved. */
  vehicleCount: number | null;
  /** Medical: patient age in years as reported. */
  patientAge: number | null;
  /** Traffic: caller reports the road is blocked. */
  roadBlocked: boolean | null;
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
  weaponPresent: "bool",
  suspectCount: "count",
  callerStatus: "text",
  vehicleCount: "count",
  patientAge: "count",
  roadBlocked: "bool",
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
    weaponPresent: null,
    suspectCount: null,
    callerStatus: null,
    vehicleCount: null,
    patientAge: null,
    roadBlocked: null,
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
  /** Trusted provider location exists; no coordinates or attachment are sent to the model. */
  hasSharedLocation?: boolean;
  addressedFields?: CallerFactField[];
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
  questionField?: CallerFactField | null;
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

/** CLOSED: ended by a dispatcher without dispatch (never had assignments). */
export type IncidentStatus = "COLLECTING" | "READY_FOR_REVIEW" | "DISPATCHED" | "RESOLVED" | "CLOSED";
export type AssignmentStatus = "OFFERED" | "ACCEPTED" | "EN_ROUTE" | "ON_SCENE" | "COMPLETED";
export type UnitStatus = "AVAILABLE" | "BUSY";
export type InboundStatus = "RECEIVED" | "APPLIED";
export type NotificationKind = "DISPATCH_CONFIRMED" | "ASSIGNMENT_EN_ROUTE" | "INFO_REPLY" | "DISPATCHER_REPLY" | "RESPONDER_REPLY";
export type NotificationStatus = "PENDING" | "SENT" | "FAILED";
export type QuestionDelivery = "SENT" | "FAILED";
export type Role = "ADMIN" | "AGENT" | "DISPATCHER" | "RESPONDER";
export type ExtractionState = "OK" | "PENDING" | "FAILED";

/**
 * Minimum provider route needed to reopen the original destination after restart.
 * For Spectrum iMessage: platform "imessage" (as emitted in message.platform), spaceId = space.id,
 * line = space.phone. On Photon's shared-pool plan space.phone is the sentinel "shared"; store it
 * as-is — space.get(spaceId, { phone: "shared" }) works because shared mode ignores the phone.
 * Agent-private; never shown in dispatcher/responder projections.
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
  /** Dispatcher's reason when status is CLOSED. */
  closeReason: string | null;
  /** Provider-shared location (pin/Find My). Counts as a known location for readiness. */
  sharedLocation: SharedLocation | null;
  createdAt: string;
  updatedAt: string;
}

export type LocationSource = "IMESSAGE_PIN" | "FIND_MY";

export interface SharedLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  label: string | null;
  source: LocationSource;
  sharedAt: string;
}

/** One line of an authorized operator's caller transcript for an incident's case. */
export interface ConversationMessage {
  translatedText?: string | null;
  language?: string | null;
  key: string;
  incidentId: string;
  sender: "CALLER" | "AGENT" | "DISPATCHER" | "RESPONDER";
  text: string;
  at: string;
  /** Outbound AGENT or DISPATCHER rows only. */
  delivery: "QUEUED" | "SENT" | "FAILED" | null;
}

export type IncidentEventKind =
  | "RESPONDER_TAKEOVER"
  | "DEMO_RESTARTED"
  | "DISPATCHER_TAKEOVER"
  | "AGENT_RESUMED"
  | "INCIDENT_CREATED"
  | "CALLER_MESSAGE"
  | "FACTS_UPDATED"
  | "LOCATION_RECEIVED"
  | "SERVICES_RECOMMENDED"
  | "EXTRACTION_FAILED"
  | "DISPATCH_CONFIRMED"
  | "UNIT_ASSIGNED"
  | "UNIT_ACCEPTED"
  | "UNIT_EN_ROUTE"
  | "UNIT_ON_SCENE"
  | "UNIT_COMPLETED"
  | "CALLER_NOTIFIED"
  | "INCIDENT_RESOLVED"
  | "INCIDENT_CLOSED";

/** Activity-log entry, timestamped when the change committed. Carries no message text. */
export interface IncidentEvent {
  id: string;
  incidentId: string;
  kind: IncidentEventKind;
  at: string;
  unitId: string | null;
  fields: CallerFactField[];
  services: Service[];
  detail: string | null;
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
  callerLanguage?: string;
  /** Present while a human operator owns the active caller conversation. */
  dispatcherIdentity?: string | null;
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
  callerLanguage?: string;
  translatedText?: string;
  translationLanguage?: string;
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


export type IntakeCategory = "violent" | "fire" | "medical" | "traffic" | "other";
export function intakeCategory(f: CallerFacts): IntakeCategory {
  const type = f.incidentType?.toLowerCase() ?? "";
  if (/crash|collision|accident|vehicle|\bcars?\b|truck|traffic|hit and run|motorcycle/.test(type)) return "traffic";
  if (/fire|smoke|burn|flame|explosion|gas leak/.test(type)) return "fire";
  if (/robb|assault|fight|weapon|gun|knife|stab|shoot|threat|attack|break.?in|burglar|theft|steal|mug/.test(type)) return "violent";
  if (/medical|collapse|unconscious|breath|seizure|heart|chest|overdose|bleed|injur|fell|fall|sick|allerg|faint/.test(type)) return "medical";
  if (f.fireOrSmoke) return "fire";
  if (f.violentThreat) return "violent";
  if (f.callerReportedBreathing === false || f.callerReportedConscious === false || f.injuryReported) return "medical";
  return "other";
}
const RELEVANT: Record<IntakeCategory, CallerFactField[]> = {
  violent: ["weaponPresent", "suspectCount", "injuryReported", "callerStatus", "peopleInvolved"],
  fire: ["trappedPerson", "fireOrSmoke", "injuryReported", "peopleInvolved"],
  medical: ["callerReportedConscious", "callerReportedBreathing", "patientAge", "injuryReported"],
  traffic: ["injuryReported", "vehicleCount", "trappedPerson", "fireOrSmoke", "roadBlocked"],
  other: ["injuryReported", "violentThreat", "fireOrSmoke", "peopleInvolved"],
};
/** Unknown answers stay unknown, but count as addressed so intake does not loop forever. */
export function missingIntakeFields(f: CallerFacts, hasPin = false, addressed: readonly CallerFactField[] = []): CallerFactField[] {
  return ([...(!hasPin ? ["locationText" as const] : []), "incidentType", ...RELEVANT[intakeCategory(f)]] as CallerFactField[])
    .filter(k => (f[k] === null || f[k] === "") && !addressed.includes(k));
}
export const INTAKE_QUESTIONS: Record<CallerFactField, string> = {
  incidentType: "What is happening?",
  locationText: "What is the address or location where this is happening?",
  peopleInvolved: "How many people are involved?",
  callerReportedConscious: "Is the person conscious?",
  callerReportedBreathing: "Is the person breathing?",
  fireOrSmoke: "Is there fire or smoke?",
  trappedPerson: "Is anyone trapped?",
  violentThreat: "Is there a violent threat?",
  injuryReported: "Is anyone injured?",
  weaponPresent: "Is a weapon present?",
  suspectCount: "How many suspects are there?",
  callerStatus: "Can you describe your current situation?",
  vehicleCount: "How many vehicles are involved?",
  patientAge: "What is the person's approximate age?",
  roadBlocked: "Is the road blocked?",
};
