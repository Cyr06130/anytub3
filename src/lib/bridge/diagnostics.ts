/**
 * Where this page is wired to its Polkadot host — one line for the failure
 * screen, so a report from a device we cannot debug says which path was taken.
 *
 * Native hosts (Polkadot Mobile / Desktop since 2026-09-22) run a shared
 * browser container that opens the loopback WebSocket itself and publishes a
 * ready-made client on `window.__HOST_API_CLIENT__` (adopted by truapi ≥ 0.19)
 * plus a compatibility `MessagePort` on `__HOST_API_PORT__` for older SDKs.
 * Older native builds injected only the port; Polkadot Web embeds us in an
 * iframe and hands a port over `postMessage`.
 *
 * Presence is checked with `in`, never by reading: on the new container
 * `__HOST_API_PORT__` is a getter that CREATES the compatibility channel and
 * diverts every non-host frame to it, which would starve the shared client.
 */
export type HostWindowLike = {
  __HOST_API_CLIENT__?: unknown;
  __HOST_API_PORT__?: unknown;
  __HOST_WEBVIEW_MARK__?: unknown;
  top?: unknown;
  location?: { origin?: string };
};

export type HostTransportKind = "shared-client" | "legacy-port" | "iframe" | "webview-mark" | "none";

export function detectHostTransport(win: HostWindowLike | null): HostTransportKind {
  if (!win) return "none";
  if ("__HOST_API_CLIENT__" in win && win.__HOST_API_CLIENT__) return "shared-client";
  if ("__HOST_API_PORT__" in win) return "legacy-port";
  if (isFramed(win)) return "iframe";
  if (win.__HOST_WEBVIEW_MARK__ === true) return "webview-mark";
  return "none";
}

function isFramed(win: HostWindowLike): boolean {
  try {
    return win.top !== undefined && win !== win.top;
  } catch {
    return true; // a cross-origin parent throws on access — we are embedded
  }
}

/** `transport=<kind> origin=<origin>`, for HostBridgeError.details. */
export function describeHostTransport(
  win: HostWindowLike | null = typeof window === "undefined" ? null : (window as HostWindowLike),
): string {
  const origin = win?.location?.origin ?? "unknown";
  return `transport=${detectHostTransport(win)} origin=${origin}`;
}
