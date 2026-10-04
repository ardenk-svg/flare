import assert from "node:assert/strict";
import test from "node:test";
import { fromVCard } from "@spectrum-ts/core";
import { locationFromUrl, locationFromVCard, normalizeInboundEvent } from "../src/location.js";
import { runMessageLoop } from "../src/message-loop.js";
import type { SpectrumMessageEnvelope } from "../src/normalize.js";

const space = { id: "iMessage;-;+15555550100", phone: "shared", send: async () => undefined };
const envelope = (content: SpectrumMessageEnvelope["content"]): SpectrumMessageEnvelope => ({
  id: "pin-1", platform: "imessage", direction: "inbound", timestamp: new Date("2026-10-04T12:00:00Z"),
  sender: { id: "+15555550100" }, content,
});
const card = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Current Location\r\nURL:https://maps.apple.com/?ll=42.3314,-83.0458\r\nEND:VCARD\r\n";

test("the installed Spectrum vCard decoder preserves an Apple Maps pin", async () => {
  const event = await normalizeInboundEvent(space, envelope({ type: "contact", ...fromVCard(card) }));
  assert.equal(event?.kind, "location");
  if (event?.kind !== "location") return;
  assert.equal(event.message.latitude, 42.3314);
  assert.equal(event.message.longitude, -83.0458);
  assert.equal(event.message.route.phone, "shared");
  assert.equal(event.message.providerMessageId, "pin-1");
  assert.equal(event.message.source, "IMESSAGE_PIN");
  assert.ok(!("text" in event.message));
});

test("GEO vCards, folded URLs, attachments, rich links and mini apps carry explicit pins", async () => {
  assert.equal(locationFromVCard("BEGIN:VCARD\nGEO:42.3;-83.0\nEND:VCARD")?.longitude, -83);
  assert.equal(locationFromVCard("BEGIN:VCARD\nGEO:geo:42.3,-83.0\nEND:VCARD")?.latitude, 42.3);
  assert.equal(locationFromVCard(card.replace("-83.0458", "\r\n -83.0458"))?.longitude, -83.0458);
  for (const content of [
    { type: "attachment", name: "location.vcf", read: async () => Buffer.from(card) },
    { type: "richlink", url: "https://maps.apple.com/?ll=0,0" },
    { type: "app", url: async () => "https://maps.apple.com/?ll=0,0" },
    { type: "text", text: "https://maps.apple.com/?ll=0,0" },
  ]) assert.equal((await normalizeInboundEvent(space, envelope(content)))?.kind, "location");
  assert.equal((await normalizeInboundEvent(space, { ...envelope({ type: "unsupported-message" }), miniApp: { url: "https://maps.apple.com/?ll=0,0" } }))?.kind, "location");
});

test("search bias, non-Maps URLs, inferred addresses and invalid coordinates are rejected", () => {
  for (const url of ["https://maps.apple.com/?sll=42,-83&q=Building", "https://example.com/?ll=42,-83", "https://maps.apple.com/?ll=91,1", "https://maps.apple.com/?ll=1,181", "https://maps.apple.com/?ll=NaN,1", "https://maps.apple.com/?q=Demo+Street"])
    assert.equal(locationFromUrl(url), null);
});

test("a failed or oversized attachment becomes a transcript-safe fallback without downloading arbitrary files", async () => {
  let reads = 0;
  const event = await normalizeInboundEvent(space, envelope({ type: "attachment", name: "photo.jpg", read: async () => { reads++; throw new Error("private payload"); } }));
  assert.equal(event?.kind, "unsupported");
  assert.equal(reads, 0);
  assert.equal((await normalizeInboundEvent(space, envelope({ type: "attachment", name: "pin.vcf", size: 300_000, read: async () => { reads++; return Buffer.from(card); } })))?.kind, "unsupported");
  assert.equal(reads, 0);
  assert.equal((await normalizeInboundEvent(space, envelope({ type: "attachment", name: "pin.vcf", read: async () => { throw new Error("private payload"); } })))?.kind, "unsupported");
});

test("ordinary text stays intact; outbound echoes and control events are ignored", async () => {
  const text = envelope({ type: "text", text: "Smoke at the north entrance" });
  assert.equal((await normalizeInboundEvent(space, text))?.kind, "text");
  assert.equal(await normalizeInboundEvent(space, { ...text, direction: "outbound" }), null);
  assert.equal(await normalizeInboundEvent(space, envelope({ type: "reaction" })), null);
  assert.equal((await normalizeInboundEvent(space, envelope({ type: "text", text: "https://maps.apple.com/?ll=91,1" })))?.kind, "unsupported");
});

test("the real Photon Find My card shape is handled as a sharing card, not an unknown attachment", async () => {
  const event = await normalizeInboundEvent(space, { ...envelope({ type: "custom", raw: { imessage_type: "unsupported-message" } }),
    balloonBundleId: "com.apple.messages.MSMessageExtensionBalloonPlugin:0000000000:com.apple.findmy.FindMyMessagesApp" });
  assert.equal(event?.kind, "location-share");
  assert.match(event!.message.text!, /Find My location sharing card/);
});

test("reply-wrapped iMessage pins retain the message routing", async () => {
  const event = await normalizeInboundEvent(space, envelope({ type: "reply", content: { type: "richlink", url: "https://maps.apple.com/?ll=42.3,-83" } }));
  assert.equal(event?.kind, "location");
  assert.equal(event?.message.providerMessageId, "pin-1");
});

test("the message loop routes text, pins and unreadable attachments to different handlers in order", async () => {
  const order: string[] = [];
  const messages = [envelope({ type: "text", text: "smoke" }), envelope({ type: "contact", ...fromVCard(card) }), envelope({ type: "attachment", name: "photo.jpg" })];
  await runMessageLoop({ messages: (async function* () { for (const message of messages) yield [space, message] as const; })() },
    async () => { order.push("text"); }, { info: () => {}, error: () => {} }, {
      handleLocation: async () => { order.push("pin"); }, handleUnsupported: async () => { order.push("fallback"); },
    });
  assert.deepEqual(order, ["text", "pin", "fallback"]);
});

test("a stuck vCard download cannot prevent a later text and pin from reaching the handlers", async () => {
  const order: string[] = [];
  const messages = [
    envelope({ type: "attachment", name: "pin.vcf", read: () => new Promise(() => {}) }),
    envelope({ type: "text", text: "Simulation: smoke" }),
    envelope({ type: "contact", ...fromVCard(card) }),
  ];
  await runMessageLoop({ messages: (async function* () { for (const message of messages) yield [space, message] as const; })() },
    async () => { order.push("text"); }, { info: () => {}, error: () => {} }, {
      locationTimeoutMs: 5, handleUnsupported: async () => { order.push("fallback"); }, handleLocation: async () => { order.push("pin"); },
    });
  assert.deepEqual(order, ["fallback", "text", "pin"]);
});
