// Read-only wire probe: shapes and availability only, never caller handles or coordinates.
import { Spectrum } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";
import { photonLocationApi } from "./find-my.js";
import { normalizeInboundEvent } from "./location.js";

const seconds = Number(process.argv.find(arg => arg.startsWith("--seconds="))?.split("=")[1] ?? 60);
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) throw new Error("Use --seconds=1..300.");
const projectId = process.env.SPECTRUM_PROJECT_ID?.trim();
const projectSecret = process.env.SPECTRUM_PROJECT_SECRET?.trim();
if (!projectId || !projectSecret) throw new Error("Set SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET.");
const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config({})], telemetry: false,
  options: { flattenGroups: true, logLevel: "error" } });
const stop = () => { void app.stop(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const timer = setTimeout(stop, seconds * 1000);
try {
  try {
    const locations = await photonLocationApi(app).list();
    console.info(JSON.stringify({ findMyApi: "available", snapshots: locations.length,
      withCoordinates: locations.filter(location => location.latitude !== undefined && location.longitude !== undefined).length }));
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    console.info(JSON.stringify({ findMyList: "failed; caller-specific get may still work", fallback: "current-location-pin",
      errorType: error instanceof Error ? error.name : "unknown", code: typeof code === "string" && /^[A-Za-z]+$/.test(code) ? code : undefined }));
  }
  console.info(`Listening for location payload shapes for ${seconds}s. Send My Current Location from the demo phone.`);
  for await (const [space, message] of app.messages) {
    if (message.direction !== "inbound") continue;
    const event = await normalizeInboundEvent(space, message);
    if (event?.kind === "location-share" && message.sender?.id) {
      try {
        const location = await photonLocationApi(app).get(message.sender.id);
        console.info(JSON.stringify({ findMyGet: "available", locationType: location.locationType,
          coordinatesFound: location.latitude !== undefined && location.longitude !== undefined }));
      } catch { console.info(JSON.stringify({ findMyGet: "failed-for-caller" })); }
    }
    const content = message.content as unknown as Record<string, unknown>;
    console.info(JSON.stringify({ contentType: content.type, contentKeys: Object.keys(content),
      rawVCardBytes: typeof content.raw === "string" ? Buffer.byteLength(content.raw) : undefined,
      normalizedKind: event?.kind ?? "ignored", coordinatesFound: event?.kind === "location" }));
  }
} finally {
  clearTimeout(timer);
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await app.stop();
}
