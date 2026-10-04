import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { PendingNotification } from "@flare/contracts";

import type { AgentDataPort } from "../src/data-port.js";
import { NotificationWorker } from "../src/notification-worker.js";
import { AgentStateStore } from "../src/state-store.js";

const job: PendingNotification = {
  id: "7",
  conversationKey: "imessage:chat-1",
  route: { platform: "imessage", spaceId: "chat-1", line: null },
  incidentId: "1",
  assignmentId: "2",
  kind: "ASSIGNMENT_EN_ROUTE",
  text: "[SIMULATION] FIRE-01 is en route.",
  eventAssignmentStatus: "EN_ROUTE",
  eventAt: "2026-10-03T12:00:00.000Z",
  attempts: 0,
  lastError: null,
};

function fakeData(
  notifications: PendingNotification[],
  acknowledgements: Array<{ notificationId: string; delivered: boolean; error?: string }>,
): AgentDataPort {
  return {
    recordInboundTranslation: async () => undefined,
    getInboundTranslation: () => null,
    prepareNotificationTranslation: async () => undefined,
    recordSharedLocation: async () => undefined,
    recordInbound: async () => {
      throw new Error("unused");
    },
    getConversationContext: () => null,
    recordExtractionFailure: async () => undefined,
    applyIntakePatch: async () => undefined,
    completeInboundWithoutPatch: async () => undefined,
    recordSentQuestion: async () => undefined,
    listAssignments: () => [],
    listPendingConversationKeys: () => [],
    listPendingNotifications: () => notifications,
    subscribeNotifications: () => () => undefined,
    ackNotification: async (input) => void acknowledgements.push(input),
  };
}

async function stateWithRoute(): Promise<AgentStateStore> {
  const directory = await mkdtemp(join(tmpdir(), "flare-notifications-"));
  const state = await AgentStateStore.open(join(directory, "state.json"));
  await state.rememberRoute(job.conversationKey, {
    platform: "imessage",
    spaceId: "chat-1",
    phone: "+15555550000",
  });
  return state;
}

test("drains a committed notification through a reconstructed route and acknowledges it", async () => {
  const acknowledgements: Array<{ notificationId: string; delivered: boolean; error?: string }> = [];
  const sent: string[] = [];
  const worker = new NotificationWorker({
    data: fakeData([job], acknowledgements),
    state: await stateWithRoute(),
    sendRoute: async (_route, text) => void sent.push(text),
    pollMs: 60_000,
    maxAttempts: 5,
  });

  await worker.start();
  await worker.drain();
  worker.stop();

  assert.deepEqual(sent, [job.text]);
  assert.deepEqual(acknowledgements, [{ notificationId: "7", delivered: true }]);
});

test("records a sanitized failed delivery and leaves it retryable", async () => {
  const acknowledgements: Array<{ notificationId: string; delivered: boolean; error?: string }> = [];
  const worker = new NotificationWorker({
    data: fakeData([job], acknowledgements),
    state: await stateWithRoute(),
    sendRoute: async () => {
      throw new Error("provider token=super-secret-value-that-must-not-leak");
    },
    pollMs: 60_000,
    maxAttempts: 5,
    logger: { info: () => undefined, error: () => undefined },
  });

  await worker.start();
  worker.stop();

  assert.equal(acknowledgements[0]?.delivered, false);
  assert.doesNotMatch(acknowledgements[0]?.error ?? "", /super-secret/);
});

test("does not exceed the configured delivery attempt limit", async () => {
  const acknowledgements: Array<{ notificationId: string; delivered: boolean; error?: string }> = [];
  let sends = 0;
  const worker = new NotificationWorker({
    data: fakeData([{ ...job, attempts: 5 }], acknowledgements),
    state: await stateWithRoute(),
    sendRoute: async () => {
      sends += 1;
    },
    pollMs: 60_000,
    maxAttempts: 5,
  });

  await worker.start();
  worker.stop();

  assert.equal(sends, 0);
  assert.deepEqual(acknowledgements, []);
});


test("localized notification payload is persisted and reused after a failed send and worker restart", async () => {
  const jobs = [{ ...job, callerLanguage: 'ja' }];
  const acknowledgements: Array<{ notificationId: string; delivered: boolean; error?: string }> = [];
  const data = fakeData(jobs, acknowledgements);
  data.prepareNotificationTranslation = async input => { Object.assign(jobs[0]!, { translatedText: input.translatedText, translationLanguage: input.language }); };
  let translations = 0;
  const state = await stateWithRoute();
  const translateText = async (request: { targetLanguage: string }) => { translations++; return { text: '[SIMULATION] FIRE-01 は移動中です。', sourceLanguage: 'en', targetLanguage: request.targetLanguage }; };
  const first = new NotificationWorker({ data, state, translateText, sendRoute: async () => { throw new Error('offline'); }, pollMs: 60000, maxAttempts: 5, logger: { info() {}, error() {} } });
  await first.start(); first.stop();
  const sent: string[] = [];
  const second = new NotificationWorker({ data, state, translateText, sendRoute: async (_route, text) => { sent.push(text); }, pollMs: 60000, maxAttempts: 5 });
  await second.start(); second.stop();
  assert.equal(translations, 1);
  assert.deepEqual(sent, ['[SIMULATION] FIRE-01 は移動中です。']);
  assert.deepEqual(acknowledgements.map(a => a.delivered), [false, true]);
});
