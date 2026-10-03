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
