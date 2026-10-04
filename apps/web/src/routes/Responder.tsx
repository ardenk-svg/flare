import { useClient, useSnapshot } from "../data";
import {
  ActionError, AssignmentStatusChip, AssignmentStepper, ExtractionBadge, ExtractionNotice, FixtureControls, Icon,
  LocationLine, Pending, RelativeTime, StaleBanner, useAction,
} from "../components";
import { ASSIGNMENT_ORDER, type AssignmentStatus, type CallerFacts } from "../types";

const NEXT_ACTION: Partial<Record<AssignmentStatus, string>> = {
  ACCEPTED: "Accept assignment",
  EN_ROUTE: "Mark en route",
  ON_SCENE: "Mark on scene",
  COMPLETED: "Mark complete",
};

// Safety-relevant caller facts, phrased for the crew. Unknowns are hidden.
const SAFETY: { key: keyof CallerFacts; yes: string; no: string; danger: boolean }[] = [
  { key: "fireOrSmoke", yes: "Fire or smoke reported", no: "No fire or smoke", danger: true },
  { key: "trappedPerson", yes: "Person trapped", no: "No one trapped", danger: true },
  { key: "violentThreat", yes: "Violent threat reported", no: "No violent threat", danger: true },
  { key: "injuryReported", yes: "Injury reported", no: "No injury reported", danger: true },
  { key: "callerReportedBreathing", yes: "Breathing", no: "Not breathing", danger: false },
  { key: "callerReportedConscious", yes: "Conscious", no: "Not conscious", danger: false },
];

export default function Responder() {
  const client = useClient();
  const { identity, assignments, incidents, connection } = useSnapshot();
  const act = useAction();
  const offline = connection !== "connected";
  const assignment = assignments.find((a) => a.unitId === identity.unitId && a.status !== "COMPLETED")
    ?? assignments.find((a) => a.unitId === identity.unitId);
  const incident = incidents.find((i) => i.id === assignment?.incidentId);

  if (!assignment || !incident)
    return (
      <div className="page page-narrow">
        <StaleBanner />
        <div className="empty">
          <p><strong className="mono">{identity.unitId}</strong> has no assignment.</p>
          <p className="small">When a dispatcher assigns this mock unit, the incident shows up here.</p>
        </div>
        <FixtureControls incidentId={null} />
      </div>
    );

  const next = ASSIGNMENT_ORDER[ASSIGNMENT_ORDER.indexOf(assignment.status) + 1] as AssignmentStatus | undefined;
  const done = assignment.status === "COMPLETED";
  const f = incident.facts;
  const pin = incident.sharedLocation;
  // Conditions where "no" is the dangerous answer (breathing, conscious) flip the danger tone.
  const safety = SAFETY.filter((s) => f[s.key] !== null).map((s) => {
    const yes = f[s.key] === true;
    return { key: s.key, label: yes ? s.yes : s.no, alarming: s.danger ? yes : !yes };
  });

  return (
    <div className="page page-narrow">
      <StaleBanner />
      <div className={`stack ${offline ? "stale" : ""}`}>
        <section className={`card mission ${done ? "done" : ""}`} aria-label="Your assignment">
          <div className="mission-head">
            <span className="mono">{assignment.unitId}</span>
            <AssignmentStatusChip status={assignment.status} />
          </div>
          {next ? (
            <button className="btn primary big" disabled={offline || act.pending}
              onClick={() => act.run(() => client.advanceAssignment({ assignmentId: assignment.id, next }))}>
              {act.pending ? <Pending label="Waiting for the backend…" /> : NEXT_ACTION[next]}
            </button>
          ) : (
            <p className="notice"><Icon name="check" /><span>Assignment complete. The dispatcher will resolve the incident.</span></p>
          )}
          <ActionError message={act.error} />
          <AssignmentStepper status={assignment.status} />
          <RelativeTime iso={assignment.updatedAt} prefix="Updated" />
        </section>

        {incident.needsReview && (
          <div className="notice err" role="status">
            <Icon name="alert" /><span>The caller changed facts after dispatch. The dispatcher is reviewing them.</span>
          </div>
        )}
        <ExtractionNotice incident={incident} />

        <section className="card">
          <h2 className="card-title">Location <span className="hint">{pin ? "shared by caller" : "typed by caller"}, unverified</span></h2>
          {f.locationText || pin?.label ? <p className="big-location">{pin?.label ?? f.locationText}</p> : !pin && <LocationLine text={null} />}
          {pin && (
            <p className="muted small mono">
              {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}{pin.accuracyMeters != null && ` · ±${Math.round(pin.accuracyMeters)} m`}
              {pin.label && f.locationText && <span> · caller typed: {f.locationText}</span>}
            </p>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">
            Incident <span className="hint">caller-reported, unverified</span>
            <ExtractionBadge incident={incident} />
          </h2>
          <dl className="kv">
            <dt>Type</dt><dd>{f.incidentType ?? <span className="muted">Not reported</span>}</dd>
            {f.peopleInvolved !== null && <><dt>People</dt><dd>{f.peopleInvolved}</dd></>}
          </dl>
          {safety.length > 0 && (
            <div className="safety" style={{ marginTop: 12 }}>
              {safety.map((s) => <span key={s.key} className={`chip ${s.alarming ? "danger" : "ok"}`}>{s.label}</span>)}
            </div>
          )}
          {incident.summary && <p className="reason">{incident.summary}</p>}
        </section>
        <p className="muted small mono">Incident #{incident.id}</p>
      </div>
      <FixtureControls incidentId={incident.id} />
    </div>
  );
}
