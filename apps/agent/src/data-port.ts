import type {
  Assignment,
  CallerMessage,
  ConversationContext,
  ConversationRoute,
  ExtractionOutcome,
  ExtractionResult,
  PendingNotification,
  Recommendation,
} from "@flare/contracts";
import {
  ackNotification,
  applyIntakePatch,
  completeInboundWithoutPatch,
  getConversationContext,
  listAssignments,
  listPendingNotifications,
  onNotification,
  recordExtractionFailure,
  recordInbound,
  recordSentQuestion,
  type FlareConnection,
} from "@flare/data";

import type { ProviderRoute } from "./types.js";

/** Converts between the agent's Spectrum route and the contract's durable database route. */
export const toConversationRoute = (route: ProviderRoute): ConversationRoute => ({
  platform: route.platform,
  spaceId: route.spaceId,
  line: route.phone ?? null,
});
export const toProviderRoute = (route: ConversationRoute): ProviderRoute => ({
  platform: route.platform,
  spaceId: route.spaceId,
  ...(route.line ? { phone: route.line } : {}),
});

export type ExtractionFailure = Extract<ExtractionOutcome, { ok: false }>['error'];

export interface AgentDataPort {
  recordInbound(input: {
    provider: string;
    conversationKey: string;
    route: ConversationRoute;
    messages: CallerMessage[];
  }): Promise<ConversationContext>;
  getConversationContext(conversationKey: string): ConversationContext | null;
  recordExtractionFailure(input: {
    conversationKey: string;
    messageIds: string[];
    error: ExtractionFailure;
  }): Promise<void>;
  applyIntakePatch(input: {
    conversationKey: string;
    expectedRevision: number;
    sourceMessageIds: string[];
    result: ExtractionResult;
    recommendation: Recommendation;
  }): Promise<void>;
  completeInboundWithoutPatch(input: {
    conversationKey: string;
    messageIds: string[];
    intent: "STATUS_QUERY" | "OTHER";
    replyText?: string;
  }): Promise<void>;
  recordSentQuestion(input: {
    conversationKey: string;
    question: string;
    delivered: boolean;
    error?: string;
  }): Promise<void>;
  listAssignments(): Assignment[];
  listPendingConversationKeys(): string[];
  listPendingNotifications(): PendingNotification[];
  subscribeNotifications(callback: (job: PendingNotification) => void): () => void;
  ackNotification(input: {
    notificationId: string;
    delivered: boolean;
    error?: string;
  }): Promise<void>;
}

export function createAgentDataPort(connection: FlareConnection): AgentDataPort {
  const { conn } = connection;
  return {
    recordInbound: (input) => recordInbound(conn, input),
    getConversationContext: (conversationKey) => getConversationContext(conn, conversationKey),
    recordExtractionFailure: (input) => recordExtractionFailure(conn, input),
    applyIntakePatch: (input) => applyIntakePatch(conn, input),
    completeInboundWithoutPatch: (input) => completeInboundWithoutPatch(conn, input),
    recordSentQuestion: (input) => recordSentQuestion(conn, input),
    listAssignments: () => listAssignments(conn),
    listPendingConversationKeys: () => {
      const keys: string[] = [];
      for (const row of conn.db.agentConversation.iter()) {
        const context = getConversationContext(conn, row.conversationKey);
        if (context && context.pendingMessages.length > 0) keys.push(row.conversationKey);
      }
      return keys;
    },
    listPendingNotifications: () => listPendingNotifications(conn),
    subscribeNotifications: (callback) => onNotification(conn, callback),
    ackNotification: (input) => ackNotification(conn, input),
  };
}
