import assert from "node:assert/strict";
import { test } from "node:test";
import { CALLER_FACT_FIELDS, emptyFacts, isValidFactValue, mergeFacts } from "../src/facts.ts";
import { locateQuote } from "../src/validate.ts";

test("emptyFacts initializes every contract field to null", () => {
  assert.deepEqual(Object.keys(emptyFacts()).sort(), [...CALLER_FACT_FIELDS].sort());
  assert.ok(Object.values(emptyFacts()).every((v) => v === null));
});

test("mergeFacts: omitted retains, null clears, false replaces", () => {
  const current = { ...emptyFacts(), fireOrSmoke: true, trappedPerson: true, locationText: "North entrance" };
  const merged = mergeFacts(current, { trappedPerson: null, injuryReported: false, locationText: "South entrance" });
  assert.equal(merged.fireOrSmoke, true);
  assert.equal(merged.trappedPerson, null);
  assert.equal(merged.injuryReported, false);
  assert.equal(merged.locationText, "South entrance");
  assert.equal(current.trappedPerson, true, "input is not mutated");
});

test("mergeFacts ignores keys that are not caller facts", () => {
  const merged = mergeFacts(emptyFacts(), { status: "DISPATCHED" } as never);
  assert.equal(Object.hasOwn(merged, "status"), false);
});

test("isValidFactValue enforces contract types", () => {
  assert.ok(isValidFactValue("peopleInvolved", 0));
  assert.ok(!isValidFactValue("peopleInvolved", -1));
  assert.ok(!isValidFactValue("peopleInvolved", 1.5));
  assert.ok(!isValidFactValue("fireOrSmoke", "yes"));
  assert.ok(!isValidFactValue("locationText", "  "));
  assert.ok(isValidFactValue("locationText", null));
});

test("locateQuote returns the exact source span", () => {
  assert.equal(locateQuote("Correction: south entrance, not north.", "south entrance, not north"), "south entrance, not north");
  assert.equal(locateQuote("Correction: South entrance", "south entrance"), "South entrance");
  assert.equal(locateQuote("I don’t know", "I don't know"), "I don’t know");
  assert.equal(locateQuote("smoke outside", "I'm at the south entrance"), null);
  assert.equal(locateQuote("smoke outside", "   "), null);
});
