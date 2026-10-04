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

The identity that publishes becomes `ADMIN`. `init` and `reset_demo` seed `FIRE-01/02`, `EMS-01/02`, and `POLICE-01/02`.

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

- All tables are private. Clients read only role-gated views. `agent_conversation`, `agent_inbound`, and `agent_notification` keep routing/context agent-private; `incident_conversation_view` and `incident_event_view` expose case transcripts and activity to dispatcher/admin identities only. Responders cannot read transcripts, and no dispatcher projection contains route fields or phone handles.
- Each conversation stores a route (`routePlatform`, `routeSpaceId`, `routeLine`) and a `caseEpoch`. Inbound messages and incidents record their `caseEpoch`. `resolveIncident` advances the epoch and clears question fields. Agent views show only current-case messages.
- Patches are sent as `FactChange[]` with a `FactValue` of `Unknown | Bool | Count | Text`, so omitted fields, explicit null, and false stay distinct. The adapter converts this from `CallerFactPatch`.
- Reducers run serializably, so of two simultaneous reservations one wins and the other gets `UNIT_CONFLICT`.
- Notification text is rendered at commit time with a `[SIMULATION]` label. `eventAt` and `eventAssignmentStatus` let the agent present an old job as a past event.

## Checks run (local, in-memory server)

The coordinated [PR #33](https://github.com/ardenk-svg/flare/pull/33) recorded 97/97 checks on its console-schema branch. This workspace incorporates that #28/#29 implementation and adds stricter finite accuracy/nonempty message-ID validation plus regression coverage. `FLARE_DB=flare-issue28-batch npm run check:data:live`: **134/134 passed** against a local, in-memory SpacetimeDB 2.10.2 server on October 3, 2026. Checks include:
- six-unit seed
- new facts stored by kind, and a mismatched kind rejected
- `recordSharedLocation`: agent-only, range and source validation, opens a partial incident, a duplicate is a no-op, satisfies the location gate, visible to the dispatcher
- transcript: order, sent and failed agent rows, case isolation, pin line, denied to responders and the agent
- event log: a full report → dispatch → completed → resolved run, plus close-without-dispatch
- route privacy extended to the new views
- older fact objects default new fields to null; explicit false and zero survive corrections
- both IMESSAGE_PIN and FIND_MY, zero coordinates/accuracy, omitted metadata, invalid and non-finite coordinates/accuracy, blank IDs
- location delivery does not overwrite a duplicate, replaying a closed case does not reopen it, and a fresh pin starts an isolated case
- typed-location removal still leaves a pin-located report ready; post-dispatch pins flag review without changing assignments
- two same-service units can be assigned together, leaving no available unit of that service

Root `npm run check` passes, and the web `smoke:live` passes. The smoke now expects 6 units.

Close-without-dispatch checks:
- only a dispatcher can close
- a reason is required
- dispatched incidents can't be closed
- CLOSED stores the reason, starts a new case, clears the question, and queues one simulated reply
- a closed incident can't be dispatched or closed again
- the next message creates a clean incident
- READY_FOR_REVIEW can also be closed

Root `npm run check` passes, and `FLARE_DB=flare-check npm run smoke:live -w @flare/web` passes.

Integration-state checks (64):
- `PENDING → OK`, `PENDING → FAILED` (facts and revision kept), and a successful retry back to `OK`
- case A resolved → case B in the same conversation: empty facts, summary and question, only its own messages, a separate incident; case A history kept
- `STALE_CASE` and old-case evidence rejected
- route stored but invisible to dispatcher, responder and outsider
- reconnect with the agent token lists pending intake and unacknowledged notifications, with their routes

Earlier checks cover duplicate inbound, extraction failure retry, evidence validation, stale revision, correction, unknown versus false, authorization (outsider, wrong role, wrong responder), view read restrictions, dispatch/notification atomicity, skipped stages, status queries, post-dispatch review flags, ack/failed delivery, resolve preconditions, independent assignments, concurrent reservation conflicts, and reconnecting with the same token.

## Maincloud deployment for #28 and #29

The shared database has not been republished from this workspace. The nested `facts` upgrade was rejected in an isolated local migration test with `requires a manual migration`; the appended defaulted location column is additive by itself. SpacetimeDB documents this distinction in [Automatic Migrations](https://spacetimedb.com/docs/databases/automatic-migrations/).

After the combined change is reviewed and the designated schema owner coordinates the reset, announce that **all demo records and role grants will be erased**. Securely retain the existing client identity hexes and role/unit assignments before resetting. From `spacetime/`, the single combined publish is:

```sh
spacetime publish --server maincloud --module-path . flare-yyehc --delete-data --yes
```

The publisher regains ADMIN and `init` seeds all six units. Re-grant AGENT, DISPATCHER, and each RESPONDER with its original unit using the commands above with `--server maincloud`. Existing `FIRE-01`, `EMS-01`, and `POLICE-01` IDs remain valid; restart clients with these generated bindings. Announce the completed publish and restored grants. Do not run `check:data:live` against Maincloud; it resets its target database.

## Not done / open

- `flare-yyehc` on Maincloud: the #28 facts change alters the nested `facts` struct, which SpacetimeDB rejects as a breaking change (verified locally). Publishing it needs `--delete-data`. That wipes incidents and **role grants**. Re-grant ADMIN (automatic for the publisher), DISPATCHER, RESPONDER, and AGENT afterwards.
- Role grants are pending: `AGENT` needs Person 1's hex, which `npm run agent:imessage` prints on first connect. `DISPATCHER` and `RESPONDER FIRE-01` need Person 4's browser hexes.
- The route field mapping (`space.id`, `space.phone`) comes from the `@spectrum-ts/imessage` 12.10.1 type definitions. Person 1 should confirm it against a live inbound event.
- `spacetime/` stays outside the root workspace, as `NEXT_STEPS.md` requires.
- Restarting the server with `--in-memory` loses data. For persistence, run without `--in-memory`.
- Views use full-table `iter()`. The docs recommend indexed lookups. This is fine at demo scale and has not been load-tested.
- Expected rejections appear as `ERROR` lines in `spacetime logs`. They are reducer `SenderError`s, not crashes.
- No live Photon or Gemini traffic has gone through this yet. Checks use synthetic extraction results.

## Dispatcher conversation control (2026-10-04)

Added a private `conversation_control` table and AGENT/DISPATCHER/ADMIN view; regenerated all bindings with CLI 2.10.2. `takeOverConversation`, `releaseConversation` and `sendDispatcherMessage` enforce owner/role/open-case checks. Replies are deduplicated per case and dispatcher, labelled as simulated, queued durably, and attributed as DISPATCHER in the transcript through acknowledgment. Responders cannot read ownership or transcripts.

The module typecheck/build passed. The isolated loop harness passed ownership conflict, forbidden responder takeover, forbidden non-owner send, transcript attribution/deduplication, release and complete FIRE/EMS/POLICE lifecycles. The additive publish to local `flare-dev` on port 3000 preserved its DISPATCHED incident and role grants. Recovering a real received Find My card's cached coordinates preserved assignments and flagged location review. Historical synthetic-only integration notes above describe the earlier checks; no shared Maincloud migration was run.
