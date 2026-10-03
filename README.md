# Flare

Flare is a ten-hour MHacks project for four teammates: a simulated incident report arrives through iMessage, Gemini extracts and updates caller-reported facts, and a dispatcher and responders coordinate through SpacetimeDB.

**Current status:** Person 1's initial TypeScript workspace and Photon Spectrum agent slice are in progress. A terminal-provider harness and cloud iMessage entrypoint share one normalized handler; live iMessage access is not yet verified. Gemini, SpacetimeDB, and web application work remain owned by their respective workstreams. The concept was called Dispatch in the original handoff; use Flare in this repository.

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

## Person 1 quickstart

With Node.js 20 or newer:

```sh
npm install
npm run check
npm run agent:terminal
```

The terminal harness is a development fallback, not evidence of live iMessage delivery. For the cloud iMessage worker, set `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` locally and run `npm run agent:imessage`. See [the agent handoff](apps/agent/HANDOFF.md) for verified scope and known gaps.

The remaining target layout and scripts are described in the handoff. As each workstream ships, add its tested setup commands and environment variable names to its own `HANDOFF.md` and update this README with a verified quickstart.

This is a simulation. It does not contact real emergency services or provide operational triage guidance.
