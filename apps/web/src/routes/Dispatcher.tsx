import { useState } from "react";
import { assignments, incidents, units } from "../fixture";
import { ConnectionStatus, ExtractionState, FactsTable, LocationCard, ServiceList, SimBanner } from "../components";

export default function Dispatcher() {
  const [selectedId, setSelectedId] = useState(incidents[0]?.id ?? null);
  const incident = incidents.find((i) => i.id === selectedId);
  const incAssignments = assignments.filter((a) => a.incidentId === selectedId);

  return (
    <div className="page">
      <SimBanner />
      <header className="bar">
        <h1>Dispatcher</h1>
        <ConnectionStatus state="fixture" />
      </header>
      <div className="split">
        <aside>
          <h3>Incident queue</h3>
          {incidents.length === 0 && <p className="muted">No incidents.</p>}
          {incidents.map((i) => (
            <button key={i.id} className={`row ${i.id === selectedId ? "sel" : ""}`} onClick={() => setSelectedId(i.id)}>
              <strong>{i.id}</strong> <span className="pill">{i.status}</span>
              <div className="muted">{i.summary}</div>
            </button>
          ))}
        </aside>
        <main>
          {!incident ? <p className="muted">Select an incident.</p> : (
            <>
              <h2>{incident.id} <span className="pill">{incident.status}</span></h2>
              <ExtractionState incident={incident} />
              <p>{incident.summary}</p>
              <LocationCard text={incident.facts.locationText} />
              <h3>Caller facts</h3>
              <FactsTable facts={incident.facts} evidence={incident.evidence} corrections={incident.corrections} />
              <div className="card">
                <h4>Recommended (simulated rules)</h4>
                <ServiceList services={incident.recommendedServices} empty="None — dispatcher review required" />
                <div className="muted">{incident.recommendationReason}</div>
                <h4>Confirmed by dispatcher</h4>
                <ServiceList services={incident.confirmedServices} empty="Not yet confirmed" />
              </div>
              <div className="card">
                <h4>Simulated dispatch</h4>
                {units.map((u) => (
                  <label key={u.id} className="unit">
                    <input type="checkbox" disabled /> {u.id} <span className="pill">{u.status}</span>
                  </label>
                ))}
                <button disabled>Confirm dispatch &amp; assign (fixture: not wired)</button>
              </div>
              <h3>Assignments</h3>
              {incAssignments.length === 0
                ? <p className="muted">No assignments yet.</p>
                : incAssignments.map((a) => <div key={a.id}>{a.unitId}: <span className="pill">{a.status}</span></div>)}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
