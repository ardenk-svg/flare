import { useState } from "react";
import { asFixture, useClient, useSnapshot } from "./data";
import type { OpResult } from "./types";
import type { CallerFacts, Evidence, IncidentView, Service } from "./types";

export function SimBanner() {
  const { mode } = useSnapshot();
  return (
    <div className="banner">
      <strong>SIMULATION</strong> — no real emergency services are contacted. Mock units only.
      {mode === "fixture" && <span className="fixture-tag">FIXTURE DATA — not live</span>}
    </div>
  );
}

export function ConnectionStatus() {
  const { connection, mode } = useSnapshot();
  const cls = mode === "fixture" ? "fixture" : connection === "connected" ? "live" : "disconnected";
  return <span className={`pill conn-${cls}`}>{mode === "fixture" ? `fixture · ${connection}` : connection}</span>;
}

export function ServiceList({ services, empty }: { services: Service[]; empty: string }) {
  if (services.length === 0) return <em className="muted">{empty}</em>;
  return <>{services.map((s) => <span key={s} className={`pill svc-${s}`}>{s}</span>)}</>;
}

const FACT_LABELS: Record<keyof CallerFacts, string> = {
  incidentType: "Incident type",
  locationText: "Location (typed)",
  peopleInvolved: "People involved",
  callerReportedConscious: "Caller: conscious",
  callerReportedBreathing: "Caller: breathing",
  fireOrSmoke: "Fire / smoke",
  trappedPerson: "Trapped person",
  violentThreat: "Violent threat",
  injuryReported: "Injury reported",
};

function show(v: string | number | boolean | null) {
  if (v === null) return <em className="muted">unknown</em>;
  if (typeof v === "boolean") return v ? "yes (caller-reported)" : "no (explicit)";
  return String(v);
}

export function FactsTable({
  facts, evidence, corrections,
}: { facts: CallerFacts; evidence: Evidence[]; corrections: string[] }) {
  return (
    <table className="facts">
      <tbody>
        {(Object.keys(FACT_LABELS) as (keyof CallerFacts)[]).map((k) => {
          const ev = evidence.find((e) => e.field === k);
          return (
            <tr key={k}>
              <th>{FACT_LABELS[k]}</th>
              <td>
                {show(facts[k])}
                {corrections.includes(k) && <span className="pill warn">corrected</span>}
                {ev && <div className="quote">“{ev.quote}” · {ev.messageId}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function LocationCard({ text }: { text: string | null }) {
  return (
    <div className="card">
      <h4>Location (typed by caller)</h4>
      <p>{text ?? <em className="muted">not yet provided</em>}</p>
    </div>
  );
}

export function ExtractionState({ incident }: { incident: IncidentView }) {
  const { state, message } = incident.extraction;
  if (state === "OK") return null;
  return (
    <div className={`notice ${state === "FAILED" ? "err" : ""}`}>
      Extraction {state.toLowerCase()}{message ? `: ${message}` : ""}. Showing last verified facts.
    </div>
  );
}


export function IdentityBadge() {
  const { identity, mode } = useSnapshot();
  const label = identity.role === "dispatcher" ? "Dispatcher" : `Responder · mock unit ${identity.unitId}`;
  return <span className="pill ident" title="Backend permissions come from the authorized identity, not this label">{label}{mode === "fixture" ? " (fixture identity)" : ""}</span>;
}

export function StaleBanner() {
  const { connection } = useSnapshot();
  if (connection === "connected") return null;
  return (
    <div className="notice err" role="alert">
      {connection === "connecting" ? "Connecting…" : "Disconnected."} Showing cached data marked stale. Actions are disabled until reconnect.
    </div>
  );
}

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
  return <div aria-live="polite">{message && <div className="notice err">{message}</div>}</div>;
}

export function FixtureControls({ incidentId }: { incidentId: string | null }) {
  const fx = asFixture(useClient());
  const { connection } = useSnapshot();
  if (!fx) return null;
  return (
    <details className="card dev">
      <summary>Fixture controls (dev only, simulate backend events)</summary>
      <div className="dev-row">
        <button onClick={() => fx.dev.setConnected(connection !== "connected")}>
          {connection === "connected" ? "Simulate disconnect" : "Reconnect"}
        </button>
        <button disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateCorrection(incidentId)}>Simulate caller correction</button>
        <button disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateExtraction(incidentId, "PENDING")}>Extraction pending</button>
        <button disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateExtraction(incidentId, "FAILED")}>Extraction failed</button>
        <button disabled={!incidentId} onClick={() => incidentId && fx.dev.simulateExtraction(incidentId, "OK")}>Extraction OK</button>
        <button onClick={() => fx.dev.rigNextConflict()}>Rig next dispatch to conflict</button>
        <button onClick={() => fx.dev.reset()}>Reset fixture data</button>
      </div>
    </details>
  );
}

/** Blocks a route until the live backend has authorized this identity for it. Fixture mode always passes. */
export function AccessGate({ role, children }: { role: "dispatcher" | "responder"; children: React.ReactNode }) {
  const { access, identity, identityHex, connection, connectError } = useSnapshot();
  const shell = (body: React.ReactNode) => (
    <div className="page"><SimBanner /><h1>{role === "dispatcher" ? "Dispatcher" : "Responder"}</h1>{body}</div>
  );
  if (connection === "connecting") return shell(<p className="muted">Connecting to the backend…</p>);
  if (connectError && connection !== "connected")
    return shell(<div className="notice err" role="alert">Cannot reach the backend: {connectError}. Retrying.</div>);
  if (access === "no-role")
    return shell(
      <div className="notice err" role="alert">
        This identity has no role yet. Ask the operator to grant one (Person 3's <code>grant_role</code>).
        <div>Identity: <code>{identityHex}</code></div>
      </div>);
  if (access === "unsupported-role")
    return shell(<div className="notice err" role="alert">This identity's role has no web view (agent/admin). Identity: <code>{identityHex}</code></div>);
  if (identity.role !== role)
    return shell(
      <div className="notice err" role="alert">
        This identity is authorized as {identity.role}, not {role}. Open <a href={`/${identity.role}`}>/{identity.role}</a> instead.
      </div>);
  return <>{children}</>;
}
