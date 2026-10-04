import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Default to PATH; allow a local installation without changing the user's shell. */
export function configureSpacetimeCli(): string {
  const configured = process.env.FLARE_SPACETIME_BIN?.trim();
  if (!configured) return "spacetime";
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const binary = resolve(root, configured);
  process.env.PATH = [dirname(binary), process.env.PATH].filter(Boolean).join(delimiter);
  return binary;
}
