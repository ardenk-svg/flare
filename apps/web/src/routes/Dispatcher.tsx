import { useEffect, useRef, useState } from "react";
import { useSnapshot } from "../data";
import { ExtractionNotice, FixtureControls, Icon, StaleBanner } from "../components";
import {
  ActivityFeed, Assignments, CallerConversation, IncidentFacts, IncidentHeader, IncidentListItem, IncidentLocation,
  IncidentSummary, isDone, RecommendedResponse,
} from "../console";
import { byPriority } from "../incident";
import type { IncidentView } from "../types";

const byNewest = (a: IncidentView, b: IncidentView) => b.createdAt.localeCompare(a.createdAt);

/** Ids that arrived after the first render, so new incidents get one brief highlight. */
function useFreshIds(ids: string[]) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = ids.join();
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(ids); return; }
    const added = ids.filter((id) => !seen.current!.has(id));
    if (!added.length) return;
    added.forEach((id) => seen.current!.add(id));
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 2500);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return fresh;
}

export default function Dispatcher() {
  const { incidents, units, assignments, connection } = useSnapshot();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fresh = useFreshIds(incidents.map((i) => i.id));

  const active = incidents.filter((i) => !isDone(i)).sort(byPriority);
  const resolved = incidents.filter(isDone).sort(byNewest);
  const incident = incidents.find((i) => i.id === selectedId) ?? active[0] ?? resolved[0];
  const offline = connection !== "connected";
  const row = (i: IncidentView) => (
    <IncidentListItem key={i.id} incident={i} selected={i.id === incident?.id} fresh={fresh.has(i.id)} onSelect={() => setSelectedId(i.id)} />
  );

  return (
    <div className="page">
      <StaleBanner />
      <div className={`console ${offline ? "stale" : ""}`}>
        <aside className="queue" aria-label="Incident queue">
          <h2>Active incidents <span className="muted">({active.length})</span></h2>
          {active.length === 0
            ? <p className="empty small">No active incidents. New caller reports show up here.</p>
            : <ul className="queue-list">{active.map(row)}</ul>}
          {resolved.length > 0 && (
            <details className="resolved-group" open={(incident && isDone(incident)) || undefined}>
              <summary>Resolved and closed ({resolved.length})</summary>
              <ul className="queue-list">{resolved.map(row)}</ul>
            </details>
          )}
        </aside>

        <main className="detail">
          {!incident ? <div className="empty">{incidents.length ? "Select an incident to review." : "No active incidents. Waiting for a caller to text Flare."}</div> : (
            <>
              <IncidentHeader incident={incident} />
              {incident.needsReview && (
                <div className="notice err" role="status">
                  <Icon name="alert" />
                  <span>The caller changed facts after dispatch. Review them below. Flare left the assigned units unchanged.</span>
                </div>
              )}
              <ExtractionNotice incident={incident} />

              <div className="detail-grid">
                <div className="col">
                  <IncidentSummary incident={incident} />
                  <IncidentLocation incident={incident} />
                  <IncidentFacts incident={incident} />
                  <CallerConversation key={incident.id} incident={incident} />
                </div>
                <div className="col">
                  <RecommendedResponse key={incident.id} incident={incident} units={units} assignments={assignments} offline={offline} />
                  <Assignments incident={incident} assignments={assignments} offline={offline} />
                  <ActivityFeed incident={incident} assignments={assignments} />
                </div>
              </div>
            </>
          )}
          <FixtureControls incidentId={incident?.id ?? null} />
        </main>
      </div>
    </div>
  );
}
