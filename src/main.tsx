import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { App } from "./App";
import { AppToaster } from "./components/AppToaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { HostThemeBridge } from "./HostThemeBridge";
import { initTvMode } from "./lib/tv";
import { initTheme } from "./theme/theme";

initTvMode();
// The document CSP bars inline scripts, so the anti-flash snippet can't sit in
// <head>; reapplying the stored theme here is one frame late and accepted.
initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <HostThemeBridge />
      <App />
      <AppToaster />
    </TooltipProvider>
  </StrictMode>,
);
