# Flare demo script and acceptance checklist

**Status: DRAFT.** Not rehearsed. No live run is recorded yet. Person 2 owns this file and fills in each result only after actually running it. This is a simulation. Every screen and caller message must say so, and no real emergency service is contacted.

## Setup before judging

- [ ] Phone with the integration iMessage thread open, dispatcher view, and responder view are all visible together.
- [ ] Dispatcher and responder use **separate authorized identities** (separate browser profiles or devices).
- [ ] Demo database reset and seeded with two units each for FIRE, EMS and POLICE, all AVAILABLE. Person 3 announces the reset.
- [ ] One designated agent process is running on the shared inbox. `GEMINI_MODEL` = `________` (the tested ID).
- [ ] Backup video is ready in case live networking fails. Say so if it is used.

## 90-second script

| # | Who / action | Expected on screen | Talking point |
|---|---|---|---|
| 1 | Caller texts **"Simulation: I see smoke outside."** | A partial incident appears as COLLECTING with `fireOrSmoke: true` and the FIRE recommendation (`DEMO_FIRE`). Other facts are unknown. | "Gemini extracts only what the caller said, and every fact links to the message it came from." |
| 2 | Agent asks for the building and entrance | The question appears in the thread | "One question at a time; the agent remembers answers." |
| 3 | Caller: **"North entrance of the demo student center."** | Location fills in; incident becomes READY_FOR_REVIEW | |
| 4 | Caller: **"Correction: south entrance, not north."** | The **same** incident updates to the south entrance, with evidence quoting this message. The recommendation stays FIRE. | "A correction updates the live record. It does not start over." |
| 5 | Dispatcher confirms FIRE and selects `FIRE-01` | Incident DISPATCHED; assignment OFFERED; FIRE-01 BUSY | "Recommendations come from fixed demo rules, and a human confirms. Gemini never assigns." |
| 6 | Responder accepts, then marks EN_ROUTE | The dispatcher sees the change without refreshing. The caller gets a message labelled as simulated. | "SpacetimeDB reducers own every state change." |
| 7 | Caller: **"Any update?"** | Reply comes from committed assignment state. No new incident is created. | "Status is read from the database, not generated." |

## Acceptance sequence

This follows the required sequence in [NEXT_STEPS.md](../NEXT_STEPS.md). For each run, record who ran it, when, the exact `GEMINI_MODEL` and database, and whether each step was **LIVE** or fixture-backed. The integration pass is complete only after the whole sequence succeeds **twice without a database reset** in between.

| # | Check | How | Run 1 | Run 2 |
|---|---|---|---|---|
| 1 | Database and the designated agent are running; dispatcher and responder use separate authorized identities | | ☐ | ☐ |
| 2 | **Terminal path**: smoke report, location, correction → one incident, exact evidence, FIRE recommendation, live UI updates | `npm run agent:terminal` | ☐ | ☐ |
| 3 | Confirm `FIRE-01`, accept, `EN_ROUTE` → committed notification sent and acknowledged | Both views | ☐ | ☐ |
| 4 | Steps 2–3 again from a **real iMessage** thread; "Any update?" reflects committed assignment state | Real phone | ☐ | ☐ |
| 5 | Stop the agent with pending or unacknowledged work, then restart → work drains safely and facts and last question survive | | ☐ | ☐ |
| 6 | Complete and resolve case A; start case B in the **same** thread → no old facts, messages or question enter B's extraction | | ☐ | ☐ |
| 7a | Duplicate source message creates nothing new | Replay the same provider message ID | ☐ | ☐ |
| 7b | Stale extraction cannot overwrite a newer correction | Revision test (Persons 1 and 3) | ☐ | ☐ |
| 7c | Two dispatchers reserve the same unit: one wins, one gets an explicit conflict | Two dispatcher clients | ☐ | ☐ |
| 7d | Responder cannot advance another unit's assignment | | ☐ | ☐ |
| 7e | Disconnect and reconnect clients without losing state | | ☐ | ☐ |
| 7f | Gemini failure: incident shows `FAILED`, verified facts stay visible, and a retry recovers to `OK` | Agent with an invalid `GEMINI_MODEL` or the network blocked, then restored | ☐ | ☐ |
| 7g | Unknown vs false: "I don't know if anyone is hurt" leaves `injuryReported` unknown | | ☐ | ☐ |
| 7h | Trapped-person case: completing one assignment leaves the other intact | Text from `fixtures/extraction/10-trapped-multi-service.json` | ☐ | ☐ |
| 8 | Clean installs, then all offline, module, adapter and web checks; handoffs updated with actual results | `npm ci && npm run check` | ☐ | ☐ |

Person 2 evidence, checked separately before the sequence above:

| Check | How | Result |
|---|---|---|
| Gemini accepts the schema | `npm run smoke` in `packages/intake` | ☐ model: `________` |
| Live eval committed, with correction and uncertainty cases reviewed by a person | `npm run eval` in `packages/intake` | ☐ report: `fixtures/results/________` |
| No secrets or private identifiers in screenshots | Review the captures | ☐ |

## Known limitations to state honestly

- Location pins and explicit Maps coordinates are supported. Find My cards use the caller-specific Photon lookup; cached snapshots are labelled and retain their capture time when supplied. A successful sharing request is not proof of coordinates or fresh GPS. The worker does not geocode addresses or compute routes.
- Demo rules are synthetic, not triage guidance.
- A crash between sending a message and acknowledging it can deliver the message twice. Delivery is not exactly-once.
- Fixture and offline runs are labelled as such and do not demonstrate live integrations.
