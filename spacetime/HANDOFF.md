# Person 3 handoff — SpacetimeDB, contracts, data adapter

Covers `spacetime/` (module), `packages/contracts/` (shared types), and `packages/data/` (adapter and generated bindings). Operation semantics: [docs/CONTRACT.md](../docs/CONTRACT.md#implemented-v1-surface).

## Versions

- SpacetimeDB CLI 2.10.2 (`curl -sSf https://install.spacetimedb.com | sh`), npm `spacetimedb` 2.10.2
- TypeScript ~5.9.3, Node 25.7 (tested), `tsx` for running TypeScript in Node

## Local setup (verified)

```sh
spacetime start --listen-addr 127.0.0.1:3000 --in-memory   # separate terminal
cd spacetime && npm install
npm run publish:local        # database flare-dev; override with FLARE_DB=...
npm run generate             # regenerates packages/data/src/bindings
cd ../packages/contracts && npm install
cd ../data && npm install && npm run typecheck
npm run check                # live checks; RESETS the local database first
```

The identity that publishes becomes `ADMIN`, and `init` seeds `FIRE-01`, `EMS-01`, and `POLICE-01`.

## Shared integration database (Maincloud)

Only Person 3 publishes or resets the shared database. Announce every publish and reset.

```sh
spacetime login                                   # one-time GitHub sign-in in the browser
FLARE_DB=<agreed-name> npm run publish:shared     # from spacetime/; the publishing identity becomes ADMIN
npm run generate                                  # if the schema changed; commit the regenerated bindings
```

The shared database is `flare-yyehc`. Clients connect with `SPACETIMEDB_URI=wss://maincloud.spacetimedb.com` and `SPACETIMEDB_DATABASE=flare-yyehc`. Grant roles with the commands below, using `--server maincloud` in place of `--server local`. A schema change that is not additive needs `--delete-data`. That wipes the shared state, so announce it first and re-grant roles afterwards.

## Identities and roles

Each client keeps its own token. `connectFlare` returns `identityHex` and `token`. Persist the token, such as in `localStorage` or the agent's local env, so the identity stays the same. Grant roles from the publisher's CLI:

```sh
spacetime call --server local flare-dev grant_role <identityHex> AGENT '{"none":[]}'
spacetime call --server local flare-dev grant_role <identityHex> DISPATCHER '{"none":[]}'
spacetime call --server local flare-dev grant_role <identityHex> RESPONDER '{"some":"FIRE-01"}'
spacetime call --server local flare-dev revoke_role <identityHex>
spacetime call --server local flare-dev reset_demo      # keeps grants; clears incidents/messages; reseeds units
```

Use separate browser profiles for the dispatcher and the responder, because tabs in one profile share `localStorage`.

## For teammates

- **Person 1 (agent):**
  - Connect with `connectFlare({ uri, database, token })`.
  - For each message: `recordInbound` (with `route: { platform, spaceId: space.id, line: space.phone ?? null }`) → `getConversationContext` → `extractTurn` → `applyIntakePatch`, `completeInboundWithoutPatch` or `recordExtractionFailure`.
  - On `FlareOpError` code `STALE_REVISION`, reload context and retry the pending messages. On `STALE_CASE`, drop that work.
  - At startup, drain `listPendingConversationContexts` and `listPendingNotifications`, subscribe with `onNotification`, reopen each job's `route`, send, then `ackNotification`. The generated bindings use extensionless imports, so run them with `tsx` or a bundler, not plain `node`.
- **Person 2 (intake):** types come from `@flare/contracts` (`"@flare/contracts": "file:../contracts"`). Evidence quotes must be exact substrings of the caller message, or the backend rejects them.
- **Person 4 (web):** map `Incident.extractionState` (`OK | PENDING | FAILED`) directly. `extractionError` holds the sanitized message. Use either the adapter functions (`listIncidents`, `listAssignments`, `listUnits`, `getMyRole`, `confirmDispatchAndAssign`, `advanceAssignment`, `resolveIncident`) or `spacetimedb/react` with `tables.incidentView`, `tables.assignmentView`, `tables.unitView`, and `tables.myRole` from `@flare/data`. Row mappers: `toIncident`, `toAssignment`, `toUnit`.

Env names (proposed, values local only): `SPACETIMEDB_URI` (e.g. `ws://127.0.0.1:3000`), `SPACETIMEDB_DATABASE`, plus a per-client token.

## Design notes

- All tables are private. Clients read only the role-gated views `my_role`, `unit_view`, `incident_view`, `assignment_view`, `agent_conversation`, `agent_inbound`, and `agent_notification`. Raw messages and conversation keys are visible only to `AGENT`.
- Each conversation stores a route (`routePlatform`, `routeSpaceId`, `routeLine`) and a `caseEpoch`. Inbound messages and incidents record their `caseEpoch`. `resolveIncident` advances the epoch and clears question fields. Agent views show only current-case messages.
- Patches are sent as `FactChange[]` with a `FactValue` of `Unknown | Bool | Count | Text`, so omitted fields, explicit null, and false stay distinct. The adapter converts this from `CallerFactPatch`.
- Reducers run serializably, so of two simultaneous reservations one wins and the other gets `UNIT_CONFLICT`.
- Notification text is rendered at commit time with a `[SIMULATION]` label. `eventAt` and `eventAssignmentStatus` let the agent present an old job as a past event.

## Checks run (local, in-memory server)

`npm run check` in `packages/data`: 64/64 passed on 6 consecutive runs (integration-state branch). New checks:
- `PENDING → OK`, `PENDING → FAILED` (facts and revision kept), and a successful retry back to `OK`
- case A resolved → case B in the same conversation: empty facts, summary and question, only its own messages, a separate incident; case A history kept
- `STALE_CASE` and old-case evidence rejected
- route stored but invisible to dispatcher, responder and outsider
- reconnect with the agent token lists pending intake and unacknowledged notifications, with their routes

Earlier checks cover duplicate inbound, extraction failure retry, evidence validation, stale revision, correction, unknown versus false, authorization (outsider, wrong role, wrong responder), view read restrictions, dispatch/notification atomicity, skipped stages, status queries, post-dispatch review flags, ack/failed delivery, resolve preconditions, independent assignments, concurrent reservation conflicts, and reconnecting with the same token.

## Not done / open

- Not yet published to Maincloud. Run `spacetime login`, then `npm run publish:shared` after this PR merges. Then collect identity hexes from Persons 1 and 4 and grant roles.
- The route field mapping (`space.id`, `space.phone`) comes from the `@spectrum-ts/imessage` 12.10.1 type definitions. Person 1 should confirm it against a live inbound event.
- `spacetime/` stays outside the root workspace, as `NEXT_STEPS.md` requires. `packages/*` have their own lockfiles and `file:` dependencies. Root `npm ci` currently fails on lockfile drift, which Person 1 reconciles.
- Restarting the server with `--in-memory` loses data. For persistence, run without `--in-memory`.
- Views use full-table `iter()`. The docs recommend indexed lookups. This is fine at demo scale and has not been load-tested.
- Expected rejections appear as `ERROR` lines in `spacetime logs`. They are reducer `SenderError`s, not crashes.
- No live Photon or Gemini traffic has gone through this yet. Checks use synthetic extraction results.
