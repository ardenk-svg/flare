import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProviderRoute } from "./types.js";

interface PersistedAgentState {
  version: 1;
  spacetimeToken?: string;
  routes: Record<string, ProviderRoute>;
}

const DEFAULT_STATE_PATH = fileURLToPath(
  new URL("../../../.flare/agent-state.json", import.meta.url),
);

const emptyState = (): PersistedAgentState => ({ version: 1, routes: {} });

function isRoute(value: unknown): value is ProviderRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  return (
    typeof route.platform === "string" &&
    route.platform.length > 0 &&
    typeof route.spaceId === "string" &&
    route.spaceId.length > 0 &&
    (route.phone === undefined || typeof route.phone === "string")
  );
}

function parseState(value: string): PersistedAgentState {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("state must be an object");
  const source = parsed as Record<string, unknown>;
  if (source.version !== 1) throw new Error("unsupported state version");
  if (source.spacetimeToken !== undefined && typeof source.spacetimeToken !== "string") {
    throw new Error("invalid SpacetimeDB token");
  }
  if (!source.routes || typeof source.routes !== "object") throw new Error("invalid routes");

  const routes: Record<string, ProviderRoute> = {};
  for (const [key, route] of Object.entries(source.routes)) {
    if (!isRoute(route)) throw new Error(`invalid route for ${key}`);
    routes[key] = route;
  }

  return {
    version: 1,
    routes,
    ...(source.spacetimeToken ? { spacetimeToken: source.spacetimeToken } : {}),
  };
}

export class AgentStateStore {
  readonly #path: string;
  #state: PersistedAgentState;
  #writeTail: Promise<void> = Promise.resolve();

  private constructor(path: string, state: PersistedAgentState) {
    this.#path = path;
    this.#state = state;
  }

  static async open(path?: string): Promise<AgentStateStore> {
    const configuredPath =
      path?.trim() || process.env.FLARE_AGENT_STATE_PATH?.trim() || DEFAULT_STATE_PATH;
    const absolutePath = resolve(configuredPath);
    try {
      return new AgentStateStore(absolutePath, parseState(await readFile(absolutePath, "utf8")));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
      if (code === "ENOENT") return new AgentStateStore(absolutePath, emptyState());
      throw new Error(
        `Cannot load agent state at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  get spacetimeToken(): string | undefined {
    return this.#state.spacetimeToken;
  }

  routeFor(conversationKey: string): ProviderRoute | undefined {
    const route = this.#state.routes[conversationKey];
    return route ? { ...route } : undefined;
  }

  async setSpacetimeToken(token: string): Promise<void> {
    if (this.#state.spacetimeToken === token) return;
    this.#state = { ...this.#state, spacetimeToken: token };
    await this.#save();
  }

  async rememberRoute(conversationKey: string, route: ProviderRoute): Promise<void> {
    const existing = this.#state.routes[conversationKey];
    if (
      existing?.platform === route.platform &&
      existing.spaceId === route.spaceId &&
      existing.phone === route.phone
    ) {
      return;
    }

    this.#state = {
      ...this.#state,
      routes: { ...this.#state.routes, [conversationKey]: { ...route } },
    };
    await this.#save();
  }

  async #save(): Promise<void> {
    const snapshot = `${JSON.stringify(this.#state, null, 2)}\n`;
    const write = async (): Promise<void> => {
      await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.#path}.${process.pid}.tmp`;
      await writeFile(temporaryPath, snapshot, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.#path);
    };

    const next = this.#writeTail.then(write, write);
    this.#writeTail = next.catch(() => undefined);
    await next;
  }
}
