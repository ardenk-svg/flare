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

## Demo data: `npm run seed:demo -w @flare/web -- [--dispatcher <hex>] [--responder <hex>]`
**Resets the local database** (refuses a non-local `SPACETIMEDB_URI`) and seeds eight simulated incidents. One is resolved and one is dispatched with FIRE-01 en route. Two are ready for review (FIRE + EMS, and the demo robbery with POLICE). A violent threat and a critical unconscious caller are both collecting with no location. A minor collision matched no rule, and one test text was closed without dispatch. The seed can't add coordinates until #28 lands. Pass your browser identity hexes to grant DISPATCHER and RESPONDER `FIRE-01` in the same step. Use it for UI review and rehearsals, never on the shared database.

## UI (issue #17)
- Plain CSS tokens on `:root` in `src/styles.css`, no new dependency. `App.tsx` owns the SIMULATION strip and top bar, so every screen (including the access gate) shows the label.
- Dispatcher: active queue newest first, with resolved incidents collapsed. Each row has a status chip, relative time, location or "Location missing", and review/extraction flags. The detail splits into two columns when the detail pane is at least 760px wide (container query), so it also works at half of a 1440px projector.
- Facts show known values with the caller's quoted words. Unknown fields sit behind "Show unknown fields", and message IDs are never rendered.
- Dispatch panel: service toggles default to the recommendation. Unchecking a service drops its units. Units are grouped by service, and blockers are written in plain language.
- Responder: the next action is one large button, followed by a stepper, the location, and safety chips (unknowns hidden).
- Unchanged: `src/data/*`, `FlareClient`, contract types, AccessGate gating logic, and no optimistic success.

## Dispatcher console (issue #32, phase 1)
- Layout: queue | center (header, summary, location, Known / Still needed, caller conversation) | right (recommended response + dispatch, assignments, live activity). The center and right columns stack when the detail pane is under 820px.
- `src/incident.ts` holds pure display helpers: `deriveSeverity` (display only, not stored), `categoryOf`, `getKnownFacts`, `getRelevantMissingFacts`, `recommendationReasons` (maps rule IDs to readable reasons until #30 exports them), `getActivity`, `byPriority`. Checked by `npm test -w @flare/web`.
- `src/console.tsx` holds the panels. `Dispatcher.tsx` composes them.
- `IncidentView` gains optional `sharedLocation`, `conversation`, `events`, and `closeReason`. Live mode fills only `closeReason` today, and each panel falls back when the others are absent:
  - Location: typed text plus the caller's quote, and no map.
  - Conversation: the caller's evidence quotes, labelled as quotes.
  - Activity: derived only from stored timestamps. Intermediate assignment steps have no timestamp of their own and aren't shown.
- Map: OSM tiles drawn as plain `<img>` elements around the coordinates, with no new dependency, so `package.json` and the lockfile are unchanged. A failed tile switches to a text fallback. Fixture incident `INC-DEMO-3` has coordinates.
- `FlareClient.closeIncident` is wired to Person 3's `closeIncident` (live) and to the fixture. "Close without dispatch" appears only for undispatched incidents with no assignments, and it requires a reason.
- Copy: the single global banner reads "DEMO SYSTEM — Not connected to emergency services". Rule IDs and "(simulated)" labels are gone from the main UI. Backend rejection codes are shown as plain sentences.
- Fixture key bumped to `flare-fixture-v2` (adds two units per service, a robbery with conversation and location, and a critical medical case).
- Phase 2, once these land:
  - #28: new facts show up in Known automatically, because the helpers read fact keys loosely. `sharedLocation` needs mapping in `liveClient.toView`.
  - #29: map the transcript into `conversation` and the activity log into `events`.
  - #30: replace the `RULES` map in `incident.ts`.

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

## Checks run for the UI overhaul (local SpacetimeDB 2.10.2)
- `npm run typecheck -w @flare/web`, `npm run build -w @flare/web`: pass. `npm run smoke:live -w @flare/web`: passed.
- `seed:demo` against local, then a throwaway server render of both routes (dispatcher, responder FIRE-01, and responder EMS-01 with no assignment) against the live snapshot. All three rendered with no errors, and no message IDs appeared in the text.
- **Not yet done:** eyeballing the pages in a real browser, and before/after screenshots for the #17 PR. Check focus rings, the 1440x900 side-by-side layout, and phone width by eye.

## Checks run for the dispatcher console (2026-10-03, local SpacetimeDB)
- `npm run check` (repo root): pass, including `npm test -w @flare/web` (8 helper tests).
- `npm run smoke:live -w @flare/web`: 47/47. New checks cover severity, readable reasons, and missing facts on live data; activity updating from a pushed EN_ROUTE; and close-without-dispatch (responder rejected, reason required, CLOSED with reason pushed).
- `npm run seed:demo -w @flare/web`: seeds 8 incidents.
- **Not done:** no visual browser pass of the new layout yet. Check 13–16" widths, the map tiles, focus rings, and the conversation dialog by eye.

## Unresolved / needs others
- **Root `npm run check` fails on main in `apps/agent`, not the web app.** Person 1's merged orchestrator predates Person 3's contract change: `data-port.ts` omits `route` in `recordInbound`, and the agent test fixtures lack `route`, `extractionState`, and `caseEpoch`. Person 1 needs to rebase.
- Reconnect was tested by closing a client and reconnecting with the same token. Losing the server mid-session hasn't been tested, because an `--in-memory` restart wipes data. Test it on a persistent database.
- Not yet run against the shared Maincloud database. Person 3 hasn't announced it yet.
- Responder evidence stays hidden in the UI. Confirm which projection fields responders may see.
