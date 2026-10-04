import { createContext, useContext, useSyncExternalStore } from "react";
import type { FlareClient, Identity, Snapshot } from "../types";
import { createFixtureClient, type FixtureClient } from "./fixtureClient";
import { browserTokenStore, createLiveClient } from "./liveClient";

// One identity per view so /dispatcher and /responder can run side by side in one browser profile.
// `?unit=` gives a responder tab its own identity per unit.
function routeTokenStore() {
  if (location.pathname.startsWith("/responder")) {
    const unit = new URLSearchParams(location.search).get("unit") ?? "FIRE-01";
    return browserTokenStore(`responder:${unit}`, unit === "FIRE-01" ? { fallbackScope: "responder" } : {});
  }
  return browserTokenStore("dispatcher", { legacyFallback: true });
}

// VITE_DATA_MODE=live connects to SpacetimeDB; anything else uses the labelled in-memory fixture.
export function createClient(): FlareClient {
  const env = import.meta.env;
  if (env.VITE_DATA_MODE === "live") {
    if (!env.VITE_SPACETIMEDB_URI || !env.VITE_SPACETIMEDB_DATABASE)
      throw new Error("Live mode needs VITE_SPACETIMEDB_URI and VITE_SPACETIMEDB_DATABASE");
    return createLiveClient({
      uri: env.VITE_SPACETIMEDB_URI, database: env.VITE_SPACETIMEDB_DATABASE, tokenStore: routeTokenStore(),
      authorizeDemoResponder: env.DEV && env.VITE_FLARE_DEMO_GRANT_KEY && location.pathname.startsWith("/responder")
        ? async identity => {
          const unit = new URLSearchParams(location.search).get("unit") ?? "FIRE-01";
          const response = await fetch("/__flare_demo/responder", { method: "POST",
            headers: { "Content-Type": "application/json", "X-Flare-Demo-Key": env.VITE_FLARE_DEMO_GRANT_KEY },
            body: JSON.stringify({ identity, unit }) });
          if (!response.ok) throw new Error("Demo responder grant failed.");
        } : undefined,
    });
  }
  const params = new URLSearchParams(location.search);
  const role = params.get("as") ?? (location.pathname.startsWith("/responder") ? "responder" : "dispatcher");
  const identity: Identity = role === "responder"
    ? { role: "responder", unitId: params.get("unit") ?? "FIRE-01" }
    : { role: "dispatcher" };
  return createFixtureClient(identity);
}

export const ClientContext = createContext<FlareClient | null>(null);

export function useClient(): FlareClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("ClientContext missing");
  return c;
}
export function useSnapshot(): Snapshot {
  const c = useClient();
  return useSyncExternalStore(c.subscribe, c.getSnapshot);
}
export const asFixture = (c: FlareClient): FixtureClient | null =>
  c.getSnapshot().mode === "fixture" ? (c as FixtureClient) : null;
