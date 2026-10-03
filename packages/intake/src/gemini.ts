import { ApiError, GoogleGenAI, type GenerateContentConfig, type ThinkingLevel } from "@google/genai";
import type { ExtractionOutcome } from "@flare/contracts";

/** The contract's failure payload (not separately named in @flare/contracts). */
export type ExtractionError = Extract<ExtractionOutcome, { ok: false }>["error"];

export interface ModelRequest {
  systemInstruction: string;
  userPrompt: string;
  responseJsonSchema: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ModelResponse {
  text: string | undefined;
  modelVersion: string | undefined;
}

/** The single model boundary. Tests substitute a fake; production uses Gemini. */
export type ModelGenerator = (request: ModelRequest) => Promise<ModelResponse>;

export interface GeminiConfig {
  apiKey: string;
  model: string;
  /** Optional; only send if the configured model supports thinking levels. */
  thinkingLevel?: string;
}

export function readGeminiConfig(env: NodeJS.ProcessEnv = process.env): GeminiConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const model = env.GEMINI_MODEL?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!model) throw new Error("GEMINI_MODEL is not set (choose a stable Flash model; run `npm run models`)");
  return { apiKey, model, thinkingLevel: env.GEMINI_THINKING_LEVEL?.trim() || undefined };
}

export function createGeminiGenerator(config: GeminiConfig): ModelGenerator {
  // The SDK retries 5 times with backoff by default; Person 1's loop owns
  // retries, so keep one attempt and a single bounded deadline per call.
  const ai = new GoogleGenAI({ apiKey: config.apiKey, httpOptions: { retryOptions: { attempts: 1 } } });
  return async ({ systemInstruction, userPrompt, responseJsonSchema, signal }) => {
    const generationConfig: GenerateContentConfig = {
      systemInstruction,
      responseMimeType: "application/json",
      responseJsonSchema,
      temperature: 0,
      abortSignal: signal,
    };
    if (config.thinkingLevel) {
      generationConfig.thinkingConfig = { thinkingLevel: config.thinkingLevel as ThinkingLevel };
    }
    const response = await ai.models.generateContent({
      model: config.model,
      contents: userPrompt,
      config: generationConfig,
    });
    return { text: response.text, modelVersion: response.modelVersion };
  };
}

export class ExtractionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Gemini did not respond within ${timeoutMs} ms`);
    this.name = "ExtractionTimeoutError";
  }
}

/** Maps a thrown provider error to the contract failure. Never echoes raw provider text. */
export function classifyProviderError(error: unknown): ExtractionError {
  if (error instanceof ExtractionTimeoutError) {
    return { code: "TIMEOUT", message: error.message, retryable: true };
  }
  const status = error instanceof ApiError ? error.status : (error as { status?: unknown })?.status;
  if (typeof status === "number") {
    if (status === 429) return { code: "RATE_LIMIT", message: "Gemini rate limit or quota exceeded (HTTP 429)", retryable: true };
    if (status === 408 || status === 504) return { code: "TIMEOUT", message: `Gemini request timed out (HTTP ${status})`, retryable: true };
    if (status >= 500) return { code: "PROVIDER_ERROR", message: `Gemini service error (HTTP ${status})`, retryable: true };
    if (status === 401 || status === 403) return { code: "PROVIDER_ERROR", message: `Gemini rejected the credentials (HTTP ${status}); check GEMINI_API_KEY`, retryable: false };
    if (status === 400 && /api key/i.test((error as Error)?.message ?? "")) {
      return { code: "PROVIDER_ERROR", message: "Gemini rejected the API key (HTTP 400); check GEMINI_API_KEY", retryable: false };
    }
    if (status === 404) return { code: "PROVIDER_ERROR", message: "Gemini model not found (HTTP 404); check GEMINI_MODEL", retryable: false };
    return { code: "PROVIDER_ERROR", message: `Gemini rejected the request (HTTP ${status})`, retryable: false };
  }
  if ((error as { name?: unknown })?.name === "AbortError") {
    return { code: "TIMEOUT", message: "Gemini request was aborted", retryable: true };
  }
  return { code: "PROVIDER_ERROR", message: "Could not reach Gemini (network or SDK error)", retryable: true };
}
