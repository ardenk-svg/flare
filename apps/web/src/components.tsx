import type { CallerFacts, Evidence, IncidentView, Service } from "./types";
import { FIXTURE_LABEL } from "./fixture";

export function SimBanner() {
  return (
    <div className="banner">
      <strong>SIMULATION</strong> — no real emergency services are contacted. Mock units only.
      <span className="fixture-tag">{FIXTURE_LABEL}</span>
    </div>
  );
}

export function ConnectionStatus({ state }: { state: "fixture" | "live" | "disconnected" }) {
  return <span className={`pill conn-${state}`}>{state}</span>;
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
