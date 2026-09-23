import { afterEach, describe, expect, it, vi } from "vitest";
import { cutAt, fetchBytes, fetchText, fetchTextPrefix } from "@/lib/bridge/http";

/** A body delivering `chunks`, then either closing or hanging like a slow
 *  network (a real download never closes itself right after the header). */
function streamOf(chunks: string[], onCancel: () => void, thenHang = false): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(enc.encode(chunks[i++]));
      else if (thenHang) return new Promise(() => undefined);
      else controller.close();
    },
    cancel: onCancel,
  });
}

describe("fetchTextPrefix", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stops at the marker and cancels the download", async () => {
    const cancelled = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(streamOf(["<tv><channel>A</cha", "nnel><prog", "ramme>never read"], cancelled, true))),
    );
    const head = await fetchTextPrefix("https://x.test/guide.xml", { until: "<programme", maxBytes: 1_000_000 });
    expect(head).toBe("<tv><channel>A</channel>");
    expect(cancelled).toHaveBeenCalled();
  });

  it("stops after maxBytes without a marker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(["0123456789", "0123456789", "0123456789"], () => {}))));
    const head = await fetchTextPrefix("https://x.test/big.xml", { until: "<never>", maxBytes: 15 });
    expect(head.length).toBeLessThan(30);
    expect(head.length).toBeGreaterThanOrEqual(15);
  });

  it("returns everything when the resource ends before the marker", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(["short"], () => {}))));
    expect(await fetchTextPrefix("https://x.test/s.xml", { until: "<programme", maxBytes: 100 })).toBe("short");
  });

  it("refuses non-http(s) URLs and HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(fetchText("javascript:alert(1)")).rejects.toThrow(/http\(s\)/);
    await expect(fetchBytes("https://x.test/missing")).rejects.toThrow("HTTP 404");
  });
});

describe("cutAt", () => {
  it("cuts before the marker or returns the whole text", () => {
    expect(cutAt("abc<p>def", "<p>")).toBe("abc");
    expect(cutAt("abc", "<p>")).toBe("abc");
  });
});
