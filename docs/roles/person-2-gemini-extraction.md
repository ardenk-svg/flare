# Person 2 — Gemini extraction, demo rules, and evaluation

**Mission:** Turn an evolving caller conversation into validated, traceable facts for Flare. After extraction works, coordinate the acceptance checklist and judging demo. This document describes planned work; it does not assert that integrations or tests already exist.

Read [the shared handoff](../../handoff.md), [the contract](../CONTRACT.md), and this role document before coding. The shared contract is authoritative when examples or prompts differ. All four teammates have equal experience; this role is one workstream in the same ten-hour build.

## Ownership and boundaries

You own `packages/intake/`, `fixtures/`, and `docs/DEMO.md`. Read the entire repository for context. Coordinate shared types with Person 3 and dependency/lockfile changes with Person 1. Do not independently change `packages/contracts/`, database schemas, or root configuration.

- **Person 1:** Supplies ordered messages and persisted context; calls your module; applies accepted updates and sends messages.
- **Person 3:** Owns exact shared types, validation boundaries, revision checks, and database writes.
- **Person 4:** Displays extracted facts, evidence, uncertainty, and extraction failures.

Your module does not send iMessages, write database records, decide assignments, or generate operational status. It interprets caller reports and computes explicitly simulated recommendations.

## Deliverables and checkpoints

| Time | Your checkpoint |
|---|---|
| 0:00–0:30 | Confirm Gemini API access, agree field semantics with Person 3, and select a currently available stable Flash model through `GEMINI_MODEL`. |
| 0:30–1:30 | Merge one real, validated extraction call plus a runnable fixture example. Give Person 1 the command and interface immediately. |
| 1:30–3:00 | Integrate extraction and pure recommendation rules into the complete live loop. Help fix the broken boundary if the loop is incomplete. |
| 3:00–5:00 | Add correction/uncertainty cases, failure handling, and a compact evaluation report; run the cross-system checklist. |
| 5:00–7:00 | Refine evidence and question quality; document the practiced scenario in `docs/DEMO.md`. |
| 7:00–10:00 | Freeze features, repeat live runs, capture a working backup video, and rehearse a 90-second demo. |

Use small branches and reviewable PRs throughout. Keep `packages/intake/HANDOFF.md` current with commands, required environment-variable names, exported interfaces, measured results, and remaining failures. Never include secret values.

## Interfaces and extraction behavior

Implement the application interfaces `extractTurn(InboundTurn)` and `recommendServices(mergedFacts)` exactly as specified in [CONTRACT.md](../CONTRACT.md). These names describe our application, not Gemini SDK methods.

Input contains trusted message IDs, ordered text, current caller facts, prior questions, and the expected revision. Output includes the contracted intent (`REPORT`, `CORRECTION`, `STATUS_QUERY`, or `OTHER`), fact patch, summary, evidence, unresolved fields, and at most one suggested clarification. Follow the contract's exact field names and return types.

Extract only caller-supported facts. Preserve these meanings:

- **Omitted field:** No new information; retain the previous value.
- **`null`:** Explicitly unknown or unresolved.
- **`false`:** Explicit denial, never an inference from silence.

“I don't know whether anyone is inside” does not establish `trappedPerson: false`. “Actually, the south entrance” replaces the location on the same incident while retaining unrelated facts. A status question must not invent a fresh report or operational state.

Use `@google/genai`, structured output, and runtime validation. Verify the configured model with a real request and record the tested model/version. Validate evidence against supplied IDs and original text; model-produced IDs or plausible quotes are insufficient. Treat caller text as untrusted content, including instructions to change the output format. Do not infer coordinates or medical assessments from prose.

Keep `recommendServices` separate from extraction. Implement only the team's agreed demonstration rules, using merged facts and the contract's rule IDs/reasons. Do not add hidden severity scores or clinical triage rules. Person 1 merges validated facts before requesting recommendations; Person 3 preserves dispatcher-confirmed choices separately.

## Acceptance and failure handling

Maintain roughly 12–15 synthetic fixtures covering incomplete reports, explicit negatives, uncertainty, corrections, contradictions, status requests, unsupported evidence, instruction injection, malformed output, and API failure. Check rule results separately from extraction. Record actual outcomes, latency, model, and fixture count; distinguish automated assertions from human judgments.

On timeout, rate limit, invalid output, or failed evidence validation, return the contracted failure result. Preserve last verified facts and expose retry/manual-review needs through Person 1. Do not silently substitute a successful fixture response. Keep any development replay visibly labelled.

Your completion check is a real caller correction updating the existing subscribed incident, supported by evidence, while an API failure leaves verified state intact. The whole-team demo also requires actual Spectrum/iMessage traffic and committed responder status returning to the caller.

## Copy-paste Claude starter prompt

```text
We are four equally experienced teammates building Flare in 10 hours for
MHacks. It is a simulation: Spectrum/iMessage → Gemini fact extraction →
SpacetimeDB shared state → human dispatcher → responder → iMessage update.

Read CLAUDE.md, handoff.md, docs/CONTRACT.md, and
docs/roles/person-2-gemini-extraction.md. You are helping Person 2. Own
packages/intake, fixtures, and docs/DEMO.md. Read broadly; coordinate shared
types with Person 3 and root dependencies with Person 1. Follow the checked-in
contract rather than inventing SDK methods or parallel interfaces.

First deliver one real @google/genai structured-output call, runtime
validation, and a runnable fixture within 45 minutes. Select a currently
available stable Flash model through GEMINI_MODEL; verify API access early.
Implement extractTurn(InboundTurn) and recommendServices(mergedFacts) using
the contract. Missing fields retain values, null means unknown, and false
requires explicit denial. Validate evidence against trusted source messages.
Keep recommendations in pure demo rules, separate from model output. Never
generate assignments, backend status, or inferred coordinates.

Integrate with Person 1 by hour 3. Cover uncertainty, negation, corrections,
status queries, invalid evidence, instruction injection, and API failures.
Preserve verified facts on failure. Record actual results and limitations.
Then own the acceptance checklist and 90-second demo. Work in small PRs,
keep packages/intake/HANDOFF.md current, and keep secrets out of the repo.
All screens and outbound reports must clearly describe a simulation.
```

## Official references

- [Gemini SDK libraries](https://ai.google.dev/gemini-api/docs/libraries)
- [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- [Available Gemini models](https://ai.google.dev/gemini-api/docs/models)
