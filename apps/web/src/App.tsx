import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import Dispatcher from "./routes/Dispatcher";
import Responder from "./routes/Responder";
import { AccessGate, ConnectionStatus, IdentityBadge, SimBanner } from "./components";

const LIVE = import.meta.env.VITE_DATA_MODE === "live";

// Plain <a> links (full reload): the identity is picked per page load, in fixture and live mode alike.
function TopBar() {
  const { pathname, search } = useLocation();
  const here = pathname + search;
  const links = [
    { href: "/dispatcher", label: "Dispatcher" },
    { href: "/responder", label: "Responder" },
    ...(LIVE ? [] : [{ href: "/responder?unit=EMS-01", label: "Responder (EMS-01)" }]),
  ];
  return (
    <header>
      <SimBanner />
      <div className="topbar">
        <a className="brand" href="/dispatcher"><img src="/flare-mark.svg" alt="" />Flare</a>
        <nav className="nav" aria-label="Views">
          {links.map((l) => <a key={l.href} href={l.href} aria-current={here === l.href ? "page" : undefined}>{l.label}</a>)}
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
