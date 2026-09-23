import { afterEach, describe, expect, it, vi } from "vitest";
import { compressText, decompressText } from "@/lib/codec";

describe("codec round-trip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips unicode text through gzip", async () => {
    const text = "édition télé — ça marche 📺 " + "x".repeat(10_000);
    expect(await decompressText(await compressText(text))).toBe(text);
  });

  it("round-trips a multi-chunk (>32k) payload", async () => {
    const text = "line\n".repeat(100_000); // ~500 kB — exercises chunked base64
    expect(await decompressText(await compressText(text))).toBe(text);
  });

  it("falls back to raw storage when CompressionStream is absent", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    vi.stubGlobal("DecompressionStream", undefined);
    const blob = await compressText("plain");
    expect(await decompressText(blob)).toBe("plain");
  });

  it("rejects (without unhandled rejections) on a corrupt gzip blob", async () => {
    // 'G' tag + garbage payload, base64-encoded.
    const corrupt = btoa("G" + "definitely-not-gzip");
    await expect(decompressText(corrupt)).rejects.toThrow();
  });
});

describe("gzip files", () => {
  it("detects and inflates a gzip payload", async () => {
    const { gunzipBytes, isGzip } = await import("@/lib/codec");
    const raw = new TextEncoder().encode("<tv>guide</tv>");
    const gz = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    expect(isGzip(gz)).toBe(true);
    expect(isGzip(raw)).toBe(false);
    expect(new TextDecoder().decode(await gunzipBytes(gz))).toBe("<tv>guide</tv>");
  });
});
