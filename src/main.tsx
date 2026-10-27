import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AuthGate from "./AuthGate";
import AccessGate from "./AccessGate";
import PersonalizationProvider from "./PersonalizationProvider";
import { SuiteProvider } from "./suite-client";
import PublicPortal from "./PublicPortal";
import "./styles.css";
import "./theme.css";
import "./suite-shell.css";

const publicRoute = /^\/(agendar|atendimento)\/([0-9a-f-]{36})\/?$/i.exec(
  window.location.pathname,
);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publicRoute ? (
      <PublicPortal
        kind={publicRoute[1] === "agendar" ? "booking" : "chat"}
        id={publicRoute[2]}
      />
    ) : (
      <AuthGate>
        <AccessGate>
          <PersonalizationProvider>
            <SuiteProvider>
              <App />
            </SuiteProvider>
          </PersonalizationProvider>
        </AccessGate>
      </AuthGate>
    )}
  </React.StrictMode>,
);
