import type { Assignment, IncidentView, Unit } from "./types";


export const FIXTURE_LABEL = "FIXTURE DATA — not live";

export const units: Unit[] = [
  { id: "FIRE-01", service: "FIRE", status: "AVAILABLE" },
  { id: "EMS-01", service: "EMS", status: "AVAILABLE" },
  { id: "POLICE-01", service: "POLICE", status: "AVAILABLE" },
];

// Synthetic scenario from CONTRACT.md after step 4 (south-entrance correction).
export const incidents: IncidentView[] = [
  {
    id: "INC-DEMO-1",
    status: "READY_FOR_REVIEW",
    summary:
      "Caller reports smoke outside the demo student center, south entrance (corrected from north).",
    facts: {
      incidentType: "smoke",
      locationText: "South entrance of the demo student center",
      peopleInvolved: null,
      callerReportedConscious: null,
      callerReportedBreathing: null,
      fireOrSmoke: true,
      trappedPerson: null,
      violentThreat: null,
      injuryReported: null,
    },
    evidence: [
      { field: "fireOrSmoke", messageId: "m1", quote: "I see smoke outside" },
      { field: "locationText", messageId: "m3", quote: "south entrance, not north" },
    ],
    corrections: ["locationText"],
    recommendedServices: ["FIRE"],
    recommendationReason: "DEMO_FIRE: caller reported fire or smoke.",
    ruleIds: ["DEMO_FIRE"],
    confirmedServices: [],
    needsReview: false,
    extraction: { state: "OK" },
    createdAt: "2026-10-03T14:00:00Z",
    updatedAt: "2026-10-03T14:02:00Z",
  },
  {
    id: "INC-DEMO-2",
    status: "READY_FOR_REVIEW",
    summary: "Synthetic multi-assignment case: caller reports a person trapped near the demo library loading dock.",
    facts: {
      incidentType: "trapped person",
      locationText: "Loading dock of the demo library",
      peopleInvolved: 1,
      callerReportedConscious: null,
      callerReportedBreathing: null,
      fireOrSmoke: null,
      trappedPerson: true,
      violentThreat: null,
      injuryReported: null,
    },
    evidence: [
      { field: "trappedPerson", messageId: "n1", quote: "someone is stuck behind the door" },
      { field: "locationText", messageId: "n2", quote: "loading dock of the demo library" },
    ],
    corrections: [],
    recommendedServices: ["FIRE", "EMS"],
    recommendationReason: "DEMO_TRAPPED: caller reported a trapped person.",
    ruleIds: ["DEMO_TRAPPED"],
    confirmedServices: [],
    needsReview: false,
    extraction: { state: "OK" },
    createdAt: "2026-10-03T14:05:00Z",
    updatedAt: "2026-10-03T14:06:00Z",
  },
];

export const assignments: Assignment[] = [];
