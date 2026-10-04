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

// Per-viewer preference only; storage can be unavailable (private window, blocked site data).
const SHOW_DONE_KEY = "flare-dispatcher-show-done";
function useShowDone() {
  const [show, setShow] = useState(() => { try { return localStorage.getItem(SHOW_DONE_KEY) === "1"; } catch { return false; } });
  const toggle = () => setShow((v) => {
    try { localStorage.setItem(SHOW_DONE_KEY, v ? "0" : "1"); } catch { /* keep in memory only */ }
    return !v;
  });
  return [show, toggle] as const;
}

export default function Dispatcher() {
  const { incidents, units, assignments, connection } = useSnapshot();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDone, toggleDone] = useShowDone();
  const fresh = useFreshIds(incidents.map((i) => i.id));

  const active = incidents.filter((i) => !isDone(i)).sort(byPriority);
  const resolved = incidents.filter(isDone).sort(byNewest);
  // Hidden resolved/closed incidents can't stay selected; the detail falls back to the top active one.
  const incident = incidents.find((i) => i.id === selectedId && (showDone || !isDone(i))) ?? active[0] ?? (showDone ? resolved[0] : undefined);
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
            <div className="resolved-group">
              <button className="resolved-toggle" aria-expanded={showDone} aria-controls="resolved-list" onClick={toggleDone}>
                <Icon name="chevron" />{showDone ? "Hide" : "Show"} resolved and closed ({resolved.length})
              </button>
              {showDone && <ul id="resolved-list" className="queue-list">{resolved.map(row)}</ul>}
            </div>
          )}
        </aside>

        <main className="detail">
          {!incident ? <div className="empty">{incidents.length ? "No active incidents. Resolved and closed incidents are hidden." : "No active incidents. Waiting for a caller to text Flare."}</div> : (
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
