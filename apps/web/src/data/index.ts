import { createContext, useContext, useSyncExternalStore } from "react";
import type { FlareClient, Identity, Snapshot } from "../types";
import { createFixtureClient, type FixtureClient } from "./fixtureClient";

// Single swap point: when Person 3's adapter lands, return a live FlareClient here for
// VITE_DATA_MODE=live. The fixture stays available (clearly labelled) for offline work.
export function createClient(): FlareClient {
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
