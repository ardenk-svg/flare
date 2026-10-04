import { createHash } from "node:crypto";
import { coordinates } from "./location.js";
import { withDeadline } from "./deadline.js";
import type { SpectrumMessageEnvelope, SpectrumSpaceEnvelope } from "./normalize.js";
import type { NormalizedInboundMessage, NormalizedSharedLocation, SharedLocationHandler } from "./types.js";

export interface FriendLocation {
  address: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  locationTimestamp?: Date;
  shortAddress?: string;
  longAddress?: string;
  locationType?: string;
}

const locationLabel = (location: FriendLocation): string => {
  const address = location.shortAddress ?? location.longAddress;
  const cached = location.locationType === "legacy" || location.locationType === "shallow";
  return `${cached ? "Cached Find My location" : "Shared Find My location"}${address ? `: ${address}` : ""}`;
};
interface LocationStream extends AsyncIterable<{ location: FriendLocation; sourceSequence: number }> { close(): Promise<void> }
export interface LocationApi {
  get(address: string): Promise<FriendLocation>;
  list(): Promise<FriendLocation[]>;
  request(chat: string, address: string, options?: { clientMessageId?: string }): Promise<{ status: string }>;
  watch(address?: string): LocationStream;
}

/** Isolate the verified Spectrum 12.10.1 native-client escape hatch in one place. */
export function photonLocationApi(app: { __internal: { platforms: Map<string, { client: unknown }> } }): LocationApi {
  const entries = app.__internal.platforms.get("imessage")?.client;
  if (!Array.isArray(entries) || entries.length !== 1) throw new Error("Find My demo requires exactly one iMessage line.");
  const locations = entries[0]?.client?.locations;
  if (!locations || !["get", "list", "request", "watch"].every(k => typeof locations[k] === "function")) {
    throw new Error("Installed Photon client does not expose the location API.");
  }
  return locations as LocationApi;
}

/** One caller/one conversation only; never consume every friend's shared-account stream. */
export class FindMyBridge {
  #candidate?: { conversationKey: string; address: string };
  #binding?: { message: NormalizedInboundMessage; epoch: number };
  #stream?: LocationStream;
  #task?: Promise<void>;
  #reconnectTimer?: ReturnType<typeof setTimeout>;
  #stopped = false;
  constructor(readonly api: LocationApi, readonly sink: SharedLocationHandler,
    readonly caseEpoch: (key: string) => number | undefined, readonly logger: Pick<Console, "info" | "error"> = console,
    readonly demoPhone?: string, readonly timeoutMs = 5_000, readonly reconnectMs = 5_000) {}

  observe(space: SpectrumSpaceEnvelope, source: SpectrumMessageEnvelope): void {
    if (this.#stopped || source.direction !== "inbound" || source.platform !== "imessage" || space.type === "group") return;
    const address = source.sender?.id;
    if (!address || (this.demoPhone && address !== this.demoPhone) || !/^(?:\+\d{8,15}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(address)) return;
    const key = `imessage:${space.id}`;
    if (!this.#candidate) this.#candidate = { conversationKey: key, address };
    if (this.#candidate.conversationKey !== key || this.#candidate.address !== address) return;
    const epoch = this.caseEpoch(key);
    if (epoch === undefined) return;
    if (this.#binding) {
      // A new explicit share card resumes updates after Restart demo. Ordinary
      // messages must not opt a later case into the previous case's location.
      if (source.balloonBundleId?.includes("com.apple.findmy.FindMyMessagesApp")) this.#binding.epoch = epoch;
      return;
    }
    const message: NormalizedInboundMessage = { providerMessageId: source.id, conversationKey: key, platform: "imessage", senderId: address,
      text: "", receivedAt: source.timestamp.toISOString(), route: { platform: "imessage", spaceId: space.id, ...(space.phone ? { phone: space.phone } : {}) } };
    this.#binding = { message, epoch };
    this.logger.info("Find My is bound to the demo caller; location values and phone handles are not logged.");
    this.#task = this.#run();
  }

  async request(message: NormalizedInboundMessage): Promise<string> {
    if (!this.#candidate || this.#candidate.conversationKey !== message.conversationKey || this.#candidate.address !== message.senderId) {
      return "[SIMULATION] Find My is limited to the configured demo phone. Send a current-location pin or type your location.";
    }
    // A caller explicitly requested a share card. Rebind the epoch for a new case.
    if (this.#binding) this.#binding.epoch = this.caseEpoch(message.conversationKey) ?? this.#binding.epoch;
    try {
      await withDeadline(this.api.request(message.route.spaceId, message.senderId!, { clientMessageId: `flare-location-${message.providerMessageId}` }), this.timeoutMs, "Find My request");
      return "[SIMULATION] A Find My sharing request was submitted. Accept it if Messages offers it. Your location appears only after Photon supplies coordinates.";
    } catch {
      this.logger.error("Find My request unavailable on this Photon line.");
      return "[SIMULATION] Find My isn't available on this line. Use Send My Current Location or send an Apple Maps pin link.";
    }
  }

  async snapshot(message: NormalizedInboundMessage, caseEpoch?: number): Promise<NormalizedSharedLocation | null> {
    if (this.#candidate?.conversationKey !== message.conversationKey || this.#candidate.address !== message.senderId) return null;
    // Automatic lookup may recover an existing share in the first case. Later cases
    // need an explicit sharing request/card rather than inheriting the old share.
    if (caseEpoch !== undefined && caseEpoch > 1 && this.#binding?.epoch !== caseEpoch) return null;
    try {
      const location = await withDeadline(this.api.get(message.senderId!), this.timeoutMs, "Find My snapshot");
      if (location.address !== message.senderId || location.latitude === undefined || location.longitude === undefined) return null;
      const point = coordinates(location.latitude, location.longitude);
      if (!point || (location.accuracy !== undefined && (!Number.isFinite(location.accuracy) || location.accuracy < 0))) return null;
      const captured = location.locationTimestamp;
      if (captured && !Number.isFinite(captured.getTime())) return null;
      const { text: _text, ...envelope } = message;
      return { ...envelope, ...point, source: "FIND_MY", accuracyMeters: location.accuracy,
        label: locationLabel(location), receivedAt: captured?.toISOString() ?? message.receivedAt };
    } catch { this.logger.info("Photon did not supply a shared location snapshot."); return null; }
  }

  async #publish(location: FriendLocation): Promise<void> {
    const binding = this.#binding!;
    if (this.#stopped || location.address !== binding.message.senderId || this.caseEpoch(binding.message.conversationKey) !== binding.epoch) return;
    if (location.latitude === undefined || location.longitude === undefined) return;
    const point = coordinates(location.latitude, location.longitude);
    if (!point || (location.accuracy !== undefined && (!Number.isFinite(location.accuracy) || location.accuracy < 0))) return;
    const captured = location.locationTimestamp;
    if (captured && !Number.isFinite(captured.getTime())) return;
    const digest = createHash("sha256").update(JSON.stringify([binding.epoch, point, location.accuracy, captured?.toISOString()])).digest("hex").slice(0, 24);
    const update: NormalizedSharedLocation = { ...binding.message, ...point, source: "FIND_MY",
      providerMessageId: `findmy-${digest}`, receivedAt: captured?.toISOString() ?? new Date().toISOString(),
      accuracyMeters: location.accuracy, label: locationLabel(location) };
    await this.sink(update);
  }

  async #run(): Promise<void> {
    const address = this.#binding!.message.senderId!;
    // Reload a current snapshot on reconnect; live feed gaps cannot be replayed.
    try { await this.#publish(await withDeadline(this.api.get(address), this.timeoutMs, "Find My snapshot")); } catch { this.logger.info("No Find My snapshot available yet; continuing with the live feed."); }
    if (this.#stopped) return;
    try {
      this.#stream = this.api.watch(address);
      for await (const update of this.#stream) await this.#publish(update.location);
    } catch {
      if (!this.#stopped) this.logger.error("Find My stream unavailable; reconnect scheduled. Current-location pins still work.");
    } finally {
      if (this.#stream) await withDeadline(this.#stream.close(), this.timeoutMs, "Find My stream close").catch(() => undefined);
      this.#stream = undefined;
      if (!this.#stopped) {
        this.#reconnectTimer = setTimeout(() => { this.#task = this.#run(); }, this.reconnectMs);
        this.#reconnectTimer.unref();
      }
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#reconnectTimer);
    if (this.#stream) await withDeadline(this.#stream.close(), this.timeoutMs, "Find My stream close").catch(() => undefined);
    if (this.#task) await withDeadline(this.#task, this.timeoutMs, "Find My shutdown").catch(() => undefined);
  }
}
