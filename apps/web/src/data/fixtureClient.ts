// In-memory FlareClient that mimics CONTRACT.md operation rules so the UI can be built and
// demoed before Person 3's adapter exists. Not the backend: replace via data/index.ts.
// Shared data syncs across same-browser tabs through localStorage; connection state is per tab.
import { ASSIGNMENT_ORDER } from "../types";
import type {
  Assignment, AssignmentStatus, FlareClient, Identity, IncidentView, OpResult, Service, Snapshot, Unit,
} from "../types";
import { incidents as seedIncidents, units as seedUnits } from "../fixture";

const KEY = "flare-fixture-v1";
const LATENCY_MS = 350;

interface Shared { incidents: IncidentView[]; units: Unit[]; assignments: Assignment[]; rigConflict: boolean }

const seed = (): Shared => ({
  incidents: structuredClone(seedIncidents),
  units: structuredClone(seedUnits),
  assignments: [],
  rigConflict: false,
});

function load(): Shared {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Shared;
  } catch { /* fall through to seed */ }
  return seed();
}

export interface FixtureClient extends FlareClient {
  dev: {
    reset(): void;
    setConnected(connected: boolean): void;
    simulateCorrection(incidentId: string): void;
    simulateExtraction(incidentId: string, state: "OK" | "PENDING" | "FAILED"): void;
    rigNextConflict(): void;
  };
}

export function createFixtureClient(identity: Identity): FixtureClient {
  let shared = load();
  let connection: Snapshot["connection"] = "connected";
  let snapshot: Snapshot;
  const listeners = new Set<() => void>();

  const build = () => {
    snapshot = {
      connection, mode: "fixture", identity,
      incidents: shared.incidents, units: shared.units, assignments: shared.assignments,
    };
  };
  const emit = () => { build(); listeners.forEach((l) => l()); };
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(shared)); } catch { /* ignore */ }
    emit();
  };
  build();

  window.addEventListener("storage", (e) => {
    if (e.key === KEY && connection === "connected") { shared = load(); emit(); }
  });

  const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), LATENCY_MS));
  const fail = (code: Extract<OpResult, { ok: false }>["code"], message: string) =>
    delay<OpResult>({ ok: false, code, message });
  const now = () => new Date().toISOString();

  const guard = (role: Identity["role"]): OpResult | null => {
    if (connection !== "connected") return { ok: false, code: "DISCONNECTED", message: "Disconnected. Changes are disabled until reconnect." };
    if (identity.role !== role) return { ok: false, code: "FORBIDDEN", message: `Only the ${role} identity may do this.` };
    return null;
  };

  return {
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot: () => snapshot,

    async confirmDispatchAndAssign({ incidentId, confirmedServices, unitIds }) {
      const g = guard("dispatcher"); if (g) return delay(g);
      shared = load();
      const inc = shared.incidents.find((i) => i.id === incidentId);
      if (!inc) return fail("NOT_FOUND", "Incident not found.");
      if (inc.status !== "READY_FOR_REVIEW")
        return inc.status === "COLLECTING"
          ? fail("NOT_READY", "Incident is not ready: a location is required.")
          : fail("ALREADY_DISPATCHED", "Dispatch was already confirmed for this incident.");
      if (confirmedServices.length === 0 || unitIds.length === 0)
        return fail("INVALID_SELECTION", "Confirm at least one service and select a unit for each.");
      const chosen = unitIds.map((id) => shared.units.find((u) => u.id === id));
      if (chosen.some((u) => !u)) return fail("INVALID_SELECTION", "Unknown unit selected.");
      const units = chosen as Unit[];
      if (units.some((u) => !confirmedServices.includes(u.service)))
        return fail("INVALID_SELECTION", "Every selected unit must match a confirmed service.");
      const missing = confirmedServices.filter((s) => !units.some((u) => u.service === s));
      if (missing.length) return fail("INVALID_SELECTION", `No unit selected for: ${missing.join(", ")}.`);

      if (shared.rigConflict) {
        // Dev only: emulate another dispatcher winning the reservation first.
        shared.rigConflict = false;
        shared.units = shared.units.map((u) => (u.id === units[0].id ? { ...u, status: "BUSY" as const } : u));
        persist();
        return fail("UNIT_CONFLICT", `Unit already reserved: ${units[0].id}. Nothing was assigned.`);
      }
      const busy = units.filter((u) => u.status !== "AVAILABLE");
      if (busy.length) return fail("UNIT_CONFLICT", `Unit already reserved: ${busy.map((u) => u.id).join(", ")}. Nothing was assigned.`);
      const ts = now();
      shared.units = shared.units.map((u) => (unitIds.includes(u.id) ? { ...u, status: "BUSY" as const } : u));
      shared.assignments = [
        ...shared.assignments,
        ...unitIds.map((unitId): Assignment => ({
          id: `ASG-${incidentId}-${unitId}`, incidentId, unitId, status: "OFFERED", updatedAt: ts,
        })),
      ];
      shared.incidents = shared.incidents.map((i) =>
        i.id === incidentId ? { ...i, status: "DISPATCHED", confirmedServices: [...confirmedServices] as Service[], updatedAt: ts } : i);
      persist();
      return delay<OpResult>({ ok: true });
    },

    async advanceAssignment({ assignmentId, next }) {
      const g = guard("responder"); if (g) return delay(g);
      shared = load();
      const a = shared.assignments.find((x) => x.id === assignmentId);
      if (!a) return fail("NOT_FOUND", "Assignment not found.");
      if (a.unitId !== identity.unitId) return fail("FORBIDDEN", "This assignment belongs to another unit.");
      if (ASSIGNMENT_ORDER.indexOf(next) !== ASSIGNMENT_ORDER.indexOf(a.status) + 1)
        return fail("INVALID_TRANSITION", `Cannot move from ${a.status} to ${next}.`);
      const ts = now();
      shared.assignments = shared.assignments.map((x) => (x.id === a.id ? { ...x, status: next as AssignmentStatus, updatedAt: ts } : x));
      if (next === "COMPLETED")
        shared.units = shared.units.map((u) => (u.id === a.unitId ? { ...u, status: "AVAILABLE" as const } : u));
      persist();
      return delay<OpResult>({ ok: true });
    },

    async resolveIncident({ incidentId }) {
      const g = guard("dispatcher"); if (g) return delay(g);
      shared = load();
      const inc = shared.incidents.find((i) => i.id === incidentId);
      if (!inc) return fail("NOT_FOUND", "Incident not found.");
      const mine = shared.assignments.filter((a) => a.incidentId === incidentId);
      if (inc.status !== "DISPATCHED" || mine.length === 0 || mine.some((a) => a.status !== "COMPLETED"))
        return fail("NOT_COMPLETE", "Incident must be dispatched with every assignment completed.");
      shared.incidents = shared.incidents.map((i) => (i.id === incidentId ? { ...i, status: "RESOLVED", updatedAt: now() } : i));
      persist();
      return delay<OpResult>({ ok: true });
    },

    dev: {
      reset() { shared = seed(); persist(); },
      setConnected(c) { connection = c ? "connected" : "disconnected"; if (c) shared = load(); emit(); },
      simulateCorrection(incidentId) {
        shared = load();
        shared.incidents = shared.incidents.map((i) => {
          if (i.id !== incidentId) return i;
          const north = i.facts.locationText?.toLowerCase().includes("south");
          const text = north ? "North entrance of the demo student center" : "South entrance of the demo student center";
          return {
            ...i, summary: `${i.summary.split(" (")[0]} (location corrected).`,
            facts: { ...i.facts, locationText: text },
            corrections: ["locationText"],
            evidence: [...i.evidence.filter((e) => e.field !== "locationText"),
              { field: "locationText", messageId: `m${Date.now() % 1000}`, quote: text.split(" of")[0].toLowerCase() }],
            needsReview: i.status === "DISPATCHED" || i.status === "RESOLVED" ? true : i.needsReview,
            updatedAt: now(),
          };
        });
        persist();
      },
      simulateExtraction(incidentId, state) {
        shared = load();
        shared.incidents = shared.incidents.map((i) => i.id !== incidentId ? i : {
          ...i, extraction: state === "FAILED" ? { state, message: "Gemini timeout (retryable)" } : { state },
        });
        persist();
      },
      rigNextConflict() { shared = load(); shared.rigConflict = true; persist(); },
    },
  };
}
