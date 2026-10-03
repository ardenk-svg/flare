import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AgentStateStore } from "../src/state-store.js";

test("persists the Spacetime token and provider route across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flare-agent-state-"));
  const path = join(directory, "state.json");
  const first = await AgentStateStore.open(path);

  await first.setSpacetimeToken("private-token");
  await first.rememberRoute("imessage:chat-1", {
    platform: "imessage",
    spaceId: "chat-1",
    phone: "+15555550000",
  });

  const second = await AgentStateStore.open(path);
  assert.equal(second.spacetimeToken, "private-token");
  assert.deepEqual(second.routeFor("imessage:chat-1"), {
    platform: "imessage",
    spaceId: "chat-1",
    phone: "+15555550000",
  });
  assert.match(await readFile(path, "utf8"), /"version": 1/);
});
