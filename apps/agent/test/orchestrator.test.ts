import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  emptyFacts, mergeFacts,
  type Assignment,
  type ConversationContext,
  type ExtractionOutcome,
  type ExtractionResult,
  type InboundTurn,
  type Incident,
  type PendingNotification,
  type Recommendation,
} from "@flare/contracts";

import type { AgentDataPort, ExtractionFailure } from "../src/data-port.js";
import { AgentOrchestrator } from "../src/orchestrator.js";
import { AgentStateStore } from "../src/state-store.js";

const message = {
  id: "m-1",
  text: "Simulation: smoke outside.",
  receivedAt: "2026-10-03T12:00:00.000Z",
};

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "1",
    facts: emptyFacts(),
    evidence: [],
    summary: "Smoke reported",
    intakeRevision: 1,
    unresolvedFields: [],
    lastCorrections: [],
    recommendedServices: ["FIRE"],
    recommendationRuleIds: ["DEMO_FIRE"],
    recommendationReason: "Smoke",
    confirmedServices: [],
    status: "READY_FOR_REVIEW",
    needsReview: false,
    extractionState: "OK",
    extractionError: null,
    caseEpoch: 1,
    closeReason: null,
    sharedLocation: null,
    createdAt: "2026-10-03T12:00:00.000Z",
    updatedAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

function context(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationKey: "imessage:chat-1",
    route: { platform: "imessage", spaceId: "chat-1", line: null },
    caseEpoch: 1,
    activeIncident: null,
    intakeRevision: 0,
    currentFacts: emptyFacts(),
    currentSummary: "",
    lastQuestion: null,
    lastQuestionDelivery: null,
    pendingMessages: [message],
    recentMessages: [],
    lastExtractionError: null,
    ...overrides,
  };
}

class FakeData implements AgentDataPort {
  translations = new Map<string, { language: string; translatedText: string }>();
  getInboundTranslation(_key: string, id: string) { return this.translations.get(id) ?? null; }
  async recordInboundTranslation(input: { messageId: string; language: string; translatedText: string }) { this.translations.set(input.messageId, input); this.current.callerLanguage = input.language; }
  async prepareNotificationTranslation() {}
  locations: Array<Parameters<AgentDataPort["recordSharedLocation"]>[0]> = [];
  async recordSharedLocation(input: Parameters<AgentDataPort["recordSharedLocation"]>[0]): Promise<void> { this.locations.push(input); }
  current = context();
  assignments: Assignment[] = [];
  failures: ExtractionFailure[] = [];
  applied: Array<{ result: ExtractionResult; recommendation: Recommendation }> = [];
  completed: Array<{ intent: "STATUS_QUERY" | "OTHER"; replyText?: string }> = [];
  questions: Array<{ question: string; delivered: boolean; error?: string; translatedText?: string; language?: string }> = [];

  async recordInbound(): Promise<ConversationContext> {
    return this.current;
  }
  getConversationContext(): ConversationContext | null {
    return this.current;
  }
  async recordExtractionFailure(input: { error: ExtractionFailure }): Promise<void> {
    this.failures.push(input.error);
  }
  async applyIntakePatch(input: {
    result: ExtractionResult;
    recommendation: Recommendation;
  }): Promise<void> {
    this.applied.push(input);
    this.current = { ...this.current, pendingMessages: [] };
  }
  async completeInboundWithoutPatch(input: {
    intent: "STATUS_QUERY" | "OTHER";
    replyText?: string;
  }): Promise<void> {
    this.completed.push(input);
    this.current = { ...this.current, pendingMessages: [] };
  }
  async recordSentQuestion(input: {
    question: string;
    delivered: boolean;
    error?: string;
  }): Promise<void> {
    this.questions.push(input);
    this.current = { ...this.current, lastQuestion: input.question, lastQuestionDelivery: input.delivered ? "SENT" : "FAILED" };
  }
  listAssignments(): Assignment[] {
    return this.assignments;
  }
  listPendingConversationKeys(): string[] {
    return this.current.pendingMessages.length ? [this.current.conversationKey] : [];
  }
  listConversationKeys(): string[] { return [this.current.conversationKey]; }
  listPendingNotifications(): PendingNotification[] {
    return [];
  }
  subscribeNotifications(): () => void {
    return () => undefined;
  }
  async ackNotification(): Promise<void> {}
}

async function state(): Promise<AgentStateStore> {
  const directory = await mkdtemp(join(tmpdir(), "flare-orchestrator-"));
  return AgentStateStore.open(join(directory, "state.json"));
}

const reportResult: ExtractionResult = {
  intent: "REPORT",
  patch: { fireOrSmoke: true },
  summary: "Caller reports smoke.",
  evidence: [{ field: "fireOrSmoke", messageId: "m-1", quote: "smoke" }],
  corrections: [],
  unresolvedFields: [],
  proposedQuestion: "Which building and entrance?",
  questionField: "locationText",
};

test("applies a report, calculates recommendations, and records its delivered question", async () => {
  const data = new FakeData();
  data.current = context({
    // These are deliberately stale resolved-case values and must not enter a new turn.
    recentMessages: [{ id: "old", text: "old case", receivedAt: message.receivedAt }],
    lastQuestion: "Old question?",
    lastQuestionDelivery: "SENT",
  });
  let receivedTurn: InboundTurn | undefined;
  const sent: string[] = [];
  const orchestrator = new AgentOrchestrator({
    data,
    state: await state(),
    sendRoute: async () => undefined,
    extractTurn: async (turn) => {
      receivedTurn = turn;
      return { ok: true, result: reportResult };
    },
    recommendServices: () => ({
      services: ["FIRE"],
      ruleIds: ["DEMO_FIRE"],
      reason: "Smoke",
    }),
  });

  await orchestrator.handleInbound(
    {
      providerMessageId: "m-1",
      conversationKey: "imessage:chat-1",
      platform: "imessage",
      senderId: "caller",
      text: message.text,
      receivedAt: message.receivedAt,
      route: { platform: "imessage", spaceId: "chat-1", phone: "+15555550000" },
    },
    { send: async (text) => void sent.push(text) },
  );

  assert.deepEqual(receivedTurn?.recentMessages, []);
  assert.equal(receivedTurn?.lastQuestion, null);
  assert.equal(data.applied.length, 1);
  assert.deepEqual(data.applied[0]?.recommendation.services, ["FIRE"]);
  assert.deepEqual(sent, ["[SIMULATION] Which building and entrance?"]);
  assert.deepEqual(data.questions, [
    {
      conversationKey: "imessage:chat-1",
      question: "[SIMULATION] Which building and entrance?",
      delivered: true,
    },
  ]);
});

test("answers an obvious status query from committed state without calling Gemini", async () => {
  const data = new FakeData();
  data.current = context({
    activeIncident: incident({ status: "DISPATCHED" }),
    intakeRevision: 1,
    pendingMessages: [{ ...message, text: "Any update?" }],
  });
  data.assignments = [
    {
      id: "9",
      incidentId: "1",
      unitId: "FIRE-01",
      service: "FIRE",
      status: "EN_ROUTE",
      createdAt: message.receivedAt,
      updatedAt: message.receivedAt,
    },
  ];
  const orchestrator = new AgentOrchestrator({
    data,
    state: await state(),
    sendRoute: async () => undefined,
    extractTurn: async () => {
      throw new Error("Gemini must not be called for the obvious status shortcut");
    },
    recommendServices: () => ({ services: [], ruleIds: [], reason: "" }),
  });

  await orchestrator.handleInbound(
    {
      providerMessageId: "m-1",
      conversationKey: "imessage:chat-1",
      platform: "imessage",
      senderId: "caller",
      text: "Any update?",
      receivedAt: message.receivedAt,
      route: { platform: "imessage", spaceId: "chat-1" },
    },
    { send: async () => undefined },
  );

  assert.equal(data.completed[0]?.intent, "STATUS_QUERY");
  assert.match(data.completed[0]?.replyText ?? "", /FIRE-01 EN_ROUTE/);
});

test("records typed extraction failure while leaving input pending", async () => {
  const data = new FakeData();
  const failure: ExtractionOutcome = {
    ok: false,
    error: { code: "TIMEOUT", message: "deadline", retryable: true },
  };
  const orchestrator = new AgentOrchestrator({
    data,
    state: await state(),
    sendRoute: async () => undefined,
    extractTurn: async () => failure,
    recommendServices: () => ({ services: [], ruleIds: [], reason: "" }),
  });

  await orchestrator.drainPendingIntake();

  assert.deepEqual(data.failures, [failure.error]);
  assert.equal(data.current.pendingMessages.length, 1);
  assert.equal(data.applied.length, 0);
});

test("reloads context and re-extracts after a stale revision", async () => {
  const data = new FakeData();
  let applyAttempts = 0;
  let extractionAttempts = 0;
  data.applyIntakePatch = async (input) => {
    applyAttempts += 1;
    if (applyAttempts === 1) {
      data.current = { ...data.current, intakeRevision: 1 };
      throw Object.assign(new Error("STALE_REVISION"), { code: "STALE_REVISION" });
    }
    data.applied.push(input);
    data.current = { ...data.current, pendingMessages: [] };
  };
  const orchestrator = new AgentOrchestrator({
    data,
    state: await state(),
    sendRoute: async () => undefined,
    extractTurn: async () => {
      extractionAttempts += 1;
      return { ok: true, result: { ...reportResult, proposedQuestion: null } };
    },
    recommendServices: () => ({ services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "Smoke" }),
  });

  await orchestrator.drainPendingIntake();

  assert.equal(extractionAttempts, 2);
  assert.equal(applyAttempts, 2);
  assert.equal(data.applied.length, 1);
});

test("completes OTHER without creating an incident", async () => {
  const data = new FakeData();
  const orchestrator = new AgentOrchestrator({
    data,
    state: await state(),
    sendRoute: async () => undefined,
    extractTurn: async () => ({
      ok: true,
      result: {
        ...reportResult,
        intent: "OTHER",
        patch: {},
        evidence: [],
        proposedQuestion: null,
      },
    }),
    recommendServices: () => {
      throw new Error("recommendations must not run for OTHER");
    },
  });

  await orchestrator.drainPendingIntake();

  assert.equal(data.applied.length, 0);
  assert.equal(data.completed[0]?.intent, "OTHER");
  assert.match(data.completed[0]?.replyText ?? "", /SIMULATION/);
});

test("records clarification delivery failure without undoing the applied patch", async () => {
  const data = new FakeData();
  const orchestrator = new AgentOrchestrator({
    data,
    state: await state(),
    sendRoute: async () => undefined,
    extractTurn: async () => ({ ok: true, result: reportResult }),
    recommendServices: () => ({ services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "Smoke" }),
    logger: { info: () => undefined, error: () => undefined },
  });

  await orchestrator.handleInbound(
    {
      providerMessageId: "m-1",
      conversationKey: "imessage:chat-1",
      platform: "imessage",
      senderId: "caller",
      text: message.text,
      receivedAt: message.receivedAt,
      route: { platform: "imessage", spaceId: "chat-1" },
    },
    {
      send: async () => {
        throw new Error("provider secret=do-not-store-this-value");
      },
    },
  );

  assert.equal(data.applied.length, 1);
  assert.equal(data.questions[0]?.delivered, false);
  assert.doesNotMatch(data.questions[0]?.error ?? "", /do-not-store/);
});

test("treats an already-applied duplicate as a no-op", async () => {
  const data = new FakeData();
  data.current = context({ pendingMessages: [] });
  let extractionCalls = 0;
  const orchestrator = new AgentOrchestrator({
    data,
    state: await state(),
    sendRoute: async () => undefined,
    extractTurn: async () => {
      extractionCalls += 1;
      return { ok: true, result: reportResult };
    },
    recommendServices: () => ({ services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "Smoke" }),
  });

  await orchestrator.handleInbound(
    {
      providerMessageId: "m-1",
      conversationKey: "imessage:chat-1",
      platform: "imessage",
      senderId: "caller",
      text: message.text,
      receivedAt: message.receivedAt,
      route: { platform: "imessage", spaceId: "chat-1" },
    },
    { send: async () => undefined },
  );

  assert.equal(extractionCalls, 0);
  assert.equal(data.applied.length, 0);
});

test("pins persist through the location reducer without extraction or a caller-text patch", async () => {
  const data = new FakeData();
  const store = await state();
  const orchestrator = new AgentOrchestrator({ data, state: store, sendRoute: async () => {},
    extractTurn: async () => { throw new Error("must not extract a pin"); },
    recommendServices: () => { throw new Error("must not recommend from a pin"); } });
  await orchestrator.handleLocation({ providerMessageId: "pin", conversationKey: "imessage:chat-1", platform: "imessage",
    senderId: "caller", receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1", phone: "shared" },
    latitude: 0, longitude: 0, source: "IMESSAGE_PIN" });
  assert.equal(data.locations.length, 1);
  assert.equal(data.locations[0]!.route.line, "shared");
  assert.equal(data.applied.length, 0);
  assert.equal(store.routeFor("imessage:chat-1")?.phone, "shared");
});

test("shared-location transcript markers stay outside model context and suppress redundant location questions", async () => {
  const data = new FakeData();
  data.current = context({ activeIncident: incident({ sharedLocation: { latitude: 0, longitude: 0, accuracyMeters: null,
    label: null, source: "IMESSAGE_PIN", sharedAt: message.receivedAt } }),
    recentMessages: [{ ...message, id: "pin", text: "[Shared location: private address]" }, message] });
  let turn: InboundTurn | undefined;
  const sent: string[] = [];
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async () => {},
    extractTurn: async input => { turn = input; return { ok: true, result: { ...reportResult, proposedQuestion: "What is the address or location where this is happening?" } }; },
    recommendServices: () => ({ services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "Smoke" }) });
  const inbound = { providerMessageId: "m-1", conversationKey: "imessage:chat-1", platform: "imessage", senderId: "caller",
    text: message.text, receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1" } };
  await orchestrator.handleInbound(inbound, { send: async text => { sent.push(text); } });
  assert.deepEqual(turn?.recentMessages, [message]);
  assert.equal(turn?.hasSharedLocation, true);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0]!, /address|location|building|entrance/i);
});

test("an existing Find My share is committed before asking the first report's location question", async () => {
  const data = new FakeData();
  const sent: string[] = [];
  data.recordSharedLocation = async input => {
    data.locations.push(input);
    data.current = { ...data.current, activeIncident: incident({ sharedLocation: { latitude: input.latitude, longitude: input.longitude,
      accuracyMeters: null, label: input.label ?? null, source: input.source, sharedAt: input.receivedAt } }) };
  };
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async () => {},
    lookupSharedLocation: async (message, epoch) => {
      assert.equal(epoch, 1);
      assert.equal(data.applied.length, 1);
      const { text: _text, ...envelope } = message;
      return { ...envelope, latitude: 0, longitude: 0, source: "FIND_MY", label: "Cached Find My location" };
    },
    extractTurn: async () => ({ ok: true, result: { ...reportResult, proposedQuestion: "What is the address or location where this is happening?" } }),
    recommendServices: () => ({ services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "Smoke" }) });
  await orchestrator.handleInbound({ providerMessageId: "m-1", conversationKey: "imessage:chat-1", platform: "imessage", senderId: "caller",
    text: message.text, receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1" } }, { send: async text => { sent.push(text); } });
  assert.equal(data.locations[0]!.messageId, "findmy-context-m-1");
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0]!, /address|location|building|entrance/i);
});

test("attachment fallback and explicit location request use durable informational replies without Gemini", async () => {
  const data = new FakeData();
  let requests = 0;
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async () => {},
    requestLocation: async () => { requests++; return "[SIMULATION] Sharing request submitted."; },
    extractTurn: async () => { throw new Error("must not extract transport events"); },
    recommendServices: () => { throw new Error("must not recommend transport events"); } });
  const inbound = { providerMessageId: "m-1", conversationKey: "imessage:chat-1", platform: "imessage", senderId: "caller",
    text: "share location", receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1" } };
  const reply = { send: async () => { throw new Error("reply must be delivered by notification worker"); } };
  await orchestrator.handleInbound(inbound, reply);
  await orchestrator.handleInbound(inbound, reply);
  assert.equal(requests, 1);
  await orchestrator.handleUnsupported({ ...inbound, text: "[Unsupported attachment message]" }, reply);
  assert.match(data.completed.at(-1)!.replyText!, /couldn't read that attachment/);
});

test("human takeover keeps extracting facts but pauses automated questions and OTHER replies", async () => {
  const data = new FakeData();
  data.current = context({ activeIncident: incident(), dispatcherIdentity: "dispatcher-1" });
  const sent: string[] = [];
  let extractionCalls = 0;
  let result = reportResult;
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async () => {},
    extractTurn: async () => { extractionCalls++; return { ok: true, result }; },
    recommendServices: () => ({ services: ["FIRE"], ruleIds: ["DEMO_FIRE"], reason: "Smoke" }) });
  const inbound = { providerMessageId: "m-1", conversationKey: "imessage:chat-1", platform: "imessage", senderId: "caller",
    text: message.text, receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1" } };
  await orchestrator.handleInbound(inbound, { send: async text => { sent.push(text); } });
  assert.equal(extractionCalls, 1);
  assert.equal(data.applied.length, 1);
  assert.deepEqual(data.questions, []);
  result = { intent: "OTHER", patch: {}, summary: "", evidence: [], corrections: [], unresolvedFields: [], proposedQuestion: null };
  data.current = { ...data.current, pendingMessages: [{ ...message, id: "other", text: "Thanks" }] };
  await orchestrator.handleInbound({ ...inbound, providerMessageId: "other", text: "Thanks" }, { send: async text => { sent.push(text); } });
  assert.equal(extractionCalls, 2);
  assert.equal(data.completed[0]!.intent, "OTHER");
  assert.equal(data.completed[0]!.replyText, undefined);
  assert.deepEqual(sent, []);
});

test("Find My cards use the scoped location lookup or a specific fallback without extraction", async () => {
  const data = new FakeData();
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async () => {},
    lookupSharedLocation: async () => null,
    extractTurn: async () => { throw new Error("Find My card must not enter Gemini"); },
    recommendServices: () => { throw new Error("Find My card must not recommend services"); } });
  const inbound = { providerMessageId: "m-1", conversationKey: "imessage:chat-1", platform: "imessage", senderId: "caller",
    text: "[Find My location sharing card; coordinates pending]", receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1" } };
  await orchestrator.handleLocationShare(inbound, { send: async () => {} });
  assert.match(data.completed[0]!.replyText!, /Find My sharing card/);
  assert.match(data.completed[0]!.replyText!, /Apple Maps/);
  assert.equal(data.locations.length, 0);
});

test("a Find My card with coordinates records the original provider message directly", async () => {
  const data = new FakeData();
  const inbound = { providerMessageId: "findmy-card", conversationKey: "imessage:chat-1", platform: "imessage", senderId: "caller",
    text: "[Find My location sharing card; coordinates pending]", receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1" } };
  const { text: _text, ...envelope } = inbound;
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async () => {},
    lookupSharedLocation: async () => ({ ...envelope, latitude: 0, longitude: 0, source: "FIND_MY", label: "Cached Find My location" }),
    extractTurn: async () => { throw new Error("Find My card must not enter Gemini"); },
    recommendServices: () => { throw new Error("Find My card must not recommend services"); } });
  await orchestrator.handleLocationShare(inbound, { send: async () => { throw new Error("must not send fallback for a supported pin"); } });
  assert.equal(data.locations.length, 1);
  assert.equal(data.locations[0]!.messageId, "findmy-card");
  assert.equal(data.locations[0]!.source, "FIND_MY");
  assert.equal(data.completed.length, 0);
});


test("intake keeps asking until relevant facts are addressed, then stops even if Gemini suggests another question", async () => {
  const data = new FakeData();
  const facts = { ...emptyFacts(), incidentType: 'smoke', locationText: 'Demo library', fireOrSmoke: true, peopleInvolved: 1 };
  data.current = context({ currentFacts: facts, activeIncident: incident({ facts }) });
  data.applyIntakePatch = async input => {
    data.applied.push(input);
    const facts = mergeFacts(data.current.currentFacts, input.result.patch);
    data.current = { ...data.current, pendingMessages: [], currentFacts: facts, activeIncident: incident({ facts, unresolvedFields: [...(data.current.activeIncident?.unresolvedFields ?? []), ...input.result.unresolvedFields] }) };
  };
  let result: ExtractionResult = { ...reportResult, patch: {}, proposedQuestion: null };
  const sent: string[] = [];
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async (_route, text) => { sent.push(text); }, extractTurn: async () => ({ ok: true, result }), recommendServices: () => ({ services: ['FIRE'], ruleIds: [], reason: 'Smoke' }) });
  const inbound = { providerMessageId: 'm-1', conversationKey: 'imessage:chat-1', platform: 'imessage', senderId: 'caller', text: message.text, receivedAt: message.receivedAt, route: { platform: 'imessage', spaceId: 'chat-1' } };
  await orchestrator.handleInbound(inbound, { send: async text => { sent.push(text); } });
  assert.deepEqual(sent, ['[SIMULATION] Is anyone trapped?']);
  data.current.pendingMessages = [{ ...message, id: 'm-2', text: "I don't know if anyone is trapped." }];
  result = { ...result, unresolvedFields: ['trappedPerson'] };
  await orchestrator.handleInbound({ ...inbound, providerMessageId: 'm-2' }, { send: async text => { sent.push(text); } });
  assert.equal(sent.at(-1), '[SIMULATION] Is anyone injured?');
  data.current.pendingMessages = [{ ...message, id: 'm-3', text: 'Nobody is injured.' }];
  result = { ...result, patch: { injuryReported: false }, unresolvedFields: [], proposedQuestion: 'Is anyone trapped?', questionField: 'trappedPerson' };
  await orchestrator.handleInbound({ ...inbound, providerMessageId: 'm-3' }, { send: async text => { sent.push(text); } });
  assert.equal(sent.length, 2);
  assert.equal(data.current.currentFacts.injuryReported, false);
});

test("Spanish caller input stays original for evidence and the question is sent in Spanish", async () => {
  const data = new FakeData();
  data.current = context({ currentFacts: { ...emptyFacts(), incidentType: 'smoke', locationText: 'Biblioteca', fireOrSmoke: true, trappedPerson: false, peopleInvolved: 1 }, pendingMessages: [{ ...message, text: 'Hay humo en la biblioteca.' }] });
  let input: InboundTurn | undefined;
  const sent: string[] = [];
  const orchestrator = new AgentOrchestrator({ data, state: await state(), sendRoute: async () => {},
    translateText: async request => ({ sourceLanguage: request.targetLanguage === 'en' ? 'es' : 'en', targetLanguage: request.targetLanguage, text: request.targetLanguage === 'en' ? 'There is smoke in the library.' : '[SIMULATION] ¿Hay alguien herido?' }),
    extractTurn: async turn => { input = turn; return { ok: true, result: { ...reportResult, patch: {}, proposedQuestion: 'Is anyone injured?', questionField: 'injuryReported' } }; }, recommendServices: () => ({ services: ['FIRE'], ruleIds: [], reason: 'Smoke' }) });
  await orchestrator.handleInbound({ providerMessageId: 'm-1', conversationKey: 'imessage:chat-1', platform: 'imessage', senderId: 'caller', text: 'Hay humo en la biblioteca.', receivedAt: message.receivedAt, route: { platform: 'imessage', spaceId: 'chat-1' } }, { send: async text => { sent.push(text); } });
  assert.equal(input?.messages[0]?.text, 'Hay humo en la biblioteca.');
  assert.equal(data.translations.get('m-1')?.translatedText, 'There is smoke in the library.');
  assert.deepEqual(sent, ['[SIMULATION] ¿Hay alguien herido?']);
  assert.equal(data.questions[0]?.question, '[SIMULATION] Is anyone injured?');
  assert.equal(data.questions[0]?.language, 'es');
});

const inbound = { providerMessageId: "m-1", conversationKey: "imessage:chat-1", platform: "imessage", senderId: "caller",
  text: message.text, receivedAt: message.receivedAt, route: { platform: "imessage", spaceId: "chat-1" } };
const recommendation = () => ({ services: ["FIRE"] as Array<"FIRE">, ruleIds: ["DEMO_FIRE"], reason: "Smoke" });
const quiet = { info: () => {}, error: () => {} };

test("a stalled Find My lookup cannot block the clarification or a later pin", async () => {
  const data = new FakeData();
  const sent: string[] = [];
  const orchestrator = new AgentOrchestrator({ data, state: await state(), logger: quiet,
    sendRoute: async (_route, text) => { sent.push(text); },
    locationTimeoutMs: 5, lookupSharedLocation: () => new Promise(() => {}),
    extractTurn: async () => ({ ok: true, result: reportResult }), recommendServices: recommendation });
  await orchestrator.handleInbound(inbound, { send: async text => { sent.push(text); } });
  await orchestrator.handleLocation({ ...inbound, providerMessageId: "later-pin", latitude: 0, longitude: 0, source: "IMESSAGE_PIN" });
  assert.equal(data.applied.length, 1);
  assert.equal(sent[0], "[SIMULATION] Which building and entrance?");
  assert.equal(data.locations[0]?.messageId, "later-pin");
});

test("a stalled Find My card gets a fallback and leaves subsequent text processable", async () => {
  const data = new FakeData();
  const orchestrator = new AgentOrchestrator({ data, state: await state(), logger: quiet, sendRoute: async () => {},
    locationTimeoutMs: 5, lookupSharedLocation: () => new Promise(() => {}),
    extractTurn: async () => ({ ok: true, result: reportResult }), recommendServices: recommendation });
  await orchestrator.handleLocationShare(inbound, { send: async () => {} });
  assert.match(data.completed[0]?.replyText ?? "", /Find My sharing card/);
  data.current.pendingMessages = [{ ...message, id: "later" }];
  await orchestrator.handleInbound({ ...inbound, providerMessageId: "later" }, { send: async () => {} });
  assert.equal(data.applied.length, 1);
});

test("translation recovers during the same run with original evidence and a Spanish reply", async () => {
  const data = new FakeData();
  data.current.pendingMessages = [{ ...message, text: "Hay humo." }];
  let now = 0;
  let translations = 0;
  let extractedText: string | undefined;
  const sent: string[] = [];
  const orchestrator = new AgentOrchestrator({ data, state: await state(), logger: quiet,
    now: () => now, retryBaseMs: 10, sendRoute: async (_route, text) => { sent.push(text); },
    translateText: async request => {
      if (++translations === 1) throw new Error("Temporary translation failure");
      return { text: request.targetLanguage === "en" ? "There is smoke." : "[SIMULATION] ¿Dónde está ocurriendo?", sourceLanguage: request.targetLanguage === "en" ? "es" : "en", targetLanguage: request.targetLanguage };
    },
    extractTurn: async turn => { extractedText = turn.messages[0]?.text; return { ok: true, result: reportResult }; },
    recommendServices: recommendation });
  await orchestrator.handleInbound({ ...inbound, text: "Hay humo." }, { send: async () => { throw new Error("The retry uses the saved route"); } });
  assert.equal(data.current.pendingMessages.length, 1);
  assert.equal(data.applied.length, 0);
  await orchestrator.drainPendingIntake();
  assert.equal(translations, 1);
  now = 10;
  await orchestrator.drainPendingIntake();
  assert.equal(extractedText, "Hay humo.");
  assert.equal(data.translations.get("m-1")?.translatedText, "There is smoke.");
  assert.deepEqual(sent, ["[SIMULATION] ¿Dónde está ocurriendo?"]);
  await orchestrator.drainPendingIntake();
  assert.equal(sent.length, 1);
});

test("provider failures back off, stop at five attempts, and reset for new input", async () => {
  const data = new FakeData();
  let now = 0;
  let calls = 0;
  const orchestrator = new AgentOrchestrator({ data, state: await state(), logger: quiet,
    now: () => now, retryBaseMs: 10, sendRoute: async () => {},
    extractTurn: async () => { calls++; return { ok: false, error: { code: "RATE_LIMIT", message: "Quota temporarily exceeded", retryable: true } }; },
    recommendServices: recommendation });
  await orchestrator.drainPendingIntake();
  await orchestrator.drainPendingIntake();
  assert.equal(calls, 1);
  for (const elapsed of [10, 20, 40, 80]) { now += elapsed; await orchestrator.drainPendingIntake(); }
  assert.equal(calls, 5);
  now += 1_000_000;
  await orchestrator.drainPendingIntake();
  assert.equal(calls, 5);
  assert.equal(data.current.pendingMessages.length, 1);
  data.current.pendingMessages.push({ ...message, id: "new-input" });
  await orchestrator.drainPendingIntake();
  assert.equal(calls, 6);
});

test("recovery sends an interrupted or failed clarification once without extracting again", async () => {
  for (const delivery of [null, "FAILED"] as const) {
    const data = new FakeData();
    data.current = context({ activeIncident: incident(), pendingMessages: [], lastQuestionDelivery: delivery });
    const sent: string[] = [];
    const orchestrator = new AgentOrchestrator({ data, state: await state(), logger: quiet,
      sendRoute: async (_route, text) => { sent.push(text); },
      extractTurn: async () => { throw new Error("Already applied input must not be re-extracted"); }, recommendServices: recommendation });
    await orchestrator.drainPendingIntake();
    await orchestrator.drainPendingIntake();
    assert.deepEqual(sent, ["[SIMULATION] What is the address or location where this is happening?"]);
    assert.equal(data.current.lastQuestionDelivery, "SENT");
  }
});

test("a failed clarification retries without reapplying facts and respects takeover", async () => {
  const data = new FakeData();
  data.current.activeIncident = incident();
  let now = 0;
  const sent: string[] = [];
  const orchestrator = new AgentOrchestrator({ data, state: await state(), logger: quiet,
    now: () => now, retryBaseMs: 10, sendRoute: async (_route, text) => { sent.push(text); },
    extractTurn: async () => ({ ok: true, result: reportResult }), recommendServices: recommendation });
  await orchestrator.handleInbound(inbound, { send: async () => { throw new Error("Temporary send failure"); } });
  await orchestrator.drainPendingIntake();
  assert.equal(sent.length, 0);
  data.current.dispatcherIdentity = "human";
  now = 10;
  await orchestrator.drainPendingIntake();
  assert.equal(sent.length, 0);
  data.current.dispatcherIdentity = undefined;
  await orchestrator.drainPendingIntake();
  await orchestrator.drainPendingIntake();
  assert.equal(data.applied.length, 1);
  assert.equal(sent.length, 1);
});

test("recovery leaves delivered, completed, and human-controlled cases alone", async () => {
  const complete = { ...emptyFacts(), incidentType: "smoke", fireOrSmoke: true, locationText: "Demo library", peopleInvolved: 1, injuryReported: false, trappedPerson: false };
  for (const overrides of [
    { lastQuestionDelivery: "SENT" as const },
    { dispatcherIdentity: "human" },
    { activeIncident: incident({ status: "RESOLVED" }) },
    { activeIncident: incident({ status: "CLOSED" }) },
    { currentFacts: complete, activeIncident: incident({ facts: complete }) },
  ]) {
    const data = new FakeData();
    data.current = context({ activeIncident: incident(), pendingMessages: [], ...overrides });
    const orchestrator = new AgentOrchestrator({ data, state: await state(), logger: quiet,
      sendRoute: async () => { throw new Error("No reply expected"); },
      extractTurn: async () => { throw new Error("No extraction expected"); }, recommendServices: recommendation });
    await orchestrator.drainPendingIntake();
    assert.equal(data.questions.length, 0);
    assert.equal(data.failures.length, 0);
  }
});
