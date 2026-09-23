import { describe, expect, it } from "vitest";
import { describeHostTransport, detectHostTransport, type HostWindowLike } from "@/lib/bridge/diagnostics";

function win(extra: Partial<HostWindowLike> = {}): HostWindowLike {
  const w: HostWindowLike = { location: { origin: "https://app.anytub3tv.paseo" }, ...extra };
  if (!("top" in extra)) w.top = w; // top-level window unless the test frames it
  return w;
}

describe("detectHostTransport", () => {
  it("prefers the shared client the native container injects", () => {
    expect(detectHostTransport(win({ __HOST_API_CLIENT__: { client: {} }, __HOST_WEBVIEW_MARK__: true }))).toBe(
      "shared-client",
    );
  });

  it("reports the compatibility port without reading it (the getter has side effects)", () => {
    let reads = 0;
    const w = win({ __HOST_WEBVIEW_MARK__: true });
    Object.defineProperty(w, "__HOST_API_PORT__", {
      get() {
        reads++;
        return {};
      },
    });
    expect(detectHostTransport(w)).toBe("legacy-port");
    expect(reads).toBe(0);
  });

  it("recognises an iframe embed (Polkadot Web), including a cross-origin parent that throws", () => {
    expect(detectHostTransport(win({ top: {} }))).toBe("iframe");
    const hostile = win();
    Object.defineProperty(hostile, "top", {
      get() {
        throw new Error("cross-origin");
      },
    });
    expect(detectHostTransport(hostile)).toBe("iframe");
  });

  it("falls back to the webview mark, then to none", () => {
    expect(detectHostTransport(win({ __HOST_WEBVIEW_MARK__: true }))).toBe("webview-mark");
    expect(detectHostTransport(win())).toBe("none");
    expect(detectHostTransport(null)).toBe("none");
  });
});

describe("describeHostTransport", () => {
  it("prints the kind and the page origin on one line", () => {
    expect(describeHostTransport(win({ __HOST_API_CLIENT__: {} }))).toBe(
      "transport=shared-client origin=https://app.anytub3tv.paseo",
    );
    expect(describeHostTransport(null)).toBe("transport=none origin=unknown");
  });
});
