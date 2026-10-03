import { useEffect, useState } from "react";
import { useClient, useSnapshot } from "../data";
import {
  ActionError, ConnectionStatus, ExtractionState, FactsTable, FixtureControls, IdentityBadge,
  LocationCard, ServiceList, SimBanner, StaleBanner, useAction,
} from "../components";
import type { Service } from "../types";

export default function Dispatcher() {
  const client = useClient();
  const { incidents, units, assignments, connection } = useSnapshot();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const dispatch = useAction();
  const resolve = useAction();

  const incident = incidents.find((i) => i.id === (selectedId ?? incidents[0]?.id));
  const incidentId = incident?.id ?? null;
  const mine = assignments.filter((a) => a.incidentId === incidentId);
  const offline = connection !== "connected";

  // Default the confirmation to the recommendation; the dispatcher can change it.
  useEffect(() => {
    setServices(incident?.recommendedServices ?? []);
    setUnitIds([]);
  }, [incidentId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Drop selections that a refreshed subscription shows are no longer available.
  useEffect(() => {
    setUnitIds((ids) => ids.filter((id) => units.find((u) => u.id === id)?.status === "AVAILABLE"));
  }, [units]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const missing = services.filter((s) => !units.some((u) => unitIds.includes(u.id) && u.service === s));
  const unitMismatch = unitIds.some((id) => !services.includes(units.find((u) => u.id === id)!.service));
  const canResolve = incident?.status === "DISPATCHED" && mine.length > 0 && mine.every((a) => a.status === "COMPLETED");
  let blocker: string | null = null;
  if (incident?.status === "COLLECTING") blocker = "Not ready: location still missing.";
  else if (services.length === 0) blocker = "Confirm at least one service.";
  else if (missing.length) blocker = `Select a unit for: ${missing.join(", ")}.`;
  else if (unitMismatch) blocker = "A selected unit does not match a confirmed service.";

  return (
    <div className="page">
      <SimBanner />
      <header className="bar">
        <h1>Dispatcher</h1>
        <IdentityBadge />
        <ConnectionStatus />
      </header>
      <StaleBanner />
      <div className={`split ${offline ? "stale" : ""}`}>
        <aside>
          <h2>Incident queue</h2>
          {incidents.length === 0 && <p className="muted">No incidents yet. Waiting for a caller report.</p>}
          {incidents.map((i) => (
            <button key={i.id} className={`row ${i.id === incidentId ? "sel" : ""}`} onClick={() => setSelectedId(i.id)}>
              <strong>{i.id}</strong> <span className="pill">{i.status}</span>
              {i.needsReview && <span className="pill warn">review</span>}
              <div className="muted">{i.summary}</div>
            </button>
          ))}
        </aside>
        <main>
          {!incident ? <p className="muted">Select an incident.</p> : (
            <>
              <h2>{incident.id} <span className="pill">{incident.status}</span></h2>
              {incident.needsReview && (
                <div className="notice err">Caller facts changed after dispatch. Review needed; assigned units were not changed.</div>
              )}
              <ExtractionState incident={incident} />
              <p>{incident.summary}</p>
              <LocationCard text={incident.facts.locationText} />
              <h3>Caller facts (caller-reported, unverified)</h3>
              <FactsTable facts={incident.facts} evidence={incident.evidence} corrections={incident.corrections} />

              <div className="card">
                <h3>Services</h3>
                <p>Recommended (simulated rules): <ServiceList services={incident.recommendedServices} empty="None. Dispatcher review required." /></p>
                <div className="muted">{incident.recommendationReason}</div>
                <p>Confirmed by dispatcher: <ServiceList services={incident.confirmedServices} empty="Not yet confirmed" /></p>
              </div>

              {incident.status === "COLLECTING" || incident.status === "READY_FOR_REVIEW" ? (
                <fieldset className="card" disabled={offline || dispatch.pending}>
                  <legend>Simulated dispatch</legend>
                  <div>Confirm services:{" "}
                    {(["FIRE", "EMS", "POLICE"] as Service[]).map((s) => (
                      <label key={s} className="inline">
                        <input type="checkbox" checked={services.includes(s)} onChange={() => setServices((l) => toggle(l, s))} /> {s}
                      </label>
                    ))}
                  </div>
                  <div>Select mock units:
                    {units.map((u) => (
                      <label key={u.id} className="unit">
                        <input type="checkbox" checked={unitIds.includes(u.id)} disabled={u.status !== "AVAILABLE"}
                          onChange={() => setUnitIds((l) => toggle(l, u.id))} />
                        {u.id} <span className="pill">{u.status}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    disabled={!!blocker || offline || dispatch.pending}
                    onClick={() => dispatch.run(() => client.confirmDispatchAndAssign({ incidentId: incident.id, confirmedServices: services, unitIds }))}
                  >
                    {dispatch.pending ? "Confirming…" : "Confirm dispatch & assign (simulated)"}
                  </button>
                  {blocker && <div className="muted">{blocker}</div>}
                  <ActionError message={dispatch.error} />
                </fieldset>
              ) : null}

              <h3>Assignments</h3>
              {mine.length === 0 ? <p className="muted">No assignments yet.</p> : (
                <ul className="assign">
                  {mine.map((a) => (
                    <li key={a.id}>
                      <strong>{a.unitId}</strong> <span className="pill">assignment: {a.status}</span>
                      <span className="muted"> updated {new Date(a.updatedAt).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              )}
              {incident.status === "DISPATCHED" && (
                <div>
                  <button disabled={!canResolve || offline || resolve.pending}
                    onClick={() => resolve.run(() => client.resolveIncident({ incidentId: incident.id }))}>
                    {resolve.pending ? "Resolving…" : "Resolve incident"}
                  </button>
                  {!canResolve && <span className="muted"> Available when every assignment is COMPLETED.</span>}
                  <ActionError message={resolve.error} />
                </div>
              )}
            </>
          )}
          <FixtureControls incidentId={incidentId} />
        </main>
      </div>
    </div>
  );
}
