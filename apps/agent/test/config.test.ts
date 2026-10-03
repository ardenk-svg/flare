import assert from "node:assert/strict";
import test from "node:test";

import { readAgentConfig } from "../src/config.js";

test("reads required data configuration and bounded worker settings", () => {
  const previous = { ...process.env };
  try {
    process.env.SPACETIMEDB_URI = "https://maincloud.spacetimedb.com";
    process.env.SPACETIMEDB_DATABASE = "database-id";
    process.env.FLARE_NOTIFICATION_POLL_MS = "2500";
    process.env.FLARE_NOTIFICATION_MAX_ATTEMPTS = "4";
    delete process.env.SPACETIMEDB_AGENT_TOKEN;

    assert.deepEqual(readAgentConfig(), {
      spacetimeUri: "https://maincloud.spacetimedb.com",
      spacetimeDatabase: "database-id",
      notificationPollMs: 2500,
      notificationMaxAttempts: 4,
    });
  } finally {
    process.env = previous;
  }
});
