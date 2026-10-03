# Person 3 — SpacetimeDB, contracts, and data access

Make Flare's shared state correct and usable by your three teammates. Spectrum carries iMessage, Gemini extracts caller facts, and SpacetimeDB persists facts and coordinates human decisions. You have ten hours.

Read the [shared handoff](../../handoff.md) and [authoritative contract](../CONTRACT.md). The application, scripts, and checks are implementation targets. Coordinate any contract conflict before building dependent code.

## Ownership and immediate output

Own `spacetime/`, `packages/contracts/`, `packages/data/`, and `docs/CONTRACT.md`. Keep generated client bindings under `packages/data/`; generate them from the published module and never edit them manually. Coordinate root dependencies and lockfile changes with Person 1. You alone publish schema changes to the shared integration database and perform announced demo resets.

Within 30 minutes, agree extraction contracts with Person 2 and adapter interfaces with Persons 1 and 4. Publish TypeScript contracts first. Deliver one real incident insertion observed through a subscription, plus three seeded mock units. Share bindings and connection instructions immediately.

## State and operations

Persist incidents, assignments, units, conversations, inbound messages, notification jobs, and authorized demo identities. Keep raw messages and routing/context private; expose authorized projections containing only what each consumer needs. Hiding a column in React does not restrict database access. Bootstrap agent, dispatcher, and responder identities through trusted setup, not a client-selectable role string.

Use these independent state machines:

- Incident: `COLLECTING → READY_FOR_REVIEW → DISPATCHED → RESOLVED`.
- Assignment: `OFFERED → ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED`.
- Unit: `AVAILABLE | BUSY`.

Implement the contract's named application operations using the pinned SpacetimeDB SDK:

- `applyIntakePatch`: authorize the agent, check message IDs and expected `intakeRevision`, apply the accepted patch, and mark its messages `APPLIED` atomically. Persisting an inbound message as `RECEIVED` must not prevent extraction retry. A duplicate applied batch is harmless; a stale result cannot overwrite newer facts. Intake revision is separate from dispatch and responder progress.
- `confirmDispatchAndAssign`: authorize the dispatcher; check readiness and every selected unit; create assignments, reserve units, set confirmed services and incident state, and enqueue the dispatch notification in one transaction. A failed check leaves all records unchanged.
- `advanceAssignment`: authorize the assigned responder and enforce the next allowed stage. On `EN_ROUTE`, enqueue the caller update transactionally. Complete and release the individual unit according to the contract; other assignments continue independently.
- `resolveIncident`: authorize the dispatcher and require the contract's completion conditions, including all assignments completed.
- `ackNotification`: authorize the agent and record the confirmed delivery outcome without mutating incident facts. Expose pending jobs through the agreed adapter.

Keep recommendations separate from confirmed services. A later caller correction may change recommendations or require review; it cannot silently change assigned units. Preserve omitted fields, represent explicit unknowns as null, and distinguish false from unknown. Gemini and Spectrum calls belong in Person 1's Node process; reducers only commit state.

## Integration checkpoints

| By | Reviewable result |
|---|---|
| 1.5 hours | Contracts, bindings, real create/subscribe proof, three units, connection settings shared. |
| 3 hours | Intake, atomic assignment, responder advance, and notification rows support the full live loop. |
| 5 hours | Corrections, duplicate/stale checks, independent assignments, and retryable received messages work. |
| 7 hours | Identity/read restrictions, double-booking conflict, reload recovery, and repeatable reset verified. |
| 10 hours | Frozen schema, reproducible setup, documented limitations, and rehearsed demo support. |

Person 1 needs persisted context and notifications; Person 2 needs patch semantics; Person 4 needs projections, errors, and identity setup. Announce schema changes; merge contracts, reducers, and regenerated bindings together. Normalize database-specific IDs/timestamps in the thin adapter.

## Acceptance and handoff

Demonstrate two simultaneous reservations of one unit: exactly one succeeds and the loser sees a conflict. Verify duplicate intake creates no extra incident, stale patches preserve the latest correction, failed extraction remains retryable, and one responder cannot advance another responder's assignment. Reload clients and restart the agent without losing state. Confirm unauthorized subscriptions cannot obtain raw conversation data.

Provide seed, reset, publish, generate-bindings, and focused-check scripts as implementation targets; document their actual commands only after creating and running them. Reset must target the agreed demo database and preserve/recreate authorized identities. Record versions, connection settings without secrets, checks, and remaining failures in your workstream's `HANDOFF.md`.

Official references: [TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/), [reducer transactions and isolation](https://spacetimedb.com/docs/functions/reducers/), [table access](https://spacetimedb.com/docs/tables/access-permissions/), [TypeScript client](https://spacetimedb.com/docs/clients/typescript/). Match examples to the installed version.

## Standalone Claude prompt

```text
We are four equally experienced teammates building Flare in ten hours. Flare is a clearly labelled simulation: Spectrum iMessage → Gemini caller-fact extraction → SpacetimeDB → dispatcher assignment → responder progress → simulated iMessage update.

You are Person 3. Read handoff.md, docs/CONTRACT.md, this role guide, and repository instructions. Own only spacetime/, packages/contracts/, packages/data/, and docs/CONTRACT.md. Coordinate root changes with Person 1. Publish contracts and generated bindings early. First deliver one real insert/subscription update and three seeded units within 90 minutes; support the complete loop by hour three.

Follow the contract exactly: separate incident/assignment states, RECEIVED versus APPLIED messages, separate intakeRevision, atomic assignment and notification enqueue, agent-only notification acknowledgment, and authorized identities/private context. Keep external API calls outside reducers. Build small reviewable slices; verify stale/duplicate input, concurrent reservation, independent progress, and unauthorized operations. Never claim implementation or tests exist before running them. End each slice with actual commands, evidence, limitations, and a short HANDOFF.md. Do not expand scope or change another owner's files without coordination.
```
