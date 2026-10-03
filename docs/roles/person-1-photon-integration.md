# Person 1 — Photon and integration

Read [the shared handoff](../../handoff.md), then [the contract](../CONTRACT.md), then this document. Your mission is to connect Flare into one continuing iMessage conversation.

Paths, interfaces, scripts, and configuration below are proposed until implemented. The shared contract is authoritative; application interface names are not Spectrum SDK methods.

## Ownership

Own `apps/agent/`, `scripts/`, root workspace/dependency configuration, `.env.example`, and integration instructions in `README.md`. Record actual commands, verification, and remaining failures in `apps/agent/HANDOFF.md` once implemented.

Read the whole repository. Coordinate changes outside your ownership: Person 2 owns extraction/rules, Person 3 owns schema/contracts/bindings/data adapter, and Person 4 owns both web views. Never modify generated bindings manually.

## Deliverables and timing

| Deadline | Deliverable |
|---|---|
| 0:30 | Photon provider/access verified, routing understood, root workspace agreed, contract reviewed with teammates. |
| 1:30 | Actual Spectrum iMessage receive/send plus a terminal harness entering the same normalized handler. |
| 3:00 | Real iMessage → Gemini → Spacetime → dispatcher → responder → return iMessage loop. |
| 5:00 | Corrections, duplicate/revision protection, remembered questions, status inquiries, restart recovery. |
| 7:00 | Delivery failures visible, credentials/setup documented, end-to-end checks run with Person 2. |
| 8:30–10:00 | Freeze features, repeat live runs, record backup, and rehearse. |

Use a persistent Node process. One worker consumes the shared inbox; teammates use fixtures or isolated resources. Merge small runnable PRs every 30–60 minutes; keep `main` runnable.

## Processing and teammate boundaries

1. Normalize trusted provider identifiers/text. Ignore outbound echoes and non-content events. Use typed location; time-box native location exploration to 15 minutes.
2. Store inbound messages through Person 3's adapter; expose a partial incident after the first successful extraction. Persisting `RECEIVED` is distinct from completing `APPLIED` processing. A status inquiry without an active incident must not create a new case.
3. Serialize each conversation. Load facts, ordered messages, last question, and `intakeRevision`. Allow one active incident per conversation; require resolution/reset for a new demo.
4. Call Person 2's `extractTurn(InboundTurn)` outside reducers. Handle the contracted success/failure outcome; on success, merge a validated patch with the current facts, then call `recommendServices(mergedFacts)`. Omitted fields retain their value; `null` means unknown; `false` requires explicit denial.
5. Call Person 3's `applyIntakePatch` with source IDs and expected revision. A stale or duplicate result must not overwrite newer facts. Re-read context before retrying stale work. Atomically accepted facts and message processing status belong to the backend transaction.
6. Persist the last clarification; ask one useful question at a time. Restarting must not re-ask answered questions.
7. Consume committed pending notifications, send to the original conversation, and acknowledge through `ackNotification`. Report only committed simulated state. Answer “Any update?” from the database, never model-invented progress.

Request adapter/identity/retry setup from Person 3 and a callable extractor/fixture from Person 2. Give Person 4 incident IDs and failure states. Intake must not change dispatcher-confirmed services or assignments.

Record delivery attempts/acknowledgments; use provider idempotency only if verified. Document crash-after-send/before-ack duplicate risk. Label outward status updates as simulated.

## Setup and failure handling

Document environment **names only** in `.env.example`; values stay local. Coordinate `GEMINI_API_KEY`, `GEMINI_MODEL`, `SPACETIMEDB_URI`, `SPACETIMEDB_DATABASE`, and the agent identity credential. These are proposed app names. Verify Photon credential names and routing with the selected provider; never guess SDK fields.

Use the [Spectrum introduction](https://photon.codes/docs/spectrum-ts/introduction), [iMessage provider setup](https://photon.codes/docs/spectrum-ts/providers/imessage), [message model](https://photon.codes/docs/spectrum-ts/messages), and [state recovery guidance](https://photon.codes/docs/best-practices/recovery-and-state). Test the provisioned routing rather than assuming a universal reachable number.

Extraction failures retain facts and received reports, expose failure, and allow retry. Delivery failures retain notifications for bounded retry. If Photon is blocked at 1:30, pair with a teammate while others use the harness. Label replays clearly: they do not demonstrate actual Spectrum/iMessage integration.

## Acceptance

- A real iMessage creates one partial incident; a later correction updates it on both screens.
- Duplicate events and stale extraction results cannot create duplicate incidents or reverse corrections.
- Restart preserves the active incident, facts, and last question.
- A committed dispatch/en-route notification reaches the correct conversation; a later status inquiry returns current state.
- Gemini/network failure preserves the last verified facts and allows recovery.
- Secrets never enter code, prompts, logs, or screenshots.

## Claude starter prompt

```text
We are four equal-experience teammates building Flare in 10 hours for MHacks.
It is a simulation: Photon Spectrum/iMessage → Gemini fact extraction →
SpacetimeDB → human dispatcher → responder → simulated iMessage update.

You are helping Person 1. Read CLAUDE.md, README.md, handoff.md,
docs/CONTRACT.md, this role document, and existing contracts before editing.
Read broadly; own apps/agent, scripts, root workspace/dependency configuration,
.env.example, and integration documentation. Coordinate shared types with
Person 3, Gemini/rules with Person 2, and web requirements with Person 4.

Verify the actual Spectrum provider, credentials, routing, and documented SDK
fields. First deliver a real iMessage echo and a terminal harness through the
same normalized handler. Use a persistent Node worker and typed locations.
One designated worker owns the shared inbox. Never invent SDK methods.

Connect extractTurn, recommendServices, and Person 3's data adapter using the
authoritative contract. Persist received messages before extraction, keep
RECEIVED distinct from APPLIED, serialize each conversation, and reject stale
intake revisions. Preserve known facts, questions, and context across restart.
Ask one useful clarification. Return only committed simulated status through
pending notifications and acknowledgments; answer status inquiries from data.
Document external delivery retry/duplicate limitations without claiming
exactly-once sending. Never claim actual emergency services were contacted.

Make the full real loop work by hour three. Produce small reviewable slices;
coordinate root changes, keep secrets local, and do not expand scope. Update
apps/agent/HANDOFF.md with real commands, interfaces, checks, and limitations.
Clearly distinguish live provider checks from fixture or harness checks.
```
