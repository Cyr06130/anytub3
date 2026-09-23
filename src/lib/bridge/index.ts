import { describeHostTransport, type HostWindowLike } from "./diagnostics";
import { HostBridgeError } from "./errors";
import { createMockBridge } from "./mock";
import type { HostBridge } from "./types";

export { HostBridgeError } from "./errors";
export type { HostBridge, ChannelLike, ChannelEnvelope } from "./types";

let singleton: HostBridge | null = null;
let pending: Promise<HostBridge> | null = null;

/**
 * Resolve the host bridge once.
 *
 * Inside a Polkadot host the real bridge is the only acceptable outcome: a
 * failure rejects with a {@link HostBridgeError} (the UI blocks on the reason
 * and offers Retry) and clears the cache so the next call starts over. It used
 * to fall back to the mock, which showed "Demo mode" in the host and "saved"
 * playlists to localStorage under fake CIDs — a save the user believed had
 * reached Bulletin. Off-host, the standalone mock bridge is the normal case.
 */
export function getBridge(): Promise<HostBridge> {
  if (singleton) return Promise.resolve(singleton);
  if (pending) return pending;
  pending = resolveBridge().then(
    (bridge) => {
      singleton = bridge;
      return bridge;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    },
  );
  return pending;
}

/** Synchronous best-effort accessor — null until getBridge() has resolved. */
export function bridgeIfReady(): HostBridge | null {
  return singleton;
}

async function resolveBridge(): Promise<HostBridge> {
  if (!(await detectHost())) {
    const mock = createMockBridge();
    await mock.init();
    return mock;
  }
  try {
    const { createRealBridge } = await import("./real");
    const bridge = await createRealBridge();
    await bridge.init();
    return bridge;
  } catch (error) {
    if (error instanceof HostBridgeError) throw error;
    throw new HostBridgeError("The Polkadot host bridge failed to initialize.", {
      cause: error,
      hint: error instanceof Error ? error.message : String(error),
      details: describeHostTransport(),
    });
  }
}

/**
 * Container detection via the SDK. If the SDK chunk itself fails to load,
 * decide with the same heuristic the SDK uses: off-host that is the ordinary
 * standalone case, but inside a container it means no real bridge can exist —
 * say so rather than pretend with the mock.
 */
async function detectHost(): Promise<boolean> {
  try {
    const host = await import("@parity/product-sdk-host");
    return await host.isInsideContainer();
  } catch (error) {
    if (looksEmbedded()) {
      throw new HostBridgeError("The Polkadot host SDK failed to load.", {
        cause: error,
        hint: "Check the connection, then retry.",
      });
    }
    return false;
  }
}

/** Sync mirror of truapi's `isCorrectEnvironment`: iframe, webview mark, injected
 *  client or port. Presence via `in` only — reading `__HOST_API_PORT__` on the
 *  native container creates its compatibility channel (see diagnostics.ts). */
function looksEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as HostWindowLike;
  let framed = false;
  try {
    framed = window !== window.top;
  } catch {
    framed = true; // a cross-origin parent throws on access — we are embedded
  }
  return framed || w.__HOST_WEBVIEW_MARK__ === true || "__HOST_API_CLIENT__" in w || "__HOST_API_PORT__" in w;
}
