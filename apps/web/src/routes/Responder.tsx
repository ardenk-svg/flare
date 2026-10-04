import { useState } from "react";
import { useClient, useSnapshot } from "../data";
import {
  ActionError, AssignmentStatusChip, AssignmentStepper, ExtractionBadge, ExtractionNotice, FixtureControls, Icon,
  Pending, RelativeTime, StaleBanner, useAction,
} from "../components";
import { ASSIGNMENT_ORDER, type AssignmentStatus, type CallerFacts, type IncidentView } from "../types";
import { ActivityFeed, CallerConversation, CallerDistressNotice, IncidentLocation, ServiceTag, SeverityBadge } from "../console";
import { deriveSeverity, formatFact, getKnownFacts, getRelevantMissingFacts, incidentTitle } from "../incident";

const NEXT_ACTION: Partial<Record<AssignmentStatus, string>> = {
  ACCEPTED: "Accept assignment",
  EN_ROUTE: "Mark en route",
  ON_SCENE: "Mark on scene",
  COMPLETED: "Complete response",
};

type Essential = { key: keyof CallerFacts; label: string; tone: "danger" | "warn" };

/** The few facts a crew needs before arriving. Only reported, alarming values qualify; everything else is secondary. */
function essentials(f: CallerFacts): Essential[] {
  const out: Essential[] = [];
  const add = (key: keyof CallerFacts, label: string, tone: Essential["tone"] = "danger") => out.push({ key, label, tone });
  if (f.violentThreat) add("violentThreat", "Violent threat");
  if (f.weaponPresent) add("weaponPresent", "Weapon reported");
  if (f.suspectCount !== null) add("suspectCount", `${f.suspectCount} ${f.suspectCount === 1 ? "suspect" : "suspects"}`);
  if (f.fireOrSmoke) add("fireOrSmoke", "Fire or smoke");
  if (f.trappedPerson) add("trappedPerson", "Person trapped");
  if (f.callerReportedBreathing === false) add("callerReportedBreathing", "Not breathing");
  if (f.callerReportedConscious === false) add("callerReportedConscious", "Not conscious");
  if (f.injuryReported) add("injuryReported", "Injury reported");
  if (f.callerStatus) add("callerStatus", `Caller ${f.callerStatus}`, "warn");
  return out;
}

function Essentials({ incident }: { incident: IncidentView }) {
  const chips = essentials(incident.facts);
  return (
    <section className="card essentials" aria-label="Incident essentials">
      <div className="essentials-head">
        <h2 className="essentials-type">{incidentTitle(incident)}</h2>
        <SeverityBadge level={deriveSeverity(incident)} long />
        <ExtractionBadge incident={incident} />
      </div>
      {chips.length > 0 && (
        <div className="safety">{chips.map((c) => <span key={c.key} className={`chip ${c.tone}`}>{c.label}</span>)}</div>
      )}
      {incident.summary && <p className="essentials-summary">{incident.summary}</p>}
      <p className="provenance">Caller-reported · unverified</p>
    </section>
  );
}

/** Everything known that isn't an essential, plus what the caller hasn't said yet. Collapsed by default. */
function AdditionalDetails({ incident }: { incident: IncidentView }) {
  const shown = new Set<string>(["incidentType", ...essentials(incident.facts).map((e) => e.key)]);
  const rest = getKnownFacts(incident).filter((k) => !shown.has(k.key));
  const missing = getRelevantMissingFacts(incident).filter((m) => m.key !== "locationText");
  if (!rest.length && !missing.length) return null;
  return (
    <details className="card details-card">
      <summary>Additional incident details <span className="muted small">({rest.length} known{missing.length ? `, ${missing.length} unknown` : ""})</span></summary>
      {rest.length > 0 && (
        <dl className="kv">
          {rest.map((k) => <div key={k.key} className="kv-row"><dt>{k.label}</dt><dd>{formatFact(k.value)}</dd></div>)}
        </dl>
      )}
      {missing.length > 0 && <p className="muted small">Not yet known: {missing.map((m) => m.label).join(", ")}</p>}
    </details>
  );
}

export default function Responder() {
  const client = useClient();
  const { identity, assignments, incidents, connection } = useSnapshot();
  const act = useAction();
  const [selectedId, setSelectedId] = useState("");
  const offline = connection !== "connected";
  const mine = assignments.filter(a => a.unitId === identity.unitId);
  const open = mine.filter(a => a.status !== 'COMPLETED');
  const choices = open.length ? open : mine.slice(-1);
  const assignment = choices.find(a => a.id === selectedId) ?? choices[0];
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

  return (
    <div className="page">
      <StaleBanner />
      <div className={`stack ${offline ? "stale" : ""}`}>
        {choices.length > 1 && <label className="sublabel">Your assigned incidents<select value={assignment.id} onChange={e => setSelectedId(e.target.value)}>{choices.map(a => <option key={a.id} value={a.id}>Incident #{a.incidentId} · {a.status.toLowerCase().replaceAll('_', ' ')}</option>)}</select></label>}
        <section className={`card mission ${done ? "done" : ""}`} aria-label="Your assignment">
          <div className="mission-status">
            <div className="mission-head">
              <span className="mono">{assignment.unitId}</span>
              <ServiceTag service={assignment.service} />
              <AssignmentStatusChip status={assignment.status} />
              <span className="mission-meta"><span className="mono">#{incident.id}</span> · <RelativeTime iso={assignment.updatedAt} prefix="Updated" /></span>
            </div>
            <AssignmentStepper status={assignment.status} large />
          </div>
          <div className="mission-action">
            {next ? (
              <button className="btn primary big" disabled={offline || act.pending}
                onClick={() => act.run(() => client.advanceAssignment({ assignmentId: assignment.id, next }))}>
                {act.pending ? <Pending label="Waiting for the backend…" /> : NEXT_ACTION[next]}
              </button>
            ) : (
              <p className="notice"><Icon name="check" /><span>{incident.status === "RESOLVED" ? "Incident resolved. Ready for your next assignment." : "Response complete. The dispatcher will resolve the incident."}</span></p>
            )}
            <ActionError message={act.error} />
          </div>
        </section>

        <CallerDistressNotice incident={incident} />
        {incident.needsReview && (
          <div className="notice err" role="status">
            <Icon name="alert" /><span>The caller changed facts after dispatch. The dispatcher is reviewing them.</span>
          </div>
        )}
        <ExtractionNotice incident={incident} />

        <div className="responder-grid">
          <div className="col">
            <Essentials incident={incident} />
            <IncidentLocation incident={incident} />
            <AdditionalDetails incident={incident} />
          </div>
          <div className="col">
            <CallerConversation key={incident.id} incident={incident} />
            <ActivityFeed incident={incident} assignments={assignments} />
          </div>
        </div>
      </div>
      <FixtureControls incidentId={incident.id} />
    </div>
  );
}
