// Dispatcher console panels. Data shaping lives in incident.ts; these only render it.
import { useEffect, useRef, useState } from "react";
import {
  ActionError, AssignmentStatusChip, AssignmentStepper, ExtractionBadge, Icon, IncidentStatusChip, Pending, RelativeTime,
  useAction, useNow,
} from "./components";
import { useClient } from "./data";
import {
  ASSIGNMENT_TEXT, activityLabel, deriveSeverity, formatElapsed, formatFact, getActivity, getKnownFacts,
  getRelevantMissingFacts, headlineFact, incidentTitle, MAJOR_EVENTS, recommendationReasons, SERVICE_LABEL, shortAge,
  unitStatusLabel, type Severity,
} from "./incident";
import type { Assignment, ConversationMessage, IncidentView, Service, SharedLocation, Unit } from "./types";

const SERVICES: Service[] = ["POLICE", "FIRE", "EMS"];
const SERVICE_ICON = { POLICE: "police", FIRE: "fire", EMS: "ems" } as const;
export const isDone = (i: IncidentView) => i.status === "RESOLVED" || i.status === "CLOSED";
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// ---- Small pieces ----
const SEVERITY_TEXT: Record<Severity, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const SEVERITY_HINT = "Display priority calculated from the caller-reported facts. Not a triage decision.";

export function SeverityBadge({ level, long = false }: { level: Severity; long?: boolean }) {
  return (
    <span className={`sev sev-${level.toLowerCase()}`} title={SEVERITY_HINT}>
      {SEVERITY_TEXT[level]}{long ? " priority" : ""}
    </span>
  );
}

export function ServiceTag({ service }: { service: Service }) {
  return <span className={`svc-tag svc-${service.toLowerCase()}`}><Icon name={SERVICE_ICON[service]} />{SERVICE_LABEL[service]}</span>;
}

function Section({ title, icon, hint, children, className = "" }: {
  title: string; icon?: Parameters<typeof Icon>[0]["name"]; hint?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <h3 className="card-title">{icon && <Icon name={icon} />}{title}{hint && <span className="hint">{hint}</span>}</h3>
      {children}
    </section>
  );
}

// ---- Queue ----
export function IncidentListItem({ incident, selected, fresh, onSelect }: {
  incident: IncidentView; selected: boolean; fresh: boolean; onSelect: () => void;
}) {
  const now = useNow(5000);
  const sev = deriveSeverity(incident);
  const fact = headlineFact(incident);
  const rec = incident.recommendedServices.length
    ? `${incident.recommendedServices.map((s) => SERVICE_LABEL[s]).join(" + ")} recommended` : null;
  const line = [fact, isDone(incident) || incident.status === "DISPATCHED" ? null : rec].filter(Boolean).join(" • ");
  const loc = incident.sharedLocation?.label ?? incident.facts.locationText ?? (incident.sharedLocation ? "Shared location" : null);
  return (
    <li>
      <button className={`qcard sevline-${sev.toLowerCase()} ${fresh ? "fresh" : ""}`} aria-current={selected} onClick={onSelect}>
        <span className="qcard-top">
          {isDone(incident) ? <IncidentStatusChip status={incident.status} /> : <SeverityBadge level={sev} />}
          <span className="mono qcard-id">#{incident.id}</span>
          <time className="qcard-age" dateTime={incident.createdAt} title={`Opened ${new Date(incident.createdAt).toLocaleString()}`}>
            {shortAge(incident.createdAt, now)}
          </time>
        </span>
        <span className="qcard-type">{incidentTitle(incident)}</span>
        {loc
          ? <span className="qcard-loc"><Icon name="pin" /><span>{loc}</span></span>
          : <span className="qcard-loc missing"><Icon name="alert" /><span>Location missing</span></span>}
        {line && <span className="qcard-line">{line}</span>}
        {(incident.needsReview || incident.extraction.state !== "OK" || incident.status === "DISPATCHED") && (
          <span className="qcard-flags">
            {incident.status === "DISPATCHED" && <IncidentStatusChip status="DISPATCHED" />}
            {incident.needsReview && <span className="chip danger">Needs review</span>}
            <ExtractionBadge incident={incident} />
          </span>
        )}
      </button>
    </li>
  );
}

// ---- Header ----
function lastCallerMessage(i: IncidentView) {
  return [...(i.conversation ?? [])].reverse().find((m) => m.sender === "CALLER");
}

export function IncidentHeader({ incident }: { incident: IncidentView }) {
  const now = useNow(1000);
  const done = isDone(incident);
  const sev = deriveSeverity(incident);
  const place = incident.sharedLocation?.label ?? incident.facts.locationText;
  const last = lastCallerMessage(incident);
  return (
    <div className="ihead">
      <div className="ihead-row">
        <span className="ihead-id mono">#{incident.id}</span>
        <h2 className="ihead-type">{incidentTitle(incident)}</h2>
        {!done && <SeverityBadge level={sev} long />}
        <span className="ihead-elapsed" title={`Opened ${new Date(incident.createdAt).toLocaleString()}`}>
          {done ? <RelativeTime iso={incident.updatedAt} prefix={incident.status === "CLOSED" ? "Closed" : "Resolved"} /> : (
            <><Icon name="clock" /><span className="mono">{formatElapsed(now - new Date(incident.createdAt).getTime())}</span> elapsed</>
          )}
        </span>
      </div>
      <p className={`ihead-place ${place ? "" : "missing"}`}>{place ?? "Location not yet provided"}</p>
      <div className="ihead-row ihead-meta">
        <IncidentStatusChip status={incident.status} />
        <ExtractionBadge incident={incident} />
        <span className="thread" title="iMessage has no live connection state. This shows whether the case is still open to caller messages.">
          <span className={`dot ${done ? "" : "on"}`} aria-hidden="true" />
          {done ? "Thread ended" : "Thread open"}
          {last && <> · last message <RelativeTime iso={last.at} /></>}
        </span>
        <RelativeTime iso={incident.updatedAt} prefix="Updated" />
      </div>
    </div>
  );
}

// ---- Summary ----
export function IncidentSummary({ incident }: { incident: IncidentView }) {
  return (
    <Section title="Summary">
      <p className="summary-text">{incident.summary || "No summary yet."}</p>
      <p className="provenance">Caller-reported · Unverified</p>
      {incident.status === "CLOSED" && incident.closeReason && (
        <p className="provenance">Closed without dispatch: {incident.closeReason}</p>
      )}
    </Section>
  );
}

// ---- Location ----
const TILE = 256, ZOOM = 16;
function MapPreview({ loc }: { loc: SharedLocation }) {
  const [failed, setFailed] = useState(false);
  const n = 2 ** ZOOM;
  const lat = (loc.latitude * Math.PI) / 180;
  const px = ((loc.longitude + 180) / 360) * n * TILE;
  const py = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n * TILE;
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  const metersPerPx = (156543.03392 * Math.cos(lat)) / n;
  const radius = loc.accuracyMeters ? Math.max(8, loc.accuracyMeters / metersPerPx) : 0;
  if (failed) return <p className="map-fallback"><Icon name="info" />Map preview unavailable. The coordinates below are still accurate.</p>;
  const tiles = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -2; dx <= 2; dx++)
      tiles.push(
        <img key={`${dx},${dy}`} alt="" draggable={false} onError={() => setFailed(true)}
          src={`https://tile.openstreetmap.org/${ZOOM}/${tx + dx}/${ty + dy}.png`}
          style={{ left: `calc(50% + ${(tx + dx) * TILE - px}px)`, top: `calc(50% + ${(ty + dy) * TILE - py}px)` }} />,
      );
  return (
    <div className="map" role="img" aria-label={`Map of the caller's shared location${loc.label ? `, ${loc.label}` : ""}`}>
      {tiles}
      {radius > 0 && <span className="map-acc" style={{ width: radius * 2, height: radius * 2 }} />}
      <span className="map-pin"><Icon name="pin" /></span>
      <a className="map-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
    </div>
  );
}

export function IncidentLocation({ incident }: { incident: IncidentView }) {
  const shared = incident.sharedLocation;
  const typed = incident.facts.locationText;
  const quote = incident.evidence.find((e) => e.field === "locationText")?.quote;
  const corrected = incident.corrections.includes("locationText");
  if (shared)
    return (
      <Section title="Location" icon="pin" hint={shared.source === "FIND_MY" ? "Shared via Find My" : "Shared via iMessage"}>
        <MapPreview loc={shared} />
        <p className="loc-main">{shared.label ?? typed ?? "Shared location"}</p>
        <p className="loc-sub">
          {shared.accuracyMeters != null && <span title="Accuracy reported by the caller's device">±{Math.round(shared.accuracyMeters)} m</span>}
          <span>Shared <RelativeTime iso={shared.sharedAt} /></span>
          {typed && shared.label && <span>Caller typed: {typed}</span>}
        </p>
        <details className="more">
          <summary>Coordinates</summary>
          <p className="mono small">{shared.latitude.toFixed(5)}, {shared.longitude.toFixed(5)}</p>
        </details>
      </Section>
    );
  return (
    <Section title="Location" icon="pin" hint={typed ? "Typed by caller · no map pin" : undefined}>
      {typed ? (
        <>
          <p className="loc-main">{typed}{corrected && <span className="chip warn">Corrected</span>}</p>
          {quote && <blockquote className="quote">“{quote}”</blockquote>}
        </>
      ) : (
        <p className="loc-missing"><Icon name="alert" />Location not yet provided</p>
      )}
    </Section>
  );
}

// ---- Facts ----
export function IncidentFacts({ incident }: { incident: IncidentView }) {
  const knownFacts = getKnownFacts(incident);
  const missing = getRelevantMissingFacts(incident).filter((m) => m.key !== "locationText");
  const quotesFor = (k: string) => incident.evidence.filter((e) => e.field === k);
  return (
    <Section title="Caller facts" hint="caller-reported, unverified">
      <div className="facts2">
        <div>
          <h4 className="sublabel">Known</h4>
          {knownFacts.length === 0 ? <p className="muted small">Nothing reported yet.</p> : (
            <dl className="known">
              {knownFacts.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>
                    {formatFact(f.value)}
                    {incident.corrections.includes(f.key as never) && <span className="chip warn">Corrected</span>}
                    {quotesFor(f.key).slice(0, 1).map((q, n) => <q key={n} className="fact-quote">{q.quote}</q>)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div>
          <h4 className="sublabel">Still needed</h4>
          {missing.length === 0 ? <p className="muted small">Nothing outstanding for this kind of incident.</p> : (
            <ul className="needed">
              {missing.map((m) => <li key={m.key}><Icon name="help" />{m.label}</li>)}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

// ---- Caller conversation ----
function Bubble({ m }: { m: ConversationMessage }) {
  return (
    <li className={`msg ${m.sender === "CALLER" ? "caller" : "agent"}`}>
      <span className="msg-who">{m.sender === "CALLER" ? "Caller" : "Agent"}<time dateTime={m.at}>{clock(m.at)}</time>
        {m.delivery === "FAILED" && <span className="chip danger">Not delivered</span>}</span>
      <span className="msg-text">{m.text}</span>
    </li>
  );
}

export function CallerConversation({ incident }: { incident: IncidentView }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const messages = incident.conversation;
  const quotes = [...new Set(incident.evidence.map((e) => e.quote))];
  const done = isDone(incident);
  const last = lastCallerMessage(incident);
  return (
    <Section title="Caller conversation" icon="message" className="convo">
      {messages?.length ? (
        <ol className="msgs">{messages.slice(-4).map((m, n) => <Bubble key={n} m={m} />)}</ol>
      ) : quotes.length ? (
        <>
          <p className="muted small">The full transcript isn't available yet. These are the caller's own words from the report.</p>
          <ul className="msgs">{quotes.slice(0, 4).map((q) => <li key={q} className="msg caller"><span className="msg-who">Caller</span><span className="msg-text">“{q}”</span></li>)}</ul>
        </>
      ) : <p className="muted small">Waiting for caller messages.</p>}
      <div className="convo-foot">
        <span className="thread">
          <span className={`dot ${done ? "" : "on"}`} aria-hidden="true" />{done ? "Thread ended" : "Thread open"}
          {last && <> · last message <RelativeTime iso={last.at} /></>}
        </span>
        {messages && messages.length > 4 && <button className="btn-link" onClick={() => dialog.current?.showModal()}>View full conversation</button>}
        <button className="btn small-btn" disabled title="Coming soon: dispatcher takeover isn't built yet">Take over</button>
      </div>
      {messages && messages.length > 4 && (
        <dialog ref={dialog} className="convo-dialog" aria-label="Full caller conversation">
          <div className="convo-dialog-head">
            <h3>Conversation · #{incident.id}</h3>
            <button className="btn" onClick={() => dialog.current?.close()}>Close</button>
          </div>
          <ol className="msgs">{messages.map((m, n) => <Bubble key={n} m={m} />)}</ol>
        </dialog>
      )}
    </Section>
  );
}

// ---- Recommended response + dispatch ----
const CLOSE_REASONS = ["Test or accidental text", "Duplicate of another incident", "No response needed"];

export function RecommendedResponse({ incident, units, assignments, offline }: {
  incident: IncidentView; units: Unit[]; assignments: Assignment[]; offline: boolean;
}) {
  const client = useClient();
  const [services, setServices] = useState<Service[]>(incident.recommendedServices);
  const [touched, setTouched] = useState(false);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState(CLOSE_REASONS[0]);
  const [other, setOther] = useState("");
  const dispatch = useAction();
  const close = useAction();
  const reasons = recommendationReasons(incident);

  // Follow the live recommendation until the dispatcher changes the selection themselves.
  const recKey = incident.recommendedServices.join();
  useEffect(() => { if (!touched) setServices(incident.recommendedServices); }, [recKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Drop selections that a refreshed subscription shows are no longer available.
  useEffect(() => {
    setUnitIds((ids) => ids.filter((id) => units.find((u) => u.id === id)?.status === "AVAILABLE"));
  }, [units]);

  const open = incident.status === "COLLECTING" || incident.status === "READY_FOR_REVIEW";
  const hasAssignments = assignments.some((a) => a.incidentId === incident.id);
  const toggleService = (s: Service) => {
    setTouched(true);
    if (services.includes(s)) {
      setServices(services.filter((x) => x !== s));
      setUnitIds((ids) => ids.filter((id) => units.find((u) => u.id === id)?.service !== s));
    } else setServices([...services, s]);
  };
  const toggleUnit = (id: string) => setUnitIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const missing = services.filter((s) => !units.some((u) => unitIds.includes(u.id) && u.service === s));
  let blocker: string | null = null;
  if (incident.status === "COLLECTING") blocker = "Waiting on the caller's location before you can dispatch.";
  else if (services.length === 0) blocker = "Pick at least one service.";
  else if (missing.length) blocker = `Pick a unit for ${missing.map((s) => SERVICE_LABEL[s]).join(" and ")}.`;
  const closeReason = reason === "Other" ? other.trim() : reason;

  const why = reasons.length > 0 && (
    <details className="why">
      <summary>Why this response?</summary>
      <ul>
        {reasons.map((r) => (
          <li key={r.service}><strong>{SERVICE_LABEL[r.service]}</strong>: {r.reasons.join("; ")}</li>
        ))}
      </ul>
      <p className="muted small">Fixed response rules applied to the caller's reported facts. You make the decision.</p>
    </details>
  );

  if (!open)
    return (
      <Section title="Response" className="response">
        {incident.confirmedServices.length ? (
          <>
            <p className="small muted">Confirmed by dispatcher</p>
            <div className="svc-row">{incident.confirmedServices.map((s) => <ServiceTag key={s} service={s} />)}</div>
          </>
        ) : <p className="muted small">{incident.status === "CLOSED" ? "Closed without dispatch." : "No services confirmed."}</p>}
        {incident.recommendedServices.length > 0 && (
          <p className="small muted rec-note">Recommended: {incident.recommendedServices.map((s) => SERVICE_LABEL[s]).join(", ")}</p>
        )}
        {why}
      </Section>
    );

  return (
    <Section title="Recommended response" className="response" hint="advisory · you confirm">
      {incident.recommendedServices.length === 0 && (
        <p className="muted small rec-none">No rule matched these facts. Review them and choose services.</p>
      )}
      <fieldset className="svc-pick" disabled={offline || dispatch.pending}>
        <legend className="sr-only">Services to confirm</legend>
        {SERVICES.map((s) => {
          const rec = incident.recommendedServices.includes(s);
          return (
            <label key={s} className={`svc-opt ${rec ? "rec" : ""}`}>
              <input type="checkbox" checked={services.includes(s)} onChange={() => toggleService(s)} />
              <ServiceTag service={s} />
              {rec && <span className="rec-tag">Recommended</span>}
            </label>
          );
        })}
      </fieldset>
      {why}

      <fieldset className="units-pick" disabled={offline || dispatch.pending}>
        <legend className="sublabel">Response units</legend>
        {services.length === 0 && <p className="muted small">Select a service to see its units.</p>}
        {SERVICES.filter((s) => services.includes(s)).map((s) => {
          const list = units.filter((u) => u.service === s);
          const anyFree = list.some((u) => u.status === "AVAILABLE");
          return (
            <div key={s} className="unit-group">
              <h5>{SERVICE_LABEL[s]}</h5>
              {!anyFree && <p className="no-units"><Icon name="alert" />No available units for this service</p>}
              {list.map((u) => {
                const status = unitStatusLabel(u, assignments);
                return (
                  <label key={u.id} className="unit-opt">
                    <input type="checkbox" checked={unitIds.includes(u.id)} disabled={u.status !== "AVAILABLE"} onChange={() => toggleUnit(u.id)} />
                    <span className="mono">{u.id}</span>
                    <span className={`chip ${u.status === "AVAILABLE" ? "ok" : ""}`}>{status}</span>
                  </label>
                );
              })}
            </div>
          );
        })}
      </fieldset>

      <div className="dispatch-actions">
        <button className="btn primary"
          disabled={!!blocker || offline || dispatch.pending}
          onClick={() => dispatch.run(() => client.confirmDispatchAndAssign({ incidentId: incident.id, confirmedServices: services, unitIds }))}>
          {dispatch.pending ? <Pending label="Confirming…" /> : "Confirm Dispatch"}
        </button>
        {blocker && <p className="blocker"><Icon name="info" />{blocker}</p>}
        <ActionError message={dispatch.error} />
      </div>

      {!hasAssignments && (
        <div className="close-box">
          {!closing ? (
            <button className="btn-link" onClick={() => setClosing(true)} disabled={offline}>Close without dispatch…</button>
          ) : (
            <fieldset disabled={offline || close.pending}>
              <legend className="sublabel">Close without dispatch</legend>
              <label className="field">
                <span>Reason</span>
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {[...CLOSE_REASONS, "Other"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
              {reason === "Other" && (
                <label className="field">
                  <span>Describe</span>
                  <input value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} />
                </label>
              )}
              <p className="muted small">The caller gets a message saying the report was closed and they can text again.</p>
              <div className="close-actions">
                <button className="btn" disabled={!closeReason}
                  onClick={async () => { if (await close.run(() => client.closeIncident({ incidentId: incident.id, reason: closeReason }))) setClosing(false); }}>
                  {close.pending ? <Pending label="Closing…" /> : "Close incident"}
                </button>
                <button className="btn-link" onClick={() => setClosing(false)}>Cancel</button>
              </div>
              <ActionError message={close.error} />
            </fieldset>
          )}
        </div>
      )}
    </Section>
  );
}

// ---- Assignments ----
export function Assignments({ incident, assignments, offline }: { incident: IncidentView; assignments: Assignment[]; offline: boolean }) {
  const client = useClient();
  const resolve = useAction();
  const mine = assignments.filter((a) => a.incidentId === incident.id);
  const canResolve = incident.status === "DISPATCHED" && mine.length > 0 && mine.every((a) => a.status === "COMPLETED");
  return (
    <Section title="Assignments">
      {mine.length === 0 ? <p className="muted small">No units assigned yet.</p> : mine.map((a) => (
        // Keyed by status so a change remounts the row and plays the highlight once.
        <div key={`${a.id}:${a.status}`} className="assignment flash">
          <div className="assignment-head">
            <ServiceTag service={a.service} />
            <span className="mono">{a.unitId}</span>
            <AssignmentStatusChip status={a.status} />
          </div>
          <p className="assignment-sub">
            {a.status === "OFFERED" ? <><span className="dot warn" aria-hidden="true" />Awaiting acknowledgment</> : <>{ASSIGNMENT_TEXT[a.status]}</>}
            <RelativeTime iso={a.updatedAt} prefix="· updated" />
          </p>
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
    </Section>
  );
}

// ---- Activity ----
export function ActivityFeed({ incident, assignments }: { incident: IncidentView; assignments: Assignment[] }) {
  const { events, derived } = getActivity(incident, assignments);
  const now = useNow(5000);
  return (
    <Section title="Live activity" icon="activity" hint="newest first">
      <ol className="feed">
        {events.map((e) => (
          <li key={e.id} className={`${MAJOR_EVENTS.has(e.kind) ? "major" : ""} ${now - new Date(e.at).getTime() < 8000 ? "fresh" : ""}`}>
            <time dateTime={e.at} className="mono">{clock(e.at)}</time>
            <span>{activityLabel(e)}{e.detail && <span className="muted"> · {e.detail}</span>}</span>
          </li>
        ))}
      </ol>
      {derived && <p className="muted small feed-note">Built from recorded timestamps. Steps without their own timestamp aren't listed.</p>}
    </Section>
  );
}
