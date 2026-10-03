import assert from "node:assert/strict";
import test from "node:test";

import { normalizeInboundMessage } from "../src/normalize.js";

const space = { id: "conversation-7" };

test("normalizes a trusted inbound Spectrum text message", () => {
  const result = normalizeInboundMessage(space, {
    id: "message-9",
    platform: "imessage",
    direction: "inbound",
    timestamp: new Date("2026-10-03T12:34:56.000Z"),
    sender: { id: "+15555550123" },
    content: { type: "text", text: "  Simulation: smoke outside.  " },
  });

  assert.deepEqual(result, {
    providerMessageId: "message-9",
    conversationKey: "imessage:conversation-7",
    platform: "imessage",
    senderId: "+15555550123",
    text: "  Simulation: smoke outside.  ",
    receivedAt: "2026-10-03T12:34:56.000Z",
  });
});

test("ignores outbound echoes, non-text content, and blank text", () => {
  const base = {
    id: "message-9",
    platform: "imessage",
    timestamp: new Date("2026-10-03T12:34:56.000Z"),
  } as const;

  assert.equal(
    normalizeInboundMessage(space, {
      ...base,
      direction: "outbound",
      content: { type: "text", text: "agent echo" },
    }),
    null,
  );
  assert.equal(
    normalizeInboundMessage(space, {
      ...base,
      direction: "inbound",
      content: { type: "attachment" },
    }),
    null,
  );
  assert.equal(
    normalizeInboundMessage(space, {
      ...base,
      direction: "inbound",
      content: { type: "text", text: "   " },
    }),
    null,
  );
});
