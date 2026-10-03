export interface NormalizedInboundMessage {
  /** Trusted SDK message identifier, scoped to the provider conversation. */
  providerMessageId: string;
  /** Stable internal key. Provider prefix prevents cross-platform collisions. */
  conversationKey: string;
  platform: string;
  senderId: string | null;
  text: string;
  receivedAt: string;
}

export interface ReplyPort {
  send(text: string): Promise<void>;
}

export type InboundMessageHandler = (
  message: NormalizedInboundMessage,
  reply: ReplyPort,
) => Promise<void>;
