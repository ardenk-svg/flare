// Shared shapes come from @flare/contracts. IncidentView is the UI projection of a contract Incident.
import type { CallerFactField, CallerFacts, Evidence, ExtractionState, IncidentStatus, Service } from "@flare/contracts";
export type {
  Assignment, AssignmentStatus, CallerFactField, CallerFacts, Evidence, ExtractionState, IncidentStatus, Service, Unit,
} from "@flare/contracts";
export { ASSIGNMENT_ORDER } from "@flare/contracts";
import type { Assignment, AssignmentStatus, Unit } from "@flare/contracts";

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
  extraction: { state: ExtractionState; message?: string };
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

