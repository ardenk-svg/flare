# apps/web handoff (Person 4)

**Status:** UI runs against either an in-memory fixture (default) or a live SpacetimeDB client (`VITE_DATA_MODE=live`, `src/data/liveClient.ts`, built on `@flare/data`). The live client has been run against a local SpacetimeDB 2.10.2 database with `npm run smoke:live` (see Checks run). The rendered pages have not been checked in a browser in live mode yet.

## Live smoke (`npm run smoke:live`)
Drives the same `createLiveClient` the routes use, with separate dispatcher, responder (`FIRE-01`), and agent identities. It **resets the local database** and refuses any non-local `SPACETIMEDB_URI`.

```sh
spacetime start --listen-addr 127.0.0.1:3000 --in-memory     # separate terminal
cd spacetime && npm install && npm run publish:local          # this CLI identity becomes the publisher (needed for grant_role/reset_demo)
cd ../apps/web && npm install --no-package-lock && npm run smoke:live
```

Env (optional): `SPACETIMEDB_URI` (default `ws://127.0.0.1:3000`), `FLARE_DB` (default `flare-dev`). It exits 0 when everything passes, 1 when any check fails, and 2 when it aborts on a missing CLI, an unpublished database, a non-publisher identity, a non-local URI, or a connection failure.

Coverage: role gating (no role, then a grant pushed without reconnecting), live incident push, evidence, recommendation separate from confirmation, the responder seeing only its own work, extraction FAILED with facts kept and a retry back to OK, rejected mutations (`UNAUTHORIZED`, `UNIT_SERVICE_MISMATCH`, `ALREADY_DISPATCHED`, `INVALID_TRANSITION`, `DISCONNECTED`) leaving state untouched, dispatch to OFFERED, `ACCEPTED`, then `EN_ROUTE` reaching the dispatcher by subscription, a committed EN_ROUTE notification, and reconnecting with the same token. Cross-client checks only pass when an update arrives by subscription, since the observing client never re-reads on its own.

**Skipped until Person 3's contract PR lands:** extraction `PENDING`. The contract has no shared `extractionState` yet. `toExtraction()` in `liveClient.ts` already prefers that field when present and otherwise infers FAILED from `extractionError`. The smoke detects the field and turns the PENDING check on automatically. After the PR lands, delete the inference fallback.

## Live mode in the browser
1. Steps above (server + `publish:local`), then `cd apps/web && cp .env.example .env.local && npm run dev`.
2. Open `/dispatcher` and `/responder` in **separate browser profiles**. A new identity sees "no role yet" with its identity hex. Grant it: `spacetime call --server local flare-dev grant_role <hex> DISPATCHER '{"none":[]}'` or `... RESPONDER '{"some":"FIRE-01"}'`. The page updates without reload.
3. The token is kept in `localStorage` key `flare-live-token`. Clear it to get a new identity.

Behavior: reconnects with backoff on disconnect and marks data stale meanwhile. Reducer errors are shown verbatim beside the action.

## Run
- `npm run dev` → `/dispatcher`, `/responder`, `/responder?unit=EMS-01`
- `npm run typecheck` (app + `scripts/`), `npm run build`
- Fixture mode: dispatcher and responder in two tabs of one browser, synced through localStorage. Identity comes from the URL (fixture only, not authorization). The "Fixture controls" panel simulates disconnect, a caller correction, extraction pending/failed, a rigged unit conflict, and reset.

## Interfaces
- `src/types.ts`: `FlareClient`, `Snapshot`, `OpResult`. The incident/unit/assignment shapes are still a **temporary mirror** of `docs/CONTRACT.md`.
- `src/data/liveClient.ts`: `createLiveClient({ uri, database, tokenStore? })` returns a `LiveClient` (`FlareClient` + `close()`). `tokenStore` defaults to localStorage. The smoke passes in-memory stores so each identity is separate.
- `src/data/fixtureClient.ts`: encodes the contract rules for offline demos.

## Checks run (2026-10-03, local in-memory SpacetimeDB 2.10.2, Node 26.7)
- `npm run smoke:live`: 29 passed, 1 skipped (PENDING). Three consecutive runs, same result.
- Failure modes: unknown `FLARE_DB`, non-local URI, and `spacetime` missing from PATH each abort with a specific message.
- `npm run typecheck`, `npm run build`: pass.
- `packages/data` `npm run check` (Person 3's adapter checks) passes on this machine.

## Unresolved / needs others
- Person 3: shared `OK | PENDING | FAILED` extraction state, then remove the `extractionError` inference and confirm the PENDING smoke check passes.
- Person 1: this PR adds `tsx` and `@types/node` devDependencies to `apps/web/package.json`. The root lockfile was not touched and needs reconciling.
- No visual browser check of live mode yet. Reconnect is covered by closing a session and reopening it with the same token. Dropping the server mid-session hasn't been tested.
- Responder evidence stays hidden in the UI. Confirm which projection fields responders may see.
