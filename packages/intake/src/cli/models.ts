// LIVE: lists Flash models this key can call with generateContent, to pick GEMINI_MODEL.
import { GoogleGenAI } from "@google/genai";
import { loadLocalEnv } from "./env.ts";

loadLocalEnv();
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  console.error("GEMINI_API_KEY is not set");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
const pager = await ai.models.list({ config: { pageSize: 100 } });
for await (const model of pager) {
  if (!model.name?.includes("flash")) continue;
  if (model.supportedActions && !model.supportedActions.includes("generateContent")) continue;
  console.log(`${model.name?.replace(/^models\//, "").padEnd(40)} ${model.displayName ?? ""}${model.thinking ? "  [thinking]" : ""}`);
}
