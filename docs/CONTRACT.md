# Flare integration contract

This is the proposed v1 application contract for the ten-hour build. Person 3 owns it with input from the other three teammates. The shared TypeScript types are in `packages/contracts/`; see [Implemented v1 surface](#implemented-v1-surface). This document defines application semantics, not exact Spectrum, Gemini, or Spacetime SDK signatures. Use actual generated bindings behind the thin data adapter.

Read the [shared handoff](../handoff.md) first. Change this contract, exported types, fixtures and consumers together; do not independently rename fields.

## Data boundaries

| Boundary | Producer → consumer | Owns |
|---|---|---|
| `InboundTurn` | Person 1 → Person 2 | Trusted message/context envelope |
| `ExtractionOutcome` | Person 2 → Person 1 | A validated `ExtractionResult` or a typed extraction failure |
| `Recommendation` | Person 2's pure rules → Persons 1 and 3 | Simulated recommended services and matching rule reasons |
| Intake operations | Person 1 → Person 3's adapter | Validated persistence, deduplication, context |
| Subscribed incident/assignment view | Person 3 → Person 4 | Authorized server state |
| Dispatch/responder operations | Person 4 → Person 3 | Human-authorized state transitions |
| Notification jobs | Person 3 → Person 1 | Committed updates ready for iMessage delivery |

Use strings for application IDs and ISO 8601 UTC timestamps at these TypeScript boundaries. Person 3 maps them to the database's native generated types in the adapter. Keep wire-format conversions out of Gemini and web components.

## Caller facts and extraction

The materialized `CallerFacts` record has these fields. Unknown values are `null`; initialize all fields to `null`.

| Field | Value type |
|---|---|
| `incidentType` | string or null; a brief caller-supported label |
| `locationText` | string or null; preserve building and entrance wording |
| `peopleInvolved` | nonnegative integer or null |
| `callerReportedConscious` | boolean or null |
| `callerReportedBreathing` | boolean or null |
| `fireOrSmoke` | boolean or null |
| `trappedPerson` | boolean or null |
| `violentThreat` | boolean or null |
| `injuryReported` | boolean or null |
| `weaponPresent` | boolean or null; robbery, assault |
| `suspectCount` | nonnegative integer or null; robbery, assault |
| `callerStatus` | string or null; a short caller phrase such as "hiding", "safe", "injured" |
| `vehicleCount` | nonnegative integer or null; traffic collisions |
| `patientAge` | nonnegative integer or null; medical, as reported |
| `roadBlocked` | boolean or null; traffic |

These are caller reports, not verified observations. Ambiguous language stays unresolved; do not infer consciousness or breathing from a vague phrase. Coordinates come only from the separate provider-shared location operation. A typed location must not produce invented coordinates.

`CallerFactPatch` has the same field names, each optional and nullable. Omitted means retain the stored value, null explicitly clears a claim to unknown/unresolved, and false requires an explicit negative. A correction replaces the previous caller claim with new evidence. Merge the patch into current facts before calculating recommendations.

Proposed application types, to be implemented by Person 3:

```ts
type Intent = "REPORT" | "CORRECTION" | "STATUS_QUERY" | "OTHER";
type Service = "POLICE" | "FIRE" | "EMS";
type CallerFactField = keyof CallerFacts;
type CallerFactPatch = Partial<CallerFacts>;

interface CallerMessage {
  id: string;              // supplied by the messaging adapter
  text: string;
  receivedAt: string;      // ISO UTC, supplied by the adapter
}

interface InboundTurn {
  hasSharedLocation?: boolean; // trusted presence only; no coordinates enter extraction
  conversationKey: string; // trusted internal routing key
  intakeRevision: number;
  messages: CallerMessage[];       // new ordered caller messages
  recentMessages: CallerMessage[]; // bounded prior caller context
  currentFacts: CallerFacts;
  currentSummary: string;
  lastQuestion: string | null;
}

interface ExtractionResult {
  intent: Intent;
  patch: CallerFactPatch;
  summary: string;
  evidence: Array<{
    field: CallerFactField;
    messageId: string;
    quote: string;
  }>;
  corrections: CallerFactField[];
  unresolvedFields: CallerFactField[];
  proposedQuestion: string | null;
}

interface Recommendation {
  services: Service[];
  ruleIds: string[];
  reason: string;
}

type ExtractionOutcome =
  | { ok: true; result: ExtractionResult }
  | { ok: false; error: {
      code: "TIMEOUT" | "RATE_LIMIT" | "INVALID_OUTPUT" | "PROVIDER_ERROR";
      message: string; // sanitized explanation, never credentials
      retryable: boolean;
    }};

// App-owned functions; not SDK methods.
declare function extractTurn(turn: InboundTurn): Promise<ExtractionOutcome>;
declare function recommendServices(facts: CallerFacts): Recommendation;
```

Validate field types, exact source quotes, and message IDs against the supplied caller messages. Every changed fact, including a correction or clearing it to null, needs supporting evidence. An extraction cannot invent an identifier or modify backend lifecycle/assignment fields. The summary must describe supported facts and preserve uncertainty; do not use it as an independent fact source for rules.

`STATUS_QUERY` returns no fact changes. The orchestrator responds from committed state; it may implement an obvious status-query shortcut before calling Gemini. If there is no active incident, say so without creating one. `OTHER` must not create an incident by itself. Complete these messages through `completeInboundWithoutPatch` so they do not replay after restart; do not call `applyIntakePatch` for them. A report/correction with no existing active incident can create a partial incident after successful validation; keep only one active incident per conversation for the MVP.

The orchestrator selects at most one relevant clarification from `proposedQuestion`, known facts and the last question. Do not repeatedly ask after an explicit unknown response. Persist the actual sent question and its delivery state as conversation context. Extraction failure returns a typed failure from the wrapper, not a fabricated successful result: keep the input available for retry and preserve verified facts.

Provider pins remain separate from typed `locationText`. Pass only their presence as `hasSharedLocation` to extraction and suppress redundant address/location questions at delivery when either a pin or typed location is already committed. If the one-phone Find My share predates the initial report, wait for its scoped snapshot before deciding to ask; use a distinct provider message ID for that snapshot so it does not collide with the report's dedupe key. Do not automatically carry a previous case's share into a new case.

## Demonstration rules

The following are synthetic fixture rules, not clinical or operational triage guidance. Person 2 implements them as a pure function; collect the union of matching services and retain matching rule IDs. Never ask Gemini to decide the services.

| Rule ID | Explicit caller-fact condition | Demo services |
|---|---|---|
| `DEMO_FIRE` | `fireOrSmoke === true` | FIRE |
| `DEMO_TRAPPED` | `trappedPerson === true` | FIRE, EMS |
| `DEMO_INJURY` | `injuryReported === true` | EMS |
| `DEMO_CONSCIOUS` | `callerReportedConscious === false` | EMS |
| `DEMO_BREATHING` | `callerReportedBreathing === false` | EMS |
| `DEMO_THREAT` | `violentThreat === true` | POLICE |

Null/missing facts match no rule. If none match, return an empty list with the reason “No demo rule matched; dispatcher review required.” Do not invent a fallback service. Store `recommendedServices` and `recommendationReason` separately from dispatcher-owned `confirmedServices`.

## Persistent state

| Logical record | Minimum content |
|---|---|
| Incident | ID, conversation relation, case epoch, facts/evidence, summary, intakeRevision, recommended services/reason, confirmed services, status, needsReview, extraction state/error, createdAt/updatedAt |
| Unit | ID, service, AVAILABLE/BUSY |
| Assignment | ID, incident ID, unit ID, assignment status, timestamps |
| Conversation | Internal conversation key, durable provider route, current case epoch, active incident ID, last sent question/delivery state |
| Inbound message | Private conversation/message key, case epoch, text, received timestamp, processing state/error, applied timestamp |
| Notification | ID, destination conversation, incident/assignment reference, event kind, committed event data, delivery attempts/status |
| Outbound message | Agent text actually sent or failed (questions, delivered or failed notifications), with its case and incident, for the dispatcher transcript |
| Incident event | Append-only activity log entry: kind, commit time, optional unit, fields, services, short detail. It never holds message text |

The records above are logical responsibilities; Person 3 may combine related storage when that simplifies the module without changing behavior. Do not duplicate private raw-message data into public subscription tables.

```text
Incident:   COLLECTING → READY_FOR_REVIEW → DISPATCHED → RESOLVED
            COLLECTING | READY_FOR_REVIEW → CLOSED   (dispatcher, never dispatched)
Assignment: OFFERED → ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED
Unit:       AVAILABLE | BUSY
Inbound:    RECEIVED → APPLIED   (handled successfully; failed attempts remain retryable)
```

Readiness requires a useful supported summary and a known location: a nonempty `locationText` or a provider-shared location; optional caller facts may stay unknown. Before dispatch, accepted intake may move readiness in either direction if a correction removes location. After dispatch, keep the lifecycle intact and flag material fact changes for review. Recompute recommendations, but do not silently alter confirmed services or units.

`intakeRevision` advances on accepted extraction results, including an accepted empty patch, and is separate from assignment/lifecycle updates. A status question alone need not advance it. Person 1 serializes extraction per conversation; Person 3 rejects stale expected revisions. On rejection, reload current context and retry the still-unapplied messages. Reserving an input for processing or recording a failure must not mark it APPLIED.

### Durable route, intake cases, and extraction state

- **Durable route.** `recordInbound` stores the latest verified `ConversationRoute { platform, spaceId, line }` on the conversation. For Spectrum iMessage, `platform` is `"imessage"` exactly as `message.platform` emits it, `spaceId` is `space.id`, and `line` is `space.phone`. On Photon's shared-pool plan, `space.phone` is the placeholder value `"shared"`. Store it unchanged: `space.get(spaceId, { phone: "shared" })` still works because shared mode ignores the phone. Reopen the destination with the platform's `space.get(spaceId, …)` after a restart. Never store callbacks or rely on an old `space` object. The route is separate from `conversationKey` and is visible only to the agent.
- **Intake case.** Each conversation has a `caseEpoch` that starts at 1, and each inbound message records the epoch it arrived in. `resolveIncident` and `closeIncident` advance the epoch and clear the last-question fields. Context reads, evidence validation and source IDs use only current-case messages. An earlier-case source fails with `STALE_CASE`, and earlier-case evidence fails with `UNKNOWN_EVIDENCE_MESSAGE`. Earlier rows stay stored as history.
- **Extraction state.** An incident's `extractionState` is `OK | PENDING | FAILED`.
  - Recording new input for an active incident sets `PENDING`.
  - An accepted patch or a no-patch completion sets `OK` and clears the error, unless more current-case input is still RECEIVED, in which case the state stays `PENDING`.
  - `recordExtractionFailure` sets `FAILED` with a sanitized error and leaves facts unchanged.
  - When the first report fails before any incident exists, the failure appears as `lastExtractionError` in the agent's context.
- **Shared location.** `recordSharedLocation` is agent-only. It stores a provider-supplied pin or Find My location as `Incident.sharedLocation` (`latitude`, `longitude`, `accuracyMeters`, `label`, `source` `IMESSAGE_PIN | FIND_MY`, `sharedAt`). If the conversation has no active incident, it opens a partial one. It does not change caller facts or `intakeRevision`. Duplicate provider message IDs are no-ops, including after case closure. The pin is stored as an APPLIED caller message, `[Shared location: <label>]`, so it shows in the transcript. Never derive coordinates from caller prose. Coordinates must be finite and in latitude/longitude bounds; optional accuracy must be finite and nonnegative. Message IDs must be nonempty. `sharedAt` comes from the trusted provider envelope's `receivedAt`; missing optional metadata maps to null. A pin alone leaves the incident COLLECTING until an accepted report supplies a summary. After dispatch, a new location sets `needsReview` while preserving assignments and lifecycle.
- **Human conversation control.** `takeOverConversation` claims an open incident for one dispatcher; a second dispatcher gets `TAKEN_OVER`. `releaseConversation` returns it to the agent (owner or ADMIN). Control is stored separately per incident and cannot carry into the next case. AGENT/DISPATCHER/ADMIN can read the control view; responders cannot. While controlled, extraction still records reports and corrections, but automated questions and generic OTHER replies pause. Caller-requested status replies and unit notifications continue. `sendDispatcherMessage` requires the controlling dispatcher and 1–2000 characters; `(case, dispatcher, clientMessageId)` deduplicates retries. It queues a `DISPATCHER_REPLY` and a `DISPATCHER` transcript row with `QUEUED` delivery. The agent sends on the committed private route and acknowledgment updates that same row to `SENT` or `FAILED`. Closed/resolved incidents reject control and send operations. Every outbound message retains the simulation label.

The `sharedLocation` column is appended with an unknown default. Missing fact fields map to null in the adapter, preserving false and zero. Adding the six fields to the nested database `CallerFacts` type changes the existing `facts` column type: SpacetimeDB 2.10.2 rejects an automatic upgrade (verified against the previous module locally). Batch #28 and #29 for the coordinated Maincloud publish; a development reset with `--delete-data` removes historical incidents and role grants. Adapter defaults do not preserve rows deleted by that reset. See [the deployment handoff](../spacetime/HANDOFF.md#maincloud-deployment-for-28-and-29).
- **Dispatcher console reads.**
  - `incident_conversation_view` (dispatcher only) returns the current case's caller messages and agent messages for each incident, latest 50, as `ConversationMessage` rows.
  - Questions are recorded by `recordSentQuestion`. Each notification gets one row, written when `ackNotification` reports it delivered or failed.
  - `incident_event_view` (dispatcher only) returns the activity log. Event kinds: `INCIDENT_CREATED`, `CALLER_MESSAGE`, `FACTS_UPDATED`, `LOCATION_RECEIVED`, `SERVICES_RECOMMENDED`, `EXTRACTION_FAILED`, `DISPATCH_CONFIRMED`, `UNIT_ASSIGNED`, `UNIT_ACCEPTED`, `UNIT_EN_ROUTE`, `UNIT_ON_SCENE`, `UNIT_COMPLETED`, `CALLER_NOTIFIED`, `INCIDENT_RESOLVED`, `INCIDENT_CLOSED`.
  - Neither view exposes conversation keys, routes, extraction errors, or model output that was never sent.
- **Startup work.** After reconnecting, the agent drains `listPendingConversationContexts` (current-case RECEIVED input) and `listPendingNotifications` (unsent jobs). Both carry the route.

## Application operations

Person 3 implements these behavioral contracts in the data adapter and maps them to actual reducers/subscriptions. Document concrete signatures alongside the implementation; do not assume the SDK returns rows directly from reducers.

| Operation | Authorized caller | Behavior |
|---|---|---|
| `recordInbound` | Agent | Save new source messages idempotently by provider/conversation/message ID; duplicates already APPLIED are no-ops; return or expose current context |
| `recordExtractionFailure` | Agent | Persist a sanitized attempt/error and expose extraction failure for an existing incident; leave input RECEIVED and retryable, with last verified facts intact |
| `applyIntakePatch` | Agent | Validate expected intakeRevision and source IDs; create/update the active incident; apply supported facts/evidence, summary and rule output; mark source messages APPLIED in the same transaction |
| `completeInboundWithoutPatch` | Agent | Mark STATUS_QUERY/OTHER messages APPLIED without creating an incident or changing intakeRevision; optionally queue the intended informational reply in the same transaction |
| `recordSentQuestion` | Agent | Persist the actual sent clarification and delivery metadata without overwriting facts or claiming a failed send succeeded |
| `confirmDispatchAndAssign` | Dispatcher | Require ready incident, explicit confirmed services and matching nonempty selected units; check availability; reserve all units; create OFFERED assignments; set DISPATCHED; queue one confirmation notification atomically |
| `advanceAssignment` | Responder for its unit | Validate the next allowed state; update only that assignment; enqueue a notification on EN_ROUTE; release its unit on COMPLETED |
| `resolveIncident` | Dispatcher | Require DISPATCHED and all assignments COMPLETED; set RESOLVED; end the conversation's active incident association |
| `closeIncident` | Dispatcher | For a test text, duplicate, or report that needs no unit: require COLLECTING or READY_FOR_REVIEW with no assignments and a nonempty reason; set CLOSED with `closeReason`; end the active association and start a new case, as resolve does; queue a simulated INFO_REPLY to the caller |
| Pending-notification subscription / `ackNotification` | Agent | Expose unsent work to the designated worker and record successful delivery/attempt errors |
| Demo seed/reset | Authorized demo administrator | Seed units and role assignments; reset only the agreed demo environment after coordination |

`confirmDispatchAndAssign` is a one-time initial dispatch operation for v1. Reject a second confirmation; later caller corrections flag review but do not offer a misleading working redispatch button. Further reassignment is outside the baseline. All selected units must belong to confirmed service types, and every confirmed service needs at least one selected unit. Two simultaneous reservations of the same unit must yield one success and one explicit conflict.

Here APPLIED means the input was handled successfully: either its intake result committed or it completed without a patch. It does not by itself mean an external reply was delivered. Keep reply delivery in the notification/question acknowledgment records. Clear a previous extraction error on a later successful attempt; if the initial report never produced an incident, expose its failure in agent diagnostics instead of inventing incident facts.

The frontend disables invalid actions, but reducers remain authoritative. Provision roles with an operator-controlled allowlist; do not allow a client to grant itself a dispatcher or administrator role. Dispatcher and responder demos use distinct identities; a URL path is not permission. The agent alone can write intake and messaging state.

Queue dispatch-confirmed and assignment-EN_ROUTE events with enough committed context to render truthful messages. An unsent old event must not claim an outdated state is current: render it explicitly as a past event, coalesce superseded jobs, or skip it after checking current state. Use stable notification IDs, record attempts, and check provider idempotency before assuming retry guarantees. A crash between external send and acknowledgment can still cause duplicate delivery.

## Implemented v1 surface

Types live in `@flare/contracts` (`packages/contracts/src/index.ts`). Operations are functions in `@flare/data` (`packages/data/src/index.ts`) taking a connected `DbConnection`; see [spacetime/HANDOFF.md](../spacetime/HANDOFF.md) for setup.

| Operation | `@flare/data` function | Notes |
|---|---|---|
| `recordInbound` | `recordInbound(conn, { provider, conversationKey, route, messages })` → `ConversationContext` | Dedupe key is provider + conversationKey + message ID. Refreshes the route |
| Context read | `getConversationContext(conn, conversationKey)` | Current case only. `intakeRevision` is `0` while there is no active incident; `pendingMessages` are RECEIVED |
| Startup intake | `listPendingConversationContexts(conn)` | Every conversation with current-case RECEIVED input, oldest first |
| `recordExtractionFailure` | `recordExtractionFailure(conn, { conversationKey, messageIds, error })` | |
| `applyIntakePatch` | `applyIntakePatch(conn, { conversationKey, expectedRevision, sourceMessageIds, result, recommendation })` | REPORT/CORRECTION only. Evidence quotes must be exact substrings of a recorded message in the same conversation. New evidence for a field replaces older evidence for that field |
| `completeInboundWithoutPatch` | `completeInboundWithoutPatch(conn, { conversationKey, messageIds, intent, replyText? })` | `replyText` is queued as an `INFO_REPLY` notification |
| `recordSentQuestion` | `recordSentQuestion(conn, { conversationKey, question, delivered, error? })` | |
| Pending notifications | `listPendingNotifications(conn)`, `onNotification(conn, cb)` | PENDING and FAILED jobs. Each carries `route`, committed `text`, `eventAt` and `eventAssignmentStatus` |
| `ackNotification` | `ackNotification(conn, { notificationId, delivered, error? })` | |
| `confirmDispatchAndAssign` | `confirmDispatchAndAssign(conn, { incidentId, confirmedServices, unitIds })` | |
| `advanceAssignment` | `advanceAssignment(conn, { assignmentId, nextStatus })` | `nextStatus` must be the next stage |
| `resolveIncident` | `resolveIncident(conn, { incidentId })` | |
| `closeIncident` | `closeIncident(conn, { incidentId, reason })` | `Incident.closeReason` holds the reason |
| Reads | `listIncidents`, `listAssignments`, `listUnits`, `getMyRole` | Role-scoped: a responder sees only its unit's assignments and their incidents |
| Shared location | `recordSharedLocation(conn, { provider, conversationKey, route, messageId, receivedAt, latitude, longitude, accuracyMeters?, label?, source })` | Agent only |
| Console reads | `listConversation(conn, incidentId)`, `listIncidentEvents(conn, incidentId)` | Dispatcher only, oldest first |
| Conversation control | `getConversationController(conn, incidentId)`, `takeOverConversation(conn, { incidentId })`, `releaseConversation(conn, { incidentId })` | Claim/release for dispatchers; owner identity is visible to agent/dispatcher/admin |
| Dispatcher reply | `sendDispatcherMessage(conn, { incidentId, text, clientMessageId })` | Requires conversation owner; retry with the same client ID |

Rejected operations throw `FlareOpError` with a `code`: `UNAUTHORIZED`, `NOT_FOUND`, `STALE_REVISION`, `STALE_CASE`, `INVALID_ROUTE`, `PARTIALLY_APPLIED_SOURCES`, `UNKNOWN_MESSAGE`, `INVALID_INTENT`, `INVALID_FIELD`, `INVALID_VALUE_TYPE`, `MISSING_EVIDENCE`, `EVIDENCE_QUOTE_MISMATCH`, `UNKNOWN_EVIDENCE_MESSAGE`, `NOT_READY`, `ALREADY_DISPATCHED`, `UNIT_CONFLICT`, `UNIT_SERVICE_MISMATCH`, `SERVICE_WITHOUT_UNIT`, `INVALID_TRANSITION`, `ASSIGNMENTS_NOT_COMPLETED`, `NOT_CLOSABLE`, `HAS_ASSIGNMENTS`, `REASON_REQUIRED`, `INCIDENT_CLOSED`, `INVALID_LATITUDE`, `INVALID_LONGITUDE`, `INVALID_ACCURACY`, `INVALID_LOCATION_SOURCE`, among others.

Roles are `ADMIN`, `AGENT`, `DISPATCHER`, and `RESPONDER` (bound to one unit). The identity that first publishes the module becomes `ADMIN` and grants the other roles by identity. An identity without a grant sees empty views and cannot call operations.

## Synthetic demo fixture

1. Caller: “Simulation: I see smoke outside.” → `fireOrSmoke: true`; other unsupported facts stay null. Partial incident is COLLECTING; recommendation is FIRE via `DEMO_FIRE`.
2. Agent asks for the building and entrance.
3. Caller: “North entrance of the demo student center.” → populate `locationText`; incident becomes READY_FOR_REVIEW.
4. Caller: “Correction: south entrance, not north.” → replace location on the same incident with evidence from this message; recommendation stays FIRE.
5. Dispatcher confirms FIRE and selects `FIRE-01`; one transaction creates its OFFERED assignment and sets DISPATCHED.
6. Responder accepts then moves EN_ROUTE. Both authorized web clients receive the change. The caller receives clearly labelled simulated status messages.
7. Caller: “Any update?” → report the committed mock assignment state; do not create a new incident or call it real dispatch.

Seed two mock units per service: `FIRE-01/02`, `EMS-01/02`, `POLICE-01/02`. There are no unit locations or ETAs, and the UI must not invent them. Add a separate synthetic trapped-person fixture when testing multi-assignment behavior; it matches `DEMO_TRAPPED`, so completing one assignment must leave the other intact. Test negative and unknown signals separately rather than adding unexplained services to the main demo.

## Integration checks

The first shared smoke test uses actual integrations and both subscribed screens. Then verify: correction retention; unknown versus false; duplicate source IDs; retry after Gemini failure; stale extraction rejection; single-winner unit reservation; independent assignments; restart/reconnect recovery; and rejected unauthorized transitions. Fixtures test the contract even when API credentials are unavailable, but label them separately from live API results.

Record version pins and actual runnable commands in the implementation handoffs. This contract is the agreement to build; it is not evidence that those checks have passed.
