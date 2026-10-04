import { emptyFacts } from "@flare/contracts";
import type { Assignment, CallerFacts, IncidentView, Unit } from "./types";


export const FIXTURE_LABEL = "FIXTURE DATA — not live";

// Two mock units per service, matching the planned live seed (#28).
export const units: Unit[] = [
  { id: "POLICE-01", service: "POLICE", status: "AVAILABLE" },
  { id: "POLICE-02", service: "POLICE", status: "AVAILABLE" },
  { id: "FIRE-01", service: "FIRE", status: "AVAILABLE" },
  { id: "FIRE-02", service: "FIRE", status: "AVAILABLE" },
  { id: "EMS-01", service: "EMS", status: "AVAILABLE" },
  { id: "EMS-02", service: "EMS", status: "AVAILABLE" },
];

// Timestamps are relative to page load so elapsed timers look plausible in fixture mode.
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const facts = (f: Partial<CallerFacts>): CallerFacts => ({ ...emptyFacts(), ...f });

export const incidents: IncidentView[] = [
  {
    id: "INC-DEMO-3",
    status: "READY_FOR_REVIEW",
    summary: "Caller reports a robbery in the basement of the Duderstadt Center and says they are hiding.",
    facts: facts({ incidentType: "robbery", locationText: "Basement of the Duderstadt Center", violentThreat: true }),
    evidence: [
      { field: "incidentType", messageId: "r1", quote: "someone is getting robbed" },
      { field: "violentThreat", messageId: "r1", quote: "someone is getting robbed" },
      { field: "locationText", messageId: "r1", quote: "in the basement of the duderstadt" },
    ],
    corrections: [],
    recommendedServices: ["POLICE"],
    recommendationReason: "DEMO_THREAT: caller reported a violent threat.",
    ruleIds: ["DEMO_THREAT"],
    confirmedServices: [],
    needsReview: false,
    extraction: { state: "OK" },
    sharedLocation: {
      latitude: 42.29107, longitude: -83.71623, accuracyMeters: 15, label: "Duderstadt Center, Ann Arbor",
      source: "IMESSAGE_PIN", sharedAt: ago(1.5),
    },
    conversation: [
      { sender: "CALLER", text: "someone is getting robbed in the basement of the duderstadt and im hiding", at: ago(2.2) },
      { sender: "AGENT", text: "[SIMULATION] Are you somewhere secure right now?", at: ago(2), delivery: "SENT" },
      { sender: "CALLER", text: "yes", at: ago(1.8) },
      { sender: "AGENT", text: "[SIMULATION] Did you see a weapon?", at: ago(1.6), delivery: "SENT" },
    ],
    createdAt: ago(2.2),
    updatedAt: ago(1.5),
  },
  {
    id: "INC-DEMO-1",
    status: "READY_FOR_REVIEW",
    summary:
      "Caller reports smoke outside the demo student center, south entrance (corrected from north).",
    facts: facts({ incidentType: "smoke", locationText: "South entrance of the demo student center", fireOrSmoke: true }),
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
    createdAt: ago(9),
    updatedAt: ago(7),
  },
  {
    id: "INC-DEMO-2",
    status: "READY_FOR_REVIEW",
    summary: "Synthetic multi-assignment case: caller reports a person trapped near the demo library loading dock.",
    facts: facts({ incidentType: "trapped person", locationText: "Loading dock of the demo library", peopleInvolved: 1, trappedPerson: true }),
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
    createdAt: ago(6),
    updatedAt: ago(5),
  },
  {
    id: "INC-DEMO-4",
    status: "COLLECTING",
    summary: "Caller reports their roommate collapsed and isn't breathing. Location not given yet.",
    facts: facts({ incidentType: "medical", callerReportedConscious: false, callerReportedBreathing: false, peopleInvolved: 1 }),
    evidence: [
      { field: "callerReportedConscious", messageId: "p1", quote: "my roommate collapsed" },
      { field: "callerReportedBreathing", messageId: "p1", quote: "he isn't breathing" },
    ],
    corrections: [],
    recommendedServices: ["EMS"],
    recommendationReason: "DEMO_CONSCIOUS: caller reported someone not conscious. DEMO_BREATHING: caller reported someone not breathing.",
    ruleIds: ["DEMO_CONSCIOUS", "DEMO_BREATHING"],
    confirmedServices: [],
    needsReview: false,
    extraction: { state: "OK" },
    createdAt: ago(1),
    updatedAt: ago(0.8),
  },
];

export const assignments: Assignment[] = [];
