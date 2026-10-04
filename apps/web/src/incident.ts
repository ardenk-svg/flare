import { intakeCategory, missingIntakeFields } from "@flare/contracts";
// Display-only helpers for the dispatcher console. Pure functions over IncidentView so backend data
// (severity, readable reasons, real activity events) can replace each one later without touching components.
import type { ActivityEvent, ActivityKind, Assignment, AssignmentStatus, IncidentView, Service, Unit } from "./types";

type FactValue = string | number | boolean | null | undefined;
/** Facts read loosely so fields the schema doesn't have yet (#28) count as unknown instead of failing. */
const factsOf = (i: IncidentView) => i.facts as unknown as Record<string, FactValue>;
const known = (v: FactValue) => v !== null && v !== undefined;

// ---- Labels ----
export const FACT_LABELS: Record<string, string> = {
  incidentType: "Incident type",
  locationText: "Location",
  peopleInvolved: "People involved",
  callerReportedConscious: "Conscious",
  callerReportedBreathing: "Breathing",
  fireOrSmoke: "Fire or smoke",
  trappedPerson: "Anyone trapped",
  violentThreat: "Violent threat",
  injuryReported: "Injuries",
  weaponPresent: "Weapon present",
  suspectCount: "Number of suspects",
  callerStatus: "Caller status",
  vehicleCount: "Vehicles involved",
  patientAge: "Approximate age",
  roadBlocked: "Road blocked",
};

export const SERVICE_LABEL: Record<Service, string> = { POLICE: "Police", FIRE: "Fire / Rescue", EMS: "EMS" };

export function formatFact(v: string | number | boolean) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

export const incidentTitle = (i: IncidentView) =>
  i.facts.incidentType ? i.facts.incidentType[0].toUpperCase() + i.facts.incidentType.slice(1) : "Unclassified report";

// ---- Category ----
export type Category = "violent" | "fire" | "medical" | "traffic" | "other";

export function categoryOf(i: IncidentView): Category {
  return intakeCategory(i.facts);
}

// ---- Known / still needed ----

export interface FactRow { key: string; label: string }
export interface KnownFact extends FactRow { value: string | number | boolean }

/** Every reported fact except location, which has its own card. */
export function getKnownFacts(i: IncidentView): KnownFact[] {
  const f = factsOf(i);
  return Object.keys(f)
    .filter((k) => k !== "locationText" && known(f[k]))
    .map((k) => ({ key: k, label: FACT_LABELS[k] ?? k, value: f[k] as string | number | boolean }));
}

/** Unknown facts that matter for this kind of incident. Location is first when nothing places the caller. */
export function getRelevantMissingFacts(i: IncidentView): FactRow[] {
  return missingIntakeFields(i.facts, !!i.sharedLocation, i.unresolvedFields ?? []).map(key => ({ key, label: FACT_LABELS[key] ?? key }));
}

// ---- Severity (display only; replace with a backend value when one exists) ----
export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function deriveSeverity(i: IncidentView): Severity {
  const f = factsOf(i);
  if (f.callerReportedBreathing === false || f.callerReportedConscious === false) return "CRITICAL";
  if (f.trappedPerson === true && f.fireOrSmoke === true) return "CRITICAL";
  if (f.violentThreat === true && f.weaponPresent === true) return "CRITICAL";
  if (f.violentThreat || f.fireOrSmoke || f.trappedPerson || f.injuryReported || f.weaponPresent) return "HIGH";
  if (known(f.incidentType) || i.recommendedServices.length > 0) return "MEDIUM";
  return "LOW";
}

/** Highest severity first, then oldest first so nothing waits behind newer reports of the same severity. */
export const byPriority = (a: IncidentView, b: IncidentView) =>
  SEVERITY_RANK[deriveSeverity(a)] - SEVERITY_RANK[deriveSeverity(b)] || a.createdAt.localeCompare(b.createdAt);

/** The single most telling fact for a queue row. */
export function headlineFact(i: IncidentView): string | null {
  const f = factsOf(i);
  if (typeof f.callerStatus === "string") return `Caller ${f.callerStatus}`;
  if (f.callerReportedBreathing === false) return "Not breathing";
  if (f.callerReportedConscious === false) return "Not conscious";
  if (f.trappedPerson) return "Person trapped";
  if (f.weaponPresent) return "Weapon reported";
  if (f.violentThreat) return "Violent threat";
  if (f.fireOrSmoke) return "Fire or smoke";
  if (f.injuryReported) return "Injury reported";
  return null;
}

// ---- Why this response? ----
// Mirrors packages/intake DEMO_RULES until #30 exports readable reasons.
const RULES: Record<string, { label: string; services: Service[] }> = {
  DEMO_FIRE: { label: "Fire or smoke reported", services: ["FIRE"] },
  DEMO_TRAPPED: { label: "Person trapped", services: ["FIRE", "EMS"] },
  DEMO_INJURY: { label: "Injury reported", services: ["EMS"] },
  DEMO_CONSCIOUS: { label: "Someone not conscious", services: ["EMS"] },
  DEMO_BREATHING: { label: "Someone not breathing", services: ["EMS"] },
  DEMO_THREAT: { label: "Violent threat reported", services: ["POLICE"] },
  DEMO_VIOLENT: { label: "Violent threat reported", services: ["POLICE"] },
};

export function recommendationReasons(i: IncidentView): { service: Service; reasons: string[] }[] {
  return i.recommendedServices.map((service) => {
    const reasons = [...new Set(i.ruleIds.filter((id) => RULES[id]?.services.includes(service)).map((id) => RULES[id].label))];
    return { service, reasons: reasons.length ? reasons : ["Matched a response rule for the reported facts"] };
  });
}

// ---- Units ----
export const ASSIGNMENT_TEXT: Record<AssignmentStatus, string> = {
  OFFERED: "Assigned", ACCEPTED: "Accepted", EN_ROUTE: "En route", ON_SCENE: "On scene", COMPLETED: "Completed",
};

export function unitStatusLabel(u: Unit, assignments: Assignment[]): string {
  if (u.status === "AVAILABLE") return "Available";
  const a = assignments.find((x) => x.unitId === u.id && x.status !== "COMPLETED");
  return a ? ASSIGNMENT_TEXT[a.status] : "Unavailable";
}

// ---- Activity ----
const UNIT_EVENT: Record<AssignmentStatus, ActivityKind> = {
  OFFERED: "UNIT_ASSIGNED", ACCEPTED: "UNIT_ACCEPTED", EN_ROUTE: "UNIT_EN_ROUTE", ON_SCENE: "UNIT_ON_SCENE", COMPLETED: "UNIT_COMPLETED",
};

/**
 * Newest first. Uses backend events when present (#29). Otherwise derives only what stored timestamps prove:
 * creation, shared location, caller messages, each assignment's creation and current status, and a terminal status.
 */
export function getActivity(i: IncidentView, assignments: Assignment[]): { events: ActivityEvent[]; derived: boolean } {
  // Backend ids are increasing integers; they break ties between events committed in the same transaction.
  const byId = (a: string, b: string) => a.length - b.length || a.localeCompare(b);
  if (i.events?.length) return { events: [...i.events].sort((a, b) => b.at.localeCompare(a.at) || byId(b.id, a.id)), derived: false };
  const ev: ActivityEvent[] = [{ id: "created", kind: "INCIDENT_CREATED", at: i.createdAt }];
  for (const [n, m] of (i.conversation ?? []).entries())
    if (m.sender === "CALLER") ev.push({ id: `msg-${n}`, kind: "CALLER_MESSAGE", at: m.at });
  if (i.sharedLocation) ev.push({ id: "location", kind: "LOCATION_RECEIVED", at: i.sharedLocation.sharedAt });
  const mine = assignments.filter((a) => a.incidentId === i.id);
  if (mine.length) {
    const first = mine.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
    ev.push({ id: "dispatch", kind: "DISPATCH_CONFIRMED", at: first.createdAt, services: i.confirmedServices });
  }
  for (const a of mine) {
    ev.push({ id: `asg-${a.id}`, kind: "UNIT_ASSIGNED", at: a.createdAt, unitId: a.unitId });
    if (a.status !== "OFFERED") ev.push({ id: `asg-${a.id}-${a.status}`, kind: UNIT_EVENT[a.status], at: a.updatedAt, unitId: a.unitId });
  }
  if (i.status === "RESOLVED") ev.push({ id: "resolved", kind: "INCIDENT_RESOLVED", at: i.updatedAt });
  if (i.status === "CLOSED") ev.push({ id: "closed", kind: "INCIDENT_CLOSED", at: i.updatedAt, ...(i.closeReason ? { detail: i.closeReason } : {}) });
  // Stable for equal timestamps: later-pushed (later in the lifecycle) sorts first.
  return { events: ev.map((e, n) => [e, n] as const).sort(([a, x], [b, y]) => b.at.localeCompare(a.at) || y - x).map(([e]) => e), derived: true };
}

const LOCATION_SOURCE: Record<string, string> = { TYPED: "typed by caller", IMESSAGE_PIN: "shared iMessage pin", FIND_MY: "shared via Find My" };
const NOTIFIED: Record<string, string> = {
  DISPATCH_CONFIRMED: "Caller told help is being sent",
  ASSIGNMENT_EN_ROUTE: "Caller told a unit is en route",
  INFO_REPLY: "Status reply sent to caller",
  RESPONDER_REPLY: "Responder message delivered to caller",
  DISPATCHER_REPLY: "Dispatcher message delivered to caller",
};

/** Readable line for an event. Internal codes in `detail` are translated or dropped, never shown raw. */
export function activityLabel(e: ActivityEvent): string {
  const unit = e.unitId ?? "Unit";
  switch (e.kind) {
    case "RESPONDER_TAKEOVER": return `${e.unitId ?? "Responder"} took over the caller conversation`;
    case "DEMO_RESTARTED": return "Demo restarted";
    case "DISPATCHER_TAKEOVER": return "Dispatcher took over the caller conversation";
    case "AGENT_RESUMED": return "Automated caller questions resumed";
    case "INCIDENT_CREATED": return "Incident created";
    case "CALLER_MESSAGE": return "Caller message received";
    case "FACTS_UPDATED": return e.fields?.length ? `Updated: ${e.fields.map((f) => FACT_LABELS[f] ?? f).join(", ")}` : "Facts updated";
    case "LOCATION_RECEIVED": return e.detail && LOCATION_SOURCE[e.detail] ? `Location received (${LOCATION_SOURCE[e.detail]})` : "Location received";
    case "SERVICES_RECOMMENDED": return e.services?.length ? `${e.services.map((s) => SERVICE_LABEL[s]).join(" + ")} recommended` : "Recommendation cleared";
    case "EXTRACTION_FAILED": return "Couldn't read a caller message";
    case "DISPATCH_CONFIRMED": return e.services?.length ? `Dispatch confirmed: ${e.services.map((s) => SERVICE_LABEL[s]).join(" + ")}` : "Dispatch confirmed";
    case "UNIT_ASSIGNED": return `${unit} assigned`;
    case "UNIT_ACCEPTED": return `${unit} accepted`;
    case "UNIT_EN_ROUTE": return `${unit} en route`;
    case "UNIT_ON_SCENE": return `${unit} on scene`;
    case "UNIT_COMPLETED": return `${unit} completed`;
    case "CALLER_NOTIFIED": return (e.detail && NOTIFIED[e.detail]) ?? "Update sent to caller";
    case "INCIDENT_RESOLVED": return "Incident resolved";
    case "INCIDENT_CLOSED": return e.detail ? `Closed without dispatch: ${e.detail}` : "Closed without dispatch";
  }
}

/** Major transitions get emphasis in the feed. */
export const MAJOR_EVENTS: ReadonlySet<ActivityKind> = new Set([
  "INCIDENT_CREATED", "LOCATION_RECEIVED", "SERVICES_RECOMMENDED", "DISPATCH_CONFIRMED", "UNIT_ACCEPTED", "UNIT_EN_ROUTE",
  "UNIT_ON_SCENE", "UNIT_COMPLETED", "INCIDENT_RESOLVED", "INCIDENT_CLOSED",
]);

// ---- Time ----
export function formatElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Short age for queue rows: "45s", "2m", "1h", "3d". */
export function shortAge(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
