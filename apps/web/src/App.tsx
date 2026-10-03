import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import Dispatcher from "./routes/Dispatcher";
import Responder from "./routes/Responder";

export default function App() {
  return (
    <BrowserRouter>
      <nav className="nav">
        <Link to="/dispatcher">Dispatcher</Link> <Link to="/responder">Responder</Link>
      </nav>
      <Routes>
        <Route path="/dispatcher" element={<Dispatcher />} />
        <Route path="/responder" element={<Responder />} />
        <Route path="*" element={<Navigate to="/dispatcher" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
