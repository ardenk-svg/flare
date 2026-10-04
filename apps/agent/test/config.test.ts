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
    process.env.FLARE_LOCATION_TIMEOUT_MS = "1500";
    process.env.FLARE_INTAKE_RETRY_POLL_MS = "1000";
    delete process.env.SPACETIMEDB_AGENT_TOKEN;

    assert.deepEqual(readAgentConfig(), {
      spacetimeUri: "https://maincloud.spacetimedb.com",
      spacetimeDatabase: "database-id",
      notificationPollMs: 2500,
      notificationMaxAttempts: 4,
      locationTimeoutMs: 1500,
      intakeRetryPollMs: 1000,
    });
  } finally {
    process.env = previous;
  }
});

test("rejects invalid location and recovery deadlines", () => {
  const previous = { ...process.env };
  try {
    process.env.SPACETIMEDB_URI = "http://localhost:3000";
    process.env.SPACETIMEDB_DATABASE = "flare-test";
    process.env.FLARE_LOCATION_TIMEOUT_MS = "0";
    assert.throws(readAgentConfig, /FLARE_LOCATION_TIMEOUT_MS must be a positive integer/);
    process.env.FLARE_LOCATION_TIMEOUT_MS = "5000";
    process.env.FLARE_INTAKE_RETRY_POLL_MS = "NaN";
    assert.throws(readAgentConfig, /FLARE_INTAKE_RETRY_POLL_MS must be a positive integer/);
  } finally { process.env = previous; }
});
