# apps/web handoff (Person 4)

**Status:** fixture-only slice. Both routes render a labelled, contract-shaped fixture. Nothing is wired to SpacetimeDB; all action buttons are disabled.

## Run
- `cd apps/web && npm install --no-package-lock && npm run dev` → `/dispatcher`, `/responder`
- `npm run typecheck`, `npm run build` (both verified passing)

## Notes
- `src/types.ts` is a temporary local mirror of `docs/CONTRACT.md`; replace with `packages/contracts` / `packages/data` projections from Person 3.
- No root workspace or lockfile exists yet; Person 1 should reconcile `apps/web/package.json` (React 19, react-router-dom 7, Vite 7, TS 5).
- Fixture has no assignments, so the responder route shows its empty state.

## Unresolved
- Real subscription adapter, identity/role display, mutations, conflict/error UI, reconnect handling.
