import { extractTurn, recommendServices } from "@flare/intake";
import { connectFlare, getMyRole } from "@flare/data";

import { readAgentConfig } from "./config.js";
import { createAgentDataPort } from "./data-port.js";
import { handleEcho } from "./echo-handler.js";
import { runMessageLoop, type SpectrumAppEnvelope } from "./message-loop.js";
import { NotificationWorker } from "./notification-worker.js";
import { AgentOrchestrator, sanitizeOperationalError } from "./orchestrator.js";
import { AgentStateStore } from "./state-store.js";
import type { InboundMessageHandler, RouteSender } from "./types.js";

interface StoppableSpectrumApp extends SpectrumAppEnvelope {
  stop(): Promise<void>;
}

async function runWithShutdown(
  app: StoppableSpectrumApp,
  handler: InboundMessageHandler,
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
    await runMessageLoop(app, handler);
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
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error(
      "GEMINI_API_KEY is missing; reports will remain RECEIVED with a typed extraction failure.",
    );
  }

  const data = createAgentDataPort(connection);
  const orchestrator = new AgentOrchestrator({
    data,
    extractTurn,
    recommendServices,
    state,
    sendRoute,
  });
  const notifications = new NotificationWorker({
    data,
    state,
    sendRoute,
    pollMs: config.notificationPollMs,
    maxAttempts: config.notificationMaxAttempts,
  });

  await notifications.start();
  try {
    await orchestrator.drainPendingIntake();
    await runWithShutdown(app, orchestrator.handleInbound);
  } finally {
    notifications.stop();
    connection.conn.disconnect();
  }
}
