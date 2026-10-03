import type { ExtractionOutcome, InboundTurn } from "./contract-types.ts";
import {
  ExtractionTimeoutError,
  classifyProviderError,
  createGeminiGenerator,
  readGeminiConfig,
  type ModelGenerator,
} from "./gemini.ts";
import { SYSTEM_INSTRUCTION, buildResponseSchema, buildUserPrompt } from "./prompt.ts";
import { validateModelOutput } from "./validate.ts";

export interface ExtractorOptions {
  generate: ModelGenerator;
  /** Overall deadline per model attempt. */
  timeoutMs?: number;
  /** Total model attempts when output fails validation (provider errors are not retried here). */
  maxAttempts?: number;
  /** Optional diagnostics hook; receives no caller text or credentials. */
  onAttempt?: (info: AttemptInfo) => void;
}

export interface AttemptInfo {
  attempt: number;
  latencyMs: number;
  modelVersion?: string;
  outcome: "ok" | "invalid_output" | "provider_error";
  problems?: string[];
}

export const DEFAULT_TIMEOUT_MS = 15_000;

async function callWithDeadline(generate: ModelGenerator, turn: InboundTurn, timeoutMs: number) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject first so the race reports the deadline, not the abort it causes.
      reject(new ExtractionTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      generate({
        systemInstruction: SYSTEM_INSTRUCTION,
        userPrompt: buildUserPrompt(turn),
        responseJsonSchema: buildResponseSchema(turn),
        signal: controller.signal,
      }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createExtractor(options: ExtractorOptions): (turn: InboundTurn) => Promise<ExtractionOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 2);

  return async (turn) => {
    if (turn.messages.length === 0) {
      return { ok: false, error: { code: "INVALID_OUTPUT", message: "Turn has no new caller messages to extract", retryable: false } };
    }

    let lastProblems: string[] = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = performance.now();
      let response;
      try {
        response = await callWithDeadline(options.generate, turn, timeoutMs);
      } catch (error) {
        options.onAttempt?.({ attempt, latencyMs: performance.now() - started, outcome: "provider_error" });
        return { ok: false, error: classifyProviderError(error) };
      }
      const latencyMs = performance.now() - started;
      const validated = validateModelOutput(response.text, turn);
      if (validated.ok) {
        options.onAttempt?.({ attempt, latencyMs, modelVersion: response.modelVersion, outcome: "ok" });
        return { ok: true, result: validated.result };
      }
      lastProblems = validated.problems;
      options.onAttempt?.({ attempt, latencyMs, modelVersion: response.modelVersion, outcome: "invalid_output", problems: lastProblems });
    }

    return {
      ok: false,
      error: {
        code: "INVALID_OUTPUT",
        message: `Model output failed validation after ${maxAttempts} attempt(s): ${lastProblems.slice(0, 3).join("; ")}`,
        retryable: true,
      },
    };
  };
}

let defaultExtractor: ((turn: InboundTurn) => Promise<ExtractionOutcome>) | undefined;

/**
 * Contract entry point. Reads GEMINI_API_KEY / GEMINI_MODEL (and optional
 * GEMINI_TIMEOUT_MS, GEMINI_THINKING_LEVEL) from the environment on first use.
 * Missing configuration is reported as a non-retryable PROVIDER_ERROR.
 */
export async function extractTurn(turn: InboundTurn): Promise<ExtractionOutcome> {
  if (!defaultExtractor) {
    let generate: ModelGenerator;
    try {
      generate = createGeminiGenerator(readGeminiConfig());
    } catch (error) {
      return { ok: false, error: { code: "PROVIDER_ERROR", message: (error as Error).message, retryable: false } };
    }
    const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    defaultExtractor = createExtractor({ generate, timeoutMs });
  }
  return defaultExtractor(turn);
}
