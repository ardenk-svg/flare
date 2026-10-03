import { useEffect, useState } from "react";
import { asFixture, useClient, useSnapshot } from "./data";
import type { OpResult } from "./types";
import {
  ASSIGNMENT_ORDER, type AssignmentStatus, type CallerFacts, type Evidence, type IncidentStatus, type IncidentView,
  type Service,
} from "./types";

// ---- Icons (Lucide paths, inline so there is no icon dependency) ----
const ICONS = {
  pin: <><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /><circle cx="12" cy="10" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  chevron: <path d="m9 18 6-6-6-6" />,
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
      <strong>SIMULATION</strong>
      <span>No real emergency services are contacted. All units are mock units.</span>
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
        {connection === "connecting" ? "Connecting to the backend." : "Connection lost. Reconnecting."} The data below may be
        out of date, and actions stay off until the connection returns.
      </span>
    </div>
  );
}

// ---- Incident content ----
export function ServiceList({ services, empty }: { services: Service[]; empty: string }) {
  if (services.length === 0) return <span className="muted small">{empty}</span>;
  return <>{services.map((s) => <span key={s} className="chip plain svc">{s}</span>)}</>;
}

export const FACT_LABELS: Record<keyof CallerFacts, string> = {
  incidentType: "Incident type",
  locationText: "Location (typed)",
  peopleInvolved: "People involved",
  callerReportedConscious: "Conscious",
  callerReportedBreathing: "Breathing",
  fireOrSmoke: "Fire or smoke",
  trappedPerson: "Trapped person",
  violentThreat: "Violent threat",
  injuryReported: "Injury reported",
};

function factValue(v: string | number | boolean) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

/** Known caller facts with the caller's own words as evidence. Unknown fields sit behind a toggle. */
export function FactsList({
  facts, evidence, corrections, skip = [],
}: { facts: CallerFacts; evidence: Evidence[]; corrections: string[]; skip?: (keyof CallerFacts)[] }) {
  const [showUnknown, setShowUnknown] = useState(false);
  const keys = (Object.keys(FACT_LABELS) as (keyof CallerFacts)[]).filter((k) => !skip.includes(k));
  const known = keys.filter((k) => facts[k] !== null);
  const unknown = keys.filter((k) => facts[k] === null);
  const shown = showUnknown ? [...known, ...unknown] : known;
  return (
    <>
      {known.length === 0 && <p className="muted small">The caller hasn't reported any of these yet.</p>}
      <ul className="facts">
        {shown.map((k) => {
          const v = facts[k];
          const quotes = evidence.filter((e) => e.field === k);
          return (
            <li key={k}>
              <span className="fact-label">{FACT_LABELS[k]}</span>
              <span className={`fact-value ${v === null ? "unknown" : ""}`}>
                {v === null ? "Unknown" : factValue(v)}
                {corrections.includes(k) && <span className="chip warn">Corrected</span>}
              </span>
              {quotes.map((q, i) => <blockquote key={i} className="quote">“{q.quote}”</blockquote>)}
            </li>
          );
        })}
      </ul>
      {unknown.length > 0 && (
        <button className="btn-link" aria-expanded={showUnknown} onClick={() => setShowUnknown((s) => !s)}>
          {showUnknown ? "Hide unknown fields" : `Show unknown fields (${unknown.length})`}
        </button>
      )}
    </>
  );
}

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
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<OpResult>) => {
    setPending(true); setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(`${r.code}: ${r.message}`);
    } catch (e) {
      setError(`Request failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setPending(false); }
  };
  return { pending, error, run };
}

export function ActionError({ message }: { message: string | null }) {
  return (
    <div aria-live="polite">
      {message && <div className="notice err"><Icon name="alert" /><span>The backend rejected this. {message}</span></div>}
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
