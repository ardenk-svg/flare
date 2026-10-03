# apps/web handoff (Person 4)

**Status:** UI runs against either an in-memory fixture (default) or a live SpacetimeDB client (`VITE_DATA_MODE=live`, `src/data/liveClient.ts`, built on `@flare/data`). **The live client typechecks and builds but has not been run against a real database yet.**

## Live mode
1. Person 3's steps: `spacetime start --in-memory`, `cd spacetime && npm install && npm run publish:local`.
2. `cd apps/web && cp .env.example .env.local && npm install --no-package-lock` (`@flare/data` and `@flare/contracts` are `file:` deps; run `npm install` in `packages/contracts` and `packages/data` first).
3. Open `/dispatcher` and `/responder` in **separate browser profiles**. A new identity sees "no role yet" with its identity hex. Grant it from the publisher's CLI: `spacetime call --server local flare-dev grant_role <hex> DISPATCHER '{"none":[]}'` or `... RESPONDER '{"some":"FIRE-01"}'`. The page updates without reload.
4. The token is kept in `localStorage` key `flare-live-token`; clear it to get a new identity.
Behavior: reconnects with backoff on disconnect and marks data stale meanwhile; reducer errors (`UNIT_CONFLICT`, `UNAUTHORIZED`, ...) are shown verbatim beside the action.

## Run
- `cd apps/web && npm install --no-package-lock && npm run dev` → `/dispatcher`, `/responder`, `/responder?unit=EMS-01`
- `npm run typecheck`, `npm run build` (both pass)
- Fixture mode: open dispatcher and responder in two tabs of one browser. Data syncs through localStorage; identity comes from the URL on page load (fixture only; it is not authorization). Use the "Fixture controls" panel to simulate disconnect, caller correction, extraction pending/failed, a rigged unit conflict, and reset.

## Interfaces
- `src/types.ts`: `FlareClient` (`subscribe`, `getSnapshot`, `confirmDispatchAndAssign`, `advanceAssignment`, `resolveIncident`), `Snapshot`, `OpResult` and error codes. The incident/unit/assignment shapes are a **temporary mirror** of `docs/CONTRACT.md`.
- `src/data/index.ts` `createClient()` picks live or fixture from `VITE_DATA_MODE`. `liveClient.ts` maps `@flare/contracts` rows to the UI shapes in `types.ts` and re-reads the authorized views on any table change.
- `src/data/fixtureClient.ts` encodes the contract rules (role checks, readiness, one-time dispatch, unit/service matching, atomic conflict, next-stage only, own-unit only, release on COMPLETED, resolve only when all complete).

## Checks run
- 20 assertions against the fixture client via a throwaway script (not committed): forbidden role, invalid selection, rigged conflict leaves no assignment, second confirm rejected, skipped stage, other unit's assignment, early resolve, full stage progression, unit release, completion not resolving the incident, independent stages, disconnected mutation blocked. All passed.
- Dev server serves both routes (HTTP 200).
- **Not done:** no visual/browser check of the rendered UI, no automated test suite committed, nothing run against the real backend.

## Unresolved / needs others
- Run and verify live mode (needs the SpacetimeDB CLI, not installed on the machine used so far).
- `src/types.ts` UI shapes still differ slightly from `@flare/contracts` (liveClient maps between them).
- No root workspace/lockfile yet (Person 1); `apps/web/package.json` uses React 19, react-router-dom 7, Vite 7, TS 5.
- Evidence for the responder view is intentionally hidden; confirm which projection fields responders may see.
- Reconnect handling is simulated; verify against the real SDK's reconnect events.
