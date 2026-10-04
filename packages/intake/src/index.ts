// Types are owned by @flare/contracts; these re-exports cover the intake boundary only.
export type {
  CallerFactField,
  CallerFactPatch,
  CallerFacts,
  CallerMessage,
  Evidence,
  ExtractionErrorCode,
  ExtractionOutcome,
  ExtractionResult,
  ExtractTurn,
  InboundTurn,
  Intent,
  Recommendation,
  RecommendServices,
  Service,
} from "@flare/contracts";
export { extractTurn, createExtractor, DEFAULT_TIMEOUT_MS, type ExtractorOptions, type AttemptInfo } from "./extract.ts";
export { recommendServices, DEMO_RULES, NO_RULE_REASON } from "./rules.ts";
export { emptyFacts, mergeFacts, isValidFactValue, CALLER_FACT_FIELDS } from "./facts.ts";
export {
  createGeminiGenerator,
  readGeminiConfig,
  classifyProviderError,
  type ModelGenerator,
  type ModelRequest,
  type ModelResponse,
  type GeminiConfig,
  type ExtractionError,
} from "./gemini.ts";
export { validateModelOutput } from "./validate.ts";

export { translateText, createTranslator, type TranslateText, type Translation } from "./translate.ts";
