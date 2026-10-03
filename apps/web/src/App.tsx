import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Dispatcher from "./routes/Dispatcher";
import Responder from "./routes/Responder";

// Plain <a> links (full reload): in fixture mode the identity is picked per page load.
export default function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <a href="/dispatcher">Dispatcher</a> <a href="/responder">Responder</a>
        <a href="/responder?unit=EMS-01">Responder (EMS-01)</a>
      </nav>
      <Routes>
        <Route path="/dispatcher" element={<Dispatcher />} />
        <Route path="/responder" element={<Responder />} />
        <Route path="*" element={<Navigate to="/dispatcher" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
