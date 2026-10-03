# Person 1 agent handoff

## Implemented slice

- Root npm/TypeScript workspace and shared verification scripts.
- Photon Spectrum `12.10.1` lean core, cloud iMessage, and terminal packages.
- Spectrum terminal-provider harness entering the same normalized handler.
- Provider-neutral inbound text envelope, outbound/non-text filtering, and per-conversation serialization.
- A visibly labelled simulation echo. It is a transport proof only; Gemini and SpacetimeDB are not connected yet.

## Setup

From the repository root:

```sh
npm install
npm run check
npm run agent:terminal
```

The terminal harness needs no credentials. Start the cloud worker only after placing these verified Photon environment names in the local process environment:

- `SPECTRUM_PROJECT_ID`
- `SPECTRUM_PROJECT_SECRET`

Then run `npm run agent:imessage`. Spectrum automatically discovers the project's managed cloud iMessage lines. A line added while the worker is already running may require a restart before it is visible.

The future integration also reserves the environment names listed in the root `.env.example` for Gemini and SpacetimeDB. No secret values belong in this repository.

## Current interfaces

`normalizeInboundMessage` accepts Spectrum's trusted space/message envelope and returns a `NormalizedInboundMessage` containing provider message ID, provider-prefixed conversation key, platform, sender ID, text, and an ISO timestamp. It ignores outbound echoes, non-text content, and blank text.

`runMessageLoop` serializes work per conversation and invokes one `InboundMessageHandler`. Both terminal and iMessage entrypoints currently use `handleEcho`. Replace that handler with the orchestrator after Person 2 exports `extractTurn`/`recommendServices` and Person 3 exports the data adapter.

## Verification and limitations

Verified on 2026-10-03:

- `npm run check` passed typechecking, 4/4 focused tests, and the production build.
- `npm run start:terminal --workspace @flare/agent` opened the Spectrum terminal TUI; sending `test` produced the labelled simulation echo through the common handler, and Ctrl-C shut it down cleanly.
- `npm run agent:imessage` loaded the ignored root `.env`, authenticated, started the `imessage` provider, and reached the listening state. A real phone send/receive is still pending.

The automated checks cover normalization, filtering, preservation of original source text, queue ordering, failure recovery, TypeScript compilation, and the production build.

Live iMessage receive/send is **not verified** until a real phone exchanges a message with the connected worker. The terminal harness and successful provider startup do not satisfy that acceptance criterion. The current worker also has no persistent receipt store, extraction, SpacetimeDB state, notification consumer, or external-send acknowledgment. Spectrum delivery idempotency is not assumed.

`npm audit --omit=dev` currently reports 18 moderate findings in Spectrum's transitive `@photon-ai/otel` / OpenTelemetry dependency chain. npm offers only a breaking downgrade as an automatic fix, so this slice leaves the pinned current Spectrum version intact and records the issue for upstream/version review.
