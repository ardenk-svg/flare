import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CallerFacts, CallerMessage, InboundTurn } from "@flare/contracts";
import { emptyFacts } from "../facts.ts";
import type { Expectation } from "./expect.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
export const FIXTURES_DIR = join(REPO_ROOT, "fixtures");

export interface TurnSpec {
  intakeRevision?: number;
  messages: string[];
  recentMessages?: string[];
  currentFacts?: Partial<CallerFacts>;
  currentSummary?: string;
  lastQuestion?: string | null;
}

export interface ExtractionFixture {
  id: string;
  description: string;
  covers: string[];
  turn: TurnSpec;
  expect: Expectation;
}

export type CannedModel =
  | { output: unknown }
  | { raw: string }
  | { sequence: Array<{ output: unknown } | { raw: string }> }
  | { hang: true }
  | { throwStatus: number; throwMessage?: string };

export interface OfflineFixture extends ExtractionFixture {
  model: CannedModel;
}

export interface ScenarioFixture {
  id: string;
  description: string;
  steps: Array<{ messages: string[]; expect: Expectation }>;
}

export interface RuleCase {
  id: string;
  facts: Partial<CallerFacts>;
  services: string[];
  ruleIds: string[];
}

// Fixed synthetic timestamps keep fixtures deterministic.
function syntheticMessages(texts: string[], prefix: string): CallerMessage[] {
  return texts.map((text, i) => ({ id: `${prefix}${i + 1}`, text, receivedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` }));
}

export function buildTurn(spec: TurnSpec, conversationKey = "fixture"): InboundTurn {
  return {
    conversationKey,
    intakeRevision: spec.intakeRevision ?? 1,
    messages: syntheticMessages(spec.messages, "m"),
    recentMessages: syntheticMessages(spec.recentMessages ?? [], "r"),
    currentFacts: { ...emptyFacts(), ...spec.currentFacts },
    currentSummary: spec.currentSummary ?? "",
    lastQuestion: spec.lastQuestion ?? null,
  };
}

function loadDir<T>(dir: string): T[] {
  const full = join(FIXTURES_DIR, dir);
  return readdirSync(full)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(full, name), "utf8")) as T);
}

export const loadExtractionFixtures = () => loadDir<ExtractionFixture>("extraction");
export const loadOfflineFixtures = () => loadDir<OfflineFixture>("offline");
export const loadScenarios = () => loadDir<ScenarioFixture>("scenarios");
export const loadRuleCases = () =>
  (JSON.parse(readFileSync(join(FIXTURES_DIR, "rules", "cases.json"), "utf8")) as { cases: RuleCase[] }).cases;
