import { Spectrum } from "@spectrum-ts/core";
import { imessage } from "@spectrum-ts/imessage";

import { runEchoAgent } from "./runtime.js";

function required(name: "SPECTRUM_PROJECT_ID" | "SPECTRUM_PROJECT_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to start the cloud iMessage diagnostic.`);
  return value;
}

const app = await Spectrum({
  projectId: required("SPECTRUM_PROJECT_ID"),
  projectSecret: required("SPECTRUM_PROJECT_SECRET"),
  providers: [imessage.config({})],
});

await runEchoAgent(app);
