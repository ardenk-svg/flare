// LIVE evaluation: runs every fixture in fixtures/extraction and every
// scenario in fixtures/scenarios against real Gemini, checks the automated
// assertions, and writes a report to fixtures/results/. Usage:
//   npm run eval
//   npm run eval -- --only location-correction --no-write
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CallerMessage, ExtractionOutcome, InboundTurn } from "@flare/contracts";
import { createExtractor, DEFAULT_TIMEOUT_MS, type AttemptInfo } from "../extract.ts";
import { emptyFacts, mergeFacts } from "../facts.ts";
import { createGeminiGenerator } from "../gemini.ts";
import { checkExpectation, type Expectation } from "../eval/expect.ts";
import { FIXTURES_DIR, buildTurn, loadExtractionFixtures, loadScenarios } from "../eval/fixtures.ts";
import { requireGeminiConfig } from "./env.ts";

interface CaseRecord {
  id: string;
  covers: string[];
  messages: string[];
  ok: boolean;
  errorCode?: string;
  attempts: number;
  latencyMs: number;
  rejectedAttempts: string[][];
  failures: string[];
  result?: unknown;
}

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const write = !args.includes("--no-write");
const config = requireGeminiConfig();
const timeoutMs = Number(process.env.GEMINI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
const generate = createGeminiGenerator(config);
const modelVersions = new Set<string>();

async function runCase(id: string, covers: string[], turn: InboundTurn, expect: Expectation): Promise<{ record: CaseRecord; outcome: ExtractionOutcome }> {
  const attempts: AttemptInfo[] = [];
  const extract = createExtractor({ generate, timeoutMs, onAttempt: (a) => attempts.push(a) });
  const outcome = await extract(turn);
  attempts.forEach((a) => a.modelVersion && modelVersions.add(a.modelVersion));
  const failures = checkExpectation(expect, { outcome, turn, attempts: attempts.length });
  const record: CaseRecord = {
    id,
    covers,
    messages: turn.messages.map((m) => m.text),
    ok: outcome.ok,
    errorCode: outcome.ok ? undefined : outcome.error.code,
    attempts: attempts.length,
    latencyMs: Math.round(attempts.reduce((sum, a) => sum + a.latencyMs, 0)),
    rejectedAttempts: attempts.filter((a) => a.problems).map((a) => a.problems!),
    failures,
    result: outcome.ok ? outcome.result : outcome.error,
  };
  const mark = failures.length === 0 ? "PASS" : "FAIL";
  console.log(`${mark}  ${id.padEnd(34)} ${String(record.latencyMs).padStart(6)} ms  ${failures.join(" | ")}`);
  return { record, outcome };
}

const cases: CaseRecord[] = [];
for (const fixture of loadExtractionFixtures()) {
  if (only && fixture.id !== only) continue;
  cases.push((await runCase(fixture.id, fixture.covers, buildTurn(fixture.turn, `eval:${fixture.id}`), fixture.expect)).record);
}

// Scenario steps thread state the way the agent would after each accepted result.
const scenarioRecords: CaseRecord[] = [];
for (const scenario of loadScenarios()) {
  if (only && scenario.id !== only) continue;
  let facts = emptyFacts();
  let summary = "";
  let lastQuestion: string | null = null;
  let revision = 0;
  const recent: CallerMessage[] = [];
  for (const [index, step] of scenario.steps.entries()) {
    const messages = step.messages.map((text, i) => ({ id: `s${index + 1}-m${i + 1}`, text, receivedAt: new Date().toISOString() }));
    const turn: InboundTurn = {
      conversationKey: `eval:${scenario.id}`,
      intakeRevision: revision,
      messages,
      recentMessages: recent.slice(-10),
      currentFacts: facts,
      currentSummary: summary,
      lastQuestion,
    };
    const { record, outcome } = await runCase(`${scenario.id} step ${index + 1}`, ["scenario"], turn, step.expect);
    scenarioRecords.push(record);
    if (!outcome.ok) {
      console.log(`      ${scenario.id}: stopping after failed step ${index + 1}`);
      break;
    }
    const { result } = outcome;
    if (result.intent === "REPORT" || result.intent === "CORRECTION") {
      facts = mergeFacts(facts, result.patch);
      summary = result.summary;
      revision += 1;
    }
    if (result.proposedQuestion) lastQuestion = result.proposedQuestion;
    recent.push(...messages);
  }
}

const all = [...cases, ...scenarioRecords];
const passed = all.filter((c) => c.failures.length === 0).length;
const latencies = all.filter((c) => c.ok).map((c) => c.latencyMs).sort((a, b) => a - b);
const pct = (p: number) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] : 0);
const retried = all.filter((c) => c.rejectedAttempts.length > 0).length;
console.log(`\n${passed}/${all.length} passed | p50 ${pct(0.5)} ms | p95 ${pct(0.95)} ms | ${retried} needed a validation retry | model ${config.model} (${[...modelVersions].join(", ") || "?"})`);

if (write && !only) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = join(FIXTURES_DIR, "results", `${stamp}-${config.model.replace(/[^\w.-]/g, "_")}`);
  mkdirSync(join(FIXTURES_DIR, "results"), { recursive: true });
  const summary = {
    kind: "LIVE Gemini extraction evaluation",
    ranAt: new Date().toISOString(),
    geminiModel: config.model,
    modelVersions: [...modelVersions],
    thinkingLevel: config.thinkingLevel ?? null,
    timeoutMs,
    fixtureCount: cases.length,
    scenarioSteps: scenarioRecords.length,
    passed,
    total: all.length,
    latencyMs: { p50: pct(0.5), p95: pct(0.95), max: latencies.at(-1) ?? 0 },
    validationRetries: retried,
  };
  writeFileSync(`${base}.json`, JSON.stringify({ summary, cases, scenario: scenarioRecords }, null, 2) + "\n");
  const row = (c: CaseRecord) =>
    `| ${c.id} | ${c.ok ? "ok" : c.errorCode} | ${c.attempts} | ${c.latencyMs} | ${c.failures.length ? c.failures.join("<br>") : "PASS"} |`;
  const review = (c: CaseRecord) => {
    const r = c.result as { summary?: string; proposedQuestion?: string | null };
    return `- **${c.id}** — summary: ${JSON.stringify(r?.summary ?? null)}; question: ${JSON.stringify(r?.proposedQuestion ?? null)}`;
  };
  writeFileSync(
    `${base}.md`,
    [
      `# LIVE Gemini extraction evaluation`,
      ``,
      `- Ran: ${summary.ranAt}`,
      `- GEMINI_MODEL: \`${config.model}\` (reported modelVersion: ${summary.modelVersions.join(", ") || "not reported"})`,
      `- Automated assertions: **${passed}/${all.length} passed** (${cases.length} fixtures + ${scenarioRecords.length} demo scenario steps)`,
      `- Latency per turn (incl. validation retries): p50 ${summary.latencyMs.p50} ms, p95 ${summary.latencyMs.p95} ms, max ${summary.latencyMs.max} ms`,
      `- Turns needing a validation retry: ${retried}`,
      ``,
      `## Fixtures`,
      ``,
      `| Fixture | Outcome | Attempts | ms | Assertions |`,
      `|---|---|---|---|---|`,
      ...cases.map(row),
      ``,
      `## Demo scenario (threaded)`,
      ``,
      `| Step | Outcome | Attempts | ms | Assertions |`,
      `|---|---|---|---|---|`,
      ...scenarioRecords.map(row),
      ``,
      `## For human judgment (not automatically asserted)`,
      ``,
      `Summary faithfulness and question quality. Reviewer: _not yet reviewed_.`,
      ``,
      ...all.filter((c) => c.ok).map(review),
      ``,
    ].join("\n"),
  );
  console.log(`report written: ${base}.md`);
}
if (passed !== all.length) process.exitCode = 1;
