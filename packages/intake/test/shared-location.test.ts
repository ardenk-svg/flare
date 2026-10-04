import assert from "node:assert/strict";
import test from "node:test";
import { emptyFacts } from "@flare/contracts";
import { buildUserPrompt, SYSTEM_INSTRUCTION } from "../src/prompt.ts";

test("the model receives provider location presence separately from typed caller facts", () => {
  const turn = { conversationKey: "private-routing-key", intakeRevision: 0, messages: [], recentMessages: [],
    currentFacts: emptyFacts(), currentSummary: "", lastQuestion: null, hasSharedLocation: true };
  const prompt = buildUserPrompt(turn);
  const payload = JSON.parse(prompt.slice(prompt.indexOf("{")));
  assert.equal(payload.hasSharedLocation, true);
  assert.equal(payload.currentFacts.locationText, null);
  assert.ok(!prompt.includes(turn.conversationKey));
  assert.match(SYSTEM_INSTRUCTION, /locationText is unknown AND hasSharedLocation is false/);
  assert.equal(JSON.parse(buildUserPrompt({ ...turn, hasSharedLocation: undefined }).split("\n\n")[1]!).hasSharedLocation, false);
});
