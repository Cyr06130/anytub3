// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MAX_STATEMENT_BYTES, openEnvelope, sealEnvelope } from "@/lib/envelope";
import type { NowPlaying } from "@/types";

const key = new Uint8Array(32).fill(7);

// Worst-case realistic now-playing payload: full-length CIDv1 + long channel id.
const nowPlaying: NowPlaying = {
  v: 1,
  playlistCid: "bafybeih36yhhzth7pdc3txg42jf4owx4zacapo6sr5aoshqgtdxuieage4",
  channelId: "ch_zzzzzzzzzz",
  timestamp: 1_787_230_500_123,
};

describe("channel envelope codec", () => {
  it("round-trips a payload through seal → open", () => {
    const envelope = sealEnvelope(nowPlaying, key, nowPlaying.timestamp);
    expect(openEnvelope<NowPlaying>(envelope, key)).toEqual(nowPlaying);
    expect(envelope.timestamp).toBe(nowPlaying.timestamp);
  });

  it("keeps a realistic now-playing envelope under the 512-byte statement limit", () => {
    // Regression: the legacy number[] ciphertext encoding pushed this envelope
    // to ~600 bytes — every real-host publish was rejected (and the rejection
    // swallowed), so nothing ever reached the statement store.
    const encoded = JSON.stringify(sealEnvelope(nowPlaying, key, nowPlaying.timestamp)).length;
    expect(encoded).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
  });

  it("still opens the legacy number[] ciphertext shape", () => {
    const modern = sealEnvelope(nowPlaying, key, 1);
    const legacy = {
      timestamp: 1,
      ct: Array.from(Uint8Array.from(atob(modern.ct as string), (c) => c.charCodeAt(0))),
    };
    expect(openEnvelope<NowPlaying>(legacy, key)).toEqual(nowPlaying);
  });

  it("throws a clear error when the payload cannot fit a statement", () => {
    const huge = { blob: "x".repeat(2_000) };
    expect(() => sealEnvelope(huge, key, 1)).toThrow(/512-byte statement limit/);
  });

  it("throws on a wrong key instead of returning garbage", () => {
    const envelope = sealEnvelope(nowPlaying, key, 1);
    expect(() => openEnvelope(envelope, new Uint8Array(32).fill(8))).toThrow();
  });
});
