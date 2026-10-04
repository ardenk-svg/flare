// Scripted end-to-end loop: real runAgent and local SpacetimeDB; fixtures or --live-gemini.
// Only the Spectrum transport is replaced. Dispatcher and responder are separate identities.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fromVCard } from "@spectrum-ts/core";
import type { ExtractTurn, CallerFacts, ExtractionResult } from "@flare/contracts";

import {
  advanceAssignment,
  closeIncident,
  confirmDispatchAndAssign,
  connectFlare,
  getMyRole,
  listAssignments,
  listIncidents,
  listConversation,
  getConversationController, takeOverConversation, releaseConversation, sendDispatcherMessage,
  resolveIncident,
  type FlareConnection,
} from "@flare/data";

import { runAgent } from "../apps/agent/src/runtime.ts";
import type { ProviderRoute } from "../apps/agent/src/types.ts";
import type { SpectrumMessageEnvelope } from "../apps/agent/src/normalize.ts";
import type { SpectrumAppEnvelope } from "../apps/agent/src/message-loop.ts";
import { configureSpacetimeCli } from "./spacetime-cli.js";

const SPACETIME = configureSpacetimeCli();

const URI = process.env.SPACETIMEDB_URI!;
const DB = process.env.SPACETIMEDB_DATABASE!;
const STATE = process.env.FLARE_AGENT_STATE_PATH!;
const localUrl = (url: string) => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
if (!localUrl(URI)) throw new Error("harness resets data; local only");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  -- ${detail}` : ""}`);
};
const SERVER = process.env.SPACETIME_SERVER ?? "local";
if (SERVER !== "local" && !localUrl(SERVER)) throw new Error("harness resets data; local only");
const cli = (...args: string[]) =>
  execFileSync(SPACETIME, ["call", "--server", SERVER, DB, ...args], { stdio: "pipe" }).toString();
const sql = (query: string) =>
  execFileSync(SPACETIME, ["sql", "--server", SERVER, DB, query], { stdio: "pipe" }).toString();
async function waitFor(name: string, fn: () => boolean, ms = 45_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) {
      check(name, true);
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  check(name, false, `timed out after ${ms}ms`);
  return false;
}

// ---- Scripted Spectrum transport ----
const SPACE_ID = `harness-space-${Date.now()}`;
const replies: string[] = [];
const routed: Array<{ route: ProviderRoute; text: string }> = [];
let messageSeq = 0;

class ScriptedApp {
  #queue: Array<readonly [ScriptedSpace, SpectrumMessageEnvelope]> = [];
  #wake: (() => void) | undefined;
  #stopped = false;
  readonly messages = this.#iterate();

  push(text: string) {
    this.pushContent({ type: "text", text });
  }

  pushContent(content: SpectrumMessageEnvelope["content"]) {
    const space = {
      id: SPACE_ID,
      phone: "shared",
      send: async (t: string) => void replies.push(t),
    };
    this.#queue.push([
      space,
      {
        id: `harness-msg-${++messageSeq}`,
        platform: "imessage",
        direction: "inbound",
        timestamp: new Date(),
        sender: { id: "+15555550100" },
        content,
      },
    ]);
    this.#wake?.();
  }

  async stop() {
    this.#stopped = true;
    this.#wake?.();
  }

  async *#iterate(): SpectrumAppEnvelope["messages"] {
    while (true) {
      while (this.#queue.length) yield this.#queue.shift()!;
      if (this.#stopped) return;
      await new Promise<void>((r) => (this.#wake = r));
    }
  }
}

interface ScriptedSpace { id: string; phone: string; send(text: string): Promise<void> }

// Stable provider responses make a fresh checkout testable without a Gemini account.
// These fixtures exercise the worker and database; --live-gemini exercises extraction too.
const fixtureExtract: ExtractTurn = async turn => {
  const caller = turn.messages.at(-1)!;
  let patch: Partial<CallerFacts>;
  let summary: string;
  let corrections: ExtractionResult["corrections"] = [];
  let proposedQuestion: string | null = null;
  if (/smoke/i.test(caller.text)) { patch = { fireOrSmoke: true }; summary = "Caller reports smoke outside."; proposedQuestion = "[SIMULATION] Which building and entrance?"; }
  else if (/correction/i.test(caller.text)) { patch = { locationText: "South entrance" }; summary = "Smoke at the south entrance."; corrections = ["locationText"]; }
  else if (/north/i.test(caller.text)) { patch = { locationText: "North entrance of the demo student center" }; summary = "Smoke at the north entrance."; }
  else if (/crashed/i.test(caller.text)) { patch = { locationText: "Demo Street" }; summary = "Car crashed into a pole on Demo Street."; }
  else if (/fainted/i.test(caller.text)) { patch = { locationText: "Library lobby", callerReportedConscious: false }; summary = "Someone fainted in the library lobby."; }
  else if (/threatening/i.test(caller.text)) { patch = { locationText: "Library entrance", violentThreat: true, weaponPresent: true }; summary = "Caller reports a violent threat at the library entrance."; }
  else return { ok: true, result: { intent: "OTHER", patch: {}, summary: "", evidence: [], corrections: [], unresolvedFields: [], proposedQuestion: null } };
  return { ok: true, result: { intent: corrections.length ? "CORRECTION" : "REPORT", patch, summary,
    evidence: Object.keys(patch).map(field => ({ field: field as keyof CallerFacts, messageId: caller.id, quote: caller.text })),
    corrections, unresolvedFields: proposedQuestion ? ["locationText"] : [], proposedQuestion } };
};

function startAgent() {
  const app = new ScriptedApp();
  const done = runAgent(app, async (route, text) => void routed.push({ route, text }), {
    extractTurn: process.argv.includes("--live-gemini") ? undefined : fixtureExtract,
  });
  return { app, done };
}

async function client(role: "DISPATCHER" | "RESPONDER" | "AGENT", unit?: string): Promise<FlareConnection> {
  const c = await connectFlare({ uri: URI, database: DB });
  cli("grant_role", c.identityHex, role, unit ? JSON.stringify({ some: unit }) : '{"none":[]}');
  const end = Date.now() + 5000;
  while (getMyRole(c.conn)?.role !== role && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return c;
}

async function main() {
  console.log(`Loop harness → ${URI}/${DB}, extraction: ${process.argv.includes("--live-gemini") ? "live Gemini" : "fixtures"}\n`);
  cli("reset_demo");

  // Pre-provision the agent identity exactly as an operator would: mint, persist, grant.
  const agentId = await client("AGENT");
  await writeFile(STATE, JSON.stringify({ version: 1, spacetimeToken: agentId.token, routes: {} }), { mode: 0o600 });
  agentId.conn.disconnect();

  const dispatcher = await client("DISPATCHER");
  const responder = await client("RESPONDER", "FIRE-01");
  const ems = await client("RESPONDER", "EMS-01");
  const police = await client("RESPONDER", "POLICE-01");
  const dispatcher2 = await client("DISPATCHER");
  const D = dispatcher.conn;
  const R = responder.conn;

  let agent = startAgent();
  await new Promise((r) => setTimeout(r, 1500));

  // ---- Report → incident ----
  agent.app.push("Simulation: I see smoke outside.");
  await waitFor("dispatcher sees a new incident with fireOrSmoke and FIRE recommended", () => {
    const i = listIncidents(D)[0];
    return !!i && i.facts.fireOrSmoke === true && i.recommendedServices.includes("FIRE");
  });
  const incidentId = listIncidents(D)[0]?.id ?? "";
  const inc = () => listIncidents(D).find((i) => i.id === incidentId)!;
  check("evidence quotes the caller's own words", inc().evidence.some((e) => e.field === "fireOrSmoke" && "Simulation: I see smoke outside.".includes(e.quote)));
  await waitFor("agent sends one clarifying question back on the same thread", () => replies.length >= 1, 10_000);
  console.log(`      question: ${JSON.stringify(replies[0])}`);

  await waitFor("delivered clarification appears in the dispatcher transcript", () =>
    listConversation(D, incidentId).some(row => row.sender === "AGENT" && row.text === replies[0] && row.delivery === "SENT"), 5000);
  await takeOverConversation(D, { incidentId });
  await waitFor("dispatcher takeover is committed and visible", () => getConversationController(D, incidentId) === dispatcher.identityHex, 5000);
  check("responders cannot read conversation ownership", getConversationController(R, incidentId) === null);
  try { await takeOverConversation(dispatcher2.conn, { incidentId }); check("another dispatcher cannot steal the conversation", false); }
  catch (error) { check("another dispatcher cannot steal the conversation", (error as { code?: string }).code === "TAKEN_OVER"); }
  try { await takeOverConversation(R, { incidentId }); check("responders cannot take over caller conversations", false); }
  catch (error) { check("responders cannot take over caller conversations", (error as { code?: string }).code === "UNAUTHORIZED"); }
  const humanReply = { incidentId, text: "Which entrance should the mock crew use?", clientMessageId: "e2e-human-1" };
  try { await sendDispatcherMessage(dispatcher2.conn, humanReply); check("only the controlling dispatcher can message the caller", false); }
  catch (error) { check("only the controlling dispatcher can message the caller", (error as { code?: string }).code === "NOT_CONVERSATION_OWNER"); }
  await sendDispatcherMessage(D, humanReply);
  await sendDispatcherMessage(D, humanReply);
  await waitFor("dispatcher message is delivered and attributed in the transcript", () => listConversation(D, incidentId).some(row => row.sender === "DISPATCHER" && row.delivery === "SENT" && /mock crew/.test(row.text)), 10_000);
  check("a retried dispatcher message creates one transcript row", listConversation(D, incidentId).filter(row => row.sender === "DISPATCHER").length === 1);
  await releaseConversation(D, { incidentId });
  await waitFor("return to agent releases the conversation", () => getConversationController(D, incidentId) === null, 5000);
  agent.app.pushContent({ type: "contact", ...fromVCard("BEGIN:VCARD\nVERSION:3.0\nFN:Current Location\nURL:https://maps.apple.com/?ll=42.3314,-83.0458\nEND:VCARD") });
  await waitFor("native iMessage vCard pin reaches the dispatcher and makes the incident ready", () => {
    const current = inc();
    return current.sharedLocation?.latitude === 42.3314 && current.sharedLocation.longitude === -83.0458 && current.status === "READY_FOR_REVIEW";
  }, 5000);
  check("pin leaves the caller's text facts unchanged", inc().facts.locationText === null);
  await waitFor("location marker appears in the caller transcript", () => listConversation(D, incidentId).some(row => row.sender === "CALLER" && row.text.startsWith("[Shared location")), 5000);
  agent.app.pushContent({ type: "attachment", name: "photo.jpg" });
  await waitFor("unreadable attachment receives a fallback recorded in the transcript", () =>
    listConversation(D, incidentId).some(row => row.sender === "AGENT" && /couldn't read that attachment/.test(row.text) && row.delivery === "SENT"), 10_000);

  agent.app.push("North entrance of the demo student center.");
  await waitFor("location fills in and incident becomes READY_FOR_REVIEW", () =>
    /north/i.test(inc().facts.locationText ?? "") && inc().status === "READY_FOR_REVIEW");

  agent.app.push("Correction: south entrance, not north.");
  await waitFor("correction updates the same incident to the south entrance", () =>
    /south/i.test(inc().facts.locationText ?? "") && !/north entrance of/i.test(inc().facts.locationText ?? ""));
  check("still exactly one incident", listIncidents(D).length === 1);
  check("correction recorded on locationText", inc().lastCorrections.includes("locationText"));
  check("recommendation stays FIRE", inc().recommendedServices.join() === "FIRE");
  console.log(`      facts.locationText: ${JSON.stringify(inc().facts.locationText)}`);

  // ---- Assignment ----
  await confirmDispatchAndAssign(D, { incidentId, confirmedServices: ["FIRE"], unitIds: ["FIRE-01"] });
  await waitFor("responder sees OFFERED assignment", () => listAssignments(R).some((a) => a.incidentId === incidentId && a.status === "OFFERED"));
  await waitFor("dispatch-confirmed notification delivered to the caller's route", () =>
    routed.some((m) => /SIMULATION/.test(m.text) && m.route.spaceId === SPACE_ID && /FIRE-01/.test(m.text)), 15_000);

  // ---- Restart with unacknowledged work: responder moves while the agent is down ----
  await agent.app.stop();
  await agent.done;
  check("agent stopped cleanly", true);
  const assignmentId = listAssignments(R)[0]!.id;
  await advanceAssignment(R, { assignmentId, nextStatus: "ACCEPTED" });
  await advanceAssignment(R, { assignmentId, nextStatus: "EN_ROUTE" });
  await waitFor("dispatcher sees EN_ROUTE without refresh", () => listAssignments(D).find((a) => a.id === assignmentId)?.status === "EN_ROUTE", 5000);
  check("EN_ROUTE notification is pending while agent is down", /ASSIGNMENT_EN_ROUTE/.test(sql("SELECT kind, status FROM notification WHERE status = 'PENDING'")));

  // Simulate a lost local state file: keep only the token, so the route must come from the database.
  await writeFile(STATE, JSON.stringify({ version: 1, spacetimeToken: agentId.token, routes: {} }), { mode: 0o600 });
  const before = routed.length;
  agent = startAgent();
  await waitFor("restarted agent drains EN_ROUTE through the DB-stored route", () =>
    routed.slice(before).some((m) => /en route/i.test(m.text) && m.route.spaceId === SPACE_ID && m.route.phone === "shared"), 15_000);
  console.log(`      delivered: ${JSON.stringify(routed.at(-1)?.text)}`);

  // ---- Status query from committed state ----
  const beforeStatus = routed.length;
  agent.app.push("Any update?");
  await waitFor("status reply reflects committed assignment state", () =>
    routed.slice(beforeStatus).some((m) => /FIRE-01 EN_ROUTE/.test(m.text)), 15_000);
  console.log(`      status reply: ${JSON.stringify(routed.at(-1)?.text)}`);
  check("status query created no new incident", listIncidents(D).length === 1);
  agent.app.push("Hello");
  await waitFor("OTHER response is delivered and recorded", () => listConversation(D, incidentId).some(row => row.sender === "AGENT" && /I can record a mock incident/.test(row.text) && row.delivery === "SENT"), 10_000);
  await waitFor("every delivered question and notification appears in the transcript", () => {
    const rows = listConversation(D, incidentId);
    return [...replies, ...routed.map(item => item.text)].every(text => rows.some(row => row.sender !== "CALLER" && row.delivery === "SENT" && row.text === text));
  }, 5000);

  await new Promise((r) => setTimeout(r, 3000));
  const unsent = sql("SELECT id, kind, status FROM notification WHERE status != 'SENT'");
  check("every notification acknowledged as SENT", !/PENDING|FAILED/.test(unsent), unsent);

  // ---- Resolve, then a clean second case on the same thread ----
  await advanceAssignment(R, { assignmentId, nextStatus: "ON_SCENE" });
  await advanceAssignment(R, { assignmentId, nextStatus: "COMPLETED" });
  await resolveIncident(D, { incidentId });
  await waitFor("incident RESOLVED", () => inc().status === "RESOLVED", 5000);

  agent.app.push("Simulation: a car crashed into a pole on Demo Street.");
  await waitFor("second report on the same thread creates a new incident", () => listIncidents(D).some((i) => i.id !== incidentId), 45_000);
  const caseB = listIncidents(D).find((i) => i.id !== incidentId)!;
  check("case B carries no fire or location facts from case A", caseB.facts.fireOrSmoke === null && !/south|north/i.test(caseB.facts.locationText ?? ""));
  check("case B carries no shared coordinates from case A", caseB.sharedLocation === null);
  check("case B evidence comes only from the new message", caseB.evidence.every((e) => "Simulation: a car crashed into a pole on Demo Street.".includes(e.quote)));
  check("case B is a later intake case", caseB.caseEpoch > inc().caseEpoch);

  // ---- Close case B without dispatching, then a third case on the same thread ----
  const incB = () => listIncidents(D).find((i) => i.id === caseB.id)!;
  await waitFor("case B extraction settles", () => incB().extractionState === "OK", 30_000);
  await new Promise((r) => setTimeout(r, 2000));
  const beforeClose = routed.length;
  await closeIncident(D, { incidentId: caseB.id, reason: "Harness: duplicate report" });
  await waitFor("case B is CLOSED with its reason", () => incB().status === "CLOSED" && incB().closeReason === "Harness: duplicate report", 5000);
  await waitFor("caller is told the report was closed", () =>
    routed.slice(beforeClose).some((m) => /closed/i.test(m.text) && m.route.spaceId === SPACE_ID), 15_000);
  console.log(`      close notice: ${JSON.stringify(routed.at(-1)?.text)}`);
  await waitFor("close notification appears in case B transcript", () => listConversation(D, caseB.id).some(row => row.sender === "AGENT" && /closed/i.test(row.text) && row.delivery === "SENT"), 5000);

  agent.app.push("Simulation: someone fainted in the library lobby.");
  await waitFor("after a close, the next text opens a new incident", () =>
    listIncidents(D).some((i) => i.id !== incidentId && i.id !== caseB.id), 45_000);
  const caseC = listIncidents(D).find((i) => i.id !== incidentId && i.id !== caseB.id)!;
  check("case C is a later intake case than B", caseC.caseEpoch > incB().caseEpoch);
  check("case C carries nothing from case B", !/pole|demo street/i.test(caseC.facts.locationText ?? ""));

  await waitFor("EMS report is ready for dispatcher review", () => listIncidents(D).find(i => i.id === caseC.id)?.status === "READY_FOR_REVIEW", 10_000);
  await confirmDispatchAndAssign(D, { incidentId: caseC.id, confirmedServices: ["EMS"], unitIds: ["EMS-01"] });
  await waitFor("EMS responder sees its assignment", () => listAssignments(ems.conn).some(a => a.incidentId === caseC.id), 5000);
  const emsAssignment = listAssignments(ems.conn).find(a => a.incidentId === caseC.id)!;
  for (const nextStatus of ["ACCEPTED", "EN_ROUTE", "ON_SCENE", "COMPLETED"] as const) await advanceAssignment(ems.conn, { assignmentId: emsAssignment.id, nextStatus });
  await waitFor("EMS completes the full responder lifecycle", () => listAssignments(D).find(a => a.id === emsAssignment.id)?.status === "COMPLETED", 5000);
  await resolveIncident(D, { incidentId: caseC.id });

  agent.app.push("Simulation: someone is threatening people with a knife at the library entrance.");
  await waitFor("police report is ready with a POLICE recommendation", () => listIncidents(D).some(i => i.id !== incidentId && i.id !== caseB.id && i.id !== caseC.id && i.status === "READY_FOR_REVIEW" && i.recommendedServices.includes("POLICE")), 15_000);
  const caseD = listIncidents(D).find(i => i.id !== incidentId && i.id !== caseB.id && i.id !== caseC.id)!;
  await confirmDispatchAndAssign(D, { incidentId: caseD.id, confirmedServices: ["POLICE"], unitIds: ["POLICE-01"] });
  await waitFor("police responder sees its assignment", () => listAssignments(police.conn).some(a => a.incidentId === caseD.id), 5000);
  const policeAssignment = listAssignments(police.conn).find(a => a.incidentId === caseD.id)!;
  check("responder views isolate EMS, police and fire assignments", listAssignments(ems.conn).every(a => a.unitId === "EMS-01") && listAssignments(police.conn).every(a => a.unitId === "POLICE-01") && listAssignments(R).every(a => a.unitId === "FIRE-01"));
  for (const nextStatus of ["ACCEPTED", "EN_ROUTE", "ON_SCENE", "COMPLETED"] as const) await advanceAssignment(police.conn, { assignmentId: policeAssignment.id, nextStatus });
  await waitFor("police completes the full responder lifecycle", () => listAssignments(D).find(a => a.id === policeAssignment.id)?.status === "COMPLETED", 5000);
  await resolveIncident(D, { incidentId: caseD.id });

  await agent.app.stop();
  await agent.done;
  D.disconnect();
  R.disconnect();
  ems.conn.disconnect(); police.conn.disconnect(); dispatcher2.conn.disconnect();
}

main()
  .catch((e) => {
    failures++;
    console.error("FAIL  unexpected error:", e);
  })
  .finally(() => {
    console.log(`\n${failures === 0 ? "Loop harness passed" : `Loop harness FAILED (${failures})`}.`);
    process.exit(failures === 0 ? 0 : 1);
  });
