// Focused checks for the dispatcher console's display helpers. Run: npm test -w @flare/web
import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyFacts } from "@flare/contracts";
import {
  activityLabel, byPriority, categoryOf, deriveSeverity, getActivity, getKnownFacts, getRelevantMissingFacts, hasReportedDistress, recommendationReasons,
} from "../src/incident";
import type { Assignment, CallerFacts, IncidentView } from "../src/types";

const inc = (facts: Partial<CallerFacts>, extra: Partial<IncidentView> = {}): IncidentView => ({
  id: "1", status: "READY_FOR_REVIEW", summary: "", facts: { ...emptyFacts(), ...facts }, evidence: [], corrections: [],
  recommendedServices: [], recommendationReason: "", ruleIds: [], confirmedServices: [], needsReview: false,
  extraction: { state: "OK" }, createdAt: "2026-10-03T20:00:00.000Z", updatedAt: "2026-10-03T20:00:00.000Z", ...extra,
});

test("severity", () => {
  assert.equal(deriveSeverity(inc({ callerReportedBreathing: false })), "CRITICAL");
  assert.equal(deriveSeverity(inc({ trappedPerson: true, fireOrSmoke: true })), "CRITICAL");
  assert.equal(deriveSeverity(inc({ incidentType: "robbery", violentThreat: true })), "HIGH");
  assert.equal(deriveSeverity(inc({ incidentType: "noise complaint" })), "MEDIUM");
  assert.equal(deriveSeverity(inc({})), "UNASSESSED");
});

test("unknown or blank incident types never imply low priority", () => {
  for (const incidentType of [null, "", "   "]) {
    assert.equal(deriveSeverity(inc({ incidentType, locationText: "Demo library" })), "UNASSESSED");
  }
  assert.equal(deriveSeverity(inc({ callerReportedBreathing: true, callerReportedConscious: true })), "UNASSESSED");
});

test("pending and failed extraction require assessment, while known danger retains priority", () => {
  for (const state of ["PENDING", "FAILED"] as const) {
    assert.equal(deriveSeverity(inc({ incidentType: "noise" }, { extraction: { state } })), "UNASSESSED");
    assert.equal(deriveSeverity(inc({ callerReportedBreathing: false }, { extraction: { state } })), "CRITICAL");
    assert.equal(deriveSeverity(inc({ injuryReported: true }, { extraction: { state } })), "HIGH");
  }
});

test("first caller distress report is high even before extraction, without inventing medical facts", () => {
  for (const text of ["Help im dying", "Help I'm dying", "Help I’m dying", "I am dying", "I'm going to die"]) {
    const i = inc({}, { extraction: { state: "PENDING" }, conversation: [{ sender: "CALLER", text, at: "" }] });
    assert.equal(deriveSeverity(i), "HIGH", text);
    assert.equal(hasReportedDistress(i), true, text);
    assert.deepEqual(i.facts, emptyFacts());
    assert.deepEqual(i.recommendedServices, []);
  }
  assert.equal(deriveSeverity(inc({ callerStatus: "dying" })), "HIGH");
  assert.equal(deriveSeverity(inc({ callerReportedBreathing: false, callerStatus: "dying" })), "CRITICAL");
});

test("caller translation flags distress and subsequent location replies do not hide it", () => {
  const i = inc({ incidentType: "medical" }, { conversation: [
    { sender: "CALLER", text: "Ayuda, me estoy muriendo", translatedText: "Help, I'm dying", at: "2026-10-03T20:00:00Z" },
    { sender: "CALLER", text: "Demo library", at: "2026-10-03T20:00:02Z" },
  ] });
  assert.equal(hasReportedDistress(i), true);
  assert.equal(deriveSeverity(i), "HIGH");
});

test("distress flags use caller statements, not denials, summaries, or operator echoes", () => {
  for (const text of ["I'm not dying", "I am no longer dying", "My phone is dying"]) {
    assert.equal(hasReportedDistress(inc({}, { conversation: [{ sender: "CALLER", text, at: "" }] })), false, text);
  }
  for (const sender of ["AGENT", "DISPATCHER", "RESPONDER"] as const) {
    assert.equal(hasReportedDistress(inc({}, { summary: "I'm dying", conversation: [{ sender, text: "I'm dying", at: "" }] })), false);
  }
  assert.equal(hasReportedDistress(inc({ callerStatus: "not dying" })), false);
});

test("queue sorts danger before unassessed reports, then medium, with oldest first within each", () => {
  const a = inc({ incidentType: "noise" }, { id: "a", createdAt: "2026-10-03T19:00:00Z" });
  const b = inc({ violentThreat: true }, { id: "b", createdAt: "2026-10-03T20:00:00Z" });
  const c = inc({ violentThreat: true }, { id: "c", createdAt: "2026-10-03T19:30:00Z" });
  const d = inc({}, { id: "d", createdAt: "2026-10-03T21:00:00Z" });
  const e = inc({}, { id: "e", createdAt: "2026-10-03T20:30:00Z" });
  const f = inc({ callerReportedBreathing: false }, { id: "f", createdAt: "2026-10-03T22:00:00Z" });
  assert.deepEqual([a, b, c, d, e, f].sort(byPriority).map((i) => i.id), ["f", "c", "b", "e", "d", "a"]);
});

test("robbery asks for robbery facts, not fire or medical ones", () => {
  const i = inc({ incidentType: "robbery", violentThreat: true, locationText: "Duderstadt basement" });
  assert.equal(categoryOf(i), "violent");
  const missing = getRelevantMissingFacts(i).map((m) => m.key);
  assert.deepEqual(missing, ["weaponPresent", "suspectCount", "injuryReported", "callerStatus", "peopleInvolved"]);
  assert.ok(!missing.includes("callerReportedBreathing"));
});

test("location is needed only when neither typed nor shared", () => {
  assert.equal(getRelevantMissingFacts(inc({ fireOrSmoke: true }))[0].key, "locationText");
  const shared = inc({ fireOrSmoke: true }, { sharedLocation: { latitude: 1, longitude: 2, accuracyMeters: null, label: null, source: "IMESSAGE_PIN", sharedAt: "2026-10-03T20:00:00Z" } });
  assert.ok(!getRelevantMissingFacts(shared).some((m) => m.key === "locationText"));
});

test("known facts skip unknowns and location", () => {
  const known = getKnownFacts(inc({ incidentType: "fire", locationText: "x", fireOrSmoke: true, injuryReported: false }));
  assert.deepEqual(known.map((k) => k.key), ["incidentType", "fireOrSmoke", "injuryReported"]);
});

test("reasons are readable and never expose rule IDs", () => {
  const r = recommendationReasons(inc({}, { recommendedServices: ["FIRE", "EMS"], ruleIds: ["DEMO_TRAPPED", "DEMO_INJURY"] }));
  assert.deepEqual(r, [
    { service: "FIRE", reasons: ["Person trapped"] },
    { service: "EMS", reasons: ["Person trapped", "Injury reported"] },
  ]);
  assert.ok(!JSON.stringify(r).includes("DEMO_"));
});

test("derived activity uses only stored timestamps, newest first", () => {
  const i = inc({}, { status: "DISPATCHED", confirmedServices: ["POLICE"] });
  const a: Assignment = {
    id: "9", incidentId: "1", unitId: "POLICE-01", service: "POLICE", status: "EN_ROUTE",
    createdAt: "2026-10-03T20:01:00.000Z", updatedAt: "2026-10-03T20:02:00.000Z",
  };
  const { events, derived } = getActivity(i, [a]);
  assert.equal(derived, true);
  assert.deepEqual(events.map((e) => e.kind), ["UNIT_EN_ROUTE", "UNIT_ASSIGNED", "DISPATCH_CONFIRMED", "INCIDENT_CREATED"]);
  // ACCEPTED happened but has no timestamp of its own, so it isn't invented.
  assert.ok(!events.some((e) => e.kind === "UNIT_ACCEPTED"));
});

test("backend events replace the derived stream, newest first, ties by id", () => {
  const at = "2026-10-03T20:00:05.000Z";
  const i = inc({}, { events: [
    { id: "9", kind: "INCIDENT_CREATED", at }, { id: "10", kind: "CALLER_MESSAGE", at },
    { id: "11", kind: "LOCATION_RECEIVED", at: "2026-10-03T20:00:09.000Z", detail: "IMESSAGE_PIN" },
  ] });
  const { events, derived } = getActivity(i, []);
  assert.equal(derived, false);
  assert.deepEqual(events.map((e) => e.id), ["11", "10", "9"]);
});

test("event details are translated, never shown raw", () => {
  assert.equal(activityLabel({ id: "1", kind: "LOCATION_RECEIVED", at: "", detail: "IMESSAGE_PIN" }), "Location received (shared iMessage pin)");
  assert.equal(activityLabel({ id: "1", kind: "CALLER_NOTIFIED", at: "", detail: "ASSIGNMENT_EN_ROUTE" }), "Caller told a unit is en route");
  assert.equal(activityLabel({ id: "1", kind: "EXTRACTION_FAILED", at: "", detail: "TIMEOUT" }), "Couldn't read a caller message");
  assert.equal(activityLabel({ id: "1", kind: "FACTS_UPDATED", at: "", fields: ["weaponPresent"] }), "Updated: Weapon present");
});
