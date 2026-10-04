import { normalizeInboundMessage, type SpectrumMessageEnvelope, type SpectrumSpaceEnvelope } from "./normalize.js";
import type { NormalizedInboundMessage, NormalizedSharedLocation } from "./types.js";

type Point = Pick<NormalizedSharedLocation, "latitude" | "longitude" | "label">;
const MAX_CARD_BYTES = 256 * 1024;

export function coordinates(latitude: number, longitude: number): Point | null {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
}

function pair(value: string): Point | null {
  const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,;]\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(value);
  return match ? coordinates(Number(match[1]), Number(match[2])) : null;
}

/** Parse explicit coordinates only. No geocoding, URL fetching, or location inference. */
export function locationFromUrl(value: string): Point | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol === "geo:") return pair(url.pathname.split("?")[0]!);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!["maps.apple.com", "maps.google.com", "www.google.com", "google.com"].includes(url.hostname)) return null;
  if (url.hostname.endsWith("google.com") && !url.hostname.startsWith("maps.") && !url.pathname.startsWith("/maps")) return null;
  // 'll' identifies the shared point; 'sll' is only a search bias and must never be used.
  for (const key of ["ll", "coordinate", "q", "query"]) {
    const point = pair(url.searchParams.get(key) ?? "");
    if (point) return { ...point, label: "Shared iMessage location" };
  }
  return null;
}

export function locationFromVCard(value: string): Point | null {
  if (Buffer.byteLength(value) > MAX_CARD_BYTES || !/^BEGIN:VCARD\s*$/im.test(value)) return null;
  const lines = value.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  for (const line of lines) {
    const match = /^(?:item\d+\.)?(GEO|URL)(?:;[^:]*)?:(.*)$/i.exec(line);
    if (!match) continue;
    const point = match[1]!.toUpperCase() === "GEO"
      ? (locationFromUrl(match[2]!) ?? pair(match[2]!)) : locationFromUrl(match[2]!.replace(/\\,/g, ","));
    if (point) return { ...point, label: "Shared iMessage location" };
  }
  return null;
}

async function pointFromContent(message: SpectrumMessageEnvelope): Promise<Point | null> {
  const content = message.content;
  if (content.type === "contact") {
    if (typeof content.raw === "string") {
      const point = locationFromVCard(content.raw);
      if (point) return point;
    }
    if (Array.isArray(content.urls)) {
      for (const url of content.urls) {
        if (typeof url === "string") {
          const point = locationFromUrl(url);
          if (point) return point;
        }
      }
    }
  }
  if (content.type === "attachment" && typeof content.read === "function") {
    const name = typeof content.name === "string" ? content.name.toLowerCase() : "";
    const mime = typeof content.mimeType === "string" ? content.mimeType.split(";")[0]!.toLowerCase() : "";
    if (name.endsWith(".vcf") || ["text/vcard", "text/x-vcard", "text/directory", "application/vcard"].includes(mime)) {
      if (typeof content.size === "number" && content.size > MAX_CARD_BYTES) return null;
      const bytes: unknown = await content.read();
      if (bytes instanceof Uint8Array && bytes.byteLength <= MAX_CARD_BYTES) return locationFromVCard(Buffer.from(bytes).toString("utf8"));
    }
  }
  if (content.type === "richlink" && typeof content.url === "string") return locationFromUrl(content.url);
  if (content.type === "app" && typeof content.url === "function") {
    const url: unknown = await content.url();
    if (typeof url === "string") return locationFromUrl(url);
  }
  if (message.miniApp?.url) {
    const point = locationFromUrl(message.miniApp.url);
    if (point) return point;
  }
  if (content.type === "text" && typeof content.text === "string") return locationFromUrl(content.text.trim());
  return null;
}

export type InboundEvent =
  | { kind: "text"; message: NormalizedInboundMessage }
  | { kind: "location"; message: NormalizedSharedLocation }
  | { kind: "location-share"; message: NormalizedInboundMessage }
  | { kind: "unsupported"; message: NormalizedInboundMessage };

/** Control events and outbound echoes never generate replies. */
export async function normalizeInboundEvent(space: SpectrumSpaceEnvelope, source: SpectrumMessageEnvelope): Promise<InboundEvent | null> {
  if (source.direction !== "inbound") return null;
  if (source.content.type === "reply" && source.content.content && typeof source.content.content === "object" && "type" in source.content.content) {
    return normalizeInboundEvent(space, { ...source, content: source.content.content as SpectrumMessageEnvelope["content"] });
  }
  if (["typing", "read", "reaction", "edit", "unsend", "rename", "avatar", "addMember", "removeMember", "leaveSpace"].includes(source.content.type)) return null;
  // Reuse the envelope checks and routing of ordinary text intake.
  const base = normalizeInboundMessage(space, { ...source, content: { type: "text", text: "[Unsupported message]" } })!;
  if (source.platform === "imessage") {
    // A failed attachment read still gets a caller-visible fallback.
    let point: Point | null = null;
    try { point = await pointFromContent(source); } catch { /* unsupported below */ }
    if (point) {
      const { text: _text, ...envelope } = base;
      return { kind: "location", message: { ...envelope, ...point, source: "IMESSAGE_PIN" } };
    }
    if (source.balloonBundleId?.includes("com.apple.findmy.FindMyMessagesApp")) {
      return { kind: "location-share", message: { ...base, text: "[Find My location sharing card; coordinates pending]" } };
    }
  }
  if (source.platform === "imessage" && source.content.type === "text" && typeof source.content.text === "string") {
    try {
      const url = new URL(source.content.text.trim());
      if (url.protocol === "geo:" || ["maps.apple.com", "maps.google.com"].includes(url.hostname)) {
        return { kind: "unsupported", message: { ...base, text: "[Unreadable shared location]" } };
      }
    } catch { /* ordinary caller text below */ }
  }
  const text = normalizeInboundMessage(space, source);
  if (text) return { kind: "text", message: text };
  if (source.content.type === "text") return null;
  return { kind: "unsupported", message: { ...base, text: `[Unsupported ${source.content.type} message]` } };
}
