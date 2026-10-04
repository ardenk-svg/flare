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

export interface NormalizedSharedLocation extends Omit<NormalizedInboundMessage, "text"> {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  label?: string;
  source: "IMESSAGE_PIN" | "FIND_MY";
}

export type SharedLocationHandler = (message: NormalizedSharedLocation) => Promise<void>;

export type InboundMessageHandler = (
  message: NormalizedInboundMessage,
  reply: ReplyPort,
) => Promise<void>;

export type RouteSender = (route: ProviderRoute, text: string) => Promise<void>;
