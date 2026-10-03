import {
  emptyFacts,
  mergeFacts,
  type Assignment,
  type ConversationContext,
  type ExtractTurn,
  type InboundTurn,
  type RecommendServices,
} from "@flare/contracts";

import type { AgentDataPort, ExtractionFailure } from "./data-port.js";
import { AgentStateStore } from "./state-store.js";
import type {
  InboundMessageHandler,
  ReplyPort,
  RouteSender,
} from "./types.js";

export interface OrchestratorLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface AgentOrchestratorOptions {
  data: AgentDataPort;
  extractTurn: ExtractTurn;
  recommendServices: RecommendServices;
  state: AgentStateStore;
  sendRoute: RouteSender;
  logger?: OrchestratorLogger;
  maxStaleRetries?: number;
}

const STATUS_QUERY = /^\s*(?:any\s+updates?|status|what(?:'s|\s+is)\s+(?:the\s+)?status|what(?:'s|\s+is)\s+happening)\s*[?.!]*\s*$/iu;
const OTHER_REPLY =
  "[SIMULATION] I can record a mock incident report or share the current mock assignment status.";

export function sanitizeOperationalError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(?:token|secret|api[-_ ]?key)\s*[:=]\s*\S+/giu, "[REDACTED]")
    .replace(/[A-Za-z0-9_-]{48,}/g, "[REDACTED]")
    .slice(0, 240);
}

function isStaleRevision(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "STALE_REVISION",
  );
}

function buildTurn(context: ConversationContext): InboundTurn {
  // Until the database session boundary lands, never feed resolved-case context
  // into the first turn of a new case in the same messaging thread.
  const hasActiveIncident = context.activeIncident !== null;
  return {
    conversationKey: context.conversationKey,
    intakeRevision: context.intakeRevision,
    messages: context.pendingMessages,
    recentMessages: hasActiveIncident ? context.recentMessages : [],
    currentFacts: hasActiveIncident ? context.currentFacts : emptyFacts(),
    currentSummary: hasActiveIncident ? context.currentSummary : "",
    lastQuestion: hasActiveIncident ? context.lastQuestion : null,
  };
}

export function renderCommittedStatus(
  context: ConversationContext,
  assignments: Assignment[],
): string {
  const incident = context.activeIncident;
  if (!incident) return "[SIMULATION] There is no active mock incident in this conversation.";

  const activeAssignments = assignments.filter((assignment) => assignment.incidentId === incident.id);
  if (activeAssignments.length === 0) {
    return `[SIMULATION] Mock incident status: ${incident.status}. No mock unit has been assigned.`;
  }

  const units = activeAssignments
    .map((assignment) => `${assignment.unitId} ${assignment.status}`)
    .join(", ");
  return `[SIMULATION] Mock incident status: ${incident.status}. Mock unit status: ${units}.`;
}

export class AgentOrchestrator {
  readonly #data: AgentDataPort;
  readonly #extractTurn: ExtractTurn;
  readonly #recommendServices: RecommendServices;
  readonly #state: AgentStateStore;
  readonly #sendRoute: RouteSender;
  readonly #logger: OrchestratorLogger;
  readonly #maxStaleRetries: number;

  constructor(options: AgentOrchestratorOptions) {
    this.#data = options.data;
    this.#extractTurn = options.extractTurn;
    this.#recommendServices = options.recommendServices;
    this.#state = options.state;
    this.#sendRoute = options.sendRoute;
    this.#logger = options.logger ?? console;
    this.#maxStaleRetries = options.maxStaleRetries ?? 2;
  }

  readonly handleInbound: InboundMessageHandler = async (message, reply) => {
    await this.#state.rememberRoute(message.conversationKey, message.route);
    await this.#data.recordInbound({
      provider: message.platform,
      conversationKey: message.conversationKey,
      messages: [
        {
          id: message.providerMessageId,
          text: message.text,
          receivedAt: message.receivedAt,
        },
      ],
    });
    await this.#processConversation(message.conversationKey, reply);
  };

  async drainPendingIntake(): Promise<void> {
    const keys = this.#data.listPendingConversationKeys();
    if (keys.length === 0) return;
    this.#logger.info(`Retrying pending intake for ${keys.length} conversation(s).`);
    const results = await Promise.allSettled(
      keys.map((conversationKey) => this.#processConversation(conversationKey)),
    );
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      this.#logger.error(`${failures.length} pending intake conversation(s) could not be retried.`);
    }
  }

  async #processConversation(conversationKey: string, reply?: ReplyPort): Promise<void> {
    for (let staleAttempt = 0; staleAttempt <= this.#maxStaleRetries; staleAttempt += 1) {
      const context = this.#data.getConversationContext(conversationKey);
      if (!context || context.pendingMessages.length === 0) return;
      const messageIds = context.pendingMessages.map((message) => message.id);

      if (context.pendingMessages.every((message) => STATUS_QUERY.test(message.text))) {
        await this.#data.completeInboundWithoutPatch({
          conversationKey,
          messageIds,
          intent: "STATUS_QUERY",
          replyText: renderCommittedStatus(context, this.#data.listAssignments()),
        });
        return;
      }

      let outcome;
      try {
        outcome = await this.#extractTurn(buildTurn(context));
      } catch (error) {
        const failure: ExtractionFailure = {
          code: "PROVIDER_ERROR",
          message: sanitizeOperationalError(error),
          retryable: true,
        };
        await this.#data.recordExtractionFailure({ conversationKey, messageIds, error: failure });
        return;
      }

      if (!outcome.ok) {
        await this.#data.recordExtractionFailure({
          conversationKey,
          messageIds,
          error: outcome.error,
        });
        return;
      }

      const { result } = outcome;
      if (result.intent === "STATUS_QUERY" || result.intent === "OTHER") {
        await this.#data.completeInboundWithoutPatch({
          conversationKey,
          messageIds,
          intent: result.intent,
          replyText:
            result.intent === "STATUS_QUERY"
              ? renderCommittedStatus(context, this.#data.listAssignments())
              : OTHER_REPLY,
        });
        return;
      }

      const recommendation = this.#recommendServices(
        mergeFacts(context.currentFacts, result.patch),
      );

      try {
        await this.#data.applyIntakePatch({
          conversationKey,
          expectedRevision: context.intakeRevision,
          sourceMessageIds: messageIds,
          result,
          recommendation,
        });
      } catch (error) {
        if (isStaleRevision(error) && staleAttempt < this.#maxStaleRetries) continue;
        throw error;
      }

      if (
        result.proposedQuestion &&
        !(context.lastQuestionDelivery === "SENT" && context.lastQuestion === result.proposedQuestion)
      ) {
        await this.#sendQuestion(conversationKey, result.proposedQuestion, reply);
      }
      return;
    }
  }

  async #sendQuestion(
    conversationKey: string,
    question: string,
    reply?: ReplyPort,
  ): Promise<void> {
    try {
      if (reply) {
        await reply.send(question);
      } else {
        const route = this.#state.routeFor(conversationKey);
        if (!route) throw new Error("No durable Spectrum route is available.");
        await this.#sendRoute(route, question);
      }
      await this.#data.recordSentQuestion({
        conversationKey,
        question,
        delivered: true,
      });
    } catch (error) {
      const message = sanitizeOperationalError(error);
      await this.#data.recordSentQuestion({
        conversationKey,
        question,
        delivered: false,
        error: message,
      });
      this.#logger.error(`A clarification question could not be delivered: ${message}`);
    }
  }
}
