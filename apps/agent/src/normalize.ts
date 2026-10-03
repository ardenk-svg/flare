import type { NormalizedInboundMessage } from "./types.js";

export interface SpectrumSpaceEnvelope {
  readonly id: string;
}

export interface SpectrumMessageEnvelope {
  readonly id: string;
  readonly platform: string;
  readonly direction: "inbound" | "outbound";
  readonly timestamp: Date;
  readonly sender?: { readonly id: string } | undefined;
  readonly content: { readonly type: string; readonly text?: string };
}

/**
 * Convert the trusted Spectrum envelope into Flare's provider-neutral boundary.
 * Outbound echoes, non-text events, and empty text do not enter intake.
 */
export function normalizeInboundMessage(
  space: SpectrumSpaceEnvelope,
  message: SpectrumMessageEnvelope,
): NormalizedInboundMessage | null {
  if (
    message.direction !== "inbound" ||
    message.content.type !== "text" ||
    typeof message.content.text !== "string"
  ) {
    return null;
  }

  const text = message.content.text;
  if (text.trim().length === 0) {
    return null;
  }

  if (!space.id || !message.id || !message.platform) {
    throw new Error("Spectrum delivered an inbound message without stable identifiers.");
  }

  if (Number.isNaN(message.timestamp.getTime())) {
    throw new Error("Spectrum delivered an inbound message with an invalid timestamp.");
  }

  return {
    providerMessageId: message.id,
    conversationKey: `${message.platform}:${space.id}`,
    platform: message.platform,
    senderId: message.sender?.id ?? null,
    text,
    receivedAt: message.timestamp.toISOString(),
  };
}
