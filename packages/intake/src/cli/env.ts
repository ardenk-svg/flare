import { existsSync } from "node:fs";
import { join } from "node:path";
import { readGeminiConfig, type GeminiConfig } from "../gemini.ts";
import { REPO_ROOT } from "../eval/fixtures.ts";

/** Loads local env and returns Gemini config, exiting with a readable message if incomplete. */
export function requireGeminiConfig(): GeminiConfig {
  loadLocalEnv();
  try {
    return readGeminiConfig();
  } catch (error) {
    console.error(`${(error as Error).message}. Set it in your shell or a local .env (never commit it).`);
    process.exit(1);
  }
}

/** Loads a local .env (repo root, then this package) without overriding real env vars. */
export function loadLocalEnv(): void {
  for (const path of [join(REPO_ROOT, ".env"), join(REPO_ROOT, "packages", "intake", ".env")]) {
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
