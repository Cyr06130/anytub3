import { describe, expect, it } from "vitest";
import { KeyManager } from "@parity/product-sdk-keys";
import { deriveSymmetricKey } from "@/lib/keys";

/** Deterministic 32-byte master keys (no Math.random — repeatable). */
function sampleMaster(seed: number): Uint8Array {
  const out = new Uint8Array(32);
  let x = seed;
  for (let i = 0; i < 32; i++) {
    x = (x * 1_103_515_245 + 12_345) & 0x7fffffff;
    out[i] = x & 0xff;
  }
  return out;
}

describe("deriveSymmetricKey stays byte-compatible with product-sdk-keys", () => {
  // The local HKDF replaced KeyManager.deriveSymmetricKey to keep ~400 KB of
  // unused elliptic-curve code off the first-paint bundle. Every derived key
  // MUST stay identical — these keys decrypt every playlist already stored on
  // Bulletin. The SDK itself is the oracle.

  const contexts = [
    "anytub3/library-index/v1",
    "anytub3/np-enc/v1",
    "anytub3/lib-enc/v1",
    "playlist:0b7f9a44-1234-4cde-9f00-abcdef012345",
    "playlist:", // boundary: empty id
  ];

  it("matches the SDK for sampled masters × app contexts", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const master = sampleMaster(seed);
      const oracle = KeyManager.fromRawKey(master);
      for (const ctx of contexts) {
        expect(deriveSymmetricKey(master, ctx)).toEqual(oracle.deriveSymmetricKey(ctx));
      }
    }
  });

  it("derives 32-byte keys that differ across contexts", () => {
    const master = sampleMaster(42);
    const a = deriveSymmetricKey(master, "ctx-a");
    const b = deriveSymmetricKey(master, "ctx-b");
    expect(a).toHaveLength(32);
    expect(a).not.toEqual(b);
  });
});
