import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Dispatcher from "./routes/Dispatcher";
import Responder from "./routes/Responder";
import { AccessGate } from "./components";

// Plain <a> links (full reload): in fixture mode the identity is picked per page load.
export default function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <a href="/dispatcher">Dispatcher</a> <a href="/responder">Responder</a>
        <a href="/responder?unit=EMS-01">Responder (EMS-01)</a>
      </nav>
      <Routes>
        <Route path="/dispatcher" element={<AccessGate role="dispatcher"><Dispatcher /></AccessGate>} />
        <Route path="/responder" element={<AccessGate role="responder"><Responder /></AccessGate>} />
        <Route path="*" element={<Navigate to="/dispatcher" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
