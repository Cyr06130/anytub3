import { useEffect } from "react";
import { useTheme } from "@novasamatech/tr-ui";
import { getBridge } from "@/lib/bridge";

/** Maps the host's light/dark theme onto TrUI's setMode. */
export function HostThemeBridge() {
  const { setMode } = useTheme();
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void getBridge().then((bridge) => {
      if (!active) return;
      dispose = bridge.subscribeTheme((mode) => setMode(mode));
    });
    return () => {
      active = false;
      dispose?.();
    };
  }, [setMode]);
  return null;
}
