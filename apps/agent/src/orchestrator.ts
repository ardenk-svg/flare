import {
  emptyFacts,
  mergeFacts,
  missingIntakeFields, INTAKE_QUESTIONS,
  type Assignment,
  type ConversationContext,
  type ExtractTurn,
  type InboundTurn,
  type RecommendServices,
} from "@flare/contracts";

import { toConversationRoute, toProviderRoute, type AgentDataPort, type ExtractionFailure } from "./data-port.js";
import { AgentStateStore } from "./state-store.js";
import type { TranslateText } from "@flare/intake";
import { ConversationQueue } from "./conversation-queue.js";
import { withDeadline } from "./deadline.js";
import type {
  InboundMessageHandler,
  ReplyPort,
  RouteSender,
  SharedLocationHandler,
  NormalizedInboundMessage,
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
  translateText?: TranslateText;
  requestLocation?: (message: NormalizedInboundMessage) => Promise<string>;
  lookupSharedLocation?: (message: NormalizedInboundMessage, caseEpoch?: number) => Promise<import("./types.js").NormalizedSharedLocation | null>;
  locationTimeoutMs?: number;
  retryBaseMs?: number;
  now?: () => number;
}

const STATUS_QUERY = /^\s*(?:any\s+updates?|status|what(?:'s|\s+is)\s+(?:the\s+)?status|what(?:'s|\s+is)\s+happening)\s*[?.!]*\s*$/iu;
const LOCATION_QUESTION = /\b(?:location|building|entrance|address)\b|\bwhere (?:are you|is (?:the )?(?:incident|smoke|fire)|did (?:it|this|that) happen)\b/i;
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
    recentMessages: hasActiveIncident ? context.recentMessages.filter(m => !/^\[(?:Shared location|Find My|Unsupported|Unreadable shared)/.test(m.text)) : [],
    currentFacts: hasActiveIncident ? context.currentFacts : emptyFacts(),
    currentSummary: hasActiveIncident ? context.currentSummary : "",
    hasSharedLocation: !!context.activeIncident?.sharedLocation,
    addressedFields: context.activeIncident?.unresolvedFields ?? [],
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
  readonly #queue = new ConversationQueue();
  readonly #translateText: TranslateText | undefined;
  readonly #requestLocation: AgentOrchestratorOptions["requestLocation"];
  readonly #lookupSharedLocation: AgentOrchestratorOptions["lookupSharedLocation"];
  readonly #locationTimeoutMs: number;
  readonly #retryBaseMs: number;
  readonly #now: () => number;
  readonly #retries = new Map<string, { fingerprint: string; attempts: number; nextAt: number }>();
  readonly #awaitingQuestion = new Set<string>();
  #recoveryTimer?: ReturnType<typeof setInterval>;
  #recovery?: Promise<void>;

  constructor(options: AgentOrchestratorOptions) {
    this.#data = options.data;
    this.#extractTurn = options.extractTurn;
    this.#recommendServices = options.recommendServices;
    this.#state = options.state;
    this.#sendRoute = options.sendRoute;
    this.#logger = options.logger ?? console;
    this.#maxStaleRetries = options.maxStaleRetries ?? 2;
    this.#translateText = options.translateText;
    this.#requestLocation = options.requestLocation;
    this.#lookupSharedLocation = options.lookupSharedLocation;
    this.#locationTimeoutMs = options.locationTimeoutMs ?? 5_000;
    this.#retryBaseMs = options.retryBaseMs ?? 5_000;
    this.#now = options.now ?? Date.now;
  }

  readonly handleInbound: InboundMessageHandler = (message, reply) => this.#queue.run(message.conversationKey, async () => {
    await this.#state.rememberRoute(message.conversationKey, message.route);
    const recorded = await this.#data.recordInbound({
      provider: message.platform,
      conversationKey: message.conversationKey,
      route: toConversationRoute(message.route),
      messages: [
        {
          id: message.providerMessageId,
          text: message.text,
          receivedAt: message.receivedAt,
        },
      ],
    });
    if (message.platform === "imessage" && /^\s*(?:share (?:my )?location|find my|request location)\s*[.!?]*\s*$/i.test(message.text) && recorded.pendingMessages.some(pending => pending.id === message.providerMessageId)) {
      const replyText = this.#requestLocation
        ? await this.#requestLocation(message)
        : "[SIMULATION] Use Send My Current Location in Messages, or send an Apple Maps link with your pin. Find My requests are not enabled.";
      await this.#data.completeInboundWithoutPatch({ conversationKey: message.conversationKey, messageIds: [message.providerMessageId], intent: "OTHER", replyText });
      return;
    }
    await this.#processConversation(message.conversationKey, reply, message);
  });

  readonly handleLocation: SharedLocationHandler = message => this.#queue.run(message.conversationKey, async () => {
    const context = this.#data.getConversationContext(message.conversationKey);
    const hadLocation = !!context?.activeIncident?.sharedLocation || !!context?.currentFacts.locationText;
    await this.#recordLocation(message);
    if (!hadLocation) await this.#askNext(message.conversationKey);
  });

  async #recordLocation(message: Parameters<SharedLocationHandler>[0]): Promise<void> {
    await this.#state.rememberRoute(message.conversationKey, message.route);
    await this.#data.recordSharedLocation({
      provider: message.platform,
      conversationKey: message.conversationKey,
      route: toConversationRoute(message.route),
      messageId: message.providerMessageId,
      receivedAt: message.receivedAt,
      latitude: message.latitude,
      longitude: message.longitude,
      accuracyMeters: message.accuracyMeters,
      label: message.label,
      source: message.source,
    });
  }

  readonly handleUnsupported: InboundMessageHandler = message => this.#queue.run(message.conversationKey, async () => {
    await this.#state.rememberRoute(message.conversationKey, message.route);
    await this.#data.recordInbound({ provider: message.platform, conversationKey: message.conversationKey,
      route: toConversationRoute(message.route), messages: [{ id: message.providerMessageId, text: message.text, receivedAt: message.receivedAt }] });
    await this.#data.completeInboundWithoutPatch({ conversationKey: message.conversationKey, messageIds: [message.providerMessageId], intent: "OTHER",
      replyText: this.#data.getConversationContext(message.conversationKey)?.dispatcherIdentity ? undefined : "[SIMULATION] I couldn't read that attachment as a location. Please type the building and entrance, or send an Apple Maps pin link." });
  });

  readonly handleLocationShare: InboundMessageHandler = async (message, reply) => {
    const pin = await this.#lookupLocation(message);
    if (pin) { await this.handleLocation(pin); return; }
    await this.#queue.run(message.conversationKey, async () => {
      await this.#state.rememberRoute(message.conversationKey, message.route);
      await this.#data.recordInbound({ provider: message.platform, conversationKey: message.conversationKey,
        route: toConversationRoute(message.route), messages: [{ id: message.providerMessageId, text: message.text, receivedAt: message.receivedAt }] });
      await this.#data.completeInboundWithoutPatch({ conversationKey: message.conversationKey, messageIds: [message.providerMessageId], intent: "OTHER",
        replyText: this.#data.getConversationContext(message.conversationKey)?.dispatcherIdentity ? undefined : "[SIMULATION] I received your Find My sharing card, but Photon didn't return coordinates. For this demo, share your current location from Apple Maps as a pin link, or type the building and entrance." });
    });
  };

  startRecovery(pollMs: number): void {
    if (this.#recoveryTimer) return;
    const drain = () => { void this.drainPendingIntake().catch(error => this.#logger.error(`Intake recovery failed: ${sanitizeOperationalError(error)}`)); };
    this.#recoveryTimer = setInterval(drain, pollMs);
    this.#recoveryTimer.unref();
    drain();
  }

  async stopRecovery(): Promise<void> {
    clearInterval(this.#recoveryTimer);
    this.#recoveryTimer = undefined;
    await this.#recovery;
  }

  drainPendingIntake(): Promise<void> {
    if (this.#recovery) return this.#recovery;
    this.#recovery = this.#drain().finally(() => { this.#recovery = undefined; });
    return this.#recovery;
  }

  async #drain(): Promise<void> {
    const keys = new Set([...this.#data.listPendingConversationKeys(), ...(this.#data.listConversationKeys?.() ?? [])]);
    await Promise.allSettled([...keys].map(key => this.#queue.run(key, async () => {
      const context = this.#data.getConversationContext(key);
      if (!context) return;
      const retry = this.#retries.get(key);
      if (retry?.fingerprint === this.#fingerprint(context) && this.#now() < retry.nextAt) return;
      try {
        if (context.pendingMessages.length) {
          this.#logger.info("Recovering persisted intake.");
          await this.#processConversation(key);
        } else if (context.activeIncident && (this.#awaitingQuestion.has(key) || context.lastQuestionDelivery !== "SENT")) {
          await this.#askNext(key);
        }
      } catch (error) {
        this.#scheduleRetry(this.#data.getConversationContext(key) ?? context, true);
        this.#logger.error(`Intake recovery failed: ${sanitizeOperationalError(error)}`);
      }
    })));
  }

  #fingerprint(context: ConversationContext): string {
    return JSON.stringify([context.caseEpoch, context.intakeRevision, context.pendingMessages.map(message => message.id)]);
  }

  #scheduleRetry(context: ConversationContext, retryable: boolean): void {
    const fingerprint = this.#fingerprint(context);
    const prior = this.#retries.get(context.conversationKey);
    const attempts = (prior?.fingerprint === fingerprint ? prior.attempts : 0) + 1;
    const delay = Math.min(this.#retryBaseMs * 2 ** (attempts - 1), 30_000);
    this.#retries.set(context.conversationKey, { fingerprint, attempts,
      nextAt: retryable && attempts < 5 ? this.#now() + delay : Infinity });
    this.#logger.info(retryable && attempts < 5 ? `Intake recovery scheduled in ${delay} ms.` : "Automatic intake retries stopped; original input remains saved.");
  }

  async #recordFailure(context: ConversationContext, error: ExtractionFailure): Promise<void> {
    await this.#data.recordExtractionFailure({ conversationKey: context.conversationKey, messageIds: context.pendingMessages.map(message => message.id), error });
    this.#scheduleRetry(context, error.retryable);
    this.#logger.error(`Intake ${error.code}: ${sanitizeOperationalError(error.message)}`);
  }

  async #lookupLocation(message: NormalizedInboundMessage, epoch?: number): Promise<import("./types.js").NormalizedSharedLocation | null> {
    if (!this.#lookupSharedLocation) return null;
    try {
      return await withDeadline(this.#lookupSharedLocation(message, epoch), this.#locationTimeoutMs, "Shared location lookup");
    } catch {
      this.#logger.info("Shared location lookup unavailable; continuing intake and listening for pins.");
      return null;
    }
  }

  async #processConversation(conversationKey: string, reply?: ReplyPort, inbound?: NormalizedInboundMessage): Promise<void> {
    for (let staleAttempt = 0; staleAttempt <= this.#maxStaleRetries; staleAttempt += 1) {
      const context = this.#data.getConversationContext(conversationKey);
      if (!context || context.pendingMessages.length === 0) return;
      const messageIds = context.pendingMessages.map((message) => message.id);
      this.#logger.info(`Processing ${messageIds.length} persisted intake message(s).`);
      if (this.#translateText) {
        try {
          for (const message of context.pendingMessages) {
            if (this.#data.getInboundTranslation(conversationKey, message.id)) continue;
            const translated = await this.#translateText({ text: message.text, targetLanguage: 'en', sourceLanguage: this.#data.getConversationContext(conversationKey)?.callerLanguage });
            await this.#data.recordInboundTranslation({ conversationKey, messageId: message.id, language: translated.sourceLanguage, translatedText: translated.text });
          }
        } catch {
          await this.#recordFailure(context, { code: 'PROVIDER_ERROR', message: 'Gemini translation unavailable; original input is retained for retry.', retryable: true });
          return;
        }
      }


      if (context.pendingMessages.every((message) => STATUS_QUERY.test(message.text))) {
        await this.#data.completeInboundWithoutPatch({
          conversationKey,
          messageIds,
          intent: "STATUS_QUERY",
          replyText: renderCommittedStatus(context, this.#data.listAssignments()),
        });
        this.#retries.delete(conversationKey);
        return;
      }

      let outcome;
      try {
        this.#logger.info("Requesting Gemini extraction.");
        outcome = await this.#extractTurn(buildTurn(context));
      } catch (error) {
        const failure: ExtractionFailure = {
          code: "PROVIDER_ERROR",
          message: sanitizeOperationalError(error),
          retryable: true,
        };
        await this.#recordFailure(context, failure);
        return;
      }

      if (!outcome.ok) {
        await this.#recordFailure(context, outcome.error);
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
              : context.dispatcherIdentity || context.activeIncident ? undefined : OTHER_REPLY,
        });
        this.#retries.delete(conversationKey);
        if (result.intent === 'OTHER' && context.activeIncident) await this.#askNext(conversationKey, reply);
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

      // A Find My share may predate this report. Resolve it before asking for location;
      // the background snapshot would otherwise sit behind this turn in the queue.
      this.#retries.delete(conversationKey);
      this.#awaitingQuestion.add(conversationKey);
      this.#logger.info("Intake facts committed; checking the next clarification.");
      const committed = this.#data.getConversationContext(conversationKey);
      if (inbound && this.#lookupSharedLocation && committed && !committed.activeIncident?.sharedLocation && !committed.currentFacts.locationText?.trim()) {
        const pin = await this.#lookupLocation({ ...inbound, providerMessageId: `findmy-context-${inbound.providerMessageId}` }, committed.caseEpoch);
        if (pin) await this.#recordLocation(pin);
      }

      await this.#askNext(conversationKey, reply, result);

      return;
    }
  }

  async #askNext(conversationKey: string, reply?: ReplyPort, result?: import("@flare/contracts").ExtractionResult): Promise<void> {
    const current = this.#data.getConversationContext(conversationKey);
    if (!current || current.dispatcherIdentity || current.activeIncident?.status === 'CLOSED' || current.activeIncident?.status === 'RESOLVED') { this.#awaitingQuestion.delete(conversationKey); return; }
    const facts = mergeFacts(current.currentFacts, result?.patch ?? {});
    const addressed = [...(current.activeIncident?.unresolvedFields ?? []), ...(result?.unresolvedFields ?? [])];
    const missing = missingIntakeFields(facts, !!current.activeIncident?.sharedLocation, addressed);
    if (!missing.length) { this.#awaitingQuestion.delete(conversationKey); return; }
    let question = result?.questionField && missing.includes(result.questionField) ? result.proposedQuestion : null;
    if (question && LOCATION_QUESTION.test(question) && !missing.includes('locationText')) question = null;
    question ||= INTAKE_QUESTIONS[missing[0]];
    await this.#sendQuestion(conversationKey, question, reply);
  }

  async #sendQuestion(
    conversationKey: string,
    question: string,
    reply?: ReplyPort,
  ): Promise<void> {
    const current = this.#data.getConversationContext(conversationKey);
    if (current?.dispatcherIdentity) return;
    if (LOCATION_QUESTION.test(question) && (current?.activeIncident?.sharedLocation || current?.currentFacts.locationText?.trim())) return;
    question = question.startsWith("[SIMULATION]") ? question : `[SIMULATION] ${question}`;
    let translatedText: string | undefined;
    const language = current?.callerLanguage ?? 'en';
    try {
      if (this.#translateText && !language.startsWith('en')) translatedText = (await this.#translateText({ text: question, sourceLanguage: 'en', targetLanguage: language })).text;
      const fresh = this.#data.getConversationContext(conversationKey);
      if (fresh?.dispatcherIdentity || fresh?.caseEpoch !== current?.caseEpoch) return;
      const text = translatedText ?? question;
      if (reply) {
        await reply.send(text);
      } else {
        const stored = this.#data.getConversationContext(conversationKey)?.route;
        const route = this.#state.routeFor(conversationKey) ?? (stored ? toProviderRoute(stored) : undefined);
        if (!route) throw new Error("No durable Spectrum route is available.");
        await this.#sendRoute(route, text);
      }
      await this.#data.recordSentQuestion({
        conversationKey,
        question,
        ...(translatedText ? { translatedText, language } : {}),
        delivered: true,
      });
      this.#awaitingQuestion.delete(conversationKey);
      this.#retries.delete(conversationKey);
    } catch (error) {
      const message = sanitizeOperationalError(error);
      await this.#data.recordSentQuestion({
        conversationKey,
        question,
        ...(translatedText ? { translatedText, language } : {}),
        delivered: false,
        error: message,
      });
      if (current) this.#scheduleRetry(current, true);
      this.#awaitingQuestion.add(conversationKey);
      this.#logger.error(`A clarification question could not be delivered: ${message}`);
    }
  }
}
