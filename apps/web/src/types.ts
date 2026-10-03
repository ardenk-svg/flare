// TEMPORARY local mirror of docs/CONTRACT.md view shapes.
// Replace with packages/contracts + packages/data projections from Person 3.
export type Service = "POLICE" | "FIRE" | "EMS";
export type IncidentStatus = "COLLECTING" | "READY_FOR_REVIEW" | "DISPATCHED" | "RESOLVED";
export type AssignmentStatus = "OFFERED" | "ACCEPTED" | "EN_ROUTE" | "ON_SCENE" | "COMPLETED";

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

export interface Evidence {
  field: CallerFactField;
  messageId: string;
  quote: string;
}

export interface Unit {
  id: string;
  service: Service;
  status: "AVAILABLE" | "BUSY";
}

export interface Assignment {
  id: string;
  incidentId: string;
  unitId: string;
  status: AssignmentStatus;
  updatedAt: string;
}

export interface IncidentView {
  id: string;
  status: IncidentStatus;
  summary: string;
  facts: CallerFacts;
  evidence: Evidence[];
  corrections: CallerFactField[];
  recommendedServices: Service[];
  recommendationReason: string;
  ruleIds: string[];
  confirmedServices: Service[];
  needsReview: boolean;
  extraction: { state: "OK" | "PENDING" | "FAILED"; message?: string };
  createdAt: string;
  updatedAt: string;
}

// ---- Client-facing shapes (app-level, not from the contract; swap with Person 3's adapter) ----
export type Role = "dispatcher" | "responder";
export interface Identity { role: Role; unitId?: string }
export type Connection = "connecting" | "connected" | "disconnected";

export interface Snapshot {
  connection: Connection;
  mode: "fixture" | "live";
  identity: Identity;
  /** "no-role": connected but the backend has not granted this identity a dispatcher/responder role. */
  access: "ok" | "no-role" | "unsupported-role";
  identityHex?: string;
  /** Present when the live connection failed before it could subscribe. */
  connectError?: string;
  incidents: IncidentView[];
  units: Unit[];
  assignments: Assignment[];
}

export type OpErrorCode =
  | "DISCONNECTED" | "FORBIDDEN" | "NOT_FOUND" | "NOT_READY" | "ALREADY_DISPATCHED"
  | "INVALID_SELECTION" | "UNIT_CONFLICT" | "INVALID_TRANSITION" | "NOT_COMPLETE";
// Live reducers return their own CODE strings (UNIT_CONFLICT, UNAUTHORIZED, ...); keep them verbatim.
export type OpResult = { ok: true } | { ok: false; code: OpErrorCode | (string & {}); message: string };

export interface FlareClient {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
  confirmDispatchAndAssign(req: { incidentId: string; confirmedServices: Service[]; unitIds: string[] }): Promise<OpResult>;
  advanceAssignment(req: { assignmentId: string; next: AssignmentStatus }): Promise<OpResult>;
  resolveIncident(req: { incidentId: string }): Promise<OpResult>;
}

export const ASSIGNMENT_ORDER: AssignmentStatus[] = ["OFFERED", "ACCEPTED", "EN_ROUTE", "ON_SCENE", "COMPLETED"];
