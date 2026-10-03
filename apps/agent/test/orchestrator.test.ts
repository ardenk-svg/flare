import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  emptyFacts,
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
    extractionError: null,
    createdAt: "2026-10-03T12:00:00.000Z",
    updatedAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

function context(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationKey: "imessage:chat-1",
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
  current = context();
  assignments: Assignment[] = [];
  failures: ExtractionFailure[] = [];
  applied: Array<{ result: ExtractionResult; recommendation: Recommendation }> = [];
  completed: Array<{ intent: "STATUS_QUERY" | "OTHER"; replyText?: string }> = [];
  questions: Array<{ question: string; delivered: boolean; error?: string }> = [];

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
  }
  listAssignments(): Assignment[] {
    return this.assignments;
  }
  listPendingConversationKeys(): string[] {
    return this.current.pendingMessages.length ? [this.current.conversationKey] : [];
  }
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
  unresolvedFields: ["locationText"],
  proposedQuestion: "Which building and entrance?",
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
  assert.deepEqual(sent, ["Which building and entrance?"]);
  assert.deepEqual(data.questions, [
    {
      conversationKey: "imessage:chat-1",
      question: "Which building and entrance?",
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
