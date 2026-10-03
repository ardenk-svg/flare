// TEMPORARY local mirror of the shared types in docs/CONTRACT.md.
// Person 3 owns these in packages/contracts/. When @flare/contracts exists,
// replace this file with re-exports from it; do not let the two drift.

export type Intent = "REPORT" | "CORRECTION" | "STATUS_QUERY" | "OTHER";
export type Service = "POLICE" | "FIRE" | "EMS";

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

export interface CallerMessage {
  id: string;
  text: string;
  receivedAt: string;
}

export interface InboundTurn {
  conversationKey: string;
  intakeRevision: number;
  messages: CallerMessage[];
  recentMessages: CallerMessage[];
  currentFacts: CallerFacts;
  currentSummary: string;
  lastQuestion: string | null;
}

export interface FactEvidence {
  field: CallerFactField;
  messageId: string;
  quote: string;
}

export interface ExtractionResult {
  intent: Intent;
  patch: CallerFactPatch;
  summary: string;
  evidence: FactEvidence[];
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

export interface ExtractionError {
  code: ExtractionErrorCode;
  message: string;
  retryable: boolean;
}

export type ExtractionOutcome =
  | { ok: true; result: ExtractionResult }
  | { ok: false; error: ExtractionError };
