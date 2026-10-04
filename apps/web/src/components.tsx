import { useEffect, useState } from "react";
import { asFixture, useClient, useSnapshot } from "./data";
import type { OpResult } from "./types";
import { ASSIGNMENT_ORDER, type AssignmentStatus, type IncidentStatus, type IncidentView } from "./types";

// ---- Icons (Lucide paths, inline so there is no icon dependency) ----
const ICONS = {
  pin: <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  help: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
  message: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  activity: <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />,
  police: <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
  fire: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  ems: <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z" />,
  wifiOff: <><path d="M12 20h.01" /><path d="M8.5 16.43a5 5 0 0 1 7 0" /><path d="M2 8.82a15 15 0 0 1 4.17-2.65" /><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" /><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" /><path d="M5 13a10 10 0 0 1 5.24-2.76" /><path d="m2 2 20 20" /></>,
} as const;
export function Icon({ name }: { name: keyof typeof ICONS }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

// ---- Time ----
/** Re-renders on an interval so relative times keep moving. */
export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function relativeTime(iso: string, now: number) {
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "unknown time";
  const s = Math.round(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return new Date(iso).toLocaleDateString();
}

export function RelativeTime({ iso, prefix, icon = false }: { iso: string; prefix?: string; icon?: boolean }) {
  const now = useNow();
  const abs = new Date(iso).toLocaleString();
  return (
    <time className="time" dateTime={iso} title={abs}>
      {icon && <Icon name="clock" />}{prefix ? `${prefix} ` : ""}{relativeTime(iso, now)}
    </time>
  );
}

// ---- Status chips (text always carries the meaning; color only reinforces it) ----
const INCIDENT_STATUS: Record<IncidentStatus, { label: string; tone: string }> = {
  COLLECTING: { label: "Collecting info", tone: "warn" },
  READY_FOR_REVIEW: { label: "Ready for review", tone: "info" },
  DISPATCHED: { label: "Dispatched", tone: "violet" },
  RESOLVED: { label: "Resolved", tone: "ok" },
  CLOSED: { label: "Closed, no dispatch", tone: "" },
};
export function IncidentStatusChip({ status }: { status: IncidentStatus }) {
  const s = INCIDENT_STATUS[status] ?? { label: status, tone: "" };
  return <span className={`chip ${s.tone}`}>{s.label}</span>;
}

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  OFFERED: "Offered", ACCEPTED: "Accepted", EN_ROUTE: "En route", ON_SCENE: "On scene", COMPLETED: "Completed",
};
const ASSIGNMENT_TONE: Record<AssignmentStatus, string> = {
  OFFERED: "warn", ACCEPTED: "info", EN_ROUTE: "violet", ON_SCENE: "orange", COMPLETED: "ok",
};
export function AssignmentStatusChip({ status }: { status: AssignmentStatus }) {
  return <span className={`chip ${ASSIGNMENT_TONE[status] ?? ""}`}>{ASSIGNMENT_LABEL[status] ?? status}</span>;
}

/** OFFERED → ACCEPTED → EN_ROUTE → ON_SCENE → COMPLETED, with the current step named for screen readers. */
export function AssignmentStepper({ status }: { status: AssignmentStatus }) {
  const cur = ASSIGNMENT_ORDER.indexOf(status);
  return (
    <ol className="stepper" aria-label="Assignment progress">
      {ASSIGNMENT_ORDER.map((s, i) => {
        const state = i < cur || status === "COMPLETED" ? "done" : i === cur ? "current" : "";
        return (
          <li key={s} className={state} aria-current={i === cur ? "step" : undefined}>
            {ASSIGNMENT_LABEL[s]}
            {state === "done" && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ---- Chrome ----
export function SimBanner() {
  const { mode } = useSnapshot();
  return (
    <div className="sim-strip" role="note">
      <strong>DEMO SYSTEM</strong>
      <span>Not connected to emergency services</span>
      {mode === "fixture" && <span className="fixture-tag">FIXTURE DATA, not live</span>}
    </div>
  );
}

export function ConnectionStatus() {
  const { connection, mode } = useSnapshot();
  if (mode === "fixture")
    return <span className="chip warn">Fixture{connection === "connected" ? "" : ` · ${connection}`}</span>;
  if (connection === "connected") return <span className="chip ok">Live</span>;
  return <span className="chip warn pulse">{connection === "connecting" ? "Connecting" : "Reconnecting"}</span>;
}

export function IdentityBadge() {
  const { identity, mode, access } = useSnapshot();
  if (access !== "ok") return null;
  const label = identity.role === "dispatcher" ? "Dispatcher" : `Responder · ${identity.unitId}`;
  return (
    <span className="chip plain ident" title="Backend permissions come from the authorized identity, not this label">
      {label}{mode === "fixture" ? " (fixture)" : ""}
    </span>
  );
}

export function StaleBanner() {
  const { connection } = useSnapshot();
  if (connection === "connected") return null;
  return (
    <div className="notice warn" role="status" style={{ marginBottom: 12 }}>
      <Icon name="wifiOff" />
      <span>
        {connection === "connecting" ? "Connecting to live updates." : "Live updates temporarily unavailable. Reconnecting."} The
        data below may be out of date, and actions stay off until the connection returns.
      </span>
    </div>
  );
}

// ---- Incident content ----
export function LocationLine({ text }: { text: string | null }) {
  if (!text)
    return <p className="location missing"><Icon name="alert" />The caller hasn't given a location yet.</p>;
  return <p className="location"><Icon name="pin" /><span>{text}</span></p>;
}

/** Inline badge for PENDING; queue rows and headers use it. */
export function ExtractionBadge({ incident }: { incident: IncidentView }) {
  const { state } = incident.extraction;
  if (state === "PENDING") return <span className="chip info pulse">Reading new message</span>;
  if (state === "FAILED") return <span className="chip danger">Extraction failed</span>;
  return null;
}

export function ExtractionNotice({ incident }: { incident: IncidentView }) {
  const { state, message } = incident.extraction;
  if (state !== "FAILED") return null;
  return (
    <div className="notice err" role="status">
      <Icon name="alert" />
      <span>
        Flare couldn't read the caller's latest message{message ? ` (${message})` : ""}. The facts below are the last
        verified ones.
      </span>
    </div>
  );
}

// ---- Actions ----
/** Runs a mutation, tracks pending state, and keeps the backend's error beside the action. */
// Plain-language explanations for the backend's rejection codes. Unlisted codes fall back to a generic line.
const OP_ERRORS: Record<string, string> = {
  DISCONNECTED: "You're offline. Nothing changed. Try again once live updates return.",
  UNAUTHORIZED: "This identity isn't allowed to do that.",
  FORBIDDEN: "This identity isn't allowed to do that.",
  NOT_FOUND: "That record no longer exists.",
  NOT_READY: "The incident needs a location before dispatch.",
  ALREADY_DISPATCHED: "Another dispatcher already confirmed this incident.",
  UNIT_CONFLICT: "One of those units was just taken. Nothing was assigned. Pick again.",
  UNIT_SERVICE_MISMATCH: "A selected unit doesn't match a confirmed service.",
  SERVICE_WITHOUT_UNIT: "Each confirmed service needs a unit.",
  INVALID_SELECTION: "Pick a unit for each confirmed service.",
  INVALID_TRANSITION: "That step is out of order. The status may have changed elsewhere.",
  NOT_COMPLETE: "Every unit must reach Completed first.",
  ASSIGNMENTS_NOT_COMPLETED: "Every unit must reach Completed first.",
  NOT_CLOSABLE: "Only incidents that haven't been dispatched can be closed.",
  HAS_ASSIGNMENTS: "This incident already has units assigned.",
  REASON_REQUIRED: "Give a reason for closing.",
  INCIDENT_CLOSED: "This incident is already closed.",
};

/** Runs a mutation, tracks pending state, and keeps the backend's error beside the action. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<OpResult>) => {
    setPending(true); setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(OP_ERRORS[r.code] ?? `The backend rejected this (${r.code}).`);
      return r.ok;
    } catch {
      setError("The request didn't reach the backend. Nothing changed.");
      return false;
    } finally { setPending(false); }
  };
  return { pending, error, run };
}

export function ActionError({ message }: { message: string | null }) {
  return (
    <div aria-live="polite">
      {message && <div className="notice err"><Icon name="alert" /><span>{message}</span></div>}
    </div>
  );
}

export function Pending({ label }: { label: string }) {
  return <span className="pending-line"><span className="spinner" aria-hidden="true" />{label}</span>;
}

export function FixtureControls({ incidentId }: { incidentId: string | null }) {
  const fx = asFixture(useClient());
  const { connection } = useSnapshot();
  if (!fx) return null;
  return (
    <details className="card dev">
      <summary>Fixture controls (dev only, simulate backend events)</summary>
      <div className="dev-row">
        <button className="btn" onClick={() => fx.dev.setConnected(connection !== "connected")}>
          {connection === "connected" ? "Simulate disconnect" : "Reconnect"}
        </button>
        <button className="btn" disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateCorrection(incidentId)}>Simulate caller correction</button>
        <button className="btn" disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateExtraction(incidentId, "PENDING")}>Extraction pending</button>
        <button className="btn" disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateExtraction(incidentId, "FAILED")}>Extraction failed</button>
        <button className="btn" disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateExtraction(incidentId, "OK")}>Extraction OK</button>
        <button className="btn" onClick={() => fx.dev.rigNextConflict()}>Rig next dispatch to conflict</button>
        <button className="btn" onClick={() => fx.dev.reset()}>Reset fixture data</button>
      </div>
    </details>
  );
}

/** Blocks a route until the live backend has authorized this identity for it. Fixture mode always passes. */
export function AccessGate({ role, children }: { role: "dispatcher" | "responder"; children: React.ReactNode }) {
  const { access, identity, identityHex, connection, connectError } = useSnapshot();
  const shell = (body: React.ReactNode) => (
    <div className="page"><div className="card gate"><h1>{role === "dispatcher" ? "Dispatcher" : "Responder"}</h1>{body}</div></div>
  );
  if (connection === "connecting") return shell(<Pending label="Connecting to the backend…" />);
  if (connectError && connection !== "connected")
    return shell(<div className="notice err" role="alert"><Icon name="alert" /><span>Can't reach the backend: {connectError}. Retrying.</span></div>);
  if (access === "no-role")
    return shell(
      <div className="notice warn" role="alert">
        <Icon name="info" />
        <div>
          This identity has no role yet. Ask the operator to grant one with Person 3's <code>grant_role</code>. The page
          updates on its own once the grant lands.
          <div style={{ marginTop: 8 }}>Identity: <code>{identityHex}</code></div>
        </div>
      </div>);
  if (access === "unsupported-role")
    return shell(<div className="notice err" role="alert"><Icon name="alert" /><span>This identity's role (agent or admin) has no web view. Identity: <code>{identityHex}</code></span></div>);
  if (identity.role !== role)
    return shell(
      <div className="notice warn" role="alert">
        <Icon name="info" />
        <span>This identity is authorized as {identity.role}, not {role}. Open <a href={`/${identity.role}`}>/{identity.role}</a> instead.</span>
      </div>);
  return <>{children}</>;
}
