# Person 1 agent handoff

## Implemented

- Reconciled npm workspace and root lockfile for agent, web, contracts, data, and intake packages. Workspace packages no longer carry competing nested lockfiles; `spacetime/` deliberately remains separate.
- Integrated terminal and cloud iMessage entrypoints now use `@flare/intake` and `@flare/data`. Explicit `echo` entrypoints remain available as labelled transport diagnostics.
- Inbound text is route-normalized, persisted before extraction, serialized per conversation, and reloaded from committed context.
- REPORT/CORRECTION applies deterministic recommendations with expected-revision checks and bounded stale-result retry.
- Obvious status questions bypass Gemini, read committed incident/assignment state, and enqueue a no-patch informational notification. OTHER is completed without creating an incident.
- Extraction failures stay retryable and preserve verified facts. Pending intake is retried once at agent startup.
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
| `GEMINI_MODEL` | live extraction | Tested stable model; local recommendation is `gemini-2.5-flash-lite` for cost |
| `FLARE_AGENT_STATE_PATH` | optional | Override ignored token/route state file |
| `FLARE_NOTIFICATION_POLL_MS` | optional | Poll interval, default 2000 ms |
| `FLARE_NOTIFICATION_MAX_ATTEMPTS` | optional | External delivery attempt ceiling, default 5 |

A Cursor API key is not a Gemini Developer API credential. Cursor exposes it for Cloud Agent operations; do not send it to Google's API or put it in `GEMINI_API_KEY`.

On the first successful schema connection without a token, the worker persists the minted token and prints the public identity hex. Person 3 must grant that identity the `AGENT` role before the worker processes messages. Keep one designated process on the shared iMessage inbox.

## Verification on 2026-10-03

- Clean `npm ci --ignore-scripts --no-audit --no-fund`: passed with every merged workspace represented in the root lockfile.
- Root `npm run check`: passed all workspace typechecks, 17 agent tests, 39 intake tests, agent source validation, and the web production build.
- `npm run install:module`: passed; `spacetime` TypeScript check passed. The module build could not run because this host does not have the `spacetime` CLI installed.
- Photon cloud echo diagnostic: authenticated and reached the listening state with the `imessage` provider. No real phone message was sent during this check.
- Supplied Maincloud database: the server responded, but subscription failed because the expected `my_role` Flare view does not exist. The Flare module/bindings must be published to the intended database before the integrated worker can run there.
- Live Gemini: not run because no Google `GEMINI_API_KEY` is configured. Missing configuration returns the existing typed provider failure and leaves inbound messages retryable.

The focused agent tests cover normalization and line routing, per-conversation serialization, state recovery, report application, recommendation flow, stale revision retry, duplicate no-op, status shortcut, OTHER, extraction failure, clarification failure, asynchronous notification send/ack failure, retry ceilings, and secret redaction.

## Remaining external integration gates

1. Person 3 publishes the Flare module to the intended persistent database and grants the persisted agent identity `AGENT`.
2. Supply a Google Gemini API key and run Person 2's `models`, `smoke`, and live evaluation commands with the configured model.
3. Run terminal → Gemini → database → both browser roles before testing the phone.
4. Run a real iMessage report/correction, dispatch and EN_ROUTE update, status inquiry, restart drain, resolve, and a clean second case in the same thread.

External delivery is at-least-once around a crash: a crash after Spectrum accepts a send but before SpacetimeDB records its acknowledgment can produce a duplicate. The worker prevents duplicate sends after a successful acknowledgment within one process, but it does not claim exactly-once delivery.
