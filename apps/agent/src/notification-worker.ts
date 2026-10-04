import type { TranslateText } from "@flare/intake";
import type { PendingNotification } from "@flare/contracts";

import { toProviderRoute, type AgentDataPort } from "./data-port.js";
import { sanitizeOperationalError, type OrchestratorLogger } from "./orchestrator.js";
import { AgentStateStore } from "./state-store.js";
import type { RouteSender } from "./types.js";

export interface NotificationWorkerOptions {
  data: AgentDataPort;
  state: AgentStateStore;
  sendRoute: RouteSender;
  pollMs: number;
  maxAttempts: number;
  logger?: OrchestratorLogger;
  translateText?: TranslateText;
}

export class NotificationWorker {
  readonly #translateText: TranslateText | undefined;
  readonly #data: AgentDataPort;
  readonly #state: AgentStateStore;
  readonly #sendRoute: RouteSender;
  readonly #pollMs: number;
  readonly #maxAttempts: number;
  readonly #logger: OrchestratorLogger;
  readonly #inFlight = new Set<string>();
  readonly #completed = new Set<string>();
  readonly #retryAfter = new Map<string, number>();
  #timer: NodeJS.Timeout | undefined;
  #unsubscribe: (() => void) | undefined;
  #stopped = true;

  constructor(options: NotificationWorkerOptions) {
    this.#translateText = options.translateText;
    this.#data = options.data;
    this.#state = options.state;
    this.#sendRoute = options.sendRoute;
    this.#pollMs = options.pollMs;
    this.#maxAttempts = options.maxAttempts;
    this.#logger = options.logger ?? console;
  }

  async start(): Promise<void> {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#unsubscribe = this.#data.subscribeNotifications((job) => {
      void this.#process(job);
    });
    this.#timer = setInterval(() => {
      void this.drain();
    }, this.#pollMs);
    this.#timer.unref();
    await this.drain();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  async drain(): Promise<void> {
    if (this.#stopped) return;
    await Promise.allSettled(
      this.#data.listPendingNotifications().map((job) => this.#process(job)),
    );
  }

  async #process(job: PendingNotification): Promise<void> {
    if (
      this.#stopped ||
      this.#completed.has(job.id) ||
      this.#inFlight.has(job.id) ||
      job.attempts >= this.#maxAttempts
    ) {
      return;
    }
    if ((this.#retryAfter.get(job.id) ?? 0) > Date.now()) return;

    // The database route survives a lost local state file; prefer the local copy when present.
    const route = this.#state.routeFor(job.conversationKey) ?? (job.route ? toProviderRoute(job.route) : undefined);
    if (!route) {
      // Do not consume attempts: a later inbound message may restore the route.
      this.#logger.error("A pending notification is waiting for a durable Spectrum route.");
      this.#retryAfter.set(job.id, Date.now() + 30_000);
      return;
    }

    this.#inFlight.add(job.id);
    try {
      let text = job.translatedText ?? job.text;
      const language = job.callerLanguage ?? 'en';
      if (!job.translatedText && this.#translateText && !language.startsWith('en')) {
        const translated = await this.#translateText({ text: job.text, sourceLanguage: 'en', targetLanguage: language });
        await this.#data.prepareNotificationTranslation({ notificationId: job.id, language, translatedText: translated.text });
        text = this.#data.listPendingNotifications().find(n => n.id === job.id)?.translatedText ?? translated.text;
      }
      // A local demo restart cancels old jobs without restarting this worker.
      if (!this.#data.listPendingNotifications().some(n => n.id === job.id)) return;
      await this.#sendRoute(route, text);
      await this.#data.ackNotification({ notificationId: job.id, delivered: true });
      this.#completed.add(job.id);
      this.#retryAfter.delete(job.id);
    } catch (error) {
      const message = sanitizeOperationalError(error);
      try {
        await this.#data.ackNotification({
          notificationId: job.id,
          delivered: false,
          error: message,
        });
      } catch (ackError) {
        this.#logger.error(
          `A notification delivery failure could not be recorded: ${sanitizeOperationalError(ackError)}`,
        );
      }
      const backoff = Math.min(this.#pollMs * 2 ** Math.max(job.attempts, 0), 30_000);
      this.#retryAfter.set(job.id, Date.now() + backoff);
      this.#logger.error(`A committed notification could not be delivered: ${message}`);
    } finally {
      this.#inFlight.delete(job.id);
    }
  }
}
