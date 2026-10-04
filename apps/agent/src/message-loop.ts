import { ConversationQueue } from "./conversation-queue.js";
import {
  type SpectrumMessageEnvelope,
  type SpectrumSpaceEnvelope,
} from "./normalize.js";
import { normalizeInboundEvent } from "./location.js";
import type { InboundMessageHandler, ReplyPort, SharedLocationHandler } from "./types.js";

interface SendableSpectrumSpace extends SpectrumSpaceEnvelope {
  send(content: string): Promise<unknown>;
}

export interface SpectrumAppEnvelope {
  readonly messages: AsyncIterable<
    readonly [SendableSpectrumSpace, SpectrumMessageEnvelope]
  >;
}

export interface AgentLogger {
  info(message: string): void;
  error(message: string): void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown processing error";
}

export async function runMessageLoop(
  app: SpectrumAppEnvelope,
  handler: InboundMessageHandler,
  logger: AgentLogger = console,
  options: {
    handleLocation?: SharedLocationHandler;
    handleUnsupported?: InboundMessageHandler;
    handleLocationShare?: InboundMessageHandler;
    observe?: (space: SpectrumSpaceEnvelope, message: SpectrumMessageEnvelope) => void;
    afterHandled?: (space: SpectrumSpaceEnvelope, message: SpectrumMessageEnvelope) => void;
  } = {},
): Promise<void> {
  const queue = new ConversationQueue();
  const pending = new Set<Promise<void>>();

  logger.info("Flare agent is listening for inbound messages and shared locations.");

  for await (const [space, sourceMessage] of app.messages) {
    let event;
    try {
      event = await normalizeInboundEvent(space, sourceMessage);
      if (event) options.observe?.(space, sourceMessage);
    } catch (error) {
      logger.error(`Rejected malformed Spectrum envelope: ${describeError(error)}`);
      continue;
    }

    if (event === null) {
      continue;
    }
    if (event.kind === "unsupported" || event.kind === "location-share") {
      logger.info(`Inbound content ${sourceMessage.content.type}: ${event.kind === "location-share" ? "Find My card without embedded coordinates" : "no supported text or location"}.`);
    }

    const { message } = event;
    const job = queue
      .run(message.conversationKey, async () => {
        const reply: ReplyPort = {
          send: async (text) => {
            await space.send(text);
          },
        };
        if (event.kind === "location") await options.handleLocation?.(event.message);
        else if (event.kind === "location-share") await options.handleLocationShare?.(event.message, reply);
        else if (event.kind === "unsupported") await options.handleUnsupported?.(event.message, reply);
        else await handler(event.message, reply);
        options.afterHandled?.(space, sourceMessage);
      })
      .catch((error: unknown) => {
        // Do not log caller text, routing identifiers, or credentials.
        logger.error(
          `Inbound message ${message.providerMessageId} failed: ${describeError(error)}`,
        );
      })
      .finally(() => {
        pending.delete(job);
      });

    pending.add(job);
  }

  await Promise.allSettled(pending);
}
