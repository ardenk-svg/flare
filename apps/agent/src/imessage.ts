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

const provider = imessage(app);

await runAgent(app, async (route, text) => {
  if (route.platform !== "imessage") {
    throw new Error(`The iMessage worker cannot send a ${route.platform} notification.`);
  }
  const space = await provider.space.get(
    route.spaceId,
    route.phone ? { phone: route.phone } : {},
  );
  await space.send(text);
});
