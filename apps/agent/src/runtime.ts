import { extractTurn, recommendServices, translateText, type TranslateText } from "@flare/intake";
import type { ExtractTurn, RecommendServices } from "@flare/contracts";
import { connectFlare, getMyRole } from "@flare/data";

import { readAgentConfig } from "./config.js";
import { createAgentDataPort } from "./data-port.js";
import { handleEcho } from "./echo-handler.js";
import { runMessageLoop, type SpectrumAppEnvelope } from "./message-loop.js";
import { NotificationWorker } from "./notification-worker.js";
import { AgentOrchestrator, sanitizeOperationalError } from "./orchestrator.js";
import { AgentStateStore } from "./state-store.js";
import { FindMyBridge, type LocationApi } from "./find-my.js";
import type { InboundMessageHandler, RouteSender } from "./types.js";

interface StoppableSpectrumApp extends SpectrumAppEnvelope {
  stop(): Promise<void>;
}

async function runWithShutdown(
  app: StoppableSpectrumApp,
  handler: InboundMessageHandler,
  options: Parameters<typeof runMessageLoop>[3] = {},
): Promise<void> {
  let stopping = false;

  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void app.stop().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown shutdown error";
      console.error(`Failed to stop Spectrum cleanly: ${message}`);
    });
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await runMessageLoop(app, handler, console, options);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

/** Explicit transport-only diagnostic. This never invokes Gemini or SpacetimeDB. */
export async function runEchoAgent(app: StoppableSpectrumApp): Promise<void> {
  console.info("Starting labelled echo diagnostic; no incident state will be created.");
  await runWithShutdown(app, handleEcho);
}

/** Production worker: Spectrum → intake → SpacetimeDB plus asynchronous notifications. */
export async function runAgent(
  app: StoppableSpectrumApp,
  sendRoute: RouteSender,
  options: { translateText?: TranslateText; locations?: LocationApi; demoPhone?: string; extractTurn?: ExtractTurn; recommendServices?: RecommendServices } = {},
): Promise<void> {
  const config = readAgentConfig();
  const state = await AgentStateStore.open();
  let connection;
  try {
    connection = await connectFlare({
      uri: config.spacetimeUri,
      database: config.spacetimeDatabase,
      token: config.spacetimeToken ?? state.spacetimeToken,
      onDisconnect: (error) => {
        console.error(
          error ? `SpacetimeDB disconnected: ${error.message}` : "SpacetimeDB disconnected.",
        );
        void app.stop();
      },
    });
  } catch (error) {
    await app.stop();
    throw new Error(`SpacetimeDB startup failed: ${sanitizeOperationalError(error)}`);
  }

  await state.setSpacetimeToken(connection.token);
  const role = getMyRole(connection.conn);
  if (role?.role !== "AGENT") {
    connection.conn.disconnect();
    await app.stop();
    throw new Error(
      `SpacetimeDB identity ${connection.identityHex} needs the AGENT role before this worker can run.`,
    );
  }

  console.info(`Connected to SpacetimeDB as authorized agent ${connection.identityHex}.`);
  if (!options.extractTurn && !process.env.GEMINI_API_KEY?.trim()) {
    console.error(
      "GEMINI_API_KEY is missing; reports will remain RECEIVED with a typed extraction failure.",
    );
  }

  const data = createAgentDataPort(connection);
  let locations: FindMyBridge | undefined;
  const orchestrator = new AgentOrchestrator({
    data,
    extractTurn: options.extractTurn ?? extractTurn,
    recommendServices: options.recommendServices ?? recommendServices,
    state,
    sendRoute,
    translateText: options.translateText ?? translateText,
    requestLocation: options.locations ? message => locations!.request(message) : undefined,
    lookupSharedLocation: options.locations ? (message, epoch) => locations!.snapshot(message, epoch) : undefined,
  });
  if (options.locations) {
    locations = new FindMyBridge(options.locations, orchestrator.handleLocation, key => {
      const context = data.getConversationContext(key);
      return context?.activeIncident ? context.caseEpoch : undefined;
    }, console, options.demoPhone);
  }
  const notifications = new NotificationWorker({
    data,
    state,
    sendRoute,
    pollMs: config.notificationPollMs,
    maxAttempts: config.notificationMaxAttempts,
    translateText: options.translateText ?? translateText,
  });

  await notifications.start();
  try {
    await orchestrator.drainPendingIntake();
    await runWithShutdown(app, orchestrator.handleInbound, {
      handleLocation: orchestrator.handleLocation,
      handleUnsupported: orchestrator.handleUnsupported,
      handleLocationShare: orchestrator.handleLocationShare,
      observe: (space, message) => locations?.observe(space, message),
      afterHandled: (space, message) => locations?.observe(space, message),
    });
  } finally {
    notifications.stop();
    await locations?.stop();
    connection.conn.disconnect();
  }
}
