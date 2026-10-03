import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyFacts } from "../src/facts.ts";
import { loadRuleCases } from "../src/eval/fixtures.ts";
import { NO_RULE_REASON, recommendServices } from "../src/rules.ts";

for (const c of loadRuleCases()) {
  test(`rules: ${c.id}`, () => {
    const rec = recommendServices({ ...emptyFacts(), ...c.facts });
    assert.deepEqual([...rec.services].sort(), [...c.services].sort());
    assert.deepEqual([...rec.ruleIds].sort(), [...c.ruleIds].sort());
    if (c.services.length === 0) assert.equal(rec.reason, NO_RULE_REASON);
  });
}

test("rules: services are de-duplicated when several rules overlap", () => {
  const rec = recommendServices({ ...emptyFacts(), fireOrSmoke: true, trappedPerson: true, injuryReported: true });
  assert.deepEqual(rec.services, ["FIRE", "EMS"]);
});

test("rules: output does not depend on text fields or summary", () => {
  const rec = recommendServices({ ...emptyFacts(), incidentType: "violent fire with injuries", locationText: "smoke street" });
  assert.deepEqual(rec.services, []);
});
