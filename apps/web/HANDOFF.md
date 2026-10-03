# apps/web handoff (Person 4)

**Status:** both routes run against either an in-memory fixture (default) or live SpacetimeDB (`VITE_DATA_MODE=live`). Live mode is verified against a local SpacetimeDB 2.10.2 database by `smoke:live` (40/40) and by a manual browser pass (see Checks run). UI shapes come from `@flare/contracts`, and the live client reads the shared `extractionState` directly.

## Setup (root workspace)
Node ≥ 22.18. From the repo root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
spacetime start --listen-addr 127.0.0.1:3000 --in-memory      # separate terminal
npm run install:module && (cd spacetime && npm run publish:local)   # this CLI identity becomes publisher/ADMIN
```

`smoke:live` uses the root workspace's `tsx` and `@types/node`. `apps/web/package.json` adds no new dependencies.

## Live smoke: `npm run smoke:live -w @flare/web`
Drives the same `createLiveClient` the routes use, with separate dispatcher, responder (`FIRE-01`), and agent identities. It **resets the local database** and refuses any non-local `SPACETIMEDB_URI`.

Env (optional): `SPACETIMEDB_URI` (default `ws://127.0.0.1:3000`), `FLARE_DB` (default `flare-dev`). It exits 0 when everything passes, 1 when any check fails, and 2 when it aborts on a missing `spacetime` CLI, an unpublished database, a non-publisher identity, a non-local URI, or a connection failure.

Coverage, in order:
1. Role gating: a fresh identity gets no-role and an empty view, a mutation from it is rejected, and a grant arrives without reconnecting.
2. Live incident push with evidence. The recommendation is kept separate from the confirmed services, and an unassigned responder sees nothing.
3. Extraction `PENDING`, then `FAILED`, then retry to `OK`, with the last verified facts kept throughout.
4. Rejected mutations (`UNAUTHORIZED`, `UNIT_SERVICE_MISMATCH`, `ALREADY_DISPATCHED`, `INVALID_TRANSITION`, `DISCONNECTED`) never report success and leave state unchanged.
5. Dispatch to `OFFERED`, `ACCEPTED`, then `EN_ROUTE`, each reaching the other role by subscription, plus a committed EN_ROUTE notification.
6. Reconnecting with the same token restores identity, role, and assignment.
7. `ON_SCENE`, then `COMPLETED`, which releases the unit. Only the dispatcher can resolve.
8. A second case in the same conversation is a new incident with a later `caseEpoch` and no facts or evidence from the first.

Cross-client checks pass only when an update arrives by subscription, since the observing client never re-reads on its own.

## Live mode in the browser
1. Setup above, then `cd apps/web && cp .env.example .env.local && npm run dev`.
2. Open `/dispatcher` and `/responder` side by side in one browser profile. Each route keeps its own identity token in `localStorage`: `flare-live-token:dispatcher`, `flare-live-token:responder`, or `flare-live-token:responder:<UNIT>` when the URL has `?unit=<UNIT>` (use it to run a second responder tab). The dispatcher falls back once to the old single key `flare-live-token`, so an identity granted before this change keeps its role. A new identity shows "no role yet" with its hex. Grant it: `spacetime call --server local flare-dev grant_role <hex> DISPATCHER '{"none":[]}'` or `... RESPONDER '{"some":"FIRE-01"}'`. The page updates without reload. The fixture-only "Responder (EMS-01)" nav link is hidden in live mode.

## Interfaces
- `src/types.ts` re-exports `Service`, `IncidentStatus`, `AssignmentStatus`, `CallerFacts`, `Evidence`, `Unit`, `Assignment`, `ExtractionState`, and `ASSIGNMENT_ORDER` from `@flare/contracts`. `IncidentView`, `Snapshot`, `FlareClient`, and `OpResult` are UI-level.
- `src/data/liveClient.ts`: `browserTokenStore(scope, { legacyFallback? })` is the per-view localStorage token store. `createLiveClient({ uri, database, tokenStore? })` returns a `LiveClient` (`FlareClient` + `close()`). `toExtraction()` maps the contract's `extractionState`/`extractionError`.
- `src/data/fixtureClient.ts`: encodes the contract rules for offline demos. Fixture assignments now carry `service` and `createdAt`.

## Checks run (2026-10-03, local in-memory SpacetimeDB 2.10.2, Node 26.7, main @ 7676d47 + this branch)
- `npm ci --ignore-scripts --no-audit --no-fund` from root: OK, lockfile unchanged.
- `npm run smoke:live -w @flare/web`: 40/40 on 3 consecutive runs without republishing.
- Bad config: unknown `FLARE_DB`, non-local URI, and `spacetime` missing from PATH each abort with a specific message.
- `npm run typecheck -w @flare/web` (app + `scripts/`), `npm run build -w @flare/web`: pass.
- `npm run check:data:live` (Person 3's 64 adapter checks): pass.
- Manual browser pass (Chrome, live mode, dev server):
  - Dispatcher goes from no-role to granted without a reload, and the incident appears live.
  - Banner reads "Extraction pending" (blue), then "Extraction failed: TIMEOUT…" (red), and the banner disappears on success. Facts and evidence stayed visible the whole time.
  - Confirming FIRE-01 from the UI moves the incident to DISPATCHED. Responder Accept and En Route clicks move the assignment to EN_ROUTE, and the dispatcher shows EN_ROUTE.

## Unresolved / needs others
- **Root `npm run check` fails on main in `apps/agent`, not the web app.** Person 1's merged orchestrator predates Person 3's contract change: `data-port.ts` omits `route` in `recordInbound`, and the agent test fixtures lack `route`, `extractionState`, and `caseEpoch`. Person 1 needs to rebase.
- Reconnect was tested by closing a client and reconnecting with the same token. Losing the server mid-session hasn't been tested, because an `--in-memory` restart wipes data. Test it on a persistent database.
- Not yet run against the shared Maincloud database. Person 3 hasn't announced it yet.
- Responder evidence stays hidden in the UI. Confirm which projection fields responders may see.
