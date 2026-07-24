import type { HostBridge } from "./types";
import { createMockBridge } from "./mock";

export type { HostBridge, ChannelLike, ChannelEnvelope } from "./types";

let singleton: HostBridge | null = null;
let pending: Promise<HostBridge> | null = null;

/**
 * Resolve the host bridge once. Detects the host container via the SDK
 * (dynamically imported); falls back to the standalone mock bridge when out of
 * a host or if the SDK fails to load. The real bridge is also dynamically
 * imported so the mock build never bundles chain dependencies.
 */
export function getBridge(): Promise<HostBridge> {
  if (singleton) return Promise.resolve(singleton);
  if (pending) return pending;

  pending = (async () => {
    let inHost = false;
    try {
      const host = await import("@parity/product-sdk-host");
      inHost = await host.isInsideContainer();
    } catch {
      inHost = false;
    }

    let bridge: HostBridge | null = null;
    if (inHost) {
      // init() is part of the fallback boundary: a real bridge that loads but
      // fails to initialize (login/accounts) must degrade to the mock too —
      // otherwise the rejected promise is cached and every later getBridge()
      // fails with it.
      try {
        const { createRealBridge } = await import("./real");
        bridge = await createRealBridge();
        await bridge.init();
      } catch (e) {
        console.warn("[AnyTub3] Host bridge unavailable, falling back to mock:", e);
        bridge = null;
      }
    }
    if (!bridge) {
      bridge = createMockBridge();
      await bridge.init();
    }

    singleton = bridge;
    return bridge;
  })();

  return pending;
}

/** Synchronous best-effort accessor — null until getBridge() has resolved. */
export function bridgeIfReady(): HostBridge | null {
  return singleton;
}
