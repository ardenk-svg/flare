import assert from "node:assert/strict";
import test from "node:test";
import { startDemoResponderServer } from "./demo-responder.js";

test("the temporary demo bridge grants selected seeded units and rejects unrelated requests", async () => {
  const grants: unknown[] = [];
  const bridge = await startDemoResponderServer({ key: "test-capability", origin: "http://localhost:5173",
    authorize: (identity, unit) => { grants.push({ identity, unit }); } });
  const url = `http://127.0.0.1:${bridge.port}/__flare_demo/responder`;
  const request = (unit: string, key = "test-capability", origin = "http://localhost:5173") => fetch(url, { method: "POST",
    headers: { Origin: origin, "X-Flare-Demo-Key": key }, body: JSON.stringify({ identity: "a".repeat(64), unit }) });
  try {
    assert.equal((await request("EMS-01", "wrong-key")).status, 403);
    assert.equal((await request("EMS-01", "test-capability", "https://unrelated.invalid")).status, 403);
    assert.equal((await request("ADMIN")).status, 400);
    assert.deepEqual(grants, []);
    assert.equal((await request("EMS-01")).status, 204);
    assert.equal((await request("POLICE-02")).status, 204);
    assert.equal(grants.length, 2);
  } finally { await bridge.close(); }
  await assert.rejects(fetch(url));
});
