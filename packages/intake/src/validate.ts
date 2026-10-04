// Runtime validation of raw model output against the trusted turn. Nothing in
// the model's JSON reaches the result unless it is checked here; unknown keys
// (for example lifecycle or assignment fields) are never copied through.

import {
  INTENTS,
  type CallerFactField,
  type CallerFactPatch,
  type Evidence,
  type ExtractionResult,
  type InboundTurn,
  type Intent,
} from "@flare/contracts";
import { CALLER_FACT_KINDS, isCallerFactField, mergeFacts } from "./facts.ts";
import { CHANGE_KINDS, type ChangeKind } from "./prompt.ts";

const MAX_SUMMARY = 1000;
const MAX_QUESTION = 300;
const MAX_TEXT_VALUE = 300;

export type ValidationOutcome =
  | { ok: true; result: ExtractionResult }
  | { ok: false; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Length-preserving normalization so a match index maps back onto the source.
function foldForMatch(text: string): string {
  return text.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** Returns the exact source span the quote refers to, or null if unsupported. */
export function locateQuote(source: string, quote: string): string | null {
  const q = quote.trim();
  if (q.length === 0) return null;
  if (source.includes(q)) return q;
  const foldedSource = foldForMatch(source);
  const foldedQuote = foldForMatch(q);
  if (foldedSource.length !== source.length || foldedQuote.length !== q.length) return null;
  const at = foldedSource.indexOf(foldedQuote);
  return at === -1 ? null : source.slice(at, at + q.length);
}

function decodeValue(field: CallerFactField, change: Record<string, unknown>, kind: ChangeKind): { ok: true; value: unknown } | { ok: false; why: string } {
  if (kind === "UNKNOWN") return { ok: true, value: null };
  const factKind = CALLER_FACT_KINDS[field];
  if (factKind === "bool") {
    if (kind === "TRUE") return { ok: true, value: true };
    if (kind === "FALSE") return { ok: true, value: false };
  } else if (factKind === "text" && kind === "TEXT") {
    const text = typeof change.text === "string" ? change.text.trim() : "";
    if (text.length === 0) return { ok: false, why: "TEXT change has empty text" };
    if (text.length > MAX_TEXT_VALUE) return { ok: false, why: "TEXT value too long" };
    return { ok: true, value: text };
  } else if (factKind === "count" && kind === "COUNT") {
    const count = change.count;
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) return { ok: true, value: count };
    return { ok: false, why: "COUNT change needs a non-negative integer count" };
  }
  return { ok: false, why: `kind ${kind} is not valid for a ${factKind} field` };
}

export function validateModelOutput(rawText: string | undefined, turn: InboundTurn): ValidationOutcome {
  if (!rawText || rawText.trim().length === 0) return { ok: false, problems: ["empty model response"] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, problems: ["model response is not valid JSON"] };
  }
  if (!isRecord(parsed)) return { ok: false, problems: ["model response is not a JSON object"] };

  const problems: string[] = [];

  const intent = parsed.intent as Intent;
  if (!INTENTS.includes(intent)) problems.push(`invalid intent ${JSON.stringify(parsed.intent)}`);

  if (!Array.isArray(parsed.changes)) problems.push("changes is not an array");
  const rawChanges: unknown[] = Array.isArray(parsed.changes) ? parsed.changes : [];

  const messagesById = new Map(turn.messages.map((m) => [m.id, m]));
  const patch: CallerFactPatch = {};
  const evidence: Evidence[] = [];
  const seen = new Set<CallerFactField>();

  rawChanges.forEach((change, i) => {
    const where = `changes[${i}]`;
    if (!isRecord(change)) return void problems.push(`${where} is not an object`);
    const field = change.field;
    if (!isCallerFactField(field)) return void problems.push(`${where} has unknown field ${JSON.stringify(field)}`);
    if (seen.has(field)) return void problems.push(`${where} repeats field ${field}`);
    seen.add(field);

    const kind = change.kind as ChangeKind;
    if (!CHANGE_KINDS.includes(kind)) return void problems.push(`${where} has invalid kind ${JSON.stringify(change.kind)}`);
    const decoded = decodeValue(field, change, kind);
    if (!decoded.ok) return void problems.push(`${where} (${field}): ${decoded.why}`);

    // A restatement of the stored value is not a change and needs no evidence.
    if (decoded.value === turn.currentFacts[field]) return;

    const messageId = change.messageId;
    const source = typeof messageId === "string" ? messagesById.get(messageId) : undefined;
    if (!source) return void problems.push(`${where} (${field}) cites a message id that is not in this turn`);
    const quote = typeof change.quote === "string" ? locateQuote(source.text, change.quote) : null;
    if (quote === null) return void problems.push(`${where} (${field}) quote does not appear in message ${source.id}`);

    (patch as Record<CallerFactField, unknown>)[field] = decoded.value;
    evidence.push({ field, messageId: source.id, quote });
  });

  const changedFields = Object.keys(patch) as CallerFactField[];
  if ((intent === "STATUS_QUERY" || intent === "OTHER") && changedFields.length > 0) {
    problems.push(`${intent} must not change facts (got ${changedFields.join(", ")})`);
  }

  const informational = intent === "STATUS_QUERY" || intent === "OTHER";
  let summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (summary.length === 0 && informational) summary = turn.currentSummary;
  if (summary.length === 0 && !informational) problems.push("summary is empty");
  if (summary.length > MAX_SUMMARY) problems.push("summary is too long");

  let proposedQuestion: string | null = null;
  if (typeof parsed.proposedQuestion === "string" && parsed.proposedQuestion.trim().length > 0) {
    proposedQuestion = parsed.proposedQuestion.trim();
    if (proposedQuestion.length > MAX_QUESTION) problems.push("proposedQuestion is too long");
  } else if (parsed.proposedQuestion !== undefined && parsed.proposedQuestion !== null && typeof parsed.proposedQuestion !== "string") {
    problems.push("proposedQuestion is not a string");
  }
  if (parsed.questionField !== undefined && parsed.questionField !== '' && !isCallerFactField(parsed.questionField)) problems.push('questionField is not a caller fact field');
  // Status replies come from committed state, not a model question.
  if (intent === "STATUS_QUERY") proposedQuestion = null;

  if (problems.length > 0) return { ok: false, problems };

  const merged = mergeFacts(turn.currentFacts, patch);
  const unresolvedFields = informational
    ? []
    : [...new Set((Array.isArray(parsed.unresolvedFields) ? parsed.unresolvedFields : []).filter(isCallerFactField))].filter(
        (field) => merged[field] === null,
      );
  // A correction is any accepted change that replaces a previous non-null claim.
  const corrections = changedFields.filter((field) => turn.currentFacts[field] !== null);

  return {
    ok: true,
    result: { intent, patch, summary, evidence, corrections, unresolvedFields, proposedQuestion,
      questionField: isCallerFactField(parsed.questionField) ? parsed.questionField : null },
  };
}
