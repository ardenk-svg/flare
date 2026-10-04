// In-memory FlareClient that mimics CONTRACT.md operation rules so the UI can be built and
// demoed before Person 3's adapter exists. Not the backend: replace via data/index.ts.
// Shared data syncs across same-browser tabs through localStorage; connection state is per tab.
import { ASSIGNMENT_ORDER } from "../types";
import type {
  Assignment, AssignmentStatus, FlareClient, Identity, IncidentView, OpResult, Service, Snapshot, Unit,
} from "../types";
import { incidents as seedIncidents, units as seedUnits } from "../fixture";

const KEY = "flare-fixture-v2";
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
  let identityHex = `fixture-${identity.role}-${identity.unitId ?? 'dispatcher'}`;
  try {
    const key = `flare-fixture-identity:${identity.role}:${identity.unitId ?? ''}`;
    identityHex = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, identityHex);
  } catch { /* stable fallback for restricted storage */ }
  let shared = load();
  let connection: Snapshot["connection"] = "connected";
  let snapshot: Snapshot;
  const listeners = new Set<() => void>();

  const build = () => {
    snapshot = {
      connection, mode: "fixture", identity, identityHex, access: "ok",
      incidents: shared.incidents.filter(i => identity.role === "dispatcher" || shared.assignments.some(a => a.incidentId === i.id && a.unitId === identity.unitId)), units: shared.units, assignments: shared.assignments.filter(a => identity.role === "dispatcher" || a.unitId === identity.unitId),
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
  const fail = (code: string, message: string) =>
    delay<OpResult>({ ok: false, code, message });
  const now = () => new Date().toISOString();

  const guard = (role: Identity["role"]): OpResult | null => {
    if (connection !== "connected") return { ok: false, code: "DISCONNECTED", message: "Disconnected. Changes are disabled until reconnect." };
    if (identity.role !== role) return { ok: false, code: "FORBIDDEN", message: `Only the ${role} identity may do this.` };
    return null;
  };

  const conversationGuard = (incidentId: string) => {
    shared = load();
    if (connection !== 'connected') return guard(identity.role);
    if (identity.role === 'responder' && !shared.assignments.some(a => a.incidentId === incidentId && a.unitId === identity.unitId && a.status !== 'COMPLETED')) return { ok: false as const, code: 'FORBIDDEN', message: 'An active assignment to your unit is required.' };
    return null;
  };

  return {
    subscribe(l) { listeners.add(l); return () => { listeners.delete(l); }; },
    getSnapshot: () => snapshot,

    async takeOverConversation({ incidentId }) {
      const g = conversationGuard(incidentId); if (g) return delay(g);
      shared = load();
      const inc = shared.incidents.find(i => i.id === incidentId);
      if (!inc) return fail("NOT_FOUND", "Incident not found.");
      if (inc.status === "CLOSED" || inc.status === "RESOLVED") return fail("INCIDENT_ENDED", "Incident ended.");
      if (inc.dispatcherIdentity && inc.dispatcherIdentity !== identityHex && inc.controllerRole === identity.role.toUpperCase()) return fail("TAKEN_OVER", "Another dispatcher owns this conversation.");
      shared.incidents = shared.incidents.map(i => i.id === incidentId ? { ...i, dispatcherIdentity: identityHex, controllerRole: identity.role.toUpperCase(), controllerUnitId: identity.unitId } : i);
      persist(); return delay<OpResult>({ ok: true });
    },
    async releaseConversation({ incidentId }) {
      const g = conversationGuard(incidentId); if (g) return delay(g);
      shared = load();
      const inc = shared.incidents.find(i => i.id === incidentId);
      if (!inc) return fail("NOT_FOUND", "Incident not found.");
      if (inc.dispatcherIdentity !== identityHex) return fail("NOT_CONVERSATION_OWNER", "Another dispatcher owns this conversation.");
      shared.incidents = shared.incidents.map(i => i.id === incidentId ? { ...i, dispatcherIdentity: null } : i);
      persist(); return delay<OpResult>({ ok: true });
    },
    async sendDispatcherMessage({ incidentId, text, clientMessageId }) {
      const g = conversationGuard(incidentId); if (g) return delay(g);
      shared = load();
      const inc = shared.incidents.find(i => i.id === incidentId);
      if (!inc) return fail("NOT_FOUND", "Incident not found.");
      if (inc.status === "CLOSED" || inc.status === "RESOLVED") return fail("INCIDENT_ENDED", "Incident ended.");
      if (inc.dispatcherIdentity !== identityHex) return fail("NOT_CONVERSATION_OWNER", "Take over first.");
      if (!text.trim() || text.trim().length > 2000) return fail("INVALID_MESSAGE", "Enter 1–2000 characters.");
      const key = `${identityHex}:${incidentId}:${clientMessageId}`;
      const receipts = JSON.parse(localStorage.getItem('flare-fixture-replies') ?? '[]') as string[];
      if (!receipts.includes(key)) {
        const labelled = text.trim().startsWith('[SIMULATION]') ? text.trim() : `[SIMULATION] ${identity.unitId ?? "Dispatcher"}: ${text.trim()}`;
        shared.incidents = shared.incidents.map(i => i.id === incidentId ? { ...i, conversation: [...(i.conversation ?? []), { sender: identity.role === "responder" ? "RESPONDER" : "DISPATCHER", text: labelled, at: now(), delivery: "SENT" }] } : i);
        localStorage.setItem('flare-fixture-replies', JSON.stringify([...receipts, key]));
        persist();
      }
      return delay<OpResult>({ ok: true });
    },

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
        ...units.map((u): Assignment => ({
          id: `ASG-${incidentId}-${u.id}`, incidentId, unitId: u.id, service: u.service, status: "OFFERED", createdAt: ts, updatedAt: ts,
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
      if (next === "COMPLETED") {
        shared.incidents = shared.incidents.map(i => i.id === a.incidentId && i.controllerUnitId === identity.unitId ? { ...i, dispatcherIdentity: null } : i);
        shared.units = shared.units.map((u) => (u.id === a.unitId ? { ...u, status: "AVAILABLE" as const } : u));
      }
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

    async closeIncident({ incidentId, reason }) {
      const g = guard("dispatcher"); if (g) return delay(g);
      shared = load();
      const inc = shared.incidents.find((i) => i.id === incidentId);
      if (!inc) return fail("NOT_FOUND", "Incident not found.");
      if (inc.status !== "COLLECTING" && inc.status !== "READY_FOR_REVIEW") return fail("NOT_CLOSABLE", inc.status);
      if (shared.assignments.some((a) => a.incidentId === incidentId)) return fail("HAS_ASSIGNMENTS", "Incident has assignments.");
      if (!reason.trim()) return fail("REASON_REQUIRED", "A reason is required.");
      shared.incidents = shared.incidents.map((i) => (i.id === incidentId ? { ...i, status: "CLOSED", closeReason: reason.trim(), updatedAt: now() } : i));
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
