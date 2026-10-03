import { useEffect, useState } from "react";
import { useClient, useSnapshot } from "../data";
import {
  ActionError, AssignmentStatusChip, AssignmentStepper, ExtractionBadge, ExtractionNotice, FactsList, FixtureControls,
  Icon, IncidentStatusChip, LocationLine, Pending, RelativeTime, ServiceList, StaleBanner, useAction,
} from "../components";
import type { IncidentView, Service } from "../types";

const SERVICES: Service[] = ["FIRE", "EMS", "POLICE"];
const byNewest = (a: IncidentView, b: IncidentView) => b.createdAt.localeCompare(a.createdAt);
const title = (i: IncidentView) =>
  i.facts.incidentType ? i.facts.incidentType[0].toUpperCase() + i.facts.incidentType.slice(1) : "Unclassified report";

function QueueRow({ incident, selected, onSelect }: { incident: IncidentView; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button className="qrow" aria-current={selected} onClick={onSelect}>
        <span className="qrow-top">
          <IncidentStatusChip status={incident.status} />
          <RelativeTime iso={incident.createdAt} />
        </span>
        <span className="qrow-summary" title={incident.summary}>{incident.summary || title(incident)}</span>
        {incident.facts.locationText
          ? <span className="qrow-meta"><Icon name="pin" /><span>{incident.facts.locationText}</span></span>
          : <span className="qrow-meta missing"><Icon name="alert" /><span>Location missing</span></span>}
        {(incident.needsReview || incident.extraction.state !== "OK") && (
          <span className="qrow-flags">
            {incident.needsReview && <span className="chip danger">Needs review</span>}
            <ExtractionBadge incident={incident} />
          </span>
        )}
      </button>
    </li>
  );
}

export default function Dispatcher() {
  const client = useClient();
  const { incidents, units, assignments, connection } = useSnapshot();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const dispatch = useAction();
  const resolve = useAction();

  const active = incidents.filter((i) => i.status !== "RESOLVED").sort(byNewest);
  const resolved = incidents.filter((i) => i.status === "RESOLVED").sort(byNewest);
  const incident = incidents.find((i) => i.id === selectedId) ?? active[0] ?? resolved[0];
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

  const toggleService = (s: Service) => {
    if (services.includes(s)) {
      setServices(services.filter((x) => x !== s));
      setUnitIds((ids) => ids.filter((id) => units.find((u) => u.id === id)?.service !== s));
    } else setServices([...services, s]);
  };
  const toggleUnit = (id: string) => setUnitIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const missing = services.filter((s) => !units.some((u) => unitIds.includes(u.id) && u.service === s));
  const unitMismatch = unitIds.some((id) => !services.includes(units.find((u) => u.id === id)!.service));
  const canResolve = incident?.status === "DISPATCHED" && mine.length > 0 && mine.every((a) => a.status === "COMPLETED");
  let blocker: string | null = null;
  if (incident?.status === "COLLECTING") blocker = "Waiting on the caller's location before you can dispatch.";
  else if (services.length === 0) blocker = "Pick at least one service to dispatch.";
  else if (missing.length) blocker = `Pick a unit for ${missing.join(" and ")}.`;
  else if (unitMismatch) blocker = "One selected unit doesn't match a confirmed service.";
  const canDispatch = incident?.status === "COLLECTING" || incident?.status === "READY_FOR_REVIEW";

  return (
    <div className="page">
      <StaleBanner />
      <div className={`console ${offline ? "stale" : ""}`}>
        <aside className="queue" aria-label="Incident queue">
          <h2>Active incidents <span className="muted">({active.length})</span></h2>
          {active.length === 0
            ? <p className="empty small">No active incidents. New caller reports show up here.</p>
            : <ul className="queue-list">
                {active.map((i) => <QueueRow key={i.id} incident={i} selected={i.id === incidentId} onSelect={() => setSelectedId(i.id)} />)}
              </ul>}
          {resolved.length > 0 && (
            <details className="resolved-group" open={incident?.status === "RESOLVED" || undefined}>
              <summary>Resolved ({resolved.length})</summary>
              <ul className="queue-list">
                {resolved.map((i) => <QueueRow key={i.id} incident={i} selected={i.id === incidentId} onSelect={() => setSelectedId(i.id)} />)}
              </ul>
            </details>
          )}
        </aside>

        <main className="detail">
          {!incident ? <div className="empty">Waiting for a caller to text Flare.</div> : (
            <>
              <div className="detail-head">
                <div className="detail-head-row">
                  <IncidentStatusChip status={incident.status} />
                  <ExtractionBadge incident={incident} />
                  <span className="detail-id">#{incident.id}</span>
                </div>
                <h2>{title(incident)}</h2>
                <div className="detail-head-row">
                  <RelativeTime iso={incident.createdAt} prefix="Opened" icon />
                  <RelativeTime iso={incident.updatedAt} prefix="Updated" />
                </div>
                {incident.needsReview && (
                  <div className="notice err" role="status">
                    <Icon name="alert" />
                    <span>The caller changed facts after dispatch. Review them below. Flare left the assigned units unchanged.</span>
                  </div>
                )}
                <ExtractionNotice incident={incident} />
              </div>

              <div className="detail-cols">
                <div>
                  <section className="card">
                    <h3 className="card-title">Summary</h3>
                    <p>{incident.summary}</p>
                  </section>
                  <section className="card">
                    <h3 className="card-title">Location <span className="hint">typed by caller</span></h3>
                    <LocationLine text={incident.facts.locationText} />
                  </section>
                  <section className="card">
                    <h3 className="card-title">Caller facts <span className="hint">caller-reported, unverified</span></h3>
                    <FactsList facts={incident.facts} evidence={incident.evidence} corrections={incident.corrections} skip={["locationText"]} />
                  </section>
                </div>

                <div>
                  <section className="card">
                    <h3 className="card-title">Services</h3>
                    <div className="svc-block rec">
                      <h4>Recommended <span className="chip plain">Simulated rule</span></h4>
                      <div className="svc-row"><ServiceList services={incident.recommendedServices} empty="No rule matched. Review the facts and decide." /></div>
                      {incident.recommendationReason && <p className="reason">{incident.recommendationReason}</p>}
                    </div>
                    <div className={`svc-block ${incident.confirmedServices.length ? "conf" : "rec"}`}>
                      <h4>{incident.confirmedServices.length > 0 && <Icon name="check" />}Confirmed by dispatcher</h4>
                      <div className="svc-row"><ServiceList services={incident.confirmedServices} empty="Not confirmed yet." /></div>
                    </div>
                  </section>

                  {canDispatch && (
                    <section className="card dispatch" aria-label="Simulated dispatch">
                      <h3 className="card-title">Dispatch <span className="hint">simulated, mock units only</span></h3>
                      <fieldset disabled={offline || dispatch.pending}>
                        <legend>Services to confirm</legend>
                        <div className="toggles">
                          {SERVICES.map((s) => (
                            <label key={s} className="toggle">
                              <input type="checkbox" checked={services.includes(s)} onChange={() => toggleService(s)} />
                              <span className="mono">{s}</span>
                              {incident.recommendedServices.includes(s) && <span className="tag">recommended</span>}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                      <fieldset disabled={offline || dispatch.pending}>
                        <legend>Units</legend>
                        <div className="unit-groups">
                          {SERVICES.filter((s) => units.some((u) => u.service === s)).map((s) => (
                            <div key={s} className="unit-group">
                              <h5>{s}{!services.includes(s) && " (service not confirmed)"}</h5>
                              {units.filter((u) => u.service === s).map((u) => (
                                <label key={u.id} className="unit-opt">
                                  <input type="checkbox" checked={unitIds.includes(u.id)}
                                    disabled={u.status !== "AVAILABLE" || !services.includes(s)}
                                    onChange={() => toggleUnit(u.id)} />
                                  <span className="mono">{u.id}</span>
                                  <span className={`chip ${u.status === "AVAILABLE" ? "ok" : ""}`}>{u.status === "AVAILABLE" ? "Available" : "Busy"}</span>
                                </label>
                              ))}
                            </div>
                          ))}
                        </div>
                      </fieldset>
                      <div className="dispatch-actions">
                        <button className="btn primary"
                          disabled={!!blocker || offline || dispatch.pending}
                          onClick={() => dispatch.run(() => client.confirmDispatchAndAssign({ incidentId: incident.id, confirmedServices: services, unitIds }))}>
                          {dispatch.pending ? <Pending label="Waiting for the backend…" /> : "Confirm dispatch (simulated)"}
                        </button>
                        {blocker && <p className="blocker"><Icon name="info" />{blocker}</p>}
                        <ActionError message={dispatch.error} />
                      </div>
                    </section>
                  )}

                  <section className="card">
                    <h3 className="card-title">Assignments</h3>
                    {mine.length === 0 ? <p className="muted small">No units assigned yet.</p> : mine.map((a) => (
                      <div key={a.id} className="assignment">
                        <div className="assignment-head">
                          <span className="mono">{a.unitId}</span>
                          <AssignmentStatusChip status={a.status} />
                          <RelativeTime iso={a.updatedAt} prefix="Updated" />
                        </div>
                        <AssignmentStepper status={a.status} />
                      </div>
                    ))}
                    {incident.status === "DISPATCHED" && (
                      <div className="resolve-row">
                        <button className="btn" disabled={!canResolve || offline || resolve.pending}
                          onClick={() => resolve.run(() => client.resolveIncident({ incidentId: incident.id }))}>
                          {resolve.pending ? <Pending label="Resolving…" /> : "Resolve incident"}
                        </button>
                        {!canResolve && <span className="muted small">Unlocks when every unit reaches Completed.</span>}
                      </div>
                    )}
                    <ActionError message={resolve.error} />
                  </section>
                </div>
              </div>
            </>
          )}
          <FixtureControls incidentId={incidentId} />
        </main>
      </div>
    </div>
  );
}
