# Person 4 — Dispatcher and responder web app

Build one React/Vite application with `/dispatcher` and `/responder` routes. Demonstrate a caller correction changing the same incident in both views, followed by human assignment and live responder progress.

Read the [shared handoff](../../handoff.md) and [authoritative contract](../CONTRACT.md). Routes, scripts, and checks are implementation targets. Prioritize a working shared loop within the ten-hour schedule.

## Ownership and dependencies

Own `apps/web/`. Person 3 supplies contracts, bindings, data access, and permissions. Person 1 coordinates root dependencies and lockfile changes. Person 2 supplies fixtures and the demo checklist. Coordinate edits outside your directory.

Start both routes against one contract-shaped fixture, visibly labelled. Share connection, status, facts, location, and error components. Switch to Person 3's actual subscription adapter immediately when available; no second backend or polling loop.

## Dispatcher route

Render a live incident queue and a selected incident detail panel. Show the summary, typed location, caller facts, unknowns, permitted supporting evidence, extraction pending/failed state, recommendations with rule reasons, confirmed services, and assignments. Keep the last verified facts visible while extraction is pending or fails.

Use incident states `COLLECTING`, `READY_FOR_REVIEW`, `DISPATCHED`, and `RESOLVED`. Show incomplete reports; readiness follows the contract's minimum information requirements.

Select available seeded units through one `confirmDispatchAndAssign` action. Show pending state, reservation conflicts, and reducer errors beside the action. Refresh choices from subscriptions. Distinguish recommendations from confirmed services; caller corrections cannot silently change dispatcher decisions.

Display each assignment's progress independently. Offer `resolveIncident` only when the contract permits it, while keeping server-side validation authoritative. A completed responder assignment does not resolve the whole incident automatically.

## Responder route

Show the current authorized responder's assignment, incident summary, typed location, relevant facts, and assigned unit. Present the sequential controls `Accept → En Route → On Scene → Complete`, mapping to assignment stages `OFFERED → ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED` through `advanceAssignment`.

Disable an action while it is pending and show any failure clearly. Render committed subscription state as truth; do not leave a successful-looking stage after the backend rejects it. Keep incident lifecycle and assignment stage separately labelled. If two units are assigned, advancing one must leave the other's stage unchanged.

Show connection, loading, empty, and failure states. During disconnection, disable mutations and mark cached data stale until reconnection completes.

## Identity and presentation

Work with Person 3 to provision distinct authorized dispatcher and responder identities. Use separate browser profiles or devices for the live demo; two routes or ordinary tabs sharing one stored token do not establish different identities. Show the active demo role/unit so setup mistakes are apparent. Do not ship a full login interface or let a role dropdown grant backend permissions.

Use labels such as “Simulated dispatch” and “Mock unit.” A location text card is sufficient; skip maps, routing, live location, animations, and attachments. Read authorized incident projections, not raw conversation tables.

## Integration checkpoints

| By | Reviewable result |
|---|---|
| 1.5 hours | Both routes render the same fixture with consistent states and basic controls. |
| 3 hours | Real subscriptions plus assignment/advance actions work in the complete live loop. |
| 5 hours | Corrections, unknown facts, independent assignments, and mutation errors are visible. |
| 7 hours | Separate identities, reconnect/reload, double-booking feedback, and readable judging layout verified. |
| 10 hours | Frozen UI, stable demo setup, screenshots supplied, and repeated rehearsals completed. |

Report missing fields/errors to Person 3 and integration failures to Person 1. Supply URLs and screenshots to Person 2. At hour three, prioritize any broken integration boundary.

## Acceptance and handoff

With two authorized clients open, confirm a new report and a correction update both views without refresh. Assign a unit, advance it, and observe committed changes on the other screen. Verify a rejected assignment shows an error without false success; one completed assignment leaves another active. Check that reload restores subscribed state and an unauthorized reducer attempt is rejected by the backend.

Create frontend development, typecheck, and build scripts as implementation targets; publish commands only after implementing and running them. Record route URLs, environment variable names, identity/profile setup, validation, and remaining issues in `apps/web/HANDOFF.md`. Never put Gemini or Photon secrets in browser configuration.

Official references: [SpacetimeDB React quickstart](https://spacetimedb.com/docs/quickstarts/react/), [TypeScript subscriptions and reducers](https://spacetimedb.com/docs/clients/typescript/), [React](https://react.dev/learn), [Vite](https://vite.dev/guide/). Use versions pinned by the team and generated bindings supplied by Person 3.

## Standalone Claude prompt

```text
We are four equally experienced teammates building Flare in ten hours. Flare is a clearly labelled simulation: Spectrum iMessage → Gemini caller-fact extraction → SpacetimeDB → dispatcher assignment → responder progress → simulated iMessage update.

You are Person 4. Read handoff.md, docs/CONTRACT.md, this role guide, and repository instructions. Own apps/web/ only. Build one React/Vite app with /dispatcher and /responder, shared components, and Person 3's real subscription/reducer adapter. Coordinate root dependencies with Person 1; do not edit generated bindings. First show both fixture-backed routes within 90 minutes, then integrate the complete live loop by hour three.

Use exact contract states and actions. Show caller corrections, unknown facts, evidence, extraction/connection failures, recommended versus confirmed services, and independent assignment stages. Confirm dispatch atomically through the backend; never imply success after a rejection. Use separate authorized identities/browser profiles, not route-based authorization. Keep all views labelled as simulations and API secrets server-side. Skip maps and extras. Work in small reviewable slices and verify live updates, conflicts, reload/reconnect, and independent progress. End with actual commands, validation evidence, limitations, and apps/web/HANDOFF.md.
```
