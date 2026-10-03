import { Spectrum } from "@spectrum-ts/core";
import { terminal } from "@spectrum-ts/terminal";

import { runAgent } from "./runtime.js";

const app = await Spectrum({
  providers: [terminal.config({})],
});

await runAgent(app);
