import { Spectrum } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";

import { runAgent } from "./runtime.js";

function requireEnvironment(name: "SPECTRUM_PROJECT_ID" | "SPECTRUM_PROJECT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to start the cloud iMessage worker.`);
  }
  return value;
}

const app = await Spectrum({
  projectId: requireEnvironment("SPECTRUM_PROJECT_ID"),
  projectSecret: requireEnvironment("SPECTRUM_PROJECT_SECRET"),
  // The current declaration requires an object even though the documented
  // automatic-discovery form is written as imessage.config().
  providers: [imessage.config({})],
});

await runAgent(app);
