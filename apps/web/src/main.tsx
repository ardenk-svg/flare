import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ClientContext, createClient } from "./data";
import "./styles.css";

const client = createClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClientContext.Provider value={client}><App /></ClientContext.Provider>
  </StrictMode>,
);
