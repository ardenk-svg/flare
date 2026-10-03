import { ConversationQueue } from "./conversation-queue.js";
import {
  normalizeInboundMessage,
  type SpectrumMessageEnvelope,
  type SpectrumSpaceEnvelope,
} from "./normalize.js";
import type { InboundMessageHandler } from "./types.js";

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
): Promise<void> {
  const queue = new ConversationQueue();
  const pending = new Set<Promise<void>>();

  logger.info("Flare agent is listening for inbound text messages.");

  for await (const [space, sourceMessage] of app.messages) {
    let message;
    try {
      message = normalizeInboundMessage(space, sourceMessage);
    } catch (error) {
      logger.error(`Rejected malformed Spectrum envelope: ${describeError(error)}`);
      continue;
    }

    if (message === null) {
      continue;
    }

    const job = queue
      .run(message.conversationKey, async () => {
        await handler(message, {
          send: async (text) => {
            await space.send(text);
          },
        });
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
