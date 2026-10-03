# Flare demo script and acceptance checklist

**Status: DRAFT.** Not rehearsed. No live run is recorded yet. Person 2 owns this file and fills in each result only after actually running it. This is a simulation. Every screen and caller message must say so, and no real emergency service is contacted.

## Setup before judging

- [ ] Phone with the integration iMessage thread open, dispatcher view, and responder view are all visible together.
- [ ] Dispatcher and responder use **separate authorized identities** (separate browser profiles or devices).
- [ ] Demo database reset and seeded with `FIRE-01`, `EMS-01` and `POLICE-01`, all AVAILABLE. Person 3 announces the reset.
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

## Acceptance checklist

Mark each item with the date and who ran it. Use LIVE only for real iMessage, Gemini and SpacetimeDB traffic.

| Check | How | Result |
|---|---|---|
| Full live loop (steps 1–7) | Real phone, both views | ☐ |
| Correction updates the existing incident, with evidence | Step 4 | ☐ |
| Unknown vs false | Send "I don't know if anyone is hurt"; `injuryReported` stays unknown | ☐ |
| Duplicate source message creates nothing new | Replay the same provider message ID | ☐ |
| Gemini failure keeps verified facts and can be retried | Agent with an invalid `GEMINI_MODEL`, or the network blocked, then restored | ☐ |
| Stale extraction cannot overwrite a newer correction | Person 1 and Person 3 revision test | ☐ |
| Two dispatchers reserve the same unit: one wins, one conflicts | Two dispatcher clients | ☐ |
| Trapped-person fixture: completing one assignment leaves the other intact | `fixtures/extraction/10-trapped-multi-service.json` text | ☐ |
| Restart the agent and reload clients: incident, facts and last question survive | | ☐ |
| Responder cannot advance another unit's assignment | | ☐ |
| No secrets or private identifiers in screenshots | Review the captures | ☐ |
| Extraction eval report committed | `npm run eval` in `packages/intake` | ☐ report: `fixtures/results/________` |

## Known limitations to state honestly

- Typed location only. There are no coordinates, maps or routing.
- Demo rules are synthetic, not triage guidance.
- A crash between sending a message and acknowledging it can deliver the message twice. Delivery is not exactly-once.
- Fixture and offline runs are labelled as such and do not demonstrate live integrations.
