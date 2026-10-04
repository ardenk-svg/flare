import assert from "node:assert/strict";
import test from "node:test";
import { FindMyBridge, photonLocationApi, type FriendLocation, type LocationApi } from "../src/find-my.js";
import type { NormalizedInboundMessage, NormalizedSharedLocation } from "../src/types.js";

const phone = "+15555550100";
const message: NormalizedInboundMessage = { providerMessageId: "request-1", conversationKey: "imessage:chat", platform: "imessage", senderId: phone,
  text: "share location", receivedAt: new Date().toISOString(), route: { platform: "imessage", spaceId: "chat", phone: "shared" } };
const envelope = { id: message.providerMessageId, platform: "imessage", direction: "inbound" as const, timestamp: new Date(), sender: { id: phone }, content: { type: "text", text: "share location" } };
const logger = { info: () => {}, error: () => {} };
const tick = () => new Promise(resolve => setImmediate(resolve));

function api(snapshot: FriendLocation) {
  let end: (() => void) | undefined;
  let emit: ((location: FriendLocation) => void) | undefined;
  const requests: unknown[] = [];
  const watched: Array<string | undefined> = [];
  const locationApi: LocationApi = {
    get: async () => snapshot, list: async () => [snapshot], request: async (...args) => { requests.push(args); return { status: "submitted" }; },
    watch: address => {
      watched.push(address);
      return { close: async () => end?.(), async *[Symbol.asyncIterator]() {
        while (true) {
          const next = await new Promise<FriendLocation | null>(resolve => { emit = value => resolve(value); end = () => resolve(null); });
          if (!next) return;
          yield { location: next, sourceSequence: 1 };
        }
      } };
    },
  };
  return { locationApi, requests, watched, emit: (location: FriendLocation) => emit?.(location) };
}

test("Find My consumes only the demo address, rejects incomplete coordinates and stops at a case boundary", async () => {
  const mock = api({ address: phone, latitude: 0, longitude: 0, accuracy: 0 });
  const pins: NormalizedSharedLocation[] = [];
  let epoch: number | undefined = 1;
  const bridge = new FindMyBridge(mock.locationApi, async pin => { pins.push(pin); }, () => epoch, logger, phone);
  bridge.observe({ id: "chat", type: "dm", phone: "shared" }, envelope);
  await tick();
  assert.deepEqual(mock.watched, [phone]);
  assert.equal(pins.length, 1);
  assert.equal(pins[0]!.accuracyMeters, 0);
  mock.emit({ address: "+15555550200", latitude: 40, longitude: -80 }); await tick();
  mock.emit({ address: phone, latitude: 40 }); await tick();
  mock.emit({ address: phone, latitude: 91, longitude: -80 }); await tick();
  assert.equal(pins.length, 1);
  epoch = undefined;
  mock.emit({ address: phone, latitude: 41, longitude: -81 }); await tick();
  epoch = 2;
  mock.emit({ address: phone, latitude: 42, longitude: -82 }); await tick();
  assert.equal(pins.length, 1);
  await bridge.request(message);
  mock.emit({ address: phone, latitude: 42, longitude: -82 }); await tick();
  assert.equal(pins.length, 2);
  assert.equal(pins[1]!.source, "FIND_MY");
  assert.match(pins[1]!.providerMessageId, /^findmy-/);
  await bridge.stop();
});

test("a first-message request works before an incident exists; groups and other phones cannot bind", async () => {
  const mock = api({ address: phone });
  const bridge = new FindMyBridge(mock.locationApi, async () => {}, () => undefined, logger, phone);
  bridge.observe({ id: "group", type: "group" }, envelope);
  bridge.observe({ id: "chat", type: "dm" }, { ...envelope, sender: { id: "+15555550200" } });
  await bridge.request(message);
  assert.equal(mock.requests.length, 0);
  bridge.observe({ id: "chat", type: "dm" }, envelope);
  assert.match(await bridge.request(message), /submitted/);
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.watched.length, 0);
  await bridge.stop();
});

test("the native API adapter verifies a single line and capability availability", () => {
  assert.throws(() => photonLocationApi({ __internal: { platforms: new Map() } }), /one iMessage line/);
  assert.throws(() => photonLocationApi({ __internal: { platforms: new Map([["imessage", { client: [{ client: {} }] }]]) } }), /location API/);
  const mock = api({ address: phone });
  assert.equal(photonLocationApi({ __internal: { platforms: new Map([["imessage", { client: [{ client: { locations: mock.locationApi } }] }]]) } }), mock.locationApi);
});

test("a sharing card gets only the caller's snapshot even when list fails, and labels cached coordinates", async () => {
  const captured = new Date("2026-10-04T12:00:00Z");
  const mock = api({ address: phone, latitude: 0, longitude: 0, locationType: "legacy", locationTimestamp: captured });
  const addresses: string[] = [];
  mock.locationApi.list = async () => { throw new Error("list unavailable"); };
  mock.locationApi.get = async address => {
    addresses.push(address);
    return { address, latitude: 0, longitude: 0, locationType: "legacy", locationTimestamp: captured };
  };
  const bridge = new FindMyBridge(mock.locationApi, async () => {}, () => undefined, logger, phone);
  bridge.observe({ id: "chat", type: "dm" }, envelope);
  const pin = await bridge.snapshot({ ...message, providerMessageId: "findmy-card" });
  assert.deepEqual(addresses, [phone]);
  assert.equal(pin?.providerMessageId, "findmy-card");
  assert.equal(pin?.source, "FIND_MY");
  assert.equal(pin?.label, "Cached Find My location");
  assert.equal(pin?.receivedAt, captured.toISOString());
  assert.equal(pin?.latitude, 0);
  assert.equal(await bridge.snapshot({ ...message, senderId: "+15555550200" }), null);
  assert.deepEqual(addresses, [phone]);
  assert.equal(await bridge.snapshot(message, 2), null);
  assert.deepEqual(addresses, [phone]);
  await bridge.stop();
});
