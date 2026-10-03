// Live browser-client smoke against a LOCAL SpacetimeDB database. RESETS that database first.
// Drives the same createLiveClient the dispatcher/responder routes use, with separate identities.
// Usage: npm run smoke:live   (needs `spacetime start` running and the module published by this machine's CLI identity)
import { execFileSync } from "node:child_process";
import type { CallerFactPatch, Evidence, ExtractionResult, Intent, Recommendation } from "@flare/contracts";
import {
  applyIntakePatch, connectFlare, getMyRole, listIncidents, listPendingNotifications,
  recordExtractionFailure, recordInbound, type FlareConnection,
} from "@flare/data";
import { createLiveClient, type LiveClient, type TokenStore } from "../src/data/liveClient";
import type { OpResult, Snapshot } from "../src/types";

const URI = process.env.SPACETIMEDB_URI ?? "ws://127.0.0.1:3000";
const DB = process.env.FLARE_DB ?? "flare-dev";
const SERVER = "local";
const KEY = "smoke:conversation-1";
const ROUTE = { platform: "smoke", spaceId: "smoke-space-1", line: null };

// ---- Reporting ----
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -- ${detail}` : ""}`);
};
const fatal = (msg: string): never => { console.error(`\nSMOKE ABORTED: ${msg}`); process.exit(2); };

// ---- Preflight: refuse anything but a local, published, reachable database ----
const host = new URL(URI).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host))
  fatal(`SPACETIMEDB_URI=${URI} is not local. This smoke resets the database; never point it at the shared integration database.`);

function cli(...args: string[]): string {
  try {
    return execFileSync("spacetime", ["call", "--server", SERVER, DB, ...args], { stdio: "pipe" }).toString();
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer };
    if (err.code === "ENOENT") fatal("`spacetime` CLI not found on PATH. Install it: curl -sSf https://install.spacetimedb.com | sh");
    return fatal(`spacetime call ${args[0]} failed. Is \`spacetime start\` running, is "${DB}" published (cd spacetime && npm run publish:local), and is this CLI identity the publisher?\n${err.stderr?.toString().trim() ?? err.message}`);
  }
}

async function waitFor(name: string, fn: () => boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  check(name, false, `timed out after ${ms}ms`);
  return false;
}
/** waitFor that reports PASS on success, so every observed update is a named check. */
const observe = async (name: string, fn: () => boolean, ms?: number) => { if (await waitFor(name, fn, ms)) check(name, true); };

const memoryTokens = (): TokenStore => { let t: string | undefined; return { get: () => t, set: (v) => { t = v; } }; };

/** A browser-equivalent client. Counts listener notifications so updates are proven to arrive by subscription. */
function browser(tokens = memoryTokens()) {
  const client = createLiveClient({ uri: URI, database: DB, tokenStore: tokens });
  const view = { client, tokens, pushes: 0, snap: (): Snapshot => client.getSnapshot() };
  client.subscribe(() => { view.pushes++; });
  return view;
}
type Browser = ReturnType<typeof browser>;

async function connected(name: string, b: Browser) {
  const s = b.snap;
  if (!(await waitFor(`${name} connects`, () => s().connection === "connected", 6000)))
    fatal(`${name} could not connect to ${URI}/${DB}: ${s().connectError ?? "no error reported"}`);
}

function grant(b: Browser, role: "DISPATCHER" | "RESPONDER" | "AGENT", unitId?: string, hex = b.snap().identityHex) {
  if (!hex) fatal(`no identity for ${role} grant`);
  cli("grant_role", hex!, role, unitId ? JSON.stringify({ some: unitId }) : '{"none":[]}');
}

const rejected = (name: string, r: OpResult, code: string) =>
  check(name, !r.ok && r.code === code, r.ok ? "mutation reported success" : `expected ${code}, got ${r.code}`);

const msg = (id: string, text: string) => ({ id, text, receivedAt: new Date().toISOString() });
const extraction = (intent: Intent, patch: CallerFactPatch, evidence: Evidence[], summary: string): ExtractionResult => ({
  intent, patch, summary, evidence, corrections: [], unresolvedFields: [], proposedQuestion: null,
});
const FIRE_REC: Recommendation = { services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "Caller reported fire or smoke." };

async function main() {
  console.log(`Flare live smoke → ${URI} / ${DB} (local, resets demo data)\n`);
  cli("reset_demo");

  // ---- 1. Role gating: fresh identities see nothing until the backend grants a role ----
  const dispatcher = browser();
  const responder = browser();
  await connected("dispatcher", dispatcher);
  await connected("responder", responder);
  const d = dispatcher.snap, r = responder.snap;
  check("dispatcher and responder have distinct identities", !!d().identityHex && d().identityHex !== r().identityHex);
  await observe("ungranted dispatcher sees no-role and no data", () => d().access === "no-role" && d().units.length === 0);
  await observe("ungranted responder sees no-role", () => r().access === "no-role");
  rejected("ungranted identity cannot dispatch", await dispatcher.client.confirmDispatchAndAssign({ incidentId: "1", confirmedServices: ["FIRE"], unitIds: ["FIRE-01"] }), "UNAUTHORIZED");

  grant(dispatcher, "DISPATCHER");
  grant(responder, "RESPONDER", "FIRE-01");
  await observe("dispatcher grant arrives without reconnect", () => d().access === "ok" && d().identity.role === "dispatcher" && d().units.length === 3);
  await observe("responder grant arrives as mock unit FIRE-01", () => r().access === "ok" && r().identity.role === "responder" && r().identity.unitId === "FIRE-01");

  // ---- 2. Live incident pushed to the dispatcher by subscription ----
  const agent: FlareConnection = await connectFlare({ uri: URI, database: DB }).catch((e) => fatal(`agent connect failed: ${e}`));
  cli("grant_role", agent.identityHex, "AGENT", '{"none":[]}');
  if (!(await waitFor("agent grant", () => getMyRole(agent.conn)?.role === "AGENT"))) fatal("AGENT role was not granted");
  const A = agent.conn;

  const pushesBefore = dispatcher.pushes;
  await recordInbound(A, { provider: "smoke", conversationKey: KEY, route: ROUTE, messages: [msg("m1", "Simulation: I see smoke outside.")] });
  await applyIntakePatch(A, {
    conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ["m1"], recommendation: FIRE_REC,
    result: extraction("REPORT", { fireOrSmoke: true }, [{ field: "fireOrSmoke", messageId: "m1", quote: "I see smoke outside" }], "Caller reports smoke outside; location unknown."),
  });
  await observe("dispatcher receives new incident by subscription", () => d().incidents.length === 1 && dispatcher.pushes > pushesBefore);
  const incidentId = d().incidents[0]?.id ?? fatal("no incident on dispatcher");
  const inc = () => d().incidents.find((i) => i.id === incidentId)!;
  check("incident is COLLECTING with FIRE recommended, nothing confirmed", inc().status === "COLLECTING" && inc().recommendedServices.join() === "FIRE" && inc().confirmedServices.length === 0);
  check("evidence quote reaches dispatcher", inc().evidence.some((e) => e.field === "fireOrSmoke" && e.quote === "I see smoke outside"));
  check("unassigned responder sees no incident", r().incidents.length === 0);

  // ---- 3. Extraction pending / failed keep the last verified facts; only the indicator changes ----
  await recordInbound(A, { provider: "smoke", conversationKey: KEY, route: ROUTE, messages: [msg("m2", "North entrance of the demo student center.")] });
  await observe("inbound for active incident shows PENDING with facts kept", () => inc().extraction.state === "PENDING" && inc().facts.fireOrSmoke === true);

  await recordExtractionFailure(A, { conversationKey: KEY, messageIds: ["m2"], error: { code: "TIMEOUT", message: "Gemini timed out", retryable: true } });
  await observe("extraction failure shows FAILED with a message", () => inc().extraction.state === "FAILED" && !!inc().extraction.message?.includes("TIMEOUT"));
  check("failure keeps last verified facts", inc().facts.fireOrSmoke === true && inc().status === "COLLECTING");

  await applyIntakePatch(A, {
    conversationKey: KEY, expectedRevision: 1, sourceMessageIds: ["m2"], recommendation: FIRE_REC,
    result: extraction("REPORT", { locationText: "North entrance of the demo student center" }, [{ field: "locationText", messageId: "m2", quote: "North entrance of the demo student center" }], "Smoke outside the north entrance of the demo student center."),
  });
  await observe("successful retry returns to OK and READY_FOR_REVIEW", () => inc().extraction.state === "OK" && inc().status === "READY_FOR_REVIEW" && inc().facts.locationText !== null);

  // ---- 4. Rejected mutations never report success ----
  rejected("responder cannot dispatch", await responder.client.confirmDispatchAndAssign({ incidentId, confirmedServices: ["FIRE"], unitIds: ["FIRE-01"] }), "UNAUTHORIZED");
  rejected("unit must match confirmed service", await dispatcher.client.confirmDispatchAndAssign({ incidentId, confirmedServices: ["FIRE"], unitIds: ["EMS-01"] }), "UNIT_SERVICE_MISMATCH");
  check("rejections created no assignment", d().assignments.length === 0 && inc().status === "READY_FOR_REVIEW");

  // ---- 5. Dispatcher confirmation reaches the responder by subscription ----
  const ok = await dispatcher.client.confirmDispatchAndAssign({ incidentId, confirmedServices: ["FIRE"], unitIds: ["FIRE-01"] });
  check("dispatcher confirms FIRE with FIRE-01", ok.ok, ok.ok ? "" : `${ok.code}: ${ok.message}`);
  await observe("responder receives OFFERED assignment and incident", () => r().assignments.some((a) => a.incidentId === incidentId && a.status === "OFFERED") && r().incidents.length === 1);
  check("dispatcher shows DISPATCHED and FIRE-01 BUSY", inc().status === "DISPATCHED" && d().units.find((u) => u.id === "FIRE-01")?.status === "BUSY");
  rejected("second confirmation rejected", await dispatcher.client.confirmDispatchAndAssign({ incidentId, confirmedServices: ["FIRE"], unitIds: ["FIRE-01"] }), "ALREADY_DISPATCHED");

  // ---- 6. Responder progress reaches the dispatcher by subscription ----
  const assignmentId = r().assignments[0]?.id ?? fatal("responder has no assignment");
  const dAssign = () => d().assignments.find((a) => a.id === assignmentId)?.status;
  rejected("responder cannot skip a stage", await responder.client.advanceAssignment({ assignmentId, next: "EN_ROUTE" }), "INVALID_TRANSITION");
  check("responder accepts", (await responder.client.advanceAssignment({ assignmentId, next: "ACCEPTED" })).ok);
  await observe("dispatcher sees ACCEPTED without refresh", () => dAssign() === "ACCEPTED");
  check("responder advances to EN_ROUTE", (await responder.client.advanceAssignment({ assignmentId, next: "EN_ROUTE" })).ok);
  await observe("dispatcher sees EN_ROUTE without refresh", () => dAssign() === "EN_ROUTE");
  await observe("EN_ROUTE notification committed for the agent", () => listPendingNotifications(A).some((n) => n.kind === "ASSIGNMENT_EN_ROUTE" && n.conversationKey === KEY));

  // ---- 7. Disconnect blocks mutations; reconnect with the same token restores identity and state ----
  const responderHex = r().identityHex;
  responder.client.close();
  rejected("closed client blocks mutations", await responder.client.advanceAssignment({ assignmentId, next: "ON_SCENE" }), "DISCONNECTED");
  check("assignment unchanged after blocked mutation", dAssign() === "EN_ROUTE");
  const again = browser(responder.tokens);
  await connected("responder (reconnect)", again);
  await observe("reconnect keeps identity, role, and committed assignment", () =>
    again.snap().identityHex === responderHex && again.snap().identity.unitId === "FIRE-01" && again.snap().assignments.some((a) => a.id === assignmentId && a.status === "EN_ROUTE"));

  // ---- 8. Resolve, then a second case in the same conversation starts clean ----
  const R = again.client;
  check("responder reaches ON_SCENE and COMPLETED", (await R.advanceAssignment({ assignmentId, next: "ON_SCENE" })).ok && (await R.advanceAssignment({ assignmentId, next: "COMPLETED" })).ok);
  await observe("dispatcher sees COMPLETED and FIRE-01 released", () => dAssign() === "COMPLETED" && d().units.find((u) => u.id === "FIRE-01")?.status === "AVAILABLE");
  check("completing the assignment does not resolve the incident", inc().status === "DISPATCHED");
  rejected("responder cannot resolve", await R.resolveIncident({ incidentId }), "UNAUTHORIZED");
  const resolved = await dispatcher.client.resolveIncident({ incidentId });
  check("dispatcher resolves the incident", resolved.ok, resolved.ok ? "" : `${resolved.code}: ${resolved.message}`);
  await observe("RESOLVED pushed to dispatcher", () => inc().status === "RESOLVED");

  await recordInbound(A, { provider: "smoke", conversationKey: KEY, route: ROUTE, messages: [msg("b1", "Simulation: a car crashed into a pole on Demo Street.")] });
  await applyIntakePatch(A, {
    conversationKey: KEY, expectedRevision: 0, sourceMessageIds: ["b1"], recommendation: { services: [], ruleIds: [], reason: "No demo rule matched; dispatcher review required." },
    result: extraction("REPORT", { incidentType: "vehicle collision" }, [{ field: "incidentType", messageId: "b1", quote: "a car crashed into a pole" }], "Caller reports a car crashed into a pole on Demo Street."),
  });
  await observe("second case appears as a new incident", () => d().incidents.some((i) => i.id !== incidentId));
  const caseB = d().incidents.find((i) => i.id !== incidentId)!;
  check("second case carries no facts or evidence from the first", caseB.facts.fireOrSmoke === null && caseB.facts.locationText === null && caseB.evidence.every((e) => e.messageId === "b1"));
  check("second case is a later intake case", (listIncidents(A).find((i) => i.id === caseB.id)?.caseEpoch ?? 0) > (listIncidents(A).find((i) => i.id === incidentId)?.caseEpoch ?? 0));
  check("first incident stays RESOLVED in history", inc().status === "RESOLVED");

  dispatcher.client.close();
  again.client.close();
  A.disconnect();
}

main()
  .catch((e) => { failures++; console.error("FAIL  unexpected error:", e); })
  .finally(() => {
    console.log(`\n${failures === 0 ? "Smoke passed" : `Smoke FAILED (${failures} failing)`}.`);
    process.exit(failures === 0 ? 0 : 1);
  });
