import { useEffect, useState } from "react";
import { DARK_THEMES, resolveTheme } from "@/theme/theme";

export type ThemeMode = "light" | "dark";

export function currentThemeMode(): ThemeMode {
  return DARK_THEMES.includes(resolveTheme()) ? "dark" : "light";
}

/** The resolved light/dark mode, kept live by watching `data-theme` — the one
 *  attribute every theme switch (host bridge, in-app toggle) goes through. */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(currentThemeMode);
  useEffect(() => {
    const observer = new MutationObserver(() => setMode(currentThemeMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}
