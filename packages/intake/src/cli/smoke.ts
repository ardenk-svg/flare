// LIVE: one real Gemini extraction. Usage:
//   npm run smoke                      demo step 1 ("Simulation: I see smoke outside.")
//   npm run smoke -- "some caller text"
import { createExtractor, DEFAULT_TIMEOUT_MS } from "../extract.ts";
import { mergeFacts } from "../facts.ts";
import { createGeminiGenerator } from "../gemini.ts";
import { recommendServices } from "../rules.ts";
import { buildTurn } from "../eval/fixtures.ts";
import { requireGeminiConfig } from "./env.ts";

const config = requireGeminiConfig();
const text = process.argv.slice(2).join(" ").trim() || "Simulation: I see smoke outside.";
const turn = buildTurn({ messages: [text] }, "smoke-cli");

let modelVersion: string | undefined;
let latencyMs = 0;
const extract = createExtractor({
  generate: createGeminiGenerator(config),
  timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  onAttempt: (info) => {
    modelVersion = info.modelVersion ?? modelVersion;
    latencyMs = info.latencyMs;
    if (info.problems) console.error(`attempt ${info.attempt} rejected: ${info.problems.join("; ")}`);
  },
});

const outcome = await extract(turn);
console.log(`LIVE Gemini | GEMINI_MODEL=${config.model} | modelVersion=${modelVersion ?? "?"} | ${Math.round(latencyMs)} ms`);
console.log(JSON.stringify(outcome, null, 2));
if (outcome.ok) {
  console.log("recommendation (demo rules on merged facts):", JSON.stringify(recommendServices(mergeFacts(turn.currentFacts, outcome.result.patch))));
} else {
  process.exitCode = 1;
}
