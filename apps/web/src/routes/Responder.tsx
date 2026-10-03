import { assignments, incidents } from "../fixture";
import { ConnectionStatus, FactsTable, LocationCard, SimBanner } from "../components";
import type { AssignmentStatus } from "../types";

const STEPS: { label: string; reaches: AssignmentStatus }[] = [
  { label: "Accept", reaches: "ACCEPTED" },
  { label: "En Route", reaches: "EN_ROUTE" },
  { label: "On Scene", reaches: "ON_SCENE" },
  { label: "Complete", reaches: "COMPLETED" },
];

export default function Responder() {
  // Fixture: pretend this identity is FIRE-01's responder.
  const unitId = "FIRE-01";
  const assignment = assignments.find((a) => a.unitId === unitId);
  const incident = incidents.find((i) => i.id === assignment?.incidentId);

  return (
    <div className="page">
      <SimBanner />
      <header className="bar">
        <h1>Responder</h1>
        <span className="pill">Mock unit {unitId}</span>
        <ConnectionStatus state="fixture" />
      </header>
      {!assignment || !incident ? (
        <p className="muted">No assignment for {unitId} yet. Waiting for simulated dispatch.</p>
      ) : (
        <main>
          <h2>{incident.id} <span className="pill">incident: {incident.status}</span></h2>
          <p>Assignment stage: <span className="pill">{assignment.status}</span></p>
          <p>{incident.summary}</p>
          <LocationCard text={incident.facts.locationText} />
          <FactsTable facts={incident.facts} evidence={[]} corrections={incident.corrections} />
          <div className="steps">
            {STEPS.map((s) => <button key={s.label} disabled>{s.label}</button>)}
          </div>
        </main>
      )}
    </div>
  );
}
