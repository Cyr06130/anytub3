import { Toaster } from "@/components/ui/sonner";
import { useThemeMode } from "@/lib/use-theme-mode";

/** Sonner toaster following the active design-system theme. The stock wrapper
 *  reads next-themes (which this app doesn't run), so the resolved mode is
 *  passed explicitly — the `theme` prop spreads after the wrapper's own. */
export function AppToaster() {
  return <Toaster theme={useThemeMode()} />;
}
