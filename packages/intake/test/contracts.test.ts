// Proves @flare/intake is built on the shared @flare/contracts package, with
// no local mirror. The type assertions fail `npm run typecheck` if they drift.

import assert from "node:assert/strict";
import { test } from "node:test";
import * as contracts from "@flare/contracts";
import type { ExtractTurn, RecommendServices } from "@flare/contracts";
import * as intake from "../src/index.ts";

const extractTurnMatchesContract: ExtractTurn = intake.extractTurn;
const recommendServicesMatchesContract: RecommendServices = intake.recommendServices;

test("extractTurn and recommendServices satisfy the shared function types", () => {
  assert.equal(typeof extractTurnMatchesContract, "function");
  assert.equal(typeof recommendServicesMatchesContract, "function");
});

test("fact helpers and rule reason are the shared implementations, not copies", () => {
  assert.equal(intake.emptyFacts, contracts.emptyFacts);
  assert.equal(intake.mergeFacts, contracts.mergeFacts);
  assert.equal(intake.CALLER_FACT_FIELDS, contracts.CALLER_FACT_FIELDS);
  assert.equal(intake.NO_RULE_REASON, contracts.NO_RULE_REASON);
});

test("recommendations only use shared service names", () => {
  const rec = intake.recommendServices({ ...contracts.emptyFacts(), fireOrSmoke: true, trappedPerson: true, violentThreat: true });
  assert.ok(rec.services.every((s) => contracts.SERVICES.includes(s)));
});

function verifiedTurn(): contracts.InboundTurn {
  return {
    conversationKey: "k",
    intakeRevision: 3,
    messages: [{ id: "m9", text: "Correction: south entrance, not north.", receivedAt: "2026-01-01T00:00:00.000Z" }],
    recentMessages: [],
    currentFacts: { ...contracts.emptyFacts(), fireOrSmoke: true, locationText: "North entrance of the demo student center" },
    currentSummary: "Caller reports smoke at the north entrance.",
    lastQuestion: null,
  };
}

test("missing Gemini configuration returns a sanitized non-retryable failure and leaves facts untouched", async () => {
  const saved = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  try {
    const turn = verifiedTurn();
    const before = structuredClone(turn);
    const outcome = await intake.extractTurn(turn);
    assert.deepEqual(outcome, { ok: false, error: { code: "PROVIDER_ERROR", message: "GEMINI_API_KEY is not set", retryable: false } });
    assert.deepEqual(turn, before);
  } finally {
    if (saved.key !== undefined) process.env.GEMINI_API_KEY = saved.key;
    if (saved.model !== undefined) process.env.GEMINI_MODEL = saved.model;
  }
});

test("a rejected API key returns a sanitized failure without echoing provider text or touching facts", async () => {
  const turn = verifiedTurn();
  const before = structuredClone(turn);
  const extract = intake.createExtractor({
    generate: () => Promise.reject(Object.assign(new Error("API key not valid: AIza-FAKE-SECRET"), { status: 400 })),
  });
  const outcome = await extract(turn);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.error.code, "PROVIDER_ERROR");
    assert.equal(outcome.error.retryable, false);
    assert.ok(!outcome.error.message.includes("AIza"));
  }
  assert.deepEqual(turn, before);
});

test("validated results contain only contract fact fields", () => {
  const outcome = intake.validateModelOutput(
    JSON.stringify({
      intent: "REPORT",
      changes: [{ field: "fireOrSmoke", kind: "TRUE", messageId: "m1", quote: "smoke" }],
      summary: "Caller reports smoke.",
      unresolvedFields: [],
      proposedQuestion: "",
    }),
    {
      conversationKey: "k",
      intakeRevision: 0,
      messages: [{ id: "m1", text: "smoke outside", receivedAt: "2026-01-01T00:00:00.000Z" }],
      recentMessages: [],
      currentFacts: contracts.emptyFacts(),
      currentSummary: "",
      lastQuestion: null,
    },
  );
  assert.ok(outcome.ok);
  const result: contracts.ExtractionResult = outcome.result;
  assert.ok(Object.keys(result.patch).every((k) => contracts.CALLER_FACT_FIELDS.includes(k as contracts.CallerFactField)));
});
