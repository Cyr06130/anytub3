import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { ThemeProvider, Toaster, TooltipProvider } from "@novasamatech/tr-ui";
import { defaultTheme } from "@novasamatech/tr-ui/themes";
import { App } from "./App";
import { HostThemeBridge } from "./HostThemeBridge";
import { initTvMode } from "./lib/tv";

initTvMode();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={defaultTheme} defaultMode="light">
      <TooltipProvider>
        <HostThemeBridge />
        <App />
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
