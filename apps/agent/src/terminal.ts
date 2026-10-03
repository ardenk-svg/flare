import { Spectrum } from "@spectrum-ts/core";
import { terminal } from "@spectrum-ts/terminal";

import { runAgent } from "./runtime.js";

const app = await Spectrum({
  providers: [terminal.config({})],
});

const provider = terminal(app);

await runAgent(app, async (route, text) => {
  if (route.platform !== "terminal") {
    throw new Error(`The terminal worker cannot send a ${route.platform} notification.`);
  }
  const space = await provider.space.get(route.spaceId);
  await space.send(text);
});
