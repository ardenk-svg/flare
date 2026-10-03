# Flare

Flare is a ten-hour MHacks project for four teammates: a simulated incident report arrives through iMessage, Gemini extracts and updates caller-reported facts, and a dispatcher and responders coordinate through SpacetimeDB.

**Current status:** the merged npm workspace installs reproducibly, and Person 1's agent now connects Spectrum to the intake and data packages, retries stale/pending intake, answers status from committed state, and drains asynchronous notification jobs through durable local routes. Photon cloud startup is verified. The supplied Maincloud database does not yet expose the Flare schema, no Google Gemini API key is configured, and a real phone message round-trip is still pending. See [NEXT_STEPS.md](NEXT_STEPS.md) for the shared integration board.

## Start here

Every teammate and coding assistant should read these in order:

1. [Shared handoff](handoff.md) — scope, architecture, ownership, ten-hour schedule, Git workflow, and acceptance criteria.
2. [Integration contract](docs/CONTRACT.md) — shared vocabulary, extraction boundary, state transitions, and application operations.
3. Your role guide below — first steps, interfaces, milestones, and a copy-paste Claude prompt.

| Person | Workstream | Guide |
|---|---|---|
| 1 | Photon Spectrum, Node agent, integration coordination | [Photon and integration](docs/roles/person-1-photon-integration.md) |
| 2 | Gemini extraction, demo rules, fixtures, demo preparation | [Gemini and evaluation](docs/roles/person-2-gemini-extraction.md) |
| 3 | SpacetimeDB, contracts, generated bindings, data adapter | [SpacetimeDB and shared contracts](docs/roles/person-3-spacetimedb.md) |
| 4 | One web app with dispatcher and responder views | [Dispatcher and responder web app](docs/roles/person-4-web-app.md) |

The shared [CLAUDE.md](CLAUDE.md) gives coding sessions the same project constraints. Tell each session its person number; the role guide supplies its task. Read the entire repo as needed, but coordinate edits outside your owned area.

## First team action

Spend 30 minutes agreeing on the contract, creating the TypeScript workspace, and verifying actual access to Photon, Gemini, and SpacetimeDB. Person 1 coordinates root configuration; Person 3 owns contract and schema changes. Implement a complete live loop by hour three and merge working slices throughout the event.

## Team quickstart

Use Node.js 22.18 or newer. Create an ignored root `.env` from `.env.example`, keep all values local, then run:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run agent:echo:terminal   # labelled transport diagnostic only
npm run agent:terminal
```

`agent:terminal` and `agent:imessage` run the integrated Gemini/SpacetimeDB worker. `agent:echo:terminal` and `agent:echo:imessage` are explicitly labelled transport-only diagnostics and never create incident state. See [the agent handoff](apps/agent/HANDOFF.md) for environment names, verified behavior, and current external blockers.

The SpacetimeDB module keeps its own lockfile and toolchain:

```sh
npm run install:module
npm run check:module
```

`check:module` requires the `spacetime` CLI. The destructive local adapter checks are intentionally separate: start the agreed local database, then run `npm run check:data:live`.

For cloud iMessage, set `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` locally and run `npm run agent:imessage`. The terminal path remains a development aid and does not satisfy the live-phone acceptance criterion.

This is a simulation. It does not contact real emergency services or provide operational triage guidance.
