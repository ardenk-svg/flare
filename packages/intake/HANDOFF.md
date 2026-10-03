# @flare/intake handoff (Person 2)

Gemini caller-fact extraction (`extractTurn`) and the synthetic demo recommendation rules (`recommendServices`) from [docs/CONTRACT.md](../../docs/CONTRACT.md). This package does not send messages, write the database, assign units, or produce status.

## Status (2026-10-03)

| Check | Result |
|---|---|
| `npm run typecheck` | Passes (TypeScript 7.0.2, strict) |
| `npm test` (offline, no network) | 39/39 pass: 13 rule cases, merge/quote checks, 15 canned-output contract fixtures |
| Real network path | Key/model discovery and a structured-output smoke extraction passed against Google |
| **Live Gemini extraction** | **20/20 passed** on `gemini-3.5-flash-lite`: 16 fixtures plus 4 threaded demo steps, p50 1101 ms and p95 2594 ms |

The lowest-priced legacy model listed for this key returned 404 for generation, and `gemini-3.1-flash-lite` produced intermittent 503s during sustained evaluation. The selected `gemini-3.5-flash-lite` model was reliable and substantially faster. The final evaluation was paced at 5000 ms between case starts to stay below the observed request quota. The report is [2026-10-03T21-48-23-gemini-3.5-flash-lite.md](../../fixtures/results/2026-10-03T21-48-23-gemini-3.5-flash-lite.md).

## Setup

Requires Node ≥ 22.18. Built and tested on Node 24.21.0. The source is erasable-only TypeScript and runs directly on Node; no tsx or build step is needed.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck --workspace @flare/intake
npm test --workspace @flare/intake             # OFFLINE contract checks
npm run models --workspace @flare/intake        # LIVE: list available Flash models
npm run smoke --workspace @flare/intake         # LIVE: one real extraction
npm run eval --workspace @flare/intake          # LIVE: fixtures + threaded demo
npm run eval --workspace @flare/intake -- --only location-correction --no-write
```

The CLIs read `.env` from the repo root or `packages/intake/.env` if one exists. Real environment variables take precedence.

| Variable | Required | Meaning |
|---|---|---|
| `GEMINI_API_KEY` | yes | Gemini API key (local only) |
| `GEMINI_MODEL` | yes | Tested stable Flash model ID. There is no built-in default; pick one from `npm run models`. On 2026-10-03 the [models page](https://ai.google.dev/gemini-api/docs/models) listed `gemini-3.x-flash` IDs as stable. |
| `GEMINI_TIMEOUT_MS` | no | Deadline per model attempt (default 15000) |
| `GEMINI_THINKING_LEVEL` | no | e.g. `LOW`/`MINIMAL`, only if the chosen model supports thinking levels (latency tuning) |
| `GEMINI_EVAL_DELAY_MS` | no | Minimum delay between live evaluation case starts; 5000 ms was used for the committed report |

The names and tested non-secret defaults are present in the root `.env.example`.

## Interface (for Person 1)

```ts
import { extractTurn, recommendServices, mergeFacts } from "@flare/intake";

const outcome = await extractTurn(turn);                 // InboundTurn from CONTRACT.md
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
- `conversationKey` is never sent to Gemini.
- Suggestion: if there is no active incident and a `REPORT` comes back with an empty patch, complete it without a patch rather than creating an all-null incident.
- `unresolvedFields` lists fields the caller left uncertain, such as an "I don't know" answer. Use it to avoid asking the same question again.

## Behaviour guaranteed by validation (not by the prompt)

Gemini returns a `changes` list. Each change names one fact field, a kind (`TRUE`/`FALSE`/`UNKNOWN`/`TEXT`/`COUNT`), a `messageId` and a verbatim `quote`. The validator builds the contract `ExtractionResult` from scratch, so no other model keys reach the result:

- Field names are limited to the 9 caller facts. Lifecycle or assignment keys are dropped, and an unknown change field is rejected.
- Values are type-checked with no coercion: a boolean field needs `TRUE`/`FALSE`/`UNKNOWN`, `peopleInvolved` needs a non-negative integer, and text must be non-empty.
- Every changed fact, including a change to `null`, must cite one of this turn's **new** messages. The structured-output schema restricts `messageId` to those IDs, and the validator checks again. Its quote must appear in that message; matching ignores case and curly-vs-straight quote marks, and the stored quote is the exact source text.
- Restating the stored value is dropped from the patch and needs no evidence.
- `STATUS_QUERY`/`OTHER` with fact changes is rejected. `STATUS_QUERY` always returns `proposedQuestion: null`.
- `corrections` is calculated, not taken from the model: it lists changed fields whose prior value was non-null.
- `unresolvedFields` is filtered to fields that are still null after the merge.
- Output that fails validation is re-asked once (2 attempts total), then becomes `INVALID_OUTPUT` with `retryable: true`. Provider errors are not retried here, and SDK retries are disabled (`attempts: 1`) so that Person 1's loop controls retries and latency stays bounded.

Error mapping: our deadline, 408 or 504 → `TIMEOUT`; 429 → `RATE_LIMIT`; 5xx or network → retryable `PROVIDER_ERROR`; 400, 401, 403 or 404 → non-retryable `PROVIDER_ERROR`. Messages never include raw provider text.

## Contract notes for Person 3

1. `src/contract-types.ts` is a temporary copy of the CONTRACT types. Replace it with re-exports from `@flare/contracts` once that package exists.
2. Interpretation choices that should be confirmed or written into CONTRACT.md:
   - Evidence may cite only `messages`, not `recentMessages`.
   - `corrections` is calculated as described above.
   - Restated values are dropped from the patch.
   - An empty `messages` array returns `INVALID_OUTPUT` with `retryable: false`, because the contract has no input-error code.

## Notes for Person 1 (root workspace)

- The package is `@flare/intake`, and `exports` points to `./src/index.ts`. Consumers run on Node ≥ 22.18, which strips types natively and also works through workspace symlinks, or under tsx.
- Pinned dependencies: `@google/genai@2.27.0`, plus dev dependencies `typescript@7.0.2` and `@types/node@24.19.1`. Align these with the root versions when you reconcile the lockfile. `package-lock.json` is ignored in this package so it does not compete with the root lockfile.

## Fixtures and remaining work

See [fixtures/README.md](../../fixtures/README.md). There are 16 live extraction fixtures, a 4-step threaded demo scenario, 15 offline canned-output fixtures and 13 rule cases.

Open items:
- [x] Run the live checks: models, smoke, eval. Commit the report and record the model, pass rate and p50/p95 latency here.
- [x] Tune the prompt for the live correction, uncertainty, explicit fire/smoke, and no-inferred-injury cases.
- [ ] Human review of summaries and questions in the eval report.
- [ ] Integrate with Person 1's agent and run the full loop. Then complete the acceptance checklist in [docs/DEMO.md](../../docs/DEMO.md).
