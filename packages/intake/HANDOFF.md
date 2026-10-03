# @flare/intake handoff (Person 2)

Gemini caller-fact extraction (`extractTurn`) and the synthetic demo recommendation rules (`recommendServices`) from [docs/CONTRACT.md](../../docs/CONTRACT.md). This package does not send messages, write the database, assign units, or produce status.

## Status (2026-10-03, branch `person2/live-gemini-contracts`)

| Check | Result |
|---|---|
| Shared types | No local copy remains. Types, `emptyFacts`, `mergeFacts`, `CALLER_FACT_FIELDS`, `CALLER_FACT_KINDS`, `INTENTS` and `NO_RULE_REASON` all come from `@flare/contracts`. `test/contracts.test.ts` checks that `extractTurn`/`recommendServices` are assignable to the shared `ExtractTurn`/`RecommendServices` types and that the re-exported helpers are the shared functions themselves. |
| `npm run typecheck --workspace @flare/intake` | Passes (TypeScript 6.0.3, strict). A deliberately wrong assignment was confirmed to fail it. |
| `npm test --workspace @flare/intake` (offline) | 45/45 pass: 13 rule cases, merge/quote checks, 15 canned-output fixtures, 6 shared-contract and invalid-configuration checks |
| Invalid configuration | No key returns `PROVIDER_ERROR` "GEMINI_API_KEY is not set" with `retryable: false`. A real request with an invalid key returns non-retryable `PROVIDER_ERROR` in about 100 ms. Neither changes the input facts (tested). |
| **Live Gemini extraction** | **Not run.** The team has decided to hold back the shared key until deploy, so Gemini has not yet accepted the response schema and there are no live fixture results. This blocks the NEXT_STEPS "done" conditions for live proof. |

## Setup

Use the root workspace, with Node ≥ 22.18; tested on Node 24.21.0. The source is erasable-only TypeScript. It runs directly on Node, including the linked `@flare/contracts` source, with no tsx or build step.

```sh
# from the repo root
npm ci                                   # once Person 1 has regenerated the lockfile for this manifest
npm run typecheck --workspace @flare/intake
npm test --workspace @flare/intake       # OFFLINE, no key needed

# LIVE (needs GEMINI_API_KEY + GEMINI_MODEL), from packages/intake
npm run models                           # list Flash models the key can call
npm run smoke                            # one real extraction of demo step 1
npm run smoke -- "Simulation: smoke at the north entrance of the demo library"
npm run eval                             # all fixtures + threaded demo → fixtures/results/<time>-<model>.{md,json}
npm run eval -- --only location-correction --no-write
```

The CLIs read the root `.env` (the same file the agent uses) and then `packages/intake/.env`. Both are gitignored, and real environment variables take precedence. Names are listed in the root `.env.example`.

| Variable | Required | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | yes | Gemini API key (local only) |
| `GEMINI_MODEL` | yes | Tested stable Flash model ID. There is no built-in default; pick one from `npm run models`. On 2026-10-03 the [models page](https://ai.google.dev/gemini-api/docs/models) listed `gemini-3.x-flash` IDs as stable. |
| `GEMINI_TIMEOUT_MS` | no | Deadline per model attempt (default 15000) |
| `GEMINI_THINKING_LEVEL` | no | e.g. `LOW`/`MINIMAL`, only if the chosen model supports thinking levels |

## Interface (for Person 1)

Add `"@flare/intake": "file:../../packages/intake"` to the agent package.

```ts
import { mergeFacts, type InboundTurn } from "@flare/contracts";
import { extractTurn, recommendServices } from "@flare/intake";

const outcome = await extractTurn(turn);                 // InboundTurn from @flare/contracts
if (!outcome.ok) {
  // { code: TIMEOUT|RATE_LIMIT|INVALID_OUTPUT|PROVIDER_ERROR, message (sanitized), retryable }
  // → recordExtractionFailure; leave messages RECEIVED; facts untouched.
} else if (outcome.result.intent === "STATUS_QUERY" || outcome.result.intent === "OTHER") {
  // patch is guaranteed empty → completeInboundWithoutPatch; answer status from committed state.
} else {
  const merged = mergeFacts(turn.currentFacts, outcome.result.patch);
  const recommendation = recommendServices(merged);      // pure; never from the model
  // → applyIntakePatch(expected intakeRevision, source IDs, patch, evidence, summary, recommendation)
}
```

- `extractTurn` reads its configuration from env on the first call. Missing configuration returns a non-retryable `PROVIDER_ERROR` and does not throw. Use `createExtractor({ generate, timeoutMs, maxAttempts, onAttempt })` for an injected or fake model, or for latency logging. `onAttempt` never receives caller text.
- `conversationKey` is never sent to Gemini. Only the turn's messages, prior message text, facts, summary and last question are sent.
- Build each `InboundTurn` from the **current intake session only** (NEXT_STEPS decision 2). The extractor trusts whatever `recentMessages` and `currentFacts` it is given.
- Suggestion: if there is no active incident and a `REPORT` comes back with an empty patch, complete it without a patch rather than creating an all-null incident.
- `unresolvedFields` lists fields the caller left uncertain, such as an "I don't know" answer. Use it to avoid asking the same question again.

## Behaviour guaranteed by validation (not by the prompt)

Gemini returns a `changes` list. Each change names one fact field, a kind (`TRUE`/`FALSE`/`UNKNOWN`/`TEXT`/`COUNT`), a `messageId` and a verbatim `quote`. The validator builds the contract `ExtractionResult` from scratch, so no other model keys reach the result:

- Field names are limited to the 9 shared caller facts. Lifecycle or assignment keys are dropped, and an unknown change field is rejected.
- Values are type-checked against `CALLER_FACT_KINDS` with no coercion.
- Every changed fact, including a change to `null`, must cite one of this turn's **new** messages. The structured-output schema restricts `messageId` to those IDs, and the validator checks again. Its quote must appear in that message; matching ignores case and curly-vs-straight quote marks, and the stored quote is the exact source text.
- Restating the stored value is dropped from the patch and needs no evidence.
- `STATUS_QUERY`/`OTHER` with fact changes is rejected. `STATUS_QUERY` always returns `proposedQuestion: null`.
- `corrections` is calculated, not taken from the model: it lists changed fields whose prior value was non-null.
- `unresolvedFields` is filtered to fields that are still null after the merge.
- Output that fails validation is re-asked once (2 attempts total), then becomes `INVALID_OUTPUT` with `retryable: true`. Provider errors are not retried here, and SDK retries are disabled so the agent controls retries.

Error mapping: our deadline, 408 or 504 → `TIMEOUT`; 429 → `RATE_LIMIT`; 5xx or network → retryable `PROVIDER_ERROR`; 400, 401, 403 or 404 → non-retryable `PROVIDER_ERROR`. Messages never include raw provider text.

## Contract notes for Person 3

These interpretation choices should be confirmed or written into CONTRACT.md:

- Evidence may cite only `messages`, not `recentMessages`.
- `corrections` is calculated as described above.
- Restated values are dropped from the patch.
- An empty `messages` array returns `INVALID_OUTPUT` with `retryable: false`, because the contract has no input-error code.
- The contract's failure payload has no exported name, so intake exports it as `ExtractionError`, derived from `ExtractionOutcome`. Exporting it from `@flare/contracts` would let the agent use the same name.

## Manifest change (for Person 1's lockfile pass)

`packages/intake/package.json`:
- Adds `"@flare/contracts": "file:../contracts"`.
- Aligns dev dependencies with the root: `typescript` `7.0.2` → `^6.0.3`, `@types/node` `24.19.1` → `^26.6.4`.
- `@google/genai` stays pinned at `2.27.0`.

The root `package-lock.json` was **not** modified. Local verification used `npm install --no-package-lock`.

## Fixtures

See [fixtures/README.md](../../fixtures/README.md). There are 16 live extraction fixtures, a 4-step threaded demo scenario, 15 offline canned-output fixtures and 13 rule cases.

## Remaining (needs the real key)

- [ ] `npm run models`, then set `GEMINI_MODEL`.
- [ ] `npm run smoke` passes. This is the first proof that Gemini accepts the response schema.
- [ ] `npm run eval`. Commit `fixtures/results/*.md`/`.json` and record here the model ID, fixture count, pass rate, p50/p95 latency and the correction/uncertainty results.
- [ ] Human review of `location-correction`, `dont-know-answer`, `uncertain-trapped` and the demo scenario in the eval report.
- [ ] Prompt tuning for any live failures. Re-run the eval after each change.
