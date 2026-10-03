// FlareClient backed by Person 3's @flare/data adapter (SpacetimeDB).
// The browser holds only its own identity token; roles are granted by the operator on the backend.
import {
  advanceAssignment, confirmDispatchAndAssign, connectFlare, FlareOpError, getMyRole,
  listAssignments, listIncidents, listUnits, resolveIncident, type FlareConnection,
} from "@flare/data";
import type { Incident } from "@flare/contracts";
import type { Assignment, FlareClient, Identity, IncidentView, OpResult, Snapshot } from "../types";

export interface TokenStore { get(): string | undefined; set(token: string): void }
export interface LiveConfig {
  uri: string;
  database: string;
  /** Where this client's identity token lives. Defaults to `browserTokenStore("default")`. */
  tokenStore?: TokenStore;
}

const LEGACY_TOKEN_KEY = "flare-live-token";
/**
 * Browser token store keyed by view, e.g. `flare-live-token:dispatcher` or `flare-live-token:responder:FIRE-01`,
 * so both routes can hold distinct identities in one browser profile. `legacyFallback` reads the old
 * single key once, so a dispatcher identity granted before per-role keys is kept.
 */
export function browserTokenStore(scope: string, { legacyFallback = false } = {}): TokenStore {
  const key = `${LEGACY_TOKEN_KEY}:${scope}`;
  return {
    get: () => {
      try {
        return localStorage.getItem(key) ?? (legacyFallback ? localStorage.getItem(LEGACY_TOKEN_KEY) ?? undefined : undefined);
      } catch { return undefined; }
    },
    set: (t) => { try { localStorage.setItem(key, t); } catch { /* ignore */ } },
  };
}

export function toExtraction(i: Incident): IncidentView["extraction"] {
  return i.extractionState === "FAILED"
    ? { state: "FAILED", message: i.extractionError ?? undefined }
    : { state: i.extractionState };
}

function toView(i: Incident): IncidentView {
  return {
    id: i.id, status: i.status, summary: i.summary, facts: i.facts,
    evidence: i.evidence.map(({ field, messageId, quote }) => ({ field, messageId, quote })),
    corrections: i.lastCorrections,
    recommendedServices: i.recommendedServices, recommendationReason: i.recommendationReason,
    ruleIds: i.recommendationRuleIds, confirmedServices: i.confirmedServices,
    needsReview: i.needsReview,
    extraction: toExtraction(i),
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  };
}

export interface LiveClient extends FlareClient {
  /** Disconnects and stops reconnecting. */
  close(): void;
}

export function createLiveClient(cfg: LiveConfig): LiveClient {
  const tokens = cfg.tokenStore ?? browserTokenStore("default");
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  let live: FlareConnection | null = null;
  let snapshot: Snapshot = {
    connection: "connecting", mode: "live", access: "ok",
    identity: { role: "dispatcher" }, incidents: [], units: [], assignments: [],
  };
  const set = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((l) => l()); };

  // Re-read every authorized projection. Cheap at demo scale and keeps one code path.
  const refresh = () => {
    if (!live) return;
    const role = getMyRole(live.conn);
    let identity: Identity = snapshot.identity;
    let access: Snapshot["access"] = "ok";
    if (!role) access = "no-role";
    else if (role.role === "DISPATCHER") identity = { role: "dispatcher" };
    else if (role.role === "RESPONDER" && role.unitId) identity = { role: "responder", unitId: role.unitId };
    else access = "unsupported-role";
    const assignments: Assignment[] = listAssignments(live.conn);
    set({
      access, identity, identityHex: live.identityHex,
      incidents: listIncidents(live.conn).map(toView),
      units: listUnits(live.conn), assignments,
    });
  };

  let attempt = 0;
  const connect = () => {
    if (closed) return;
    set({ connection: snapshot.incidents.length ? "disconnected" : "connecting" });
    connectFlare({
      uri: cfg.uri, database: cfg.database, token: tokens.get(),
      onDisconnect: () => { live = null; set({ connection: "disconnected" }); scheduleRetry(); },
    }).then((c) => {
      if (closed) { c.conn.disconnect(); return; }
      attempt = 0; live = c; tokens.set(c.token);
      const db = c.conn.db;
      for (const t of [db.incidentView, db.assignmentView, db.unitView, db.myRole]) {
        t.onInsert(refresh); t.onUpdate(refresh); t.onDelete(refresh);
      }
      set({ connection: "connected", connectError: undefined });
      refresh();
    }).catch((e) => {
      set({ connection: "disconnected", connectError: e instanceof Error ? e.message : String(e) });
      scheduleRetry();
    });
  };
  const scheduleRetry = () => {
    if (!closed) retryTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000));
  };
  connect();

  const run = async (op: (c: FlareConnection) => Promise<void>): Promise<OpResult> => {
    if (!live || snapshot.connection !== "connected")
      return { ok: false, code: "DISCONNECTED", message: "Disconnected. Changes are disabled until reconnect." };
    try {
      await op(live);
      refresh(); // reducer committed; subscription also pushes it, this just avoids a visual gap
      return { ok: true };
    } catch (e) {
      if (e instanceof FlareOpError) return { ok: false, code: e.code, message: e.message.replace(/^[A-Z_]+:\s*/, "") };
      return { ok: false, code: "REQUEST_FAILED", message: e instanceof Error ? e.message : String(e) };
    }
  };

  return {
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot: () => snapshot,
    confirmDispatchAndAssign: (req) => run((c) => confirmDispatchAndAssign(c.conn, req)),
    advanceAssignment: ({ assignmentId, next }) => run((c) => advanceAssignment(c.conn, { assignmentId, nextStatus: next })),
    resolveIncident: (req) => run((c) => resolveIncident(c.conn, req)),
    close() {
      closed = true;
      clearTimeout(retryTimer);
      live?.conn.disconnect();
      live = null;
    },
  };
}
