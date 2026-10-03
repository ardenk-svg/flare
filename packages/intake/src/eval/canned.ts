// OFFLINE ONLY: a fake ModelGenerator replaying canned fixture output. It
// exercises validation and failure mapping; it is not evidence of Gemini
// behaviour and must never be wired into the live agent.

import type { ModelGenerator } from "../gemini.ts";
import type { CannedModel } from "./fixtures.ts";

export function cannedGenerator(model: CannedModel): ModelGenerator {
  const steps = "sequence" in model ? model.sequence : [model];
  let call = 0;
  return ({ signal }) => {
    const step = steps[Math.min(call++, steps.length - 1)];
    if ("hang" in step) {
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    if ("throwStatus" in step) {
      return Promise.reject(Object.assign(new Error(step.throwMessage ?? `HTTP ${step.throwStatus}`), { status: step.throwStatus }));
    }
    const text = "raw" in step ? step.raw : JSON.stringify(step.output);
    return Promise.resolve({ text, modelVersion: "canned-offline" });
  };
}
