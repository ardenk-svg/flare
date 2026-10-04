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
**Resets the local database** (refuses a non-local `SPACETIMEDB_URI`) and seeds eight simulated incidents. One is resolved and one is dispatched with FIRE-01 en route. Two are ready for review (FIRE + EMS, and the demo robbery with POLICE). A violent threat and a critical unconscious caller are both collecting with no location. A minor collision matched no rule, and one test text was closed without dispatch. The robbery also gets an iMessage pin with coordinates, two agent questions, and a caller reply, so the map, transcript, and activity log all have live data. Pass your browser identity hexes to grant DISPATCHER and RESPONDER `FIRE-01` in the same step. Use it for UI review and rehearsals, never on the shared database.

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
- Live data (#28/#29, merged in #33): `liveClient.toView` maps `sharedLocation`, `listConversation` into `conversation`, and `listIncidentEvents` into `events`. It subscribes to `incident_conversation_view` and `incident_event_view`, so the transcript and activity log update by push with no polling. Both views are dispatcher-only. Responders get neither, but they see `sharedLocation` on their own incident, and the responder page shows the pin.
- Fallbacks, still used in fixture mode and for any incident the views don't cover:
  - The conversation panel shows the caller's evidence quotes.
  - Activity is derived from stored timestamps without inventing steps.
  - The location card shows typed text when there's no pin.
- Event `detail` codes (`TYPED`, `IMESSAGE_PIN`, `FIND_MY`, notification kinds, extraction error codes) are translated into readable text or dropped by `activityLabel`, never shown raw.
- Map: OSM tiles drawn as plain `<img>` elements around the coordinates, with no new dependency. A failed tile switches to a text fallback.
- `FlareClient.closeIncident` is wired to `closeIncident` (live) and to the fixture. "Close without dispatch" appears only for undispatched incidents with no assignments, and it requires a reason.
- Copy: the single global banner reads "DEMO SYSTEM — Not connected to emergency services". Rule IDs and "(simulated)" labels are gone from the main UI. Backend rejection codes are shown as plain sentences.
- Fixture key is `flare-fixture-v2`, with two units per service, a robbery with conversation and location, and a critical medical case.
- **Still waiting on others:**
  - #30 (Person 2): readable reasons come from the `RULES` map in `incident.ts` until #30 exports rule labels from `@flare/contracts`. Switch to that export when it lands.
  - #31 (Person 1): real callers' pins arrive once the agent calls `recordSharedLocation`. No UI change is needed. Verify with `npm run e2e` once it exists.

## Live mode in the browser
1. Setup above, then `cd apps/web && cp .env.example .env.local && npm run dev`.
2. Open `/dispatcher` and `/responder` side by side in one browser profile. Each route keeps its own identity token in `localStorage`: `flare-live-token:dispatcher` or `flare-live-token:responder:<UNIT>`. `/responder` defaults to FIRE-01 and reuses the old `flare-live-token:responder` token once if the new scoped token is missing. The dispatcher falls back once to the old single key `flare-live-token`. A new identity shows "no role yet" with its hex. Outside the local runner, grant it: `spacetime call --server local flare-dev grant_role <hex> DISPATCHER '{"none":[]}'` or `... RESPONDER '{"some":"FIRE-01"}'`. The Unit picker gives EMS, police and fire separate identities. `npm run e2e` opens exactly one tab for each role and automatically authorizes the selected responder unit.

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

## Checks run for the dispatcher console (2026-10-03, local SpacetimeDB 2.10.2, module from #33)
- `npm run check` (repo root): pass, including `npm test -w @flare/web` (9 helper tests).
- `FLARE_DB=flare-check npm run smoke:live -w @flare/web`: 56/56 on two consecutive runs. It covers:
  - the transcript (caller message, agent question with delivery state, no route or conversation key)
  - backend events (created, recommended, typed location, accepted, en route)
  - responders getting no transcript or log
  - a shared pin pushed to the dispatcher and satisfying the location gate
  - close without dispatch
- `seed:demo` against `flare-check`, then read back through `createLiveClient`:
  - six units
  - the robbery is HIGH and READY_FOR_REVIEW, with the pin
  - "Still needed" lists weapon, suspects, injuries, and people involved
  - five transcript lines and readable events
- **Not done:** no visual browser pass yet. Check 13–16" widths, the map tiles, focus rings, and the conversation dialog by eye.

## Unresolved / needs others
- The earlier agent/contract mismatch is repaired; root `npm run check` passed on 2026-10-04.
- Reconnect was tested by closing a client and reconnecting with the same token. Losing the server mid-session hasn't been tested, because an `--in-memory` restart wipes data. Test it on a persistent database.
- Not yet run against the shared Maincloud database. Person 3 hasn't announced it yet.

## Dispatcher takeover and all services (2026-10-04)

The conversation panel now claims/relinquishes control and lets its owning dispatcher compose messages. It disables actions offline or for ended incidents, blocks other dispatchers, preserves a failed draft, deduplicates send retries, and resets the draft when switching incidents. QUEUED/SENT/FAILED delivery and DISPATCHER attribution come from committed data. The agent continues fact extraction and unit updates while questions pause. The responder mission header shows its service, and the Unit picker supports all six seeded units.

Root checks passed (9 web helper tests plus typecheck/build); the isolated agent/database harness passed takeover ownership/privacy/delivery and full Fire, EMS and Police lifecycles. A manual fixture browser pass verified Take over → composer → Send message → DISPATCHER transcript → Return to agent. The capture is in ignored `.flare/screenshots/dispatcher-takeover.jpg`. This UI pass used fixture delivery; no real caller message was sent by the browser test.
- Responder evidence stays hidden in the UI. Confirm which projection fields responders may see.

## Single responder tab (2026-10-04)

The local e2e runner supplies a temporary dev-only responder authorization callback. Vite proxies `POST /__flare_demo/responder` to an ephemeral loopback server. A per-run capability header and matching browser origin are required; only seeded units and connected identities without an existing role can receive RESPONDER. It cannot replace existing dispatcher/admin/different-unit grants. Production builds and ordinary web startup do not enable this bridge. Tokens stay per unit; no identity token is placed in a URL or passed from the runner.

Manual browser verification on an isolated SpacetimeDB: one dispatcher and one responder tab; switched the same responder through FIRE-01/02, EMS-01/02 and POLICE-01/02, then returned to a previously authorized unit. All displayed the correct committed role/unit. Capture: ignored `.flare/screenshots/one-responder-dropdown.jpg`. Root checks and the local bridge origin/capability/unit checks passed.


## Multilingual intake, responder chat and repeat demos (2026-10-04)

Shared `missingIntakeFields` drives the console and worker. Intake continues for relevant facts, preserves explicit unknown answers across turns, and stops when complete or controlled by a dispatcher/assigned responder. Assigned responders now read their case transcript/activity and can claim/send/release chat; same-role ownership cannot be stolen. Dispatchers coordinate assignment/resolve and can transfer control back. Responder completion releases chat control.

Gemini translation uses existing credentials and the structured-output generator with a bounded deadline. Original text remains the evidence source; transcripts show English translations of caller text and translated outgoing text. A private additive `message_translation` table stores these separately. Notification translations persist before external delivery and survive retries. Translation and language context stay within the case; failures retain original messages or record failed delivery.

The local dispatcher Restart demo button calls the temporary loopback bridge, which checks origin/capability and the connected dispatcher's grant before the publisher invokes ADMIN-only `restart_demo`. It ends cases, completes assignments, frees units, releases control and cancels unsent notifications. IDs, dedupe history, role grants, services and tabs remain. Send another report in the same phone thread. The control is absent from production/ordinary web startup. Publish the updated module and regenerate bindings before running clients; persistent table changes are additive and do not require a data wipe.

Verification: root check passed 99 tests plus typechecks/build; 143 live adapter checks passed on an isolated local database; e2e:auto passed assigned-responder authorization, delivery, all service lifecycles and two restarts without restarting the worker or clients. Real Gemini passed synthetic Spanish detection/English translation, Spanish replies with the simulation label, and original-language fact evidence. Browser verification showed both text versions, responder takeover/composer/queued attribution, and the local restart success message. No real iMessage was sent by these tests.

## Responder essentials and resolved toggle (2026-10-04)

- Dispatcher queue: resolved/closed incidents are hidden behind a "Show/Hide resolved and closed (N)" toggle, off by default and remembered per browser (`localStorage` key `flare-dispatcher-show-done`, wrapped in try/catch). A hidden incident can't stay selected; the detail falls back to the top active one.
- Responder: full-width two-column layout (single column under 960px). The mission bar puts unit/service/status and a large progress bar beside one primary action: Accept assignment → Mark en route → Mark on scene → Complete response.
- Essentials card: incident type, priority, and chips only for reported alarming facts (violent threat, weapon, suspect count, fire, trapped, not breathing/conscious, injury, caller status), plus the summary. Other known facts and the unknown list sit in a collapsed "Additional incident details".
- Location card (shared by both views): map when the caller shared coordinates, labelled with its source and "unverified"; typed text otherwise, labelled "Caller typed location · unverified" with no map. Coordinates are never invented.
- Checks: `npm run typecheck -w @flare/web`, `npm test -w @flare/web` (9/9), `npm run build -w @flare/web` pass. **Not done:** visual browser pass (extension unavailable); check 1440px and phone width by eye.

## Intake priority correction (2026-10-04)

Unclassified reports and pending/failed extraction now show **Needs assessment** instead of falling back to Low. Existing explicit High/Critical facts retain their priority during extraction. Queue order is Critical, High, Needs assessment, Medium, then oldest first within each group.

An explicit first-person statement such as "Help im dying" or "I'm going to die" raises the display priority to High and shows a distress review notice in both operator views. The detector uses caller messages in the current case, their English translations, and callerStatus; operator/agent text and summaries do not trigger it. A later location answer does not hide an earlier distress report. This is a narrow attention cue for operator review, not a general medical classifier. Breathing/injury facts stay unknown until supported, and service recommendations/assignments continue through the existing rules and human confirmation.

Verified `npm run check`: 104 tests (14 web tests), all workspace/script typechecks, and production build passed. A synthetic browser preview verified High plus the distress notice for "Help im dying", Needs assessment for an unclassified report, queue ordering, and the assigned responder's High badge/notice; no browser console errors. Screenshot: ignored `.flare/screenshots/intake-priority.jpg`. No phone worker or database was used by the UI preview; no schema migration is needed.

## Light/dark theme toggle (2026-10-04)

- A sun/moon button at the right of the top bar switches themes. With no saved choice, the page follows the OS setting and tracks OS changes live. A click saves `light` or `dark` in `localStorage` key `flare-theme` (try/catch; falls back to this page load only).
- `index.html` applies the saved theme before first paint, so there's no flash of the wrong theme.
- `styles.css`: every hard-coded color is now a token on `:root`. Dark values are declared under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])` and again for `:root[data-theme="dark"]`. Map tiles are dimmed in dark mode. The pin keeps its white fill because it always sits on map tiles.
- Checks: `npm run typecheck -w @flare/web`, `npm test -w @flare/web` (9/9), `npm run build -w @flare/web` pass. **Not done:** visual pass in both themes (browser extension unavailable). Check chip, notice and severity contrast in dark mode by eye.
