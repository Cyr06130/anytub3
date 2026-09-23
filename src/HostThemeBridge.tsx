import { useEffect } from "react";
import { getBridge } from "@/lib/bridge";
import { setTheme } from "@/theme/theme";

/** Maps the host's light/dark theme onto the design-system pair:
 *  light → Berlin Day, dark → Berlin Night (the only dark theme). */
export function HostThemeBridge() {
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    getBridge()
      .then((bridge) => {
        if (!active) return;
        dispose = bridge.subscribeTheme((mode) =>
          setTheme(mode === "dark" ? "berlin-night" : "berlin-day"),
        );
      })
      // A host bridge failure is surfaced by the HostUnavailable screen; the
      // theme simply keeps its default rather than adding an "Unexpected error".
      .catch(() => undefined);
    return () => {
      active = false;
      dispose?.();
    };
  }, []);
  return null;
}
