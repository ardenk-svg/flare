import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Dispatcher from "./routes/Dispatcher";
import Responder from "./routes/Responder";
import { AccessGate, ConnectionStatus, Icon, IdentityBadge, SimBanner } from "./components";
import { useSnapshot } from "./data";

// Seeded by the SpacetimeDB module's init; used until the backend's unit list arrives (or if this identity can't read it).
const SEEDED_UNITS = ["FIRE-01", "FIRE-02", "EMS-01", "EMS-02", "POLICE-01", "POLICE-02"];

// Picks which responder unit to view. Navigates with a full reload because the identity is chosen per page load;
// in live mode each unit gets its own browser identity, which the operator grants once.
function UnitPicker() {
  const { units, identity } = useSnapshot();
  const ids = units.length ? units.map((u) => u.id) : SEEDED_UNITS;
  const current = new URLSearchParams(location.search).get("unit") ?? identity.unitId ?? "";
  return (
    <label className="unit-picker">
      <span className="unit-picker-label">Unit</span>
      <select value={current} onChange={(e) => { location.href = `/responder?unit=${encodeURIComponent(e.target.value)}`; }}>
        {ids.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      <Icon name="chevron" />
    </label>
  );
}

// Plain <a> links (full reload): the identity is picked per page load, in fixture and live mode alike.
function TopBar() {
  const { pathname } = useLocation();
  const links = [
    { href: "/dispatcher", label: "Dispatcher" },
    { href: "/responder", label: "Responder" },
  ];
  return (
    <header>
      <SimBanner />
      <div className="topbar">
        <a className="brand" href="/dispatcher"><img src="/flare-mark.svg" alt="" />Flare</a>
        <nav className="nav" aria-label="Views">
          {links.map((l) => <a key={l.href} href={l.href} aria-current={pathname === l.href ? "page" : undefined}>{l.label}</a>)}
          {pathname.startsWith("/responder") && <UnitPicker />}
        </nav>
        <div className="topbar-right">
          <IdentityBadge />
          <ConnectionStatus />
        </div>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <TopBar />
      <Routes>
        <Route path="/dispatcher" element={<AccessGate role="dispatcher"><Dispatcher /></AccessGate>} />
        <Route path="/responder" element={<AccessGate role="responder"><Responder /></AccessGate>} />
        <Route path="*" element={<Navigate to="/dispatcher" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
