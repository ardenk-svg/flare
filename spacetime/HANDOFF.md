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

- **Person 1 (agent):** `connectFlare({ uri, database, token })`, then `recordInbound` → `getConversationContext` → `extractTurn` → `applyIntakePatch` / `completeInboundWithoutPatch` / `recordExtractionFailure`. On `FlareOpError` with code `STALE_REVISION`, reload context and retry the pending messages. Send notifications with `onNotification` / `listPendingNotifications`, then `ackNotification`. The generated bindings use extensionless imports, so run them with `tsx` or a bundler, not plain `node`.
- **Person 2 (intake):** types come from `@flare/contracts` (`"@flare/contracts": "file:../contracts"`). Evidence quotes must be exact substrings of the caller message, or the backend rejects them.
- **Person 4 (web):** use either the adapter functions (`listIncidents`, `listAssignments`, `listUnits`, `getMyRole`, `confirmDispatchAndAssign`, `advanceAssignment`, `resolveIncident`) or `spacetimedb/react` with `tables.incidentView`, `tables.assignmentView`, `tables.unitView`, and `tables.myRole` from `@flare/data`. Row mappers: `toIncident`, `toAssignment`, `toUnit`.

Env names (proposed, values local only): `SPACETIMEDB_URI` (e.g. `ws://127.0.0.1:3000`), `SPACETIMEDB_DATABASE`, plus a per-client token.

## Design notes

- All tables are private. Clients read only the role-gated views `my_role`, `unit_view`, `incident_view`, `assignment_view`, `agent_conversation`, `agent_inbound`, and `agent_notification`. Raw messages and conversation keys are visible only to `AGENT`.
- Patches are sent as `FactChange[]` with a `FactValue` of `Unknown | Bool | Count | Text`, so omitted fields, explicit null, and false stay distinct. The adapter converts this from `CallerFactPatch`.
- Reducers run serializably, so of two simultaneous reservations one wins and the other gets `UNIT_CONFLICT`.
- Notification text is rendered at commit time with a `[SIMULATION]` label. `eventAt` and `eventAssignmentStatus` let the agent present an old job as a past event.

## Checks run (local, in-memory server)

`npm run check` in `packages/data`: 47/47 passed on 3 consecutive runs. It covers duplicate inbound, extraction failure retry, evidence validation, stale revision, correction, unknown versus false, authorization (outsider, wrong role, wrong responder), view read restrictions, dispatch/notification atomicity, skipped stages, status queries, post-dispatch review flags, ack/failed delivery, resolve preconditions, independent assignments, concurrent reservation conflicts, and reconnecting with the same token.

## Not done / open

- Not yet published to a shared integration or maincloud database, and no team announcement yet.
- No root workspace: packages link through `file:` dependencies. Person 1 may convert them to npm workspaces.
- Restarting the server with `--in-memory` loses data. For persistence, run without `--in-memory`.
- Views use full-table `iter()`. The docs recommend indexed lookups. This is fine at demo scale and has not been load-tested.
- Expected rejections appear as `ERROR` lines in `spacetime logs`. They are reducer `SenderError`s, not crashes.
- No live Photon or Gemini traffic has gone through this yet. Checks use synthetic extraction results.
