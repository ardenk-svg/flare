import assert from "node:assert/strict";
import test from "node:test";

import { ConversationQueue } from "../src/conversation-queue.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("serializes one conversation without blocking another", async () => {
  const queue = new ConversationQueue();
  const releaseFirst = deferred();
  const firstStarted = deferred();
  const order: string[] = [];

  const first = queue.run("conversation-a", async () => {
    order.push("a1:start");
    firstStarted.resolve();
    await releaseFirst.promise;
    order.push("a1:end");
  });

  await firstStarted.promise;

  const second = queue.run("conversation-a", async () => {
    order.push("a2");
  });
  const other = queue.run("conversation-b", async () => {
    order.push("b1");
  });

  await other;
  assert.deepEqual(order, ["a1:start", "b1"]);

  releaseFirst.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["a1:start", "b1", "a1:end", "a2"]);
});

test("continues a conversation after a failed task", async () => {
  const queue = new ConversationQueue();

  await assert.rejects(
    queue.run("conversation-a", async () => {
      throw new Error("expected failure");
    }),
  );

  const value = await queue.run("conversation-a", async () => "recovered");
  assert.equal(value, "recovered");
});
