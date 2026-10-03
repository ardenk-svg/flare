# apps/web handoff (Person 4)

**Status:** full UI built against a `FlareClient` interface with an in-memory fixture implementation. **Not connected to SpacetimeDB**: `packages/contracts`, `packages/data` and `spacetime/` did not exist when this was written.

## Run
- `cd apps/web && npm install --no-package-lock && npm run dev` → `/dispatcher`, `/responder`, `/responder?unit=EMS-01`
- `npm run typecheck`, `npm run build` (both pass)
- Fixture mode: open dispatcher and responder in two tabs of one browser. Data syncs through localStorage; identity comes from the URL on page load (fixture only; it is not authorization). Use the "Fixture controls" panel to simulate disconnect, caller correction, extraction pending/failed, a rigged unit conflict, and reset.

## Interfaces
- `src/types.ts`: `FlareClient` (`subscribe`, `getSnapshot`, `confirmDispatchAndAssign`, `advanceAssignment`, `resolveIncident`), `Snapshot`, `OpResult` and error codes. The incident/unit/assignment shapes are a **temporary mirror** of `docs/CONTRACT.md`.
- `src/data/index.ts` `createClient()` is the single swap point for Person 3's adapter. It needs: snapshot of authorized incident/unit/assignment projections, connection state, authenticated identity (role + unit), and mutations that return typed errors (esp. unit conflict).
- `src/data/fixtureClient.ts` encodes the contract rules (role checks, readiness, one-time dispatch, unit/service matching, atomic conflict, next-stage only, own-unit only, release on COMPLETED, resolve only when all complete).

## Checks run
- 20 assertions against the fixture client via a throwaway script (not committed): forbidden role, invalid selection, rigged conflict leaves no assignment, second confirm rejected, skipped stage, other unit's assignment, early resolve, full stage progression, unit release, completion not resolving the incident, independent stages, disconnected mutation blocked. All passed.
- Dev server serves both routes (HTTP 200).
- **Not done:** no visual/browser check of the rendered UI, no automated test suite committed, nothing run against the real backend.

## Unresolved / needs others
- Live adapter, real identities and per-role projections (Person 3). No full login UI by design.
- Contract types should replace `src/types.ts` shapes.
- No root workspace/lockfile yet (Person 1); `apps/web/package.json` uses React 19, react-router-dom 7, Vite 7, TS 5.
- Evidence for the responder view is intentionally hidden; confirm which projection fields responders may see.
- Reconnect handling is simulated; verify against the real SDK's reconnect events.
