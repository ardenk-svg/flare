# Flare integration execution plan

Created October 3, 2026 from the implementation review of `40ba4be`, against current `main` at `0a167ca`. This is the active work board until the complete live loop passes. The priority is integration and repeatability; do not add presentation features before the final gate.

## Target outcome

One real iMessage report must pass through Gemini and SpacetimeDB, update both authorized browser roles, produce a committed responder update back to the same iMessage conversation, answer a status query from committed state, survive an agent restart, and then start a second clean case in that same conversation after the first is resolved.

The required order is:

```text
clean install
  → terminal + real Gemini + real SpacetimeDB
  → dispatcher/responder actions
  → iMessage input + asynchronous notification return
  → correction + status query
  → restart/reconnect
  → resolve + second case in the same conversation
```

## Working agreement

- Person 1 alone reconciles the root `package-lock.json`. Other owners may change their package manifests but must call that out in their PR.
- Person 3 owns `docs/CONTRACT.md`, `packages/contracts`, database schema, adapter APIs, deployment, and generated bindings. Never hand-edit generated bindings.
- Person 3 announces schema deployments and shared-database resets. No other person resets the integration database.
- Keep `spacetime/` as a separately locked module for this integration pass. Root tooling may call its scripts explicitly; do not silently add it to the root workspace.
- Use Node 22.18 or newer everywhere. Do not commit `.env`, identity tokens, API keys, phone numbers, or private conversation identifiers.
- Every PR states commands actually run, live versus fixture coverage, remaining blockers, and whether a manifest or shared contract changed.

## Shared contract decisions to implement

Person 3 publishes these shapes first; Persons 1 and 4 consume them rather than creating local alternatives.

1. **Durable route:** persist the minimum verified Spectrum route needed to reopen the original destination after restart: platform, provider space ID, and any cloud iMessage line/phone discriminator required by the installed SDK. Keep the internal `conversationKey` separate from provider routing data. Do not store a callback or assume the inbound `space` object will still exist.
2. **Intake session:** add a monotonically increasing session/case epoch to a conversation and its inbound messages. Resolving a case advances the epoch and clears the active question fields. Context reads return pending/applied messages and questions only from the current epoch; older rows remain available as history but never enter a new Gemini turn.
3. **Extraction state:** expose `OK | PENDING | FAILED` on an existing incident. Recording inbound content for an active incident sets `PENDING`; accepted/no-patch completion sets `OK`; extraction failure sets `FAILED` with a sanitized error. A first-report failure with no incident remains visible in agent diagnostics.
4. **Startup work:** expose adapter reads for every pending intake context and every unacknowledged notification so the designated agent can drain both after reconnect.

Update `docs/CONTRACT.md`, exported contract types, schema, adapter, generated bindings, checks, and consumers together.

## Person 1 — installation, orchestrator, and delivery worker

Branch: `person1/integration-orchestrator`

### Start now

- Raise the root Node engine to `>=22.18`, retain the npm pin, reconcile all current workspaces, and regenerate the root lockfile.
- Make the root `.env` optional when credentials are already exported. Keep `.env.example` as names only.
- Add explicit root scripts for:
  - reproducible workspace install/check;
  - separate `spacetime/` install/typecheck/build;
  - the destructive local adapter integration check, clearly named and never hidden inside the ordinary unit check.
- Prove `npm ci --ignore-scripts --no-audit --no-fund` and `npm run check` in a fresh checkout. Record the commands and results in the root README.
- Add `@flare/contracts`, `@flare/intake`, and `@flare/data` to the agent package. Let Person 1 make the final lockfile update after all manifest-changing PRs merge.

### Orchestrator

Replace `handleEcho` in production entrypoints with a dependency-injected handler while retaining explicit `echo` scripts as labelled transport diagnostics.

For each normalized inbound text batch:

1. Persist it with `recordInbound`, including the durable route.
2. Reload committed context and operate on its still-`RECEIVED` messages.
3. Build the shared `InboundTurn` and call `extractTurn` outside the database.
4. On failure, call `recordExtractionFailure`; do not mutate verified facts or mark messages applied.
5. For `REPORT`/`CORRECTION`, merge facts, call `recommendServices`, and call `applyIntakePatch` with the expected revision and source IDs.
6. On `STALE_REVISION`, reload context and reprocess the still-pending messages with a bounded retry; never apply the old result.
7. For `STATUS_QUERY`, render text only from the committed incident/assignment snapshot and call `completeInboundWithoutPatch` so the reply becomes a notification job. With no active case, report that truth without creating one.
8. For `OTHER`, complete without a patch and use only a fixed informational reply when needed.
9. Send at most one proposed clarification, then persist success/failure through `recordSentQuestion`.

At startup, connect with the persisted agent identity, drain pending intake contexts, subscribe for new notifications, and drain existing notification jobs. Resolve each notification's durable route into a fresh Spectrum destination, send the committed simulation-labelled text, then call `ackNotification`. A failed send remains retryable. Document the unavoidable crash-after-send/before-ack duplicate risk.

### Person 1 tests and done condition

- Unit-test report, correction, status, other, extraction failure, stale retry, duplicate input, question delivery failure, notification send/ack failure, and startup draining with injected fakes.
- Terminal + real Gemini + real local SpacetimeDB creates and updates an incident before attempting phone debugging.
- After credentials are enabled, a real phone report reaches the dashboards and a later committed `EN_ROUTE` notification returns asynchronously to that same conversation.
- Restarting the agent drains pending work without losing facts or depending on an old callback.

## Person 2 — shared types and live Gemini proof

Branch: `person2/live-gemini-contracts`

### Start now

- Add `@flare/contracts` as an intake dependency. Replace `packages/intake/src/contract-types.ts` with shared imports/re-exports and remove the duplicate definitions.
- Keep extraction and recommendation behavior unchanged while proving the package tests still exercise the shared types.
- With the real key, run `models`, `smoke`, and the full live evaluation against the exact structured-output schema used by the orchestrator.
- Commit the generated Markdown/JSON evaluation result, recording model ID, fixture count, pass rate, correction/uncertainty results, and p50/p95 latency. Never commit the key or raw provider errors containing sensitive data.
- Refresh `packages/intake/HANDOFF.md` and `docs/DEMO.md`; remove statements that the root workspace/contracts do not exist.

### Person 2 done condition

- `@flare/intake` exports types assignable to `@flare/contracts` without a local mirror.
- A real model accepts the schema and passes the smoke case.
- The north-to-south correction and “I don't know” uncertainty cases pass the live evaluation and receive human review.
- Invalid configuration still returns the contracted sanitized failure without changing stored facts.

## Person 3 — routing, session isolation, pending state, and shared database

Branch: `person3/integration-state`

### Start now

- Implement the four shared contract decisions above in `docs/CONTRACT.md`, `packages/contracts`, `spacetime/`, and `packages/data`.
- Regenerate bindings from the built module; do not edit binding files manually.
- Make `resolveIncident` advance the intake session and clear current-session question fields. Make `getConversationContext` filter messages/questions by the current session.
- Add adapter reads for pending conversation contexts and pending notifications for startup recovery.
- Persist only the verified routing fields Person 1 needs to reconstruct a Spectrum destination. Keep them agent-private.
- Publish one persistent shared integration database, provision distinct agent/dispatcher/responder identities, and share only non-secret connection instructions. Announce every reset.

### Person 3 tests and done condition

- Extend adapter checks for `PENDING → OK`, `PENDING → FAILED`, successful retry, and no fact loss.
- Resolve case A, then record case B in the same conversation: case B receives empty facts/summary, no old question, and no case-A messages in its Gemini context. Historical case-A records remain stored.
- Restart/reconnect with the agent token and enumerate both pending intake and unacknowledged notifications.
- Route fields are invisible to dispatcher/responder projections.
- Existing 47 adapter checks plus the new checks pass against the published schema.

## Person 4 — live pending state and reproducible browser smoke

Branch: `person4/live-pending-smoke`

### Start now

- Prepare the live client and UI to consume the shared extraction state. Keep the last verified facts visible during `PENDING` and `FAILED`; only the status indicator changes.
- Commit a reproducible smoke command for live mode. It must use separate dispatcher and responder identities, fail loudly on missing roles/configuration, and verify subscription-driven updates without a page refresh.
- Refresh `apps/web/HANDOFF.md`; remove claims that live mode, browser rendering, root workspace, or data packages are unverified when the corresponding check has actually run.

### After Person 3's contract PR lands

- Map the shared `OK | PENDING | FAILED` value directly in `liveClient.ts`; remove the current inference from `extractionError` alone.
- Verify an existing incident visibly becomes pending while extraction is in flight, returns to OK on success, and retains verified facts with a failure message on failure.
- Exercise dispatcher confirmation and responder `ACCEPTED → EN_ROUTE` with separate tokens. Confirm the dispatcher updates from subscriptions without refresh and rejected mutations never show false success.

### Person 4 done condition

- `npm run smoke:live` (or the documented equivalent) is committed and repeatable.
- The smoke evidence covers role gating, live incidents, assignment, responder progress, pending/failure display, reconnect, and mutation rejection.
- Both routes build and typecheck against the same shared contracts/bindings used by the agent.

## Merge and integration order

1. **Person 1 root-install slice:** merge only the clean-install/Node/env/check changes so every branch has a reproducible base.
2. **Persons 2 and 3:** merge shared intake types/live proof and the coordinated contract/schema/adapter change. Person 3 publishes the matching database and bindings immediately after merge.
3. **Person 4:** rebase onto the shared extraction state, merge the live mapping and smoke command.
4. **Person 1 orchestrator:** rebase onto the final intake/data APIs, finish the notification route resolver, and run the terminal integration gate.
5. **Person 1 final dependency pass:** regenerate the root lockfile after every manifest-changing PR, prove clean `npm ci`, and update the single team quickstart.
6. Run the complete live acceptance sequence below. Fix the first broken boundary before polishing anything.

## Required acceptance sequence

Use the synthetic scenario in `docs/DEMO.md` and record who ran it, when, the exact model/database, and whether each step was live or fixture-backed.

1. Start the persistent database and designated agent; open dispatcher and responder with separate authorized identities.
2. From the terminal path, send the smoke report, location, and correction. Verify one incident, exact evidence, FIRE recommendation, and live UI updates.
3. Confirm `FIRE-01`, accept, and advance `EN_ROUTE`. Verify the committed notification is sent and acknowledged.
4. Repeat steps 2–3 from a real iMessage conversation. Ask “Any update?” and verify the answer reflects committed assignment state.
5. Stop the agent with pending or unacknowledged work, restart it, and verify the work drains safely.
6. Complete and resolve the first case. Start a second report in the same iMessage thread and verify no old facts, messages, or question enter the new extraction.
7. Re-run duplicate, stale revision, unit conflict, unauthorized responder, disconnect/reconnect, and extraction-failure recovery checks.
8. Run clean installs and all offline/module/adapter/web checks once more; update every handoff and the demo checklist with actual results.

The integration pass is complete only after this sequence succeeds twice without a database reset between the two runs.
