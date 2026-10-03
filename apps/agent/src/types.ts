export interface ProviderRoute {
  platform: string;
  spaceId: string;
  /** Required by Spectrum Cloud when more than one dedicated iMessage line exists. */
  phone?: string;
}

export interface NormalizedInboundMessage {
  /** Trusted SDK message identifier, scoped to the provider conversation. */
  providerMessageId: string;
  /** Stable internal key. Provider prefix prevents cross-platform collisions. */
  conversationKey: string;
  platform: string;
  senderId: string | null;
  text: string;
  receivedAt: string;
  route: ProviderRoute;
}

export interface ReplyPort {
  send(text: string): Promise<void>;
}

export type InboundMessageHandler = (
  message: NormalizedInboundMessage,
  reply: ReplyPort,
) => Promise<void>;

export type RouteSender = (route: ProviderRoute, text: string) => Promise<void>;
