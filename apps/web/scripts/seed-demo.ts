// Seeds a LOCAL SpacetimeDB database with a few simulated incidents in different states, for UI review and
// screenshots. RESETS that database first. Optionally grants roles to your browser identities.
// Usage: npm run seed:demo -w @flare/web -- [--dispatcher <hex>] [--responder <hex>]   (responder gets FIRE-01)
import { execFileSync } from "node:child_process";
import type { CallerFactPatch, Evidence, Recommendation } from "@flare/contracts";
import {
  advanceAssignment, applyIntakePatch, confirmDispatchAndAssign, connectFlare, getMyRole, listAssignments, listIncidents,
  recordInbound, resolveIncident, type FlareConnection,
} from "@flare/data";

const URI = process.env.SPACETIMEDB_URI ?? "ws://127.0.0.1:3000";
const DB = process.env.FLARE_DB ?? "flare-dev";
const ROUTE = { platform: "seed", spaceId: "seed-space", line: null };

if (!["127.0.0.1", "localhost", "::1"].includes(new URL(URI).hostname)) {
  console.error(`SPACETIMEDB_URI=${URI} is not local. This seed resets the database; never point it at the shared one.`);
  process.exit(2);
}
const cli = (...args: string[]) => execFileSync("spacetime", ["call", "--server", "local", DB, ...args], { stdio: "pipe" }).toString();
const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

async function as(role: "AGENT" | "DISPATCHER" | "RESPONDER", unitId?: string): Promise<FlareConnection> {
  const c = await connectFlare({ uri: URI, database: DB });
  cli("grant_role", c.identityHex, role, unitId ? JSON.stringify({ some: unitId }) : '{"none":[]}');
  for (let i = 0; i < 200 && getMyRole(c.conn)?.role !== role; i++) await new Promise((r) => setTimeout(r, 25));
  return c;
}

const revisions = new Map<string, number>();
let n = 0;
/** One caller message plus the extraction the agent would apply for it. */
async function say(agent: FlareConnection, key: string, text: string, patch: CallerFactPatch, quotes: [keyof CallerFactPatch, string][], summary: string, rec: Recommendation) {
  const id = `seed-${++n}`;
  await recordInbound(agent.conn, { provider: "seed", conversationKey: key, route: ROUTE, messages: [{ id, text, receivedAt: new Date().toISOString() }] });
  const expectedRevision = revisions.get(key) ?? 0;
  const evidence: Evidence[] = quotes.map(([field, quote]) => ({ field, messageId: id, quote }));
  await applyIntakePatch(agent.conn, {
    conversationKey: key, expectedRevision, sourceMessageIds: [id], recommendation: rec,
    result: { intent: "REPORT", patch, summary, evidence, corrections: [], unresolvedFields: [], proposedQuestion: null },
  });
  revisions.set(key, expectedRevision + 1);
}
const incidentFor = (agent: FlareConnection, summaryStart: string) =>
  listIncidents(agent.conn).find((i) => i.summary.startsWith(summaryStart))!.id;
const assignmentId = (c: FlareConnection, incidentId: string) =>
  listAssignments(c.conn).find((a) => a.incidentId === incidentId)!.id;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FIRE: Recommendation = { services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "DEMO_FIRE: caller reported fire or smoke." };
const TRAPPED: Recommendation = { services: ["FIRE", "EMS"], ruleIds: ["DEMO_TRAPPED", "DEMO_INJURY"], reason: "DEMO_TRAPPED: caller reported a trapped person. DEMO_INJURY: caller reported an injury." };
const THREAT: Recommendation = { services: ["POLICE"], ruleIds: ["DEMO_VIOLENT"], reason: "DEMO_VIOLENT: caller reported a violent threat." };

async function main() {
  cli("reset_demo");
  const agent = await as("AGENT");
  const dispatcher = await as("DISPATCHER");
  const fire = await as("RESPONDER", "FIRE-01");
  const step = async (inc: string, ...to: ("ACCEPTED" | "EN_ROUTE" | "ON_SCENE" | "COMPLETED")[]) => {
    for (const s of to) { await advanceAssignment(fire.conn, { assignmentId: assignmentId(fire, inc), nextStatus: s }); await pause(50); }
  };

  // 1. Resolved: dumpster smoke, full cycle with FIRE-01.
  await say(agent, "seed:1", "Simulation: smoke coming from the dumpster behind Demo Hall", { incidentType: "smoke", fireOrSmoke: true, locationText: "Behind Demo Hall, by the dumpsters" },
    [["incidentType", "smoke"], ["fireOrSmoke", "smoke coming from the dumpster"], ["locationText", "behind Demo Hall"]], "Smoke from a dumpster behind Demo Hall.", FIRE);
  const inc1 = incidentFor(agent, "Smoke from a dumpster");
  await confirmDispatchAndAssign(dispatcher.conn, { incidentId: inc1, confirmedServices: ["FIRE"], unitIds: ["FIRE-01"] });
  await pause(100);
  await step(inc1, "ACCEPTED", "EN_ROUTE", "ON_SCENE", "COMPLETED");
  await resolveIncident(dispatcher.conn, { incidentId: inc1 });

  // 2. Dispatched: kitchen fire, FIRE-01 en route.
  await say(agent, "seed:2", "Simulation: there's a fire in the kitchen on the 2nd floor of the demo union, two of us got out", {
    incidentType: "kitchen fire", fireOrSmoke: true, peopleInvolved: 2, locationText: "Demo Union, 2nd floor kitchen",
  }, [["incidentType", "fire in the kitchen"], ["fireOrSmoke", "there's a fire in the kitchen"], ["peopleInvolved", "two of us got out"], ["locationText", "2nd floor of the demo union"]],
  "Kitchen fire on the 2nd floor of the Demo Union. Two people got out.", FIRE);
  await say(agent, "seed:2", "nobody is hurt", { injuryReported: false }, [["injuryReported", "nobody is hurt"]],
    "Kitchen fire on the 2nd floor of the Demo Union. Two people got out, nobody hurt.", FIRE);
  const inc2 = incidentFor(agent, "Kitchen fire");
  await confirmDispatchAndAssign(dispatcher.conn, { incidentId: inc2, confirmedServices: ["FIRE"], unitIds: ["FIRE-01"] });
  await pause(100);
  await step(inc2, "ACCEPTED", "EN_ROUTE");

  // 3. Ready for review: trapped and injured person, FIRE + EMS recommended.
  await say(agent, "seed:3", "Simulation: my coworker is pinned under a shelf at the demo library loading dock, he's awake but his leg is bleeding", {
    incidentType: "trapped person", trappedPerson: true, injuryReported: true, callerReportedConscious: true, peopleInvolved: 1,
    locationText: "Demo library loading dock",
  }, [["incidentType", "pinned under a shelf"], ["trappedPerson", "pinned under a shelf"], ["injuryReported", "his leg is bleeding"], ["callerReportedConscious", "he's awake"], ["peopleInvolved", "my coworker"], ["locationText", "demo library loading dock"]],
  "Person pinned under a shelf at the demo library loading dock. Conscious, leg bleeding.", TRAPPED);

  // 4. Collecting, no location yet, and a new message still being read (PENDING).
  await say(agent, "seed:4", "Simulation: a guy is swinging a bat at cars in the parking garage", { incidentType: "violent threat", violentThreat: true },
    [["incidentType", "swinging a bat"], ["violentThreat", "swinging a bat at cars"]], "Person swinging a bat at cars in a parking garage. Location not given yet.", THREAT);
  await recordInbound(agent.conn, { provider: "seed", conversationKey: "seed:4", route: ROUTE, messages: [{ id: "seed-pending", text: "the one on demo street", receivedAt: new Date().toISOString() }] });

  for (const [flag, role, unit] of [["dispatcher", "DISPATCHER"], ["responder", "RESPONDER", "FIRE-01"]] as const) {
    const hex = arg(flag);
    if (hex) { cli("grant_role", hex, role, unit ? JSON.stringify({ some: unit }) : '{"none":[]}'); console.log(`granted ${role} to ${hex}`); }
  }
  console.log(`Seeded 4 incidents into ${DB}.`);
  for (const c of [agent, dispatcher, fire]) c.conn.disconnect();
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
