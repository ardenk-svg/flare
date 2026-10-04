# Person 1 agent handoff

## Implemented

- Reconciled npm workspace and root lockfile for agent, web, contracts, data, and intake packages. Workspace packages no longer carry competing nested lockfiles; `spacetime/` deliberately remains separate.
- Integrated terminal and cloud iMessage entrypoints now use `@flare/intake` and `@flare/data`. Explicit `echo` entrypoints remain available as labelled transport diagnostics.
- Inbound text is route-normalized, persisted before extraction, serialized per conversation, and reloaded from committed context.
- iMessage vCards (GEO or Maps URLs), vCard attachments, rich links, mini apps and explicit Maps pin links normalize into `recordSharedLocation`. Bundled messages are flattened. Pin payloads bypass Gemini and do not patch caller facts. Unreadable attachments enqueue an informational fallback whose send/ack is recorded in the transcript.
- Optional Find My binds one direct caller and conversation on a single line. It reloads that caller's snapshot, watches only that address, rejects missing/invalid coordinates, and stops applying updates across case boundaries until an explicit new request. The installed Spectrum native-client escape hatch is isolated and capability-checked in `find-my.ts`.
- REPORT/CORRECTION applies deterministic recommendations with expected-revision checks and bounded stale-result retry.
- Obvious status questions bypass Gemini, read committed incident/assignment state, and enqueue a no-patch informational notification. OTHER is completed without creating an incident.
- Extraction failures preserve verified facts. Pending intake is retried at startup and while running with bounded backoff; interrupted/failed clarifications recover without reapplying facts.
- Clarifications are sent one at a time and their delivery outcome is persisted.
- Pending/failed notification jobs drain at startup and while running. Successful external sends are acknowledged; failures use bounded exponential retry and sanitized errors.
- Spacetime identity token and Spectrum route data persist in ignored `.flare/agent-state.json` (mode `0600`) so the same worker host can reconnect and reopen an iMessage space after restart. Cloud routes include the line phone discriminator required by multi-line Spectrum projects.
- A first turn with no active incident deliberately excludes old applied messages and the old question, preventing resolved-case context from entering a new Gemini turn while Person 3 adds the database session boundary.

## Runtime commands

From the repository root with Node 22.18 or newer:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check

npm run agent:terminal        # integrated development path
npm run agent:imessage        # integrated cloud iMessage worker
npm run agent:echo:terminal   # transport-only diagnostic
npm run agent:echo:imessage   # transport-only diagnostic
npm run agent:probe:locations -- --seconds=60  # read-only payload/API probe
npm run e2e                  # local one-phone demo with both web roles
npm run e2e:auto             # real worker/database, fixture extraction, fake transport
npm run e2e:auto -- --live-gemini  # real Gemini, fake transport
```

The agent executes TypeScript through `tsx` because Person 3's generated SpacetimeDB bindings intentionally use extensionless imports. `npm run build` validates the agent source and produces the web bundle; it does not create a second compiled agent copy.

## Local environment

The root `.env` is optional when values are exported by the process. It is ignored and must never be committed.

| Name | Required | Purpose |
|---|---:|---|
| `SPECTRUM_PROJECT_ID` | iMessage | Photon project |
| `SPECTRUM_PROJECT_SECRET` | iMessage | Photon project secret |
| `SPACETIMEDB_URI` | integrated worker | Server, such as `https://maincloud.spacetimedb.com` |
| `SPACETIMEDB_DATABASE` | integrated worker | Database name or identity |
| `SPACETIMEDB_AGENT_TOKEN` | optional | Existing authorized identity; otherwise the minted token is persisted locally |
| `GEMINI_API_KEY` | live extraction | Google AI API key used by `@google/genai` |
| `GEMINI_MODEL` | live extraction | Tested stable model; use `gemini-3.5-flash-lite` for the reliable low-cost path verified by the live evaluation |
| `GEMINI_TIMEOUT_MS` | optional | Per-attempt extraction deadline; tested at 30000 ms |
| `GEMINI_THINKING_LEVEL` | optional | Model thinking level; tested at `LOW` for this extraction task |
| `FLARE_AGENT_STATE_PATH` | optional | Override ignored token/route state file |
| `FLARE_SPACETIME_BIN` | optional | CLI executable path for the local demo runner; otherwise uses PATH |
| `FLARE_NOTIFICATION_POLL_MS` | optional | Poll interval, default 2000 ms |
| `FLARE_NOTIFICATION_MAX_ATTEMPTS` | optional | External delivery attempt ceiling, default 5 |
| `FLARE_LOCATION_TIMEOUT_MS` | optional | Location/attachment deadline, default 5000 ms |
| `FLARE_INTAKE_RETRY_POLL_MS` | optional | Intake and clarification recovery poll, default 5000 ms |
| `FLARE_FIND_MY_ENABLED` | optional | One-phone Find My enabled by default; set `0` to disable; pins always work |
| `FLARE_DEMO_PHONE` | optional | E.164 caller allowlist; otherwise binds first direct caller |

A Cursor API key is not a Gemini Developer API credential. Cursor exposes it for Cloud Agent operations; do not send it to Google's API or put it in `GEMINI_API_KEY`.

On the first successful schema connection without a token, the worker persists the minted token and prints the public identity hex. Person 3 must grant that identity the `AGENT` role before the worker processes messages. Keep one designated process on the shared iMessage inbox.

## Verification on 2026-10-03

- Clean `npm ci --ignore-scripts --no-audit --no-fund`: passed with every merged workspace represented in the root lockfile.
- Root `npm run check`: passed all workspace typechecks, 17 agent tests, 39 intake tests, agent source validation, and the web production build.
- `npm run install:module`: passed; `spacetime` TypeScript check passed. The module build could not run because this host does not have the `spacetime` CLI installed.
- Photon cloud echo diagnostic: authenticated and reached the listening state with the `imessage` provider. No real phone message was sent during this check.
- Supplied Maincloud database: the server responded, but subscription failed because the expected `my_role` Flare view does not exist. The Flare module/bindings must be published to the intended database before the integrated worker can run there.
- Live Gemini: model discovery and smoke passed with the local Google credential. The paced `gemini-3.5-flash-lite` evaluation passed 20/20 cases (p50 1101 ms, p95 2594 ms); see the committed report under `fixtures/results/`. Missing configuration still returns the existing typed provider failure and leaves inbound messages retryable.

The focused agent tests cover normalization and line routing, per-conversation serialization, state recovery, report application, recommendation flow, stale revision retry, duplicate no-op, status shortcut, OTHER, extraction failure, clarification failure, asynchronous notification send/ack failure, retry ceilings, and secret redaction.

## Remaining external integration gates

1. Person 3 publishes the Flare module to the intended persistent database and grants the persisted agent identity `AGENT`.
2. Run terminal → Gemini → database → both browser roles before testing the phone.
3. Run a real iMessage report/correction, dispatch and EN_ROUTE update, status inquiry, restart drain, resolve, and a clean second case in the same thread.

External delivery is at-least-once around a crash: a crash after Spectrum accepts a send but before SpacetimeDB records its acknowledgment can produce a duplicate. The worker prevents duplicate sends after a successful acknowledgment within one process, but it does not claim exactly-once delivery.

## Demo message recovery (2026-10-04)

The saved local demo contained applied intake with no recorded clarification. The normal processing path awaited an unbounded Find My lookup before sending that question, blocking later messages in the same conversation. Provider reads, requests, attachment reads and stream shutdown now have deadlines. A failed initial snapshot still opens the location feed, feed failures reconnect automatically, and an explicit new Find My card rebinds the current demo case. Timed-out results are never applied.

Recovery runs alongside message listening, serializes with caller turns, retries failed translation/extraction or clarification with backoff (five attempts per unchanged context), and resumes an applied case with no delivered question. New input resets the retry budget; completed intake and human-controlled/ended cases receive no automated recovery question. Safe logs expose received/processed stages, successful fact commits, and provider failures. No model, schema, or shared deployment was changed.

Verification: root check passed 117 tests, workspace/script typechecks and production build. Isolated fixture `e2e:auto` passed the full worker/database loop, pin handling, dispatcher/responder takeover, all services, worker restart and repeated demos. Live Gemini smoke and English/Spanish translations passed with the unchanged configured model. The full live loop reached repeated rehearsals but failed its 45-second wait during repeated HTTP 429 quota errors; an earlier rate-limited turn successfully recovered in the same run. This confirms recovery while leaving external quota availability as a limit. Tests used synthetic inputs and fake phone transport; no real phone test message was sent. Local saved demo data was retained.

## Issue #31 verification on 2026-10-04

- Root `npm ci --ignore-scripts --no-audit --no-fund` and `npm run check`: passed. 29 agent, 9 web and 45 intake tests; workspace/script typechecks and production build passed.
- `npm run check:module`: typecheck and SpacetimeDB build passed with CLI 2.10.2 on PATH.
- `npm run e2e:auto`: passed against an isolated local database. Uses the installed Spectrum vCard decoder, real `runAgent`, reducers, dispatcher/responder subscriptions, notification acknowledgments, persisted-route restart and three case epochs. Checks that the shared pin is visible to the dispatcher and every delivered question/notification (including fallback, status, OTHER and close) appears in the correct transcript.
- `npm run e2e:auto -- --live-gemini`: the same loop passed with live Gemini extraction and fake message transport.
- A clean checkout copy with no `.env`, `.flare`, or `node_modules`: root `npm ci` and `npm run e2e:auto` both passed, including automatic module dependency installation. Only the SpacetimeDB CLI was provided through PATH.
- Local CLI configuration: `FLARE_SPACETIME_BIN` in ignored `.env` points to this host's existing installation. Script typecheck and `npm run e2e:auto` passed without a shell PATH override; the runner and harness both use the configured executable.
- Initial Photon probe authenticated and listened; `locations.list()` returned `ValidationError`, code `internalError`. This did not prove that caller-specific reads were unavailable; see the later correction below.

The tracked runner is `scripts/e2e.ts`; it uses `spacetime` from PATH (or `FLARE_SPACETIME_BIN`), the current checkout, and ignored `.flare/e2e/` for local state. It does not pull code automatically or require credentials for fixture mode. Phone mode requires Photon and Gemini credentials, one designated worker, and separate dispatcher/responder browser identities. Local `--wipe` resets local schema/data; shared deployment remains a coordinated action.

## Takeover, all responder services and real Find My card (2026-10-04)

- Takeover pauses automated questions and generic replies while continuing extraction, caller-requested status replies and committed notifications. Human messages reuse the durable notification worker and appear as DISPATCHER with queued/sent/failed delivery. Returning control lets the agent ask on subsequent intake turns.
- Inspected the original received Photon message: Spectrum represents the Find My card as `custom` with `imessage_type: unsupported-message`, while the native `balloonBundleId` identifies `com.apple.findmy.FindMyMessagesApp`. The installed Spectrum adapter preserves that metadata at the message level. Normalization now recognizes it and gets coordinates with `locations.get(caller address)` before recording the provider ID, avoiding a placeholder that would consume the dedupe key.
- Read the official [Photon locations API](https://photon.codes/docs/advanced-kits/imessage/locations). The configured line's caller-specific `get` succeeded with coordinates of type `legacy`, despite the list failure. Cached `legacy`/`shallow` snapshots are labelled. Recovery saved this real card's cached pin to the same local DISPATCHED incident, preserved assignments, and set the existing review flag. This verifies the provider read and database recovery; a fresh card through the restarted worker still needs a phone rehearsal. It does not establish fresh live GPS.
- The bridge is enabled by default in one-phone mode, scopes all reads/watch to the bound direct caller, and stops publishing at case boundaries unless sharing is requested again. Never start the payload probe alongside the designated inbox worker.
- Root `npm run check`: passed 35 agent, 9 web and 45 intake tests, typechecks and production build. The sandbox initially blocked `tsx`'s local IPC pipe; the authorized rerun passed.
- Isolated `FLARE_TMP=.flare/validation-takeover FLARE_DB_PORT=3053 FLARE_DB=flare-takeover npm run e2e:auto`: passed takeover ownership, responder privacy, human delivery attribution/deduplication, release, pins, restart drain, case isolation, and complete FIRE/EMS/POLICE assignment lifecycles. Extraction and message transport were fixture-backed.
- The additive local module publish retained the live case and role grants. Restarted only the designated local phone worker with its existing token/state, new code and Find My enabled. No Maincloud publish/reset occurred.

## Location questions and local shutdown (2026-10-04)

- A first report could ask for location before the background Find My snapshot was applied. It now waits for a scoped snapshot before deciding to send a question, with a separate snapshot message ID. Later cases cannot automatically reuse an earlier sharing binding. Known pins pass only `hasSharedLocation` to Gemini; the prompt selects another missing fact, and the final send guard rejects redundant address/location questions for pins or typed locations. Tests include the reported exact question.
- `npm run e2e` opens one dispatcher and one responder. The single responder dropdown automatically grants separate identities for the six seeded units via a dev-only loopback bridge. Its grants require the per-run capability, matching origin, an active local connection and no conflicting role. No shared schema or deployment changes were needed.
- Repeated SIGINT/SIGTERM handlers now await one cleanup promise. Startup checks stop spawning services once shutdown starts. Verified two interrupts during a running isolated demo, and an actual terminal Ctrl+C in a second demo: runner/children stopped and both database/web ports closed. The first manual run exposed competing responder bootstrap grants; removed that connection-wide poll so the dropdown bridge alone authorizes responder units.
- Root `npm run check`: 36 agent, 9 web, 46 intake and 1 script test passed, with typechecks/build. Isolated fixture `e2e:auto` passed again. Manual browser switching verified all six unit identities in one responder tab. No additional phone message was sent during these checks.
- Gracefully stopped the confirmed orphaned worker/database left after the earlier Ctrl+C. Saved `.flare/e2e/` state/data was retained. Relaunch with `npm run e2e -- --keep` to use the fixes and preserve the current demo incident.


## Multilingual intake, responder chat and repeat demos (2026-10-04)

Shared `missingIntakeFields` drives the console and worker. Intake continues for relevant facts, preserves explicit unknown answers across turns, and stops when complete or controlled by a dispatcher/assigned responder. Assigned responders now read their case transcript/activity and can claim/send/release chat; same-role ownership cannot be stolen. Dispatchers coordinate assignment/resolve and can transfer control back. Responder completion releases chat control.

Gemini translation uses existing credentials and the structured-output generator with a bounded deadline. Original text remains the evidence source; transcripts show English translations of caller text and translated outgoing text. A private additive `message_translation` table stores these separately. Notification translations persist before external delivery and survive retries. Translation and language context stay within the case; failures retain original messages or record failed delivery.

The local dispatcher Restart demo button calls the temporary loopback bridge, which checks origin/capability and the connected dispatcher's grant before the publisher invokes ADMIN-only `restart_demo`. It ends cases, completes assignments, frees units, releases control and cancels unsent notifications. IDs, dedupe history, role grants, services and tabs remain. Send another report in the same phone thread. The control is absent from production/ordinary web startup. Publish the updated module and regenerate bindings before running clients; persistent table changes are additive and do not require a data wipe.

Verification: root check passed 99 tests plus typechecks/build; 143 live adapter checks passed on an isolated local database; e2e:auto passed assigned-responder authorization, delivery, all service lifecycles and two restarts without restarting the worker or clients. Real Gemini passed synthetic Spanish detection/English translation, Spanish replies with the simulation label, and original-language fact evidence. Browser verification showed both text versions, responder takeover/composer/queued attribution, and the local restart success message. No real iMessage was sent by these tests.
