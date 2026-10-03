# Flare fixtures (Person 2)

All content is synthetic. Do not add real names, phone numbers or places, private conversation identifiers, or secrets.

| Folder | Used by | What it proves | Label |
|---|---|---|---|
| `extraction/` | `npm run eval` | How live Gemini handles each case: incomplete report, explicit negative, uncertainty, vague medical wording, correction, contradiction, retraction to unknown, status query, greeting, injection, multi-message batch | **LIVE** |
| `scenarios/demo.json` | `npm run eval` | The contract's demo conversation, run turn by turn. Each turn's facts, summary, revision and last question feed into the next. | **LIVE** |
| `offline/` | `npm test` | Validation and failure mapping using canned model output: malformed JSON, invented message ID, fabricated quote, status query with a patch, lifecycle injection, type mismatch, timeout, 429, 5xx, bad credentials, retry | **OFFLINE: not Gemini behaviour** |
| `rules/cases.json` | `npm test` | `recommendServices` against the contract's demo rule table | Deterministic |
| `results/` | written by `npm run eval` | Timestamped live reports (`.md` plus raw `.json`) with the model, latency and failed assertions | **LIVE results** |

Fixture turns use message IDs `m1, m2…` for new messages and `r1…` for prior context, with fixed synthetic timestamps. Expectation matchers are defined in [packages/intake/src/eval/expect.ts](../packages/intake/src/eval/expect.ts). For example, `"unknown"` means the field is omitted or null, so it never becomes false. `"cleared"` means the field is explicitly set to null.

Automated assertions do not grade summary wording or question tone. The eval report lists those for a human to judge.
