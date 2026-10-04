// Automated assertions for fixtures. Summary wording and question tone are
// left for human judgment and are reported, not asserted, except for the
// explicit regex checks below.

import type { CallerFactField, CallerFacts, ExtractionErrorCode, ExtractionOutcome, InboundTurn, Intent } from "@flare/contracts";
import { mergeFacts } from "../facts.ts";
import { recommendServices } from "../rules.ts";

type FactMatcher =
  | "absent" // patch omits the field (retain stored value)
  | "unknown" // patch omits it or sets null; on merged facts: null
  | "cleared" // patch explicitly sets null
  | "set" // non-null value
  | { is: string | number | boolean }
  | { contains?: string[]; notContains?: string[] };

export interface Expectation {
  intent?: Intent;
  patch?: Partial<Record<CallerFactField, FactMatcher>>;
  merged?: Partial<Record<CallerFactField, FactMatcher>>;
  patchEmpty?: boolean;
  corrections?: { includes?: CallerFactField[]; excludes?: CallerFactField[] };
  unresolved?: { includes?: CallerFactField[] };
  /** field → messageId; "current" means the last new message in the turn. */
  evidence?: Partial<Record<CallerFactField, string>>;
  question?: { null?: boolean; match?: string; notMatch?: string };
  summaryNotMatch?: string;
  recommendation?: { services: string[]; ruleIds?: string[] };
  resultKeysExactly?: boolean;
  attempts?: number;
  errorCode?: ExtractionErrorCode;
  retryable?: boolean;
  messageNotMatch?: string;
}

const RESULT_KEYS = ["corrections", "evidence", "intent", "patch", "proposedQuestion", "questionField", "summary", "unresolvedFields"];

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
}

function checkFact(label: string, matcher: FactMatcher, present: boolean, value: unknown): string | null {
  const show = present ? JSON.stringify(value) : "(omitted)";
  if (matcher === "absent") return present ? `${label}: expected omitted, got ${show}` : null;
  if (matcher === "unknown") return present && value !== null ? `${label}: expected unknown, got ${show}` : null;
  if (matcher === "cleared") return present && value === null ? null : `${label}: expected explicit null, got ${show}`;
  if (matcher === "set") return present && value !== null ? null : `${label}: expected a value, got ${show}`;
  if ("is" in matcher) return present && value === matcher.is ? null : `${label}: expected ${JSON.stringify(matcher.is)}, got ${show}`;
  if (typeof value !== "string") return `${label}: expected text, got ${show}`;
  const lower = value.toLowerCase();
  const missing = (matcher.contains ?? []).filter((s) => !lower.includes(s.toLowerCase()));
  const forbidden = (matcher.notContains ?? []).filter((s) => lower.includes(s.toLowerCase()));
  if (missing.length) return `${label}: ${show} is missing ${missing.join(", ")}`;
  if (forbidden.length) return `${label}: ${show} should not contain ${forbidden.join(", ")}`;
  return null;
}

export interface CheckContext {
  outcome: ExtractionOutcome;
  turn: InboundTurn;
  attempts?: number;
}

/** Returns failed assertions; an empty list means every assertion passed. */
export function checkExpectation(expect: Expectation, { outcome, turn, attempts }: CheckContext): string[] {
  const failures: string[] = [];
  const add = (failure: string | null) => failure && failures.push(failure);

  if (expect.errorCode) {
    if (outcome.ok) return [`expected ${expect.errorCode} failure, got success`];
    add(outcome.error.code === expect.errorCode ? null : `expected ${expect.errorCode}, got ${outcome.error.code}`);
    if (expect.retryable !== undefined && outcome.error.retryable !== expect.retryable) add(`expected retryable=${expect.retryable}`);
    if (expect.messageNotMatch && new RegExp(expect.messageNotMatch, "i").test(outcome.error.message)) add("error message leaks forbidden text");
    return failures;
  }
  if (!outcome.ok) return [`expected success, got ${outcome.error.code}: ${outcome.error.message}`];

  const { result } = outcome;
  const merged: CallerFacts = mergeFacts(turn.currentFacts, result.patch);

  if (expect.intent && result.intent !== expect.intent) add(`intent: expected ${expect.intent}, got ${result.intent}`);
  for (const [field, matcher] of Object.entries(expect.patch ?? {}) as [CallerFactField, FactMatcher][]) {
    add(checkFact(`patch.${field}`, matcher, Object.hasOwn(result.patch, field), result.patch[field]));
  }
  for (const [field, matcher] of Object.entries(expect.merged ?? {}) as [CallerFactField, FactMatcher][]) {
    add(checkFact(`merged.${field}`, matcher, true, merged[field]));
  }
  if (expect.patchEmpty && Object.keys(result.patch).length > 0) add(`expected empty patch, got ${JSON.stringify(result.patch)}`);
  for (const field of expect.corrections?.includes ?? []) {
    if (!result.corrections.includes(field)) add(`corrections should include ${field}`);
  }
  for (const field of expect.corrections?.excludes ?? []) {
    if (result.corrections.includes(field)) add(`corrections should not include ${field}`);
  }
  for (const field of expect.unresolved?.includes ?? []) {
    if (!result.unresolvedFields.includes(field)) add(`unresolvedFields should include ${field}`);
  }
  for (const [field, id] of Object.entries(expect.evidence ?? {}) as [CallerFactField, string][]) {
    const expectedId = id === "current" ? turn.messages[turn.messages.length - 1].id : id;
    const found = result.evidence.find((e) => e.field === field);
    if (!found) add(`evidence missing for ${field}`);
    else if (found.messageId !== expectedId) add(`evidence for ${field} cites ${found.messageId}, expected ${expectedId}`);
  }
  // Every patched field must carry evidence (the validator guarantees this; assert anyway).
  for (const field of Object.keys(result.patch) as CallerFactField[]) {
    if (!result.evidence.some((e) => e.field === field)) add(`patched field ${field} has no evidence`);
  }
  const q = result.proposedQuestion;
  if (expect.question?.null && q !== null) add(`expected no question, got ${JSON.stringify(q)}`);
  if (expect.question?.match && !(q && new RegExp(expect.question.match, "i").test(q))) add(`question ${JSON.stringify(q)} should match /${expect.question.match}/`);
  if (expect.question?.notMatch && q && new RegExp(expect.question.notMatch, "i").test(q)) add(`question ${JSON.stringify(q)} should not match /${expect.question.notMatch}/`);
  if (expect.summaryNotMatch && new RegExp(expect.summaryNotMatch, "i").test(result.summary)) add(`summary should not match /${expect.summaryNotMatch}/`);
  if (expect.recommendation) {
    const rec = recommendServices(merged);
    if (!sameSet(rec.services, expect.recommendation.services)) add(`recommendation: expected [${expect.recommendation.services}], got [${rec.services}]`);
    if (expect.recommendation.ruleIds && !sameSet(rec.ruleIds, expect.recommendation.ruleIds)) add(`ruleIds: expected [${expect.recommendation.ruleIds}], got [${rec.ruleIds}]`);
  }
  if (expect.resultKeysExactly && !sameSet(Object.keys(result), RESULT_KEYS)) add(`result keys ${Object.keys(result)} are not the contract keys`);
  if (expect.attempts !== undefined && attempts !== expect.attempts) add(`expected ${expect.attempts} attempts, got ${attempts}`);
  return failures;
}
