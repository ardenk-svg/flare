import { useClient, useSnapshot } from "../data";
import {
  ActionError, ConnectionStatus, ExtractionState, FactsTable, FixtureControls, IdentityBadge,
  LocationCard, SimBanner, StaleBanner, useAction,
} from "../components";
import { ASSIGNMENT_ORDER, type AssignmentStatus } from "../types";

const STEPS: { label: string; reaches: AssignmentStatus }[] = [
  { label: "Accept", reaches: "ACCEPTED" },
  { label: "En Route", reaches: "EN_ROUTE" },
  { label: "On Scene", reaches: "ON_SCENE" },
  { label: "Complete", reaches: "COMPLETED" },
];

export default function Responder() {
  const client = useClient();
  const { identity, assignments, incidents, connection } = useSnapshot();
  const act = useAction();
  const offline = connection !== "connected";
  const assignment = assignments.find((a) => a.unitId === identity.unitId && a.status !== "COMPLETED")
    ?? assignments.find((a) => a.unitId === identity.unitId);
  const incident = incidents.find((i) => i.id === assignment?.incidentId);

  return (
    <div className="page">
      <SimBanner />
      <header className="bar">
        <h1>Responder</h1>
        <IdentityBadge />
        <ConnectionStatus />
      </header>
      <StaleBanner />
      {!assignment || !incident ? (
        <p className="muted">No assignment for {identity.unitId} yet. Waiting for simulated dispatch.</p>
      ) : (
        <main className={offline ? "stale" : ""}>
          <h2>{incident.id}</h2>
          <p>
            Incident: <span className="pill">{incident.status}</span>{" "}
            Your assignment: <span className="pill">{assignment.status}</span>
          </p>
          {incident.needsReview && <div className="notice err">Caller facts changed after dispatch. Dispatcher has been flagged to review.</div>}
          <ExtractionState incident={incident} />
          <p>{incident.summary}</p>
          <LocationCard text={incident.facts.locationText} />
          <FactsTable facts={incident.facts} evidence={[]} corrections={incident.corrections} />
          <div className="steps" role="group" aria-label="Assignment progress">
            {STEPS.map((s) => {
              const cur = ASSIGNMENT_ORDER.indexOf(assignment.status);
              const idx = ASSIGNMENT_ORDER.indexOf(s.reaches);
              const done = idx <= cur;
              const isNext = idx === cur + 1;
              return (
                <button key={s.label} className={done ? "done" : ""}
                  disabled={!isNext || offline || act.pending}
                  onClick={() => act.run(() => client.advanceAssignment({ assignmentId: assignment.id, next: s.reaches }))}>
                  {done ? "✓ " : ""}{s.label}
                </button>
              );
            })}
          </div>
          {act.pending && <div className="muted">Waiting for the backend to confirm…</div>}
          <ActionError message={act.error} />
        </main>
      )}
      <FixtureControls incidentId={incident?.id ?? null} />
    </div>
  );
}
