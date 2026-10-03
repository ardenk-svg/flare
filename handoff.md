# Flare shared build handoff

Flare turns an evolving iMessage report into a shared incident response simulation. Gemini interprets caller-reported facts and corrections; SpacetimeDB persists the conversation and coordinates human dispatcher and responder actions. This handoff adapts the original Dispatch proposal to four equally experienced teammates with ten hours and individual Claude Pro subscriptions.

**Build target:** by hour three, one actual iMessage should pass through Gemini and SpacetimeDB, appear on the dispatcher screen, become a mock responder assignment, and produce a clearly labelled simulated update back to the caller. Integrate throughout the event.

**Repository status:** this is the initial documentation package. Application directories, scripts, deployments, and acceptance results below are planned work, not completed features. These documents do not authorize the application to contact real emergency services.

## Shared context and authority

Every person reads this file, [the integration contract](docs/CONTRACT.md), and their role guide. The contract is the single shared definition of types, operation behavior, and state transitions; role guides refer to it instead of defining competing schemas. Person 3 implements the corresponding shared package and generated bindings. Update the document and code together when the team agrees a change.

Use [CLAUDE.md](CLAUDE.md) as the common coding-assistant context. Each person gets a separate clone/branch or worktree and their own Claude session. Sessions do not share memory automatically; checked-in contracts and workstream `HANDOFF.md` files carry context between people.

## MVP and sponsor evidence

| Track | Required product behavior | Evidence to show |
|---|---|---|
| Photon | Spectrum connects the agent to actual iMessage; questions, corrections, and status stay in the conversation | A real phone exchanges messages with the running agent |
| Spacetime | Shared persistent incident, assignment and conversation state; reducers control changes and subscribers receive them | Two authorized clients update without refreshing; a unit cannot be booked twice |
| Gemini | Real API extraction of evolving caller facts, explicit uncertainty, and corrections with supporting message evidence | A caller correction changes the existing live record; a fixture report records actual extraction results |

The team supplied the track criteria; this design is intended to fit them. Confirm any additional event submission requirements with organizers.

Keep typed building/entrance location, three seeded service units, human confirmation, two web views, conversation persistence, and an iMessage status return. Start with one active incident per conversation. A new case starts only after explicit reset or completion; avoid implicit multi-incident reasoning.

Exclude FinchNode, maps, navigation, continuous location, extra agents, image/audio analysis, production login screens, and complex unit scheduling from the ten-hour baseline. Preserve basic backend role checks even though there is no full login product. All examples and data are synthetic. Service rules are demonstration logic, not operational triage standards.

## Architecture

```text
Caller iMessage ⇄ Spectrum in persistent Node agent (Person 1)
                                │
                  Gemini extraction + demo rules (Person 2)
                                │
                    SpacetimeDB state and reducers (Person 3)
                         │                       │
                   Dispatcher route       Responder route
                          one React web app (Person 4)
                                │
                  committed notification → agent → iMessage
```

The agent saves received input, loads context, asks Gemini for a fact patch, validates it, merges it with stored facts, calculates deterministic recommendations, and applies the result through the data adapter. The backend rejects stale or duplicate applications. Show the first partial incident as soon as extraction succeeds; keep collecting missing information on that same record.

Gemini and Spectrum calls run outside database reducers. Browsers subscribe directly to authorized Spacetime state. Persist conversation routing/context and outgoing notification jobs. A status question reads committed assignment state, not a model-generated estimate.

The caller-facing agent should acknowledge relevant updates, ask one missing question at a time, accept “I don't know,” remember prior answers, and handle corrections without restarting intake. Do not imply that a recommended service has been assigned before the dispatcher commits that action.

## Four workstreams

| Person | Owned implementation area | First slice | Guide |
|---|---|---|---|
| 1 | Spectrum, Node orchestration, root configuration, integration scripts | Actual iMessage echo and normalized terminal harness | [Photon and integration](docs/roles/person-1-photon-integration.md) |
| 2 | Gemini extraction, pure rules, fixtures; later demo preparation | One actual validated extraction call | [Gemini and evaluation](docs/roles/person-2-gemini-extraction.md) |
| 3 | Spacetime module, shared contracts, data adapter and bindings | Real incident insertion and subscription | [SpacetimeDB](docs/roles/person-3-spacetimedb.md) |
| 4 | Both web routes and shared frontend components | Dispatcher and responder render one shared fixture | [Web app](docs/roles/person-4-web-app.md) |

Proposed layout, to be created during implementation:

```text
apps/agent/          Person 1
apps/web/            Person 4
packages/intake/     Person 2
packages/contracts/  Person 3
packages/data/       Person 3, including generated bindings
spacetime/           Person 3
fixtures/            Person 2
scripts/             Person 1, coordinating Person 3's seed/reset operations
docs/DEMO.md         Person 2 after the first real extraction works
```

Person 1 owns root configuration and reconciles the lockfile. Person 3 owns schema changes and deployment to the shared integration database. Coordinate ownership before helping in another person's files. Once extraction works, Person 2 takes the acceptance checklist, demo script, and screenshots so the other three can complete integration and UI.

## First thirty minutes

1. Read this handoff and the contract together. Agree the exact synthetic scenario and role assignments.
2. Person 1 creates the TypeScript workspace and verifies Photon credentials/routing with a real phone. Use one designated persistent agent process on the shared integration inbox.
3. Person 2 verifies a real Gemini call with the team's API key and an available stable model. Keep its tested identifier in `GEMINI_MODEL`.
4. Person 3 boots SpacetimeDB, pins compatible CLI/module/client versions, and creates shared types plus a minimal schema. Publish bindings early.
5. Person 4 creates both React/Vite routes using a shared fixture, then replaces it with the real data client as soon as available.

Your Claude subscriptions help write the application. Photon access and Gemini API credentials are separate setup checks. Do not assume either is ready.

## Ten hour schedule

| Time from start | Required result |
|---|---|
| 0:00–0:30 | Repo scaffold, contracts, owners, versions, credentials and demo scenario agreed |
| 0:30–1:30 | Real Photon echo; real Gemini extraction; real Spacetime subscription; both screens render |
| 1:30–3:00 | Complete real message → incident → assignment → responder → iMessage loop |
| 3:00–5:00 | Corrections, durable context, duplicate/stale handling, independent responder progress |
| 5:00–7:00 | Source evidence, clear unknown/error states, restart/reconnect checks and basic role enforcement |
| 7:00–8:30 | Feature freeze, repeated live runs, bug fixes and backup recording |
| 8:30–10:00 | README, screenshots, submission and timed rehearsals; every person runs the demo |

If the full loop is absent at hour three, all four prioritize the failing interface. Stop polish and stretch work. If Photon is unavailable, use the terminal harness to continue development while fixing access; this fallback does not satisfy the supplied real-iMessage requirement. Label model fixtures/replay honestly as well.

## GitHub workflow

Use one repo and an always-runnable `main` once code begins. Develop on short branches, open small PRs, and merge each working slice after a teammate review. Aim for a coherent merge every 30–60 minutes; do not hold four entire workstreams until the deadline.

Examples of slices: Spectrum echo, validated extraction, reducer plus generated bindings, or a live subscribed incident list. Every PR includes what works, how another teammate runs it, checks performed, and contract changes. Person 1 coordinates integration order; Person 3 announces schema updates. Synchronize after merges and before the next slice. Never edit generated bindings manually.

Use a local clone per person. Separate assistants on one machine need separate worktrees. Keep experimental fixtures isolated from shared demo records; announce every shared reset. Use separate authorized identities for dispatcher and responder, preferably separate browser profiles/devices, because two tabs may share one persisted token.

Target developer commands should cover agent start, web start, typecheck/build, intake fixtures, module publish/binding generation, and demo seed/reset. These are requirements to implement, not commands currently available. Each owner records actual tested commands and environment names in their workstream's `HANDOFF.md`; then Person 1 adds the verified quickstart to README.

## Demo and acceptance

Use the fixed scenario in the [contract](docs/CONTRACT.md#synthetic-demo-fixture): a caller reports smoke, provides a building/entrance, corrects the entrance, and receives a simulated assignment update. This exercises the same incident across the conversation and both dashboards.

1. Show the phone, dispatcher, and responder together.
2. Send the synthetic report through actual iMessage. Let the agent ask for the missing building/entrance.
3. Supply the location, then correct north to south. The existing incident updates with source evidence.
4. Dispatcher confirms the FIRE recommendation and assigns the seeded unit.
5. Responder accepts and moves en route; the dispatcher sees that assignment change.
6. The caller receives a simulated update and asks “Any update?” to retrieve committed status.

Test the complete live loop first, then corrections/duplicates, independent assignments/double booking, restart recovery, and unauthorized transitions. A Gemini timeout must preserve verified facts and remain retryable. A received message is not APPLIED until its fact update commits. A stale extraction must not overwrite a newer correction. One responder completing an assignment must not resolve the entire incident.

Keep keys, tokens and private conversation identifiers out of public tables, fixtures, and screenshots. For outbound delivery, record attempts and acknowledgment and use provider idempotency only if verified. Do not claim exactly-once delivery across the external messaging service.

## Official references

- [Spectrum introduction](https://photon.codes/docs/spectrum-ts/introduction), [iMessage setup](https://photon.codes/docs/spectrum-ts/providers/imessage), and [message model](https://photon.codes/docs/spectrum-ts/messages). Typed location is the guaranteed path; native location events are not verified for this build.
- [SpacetimeDB TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/), [functions](https://spacetimedb.com/docs/functions/), and [client reference](https://spacetimedb.com/docs/clients/typescript/).
- [Gemini libraries](https://ai.google.dev/gemini-api/docs/libraries), [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), and [model availability](https://ai.google.dev/gemini-api/docs/models).
- [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow).
