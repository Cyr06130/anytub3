import { describe, expect, it } from "vitest";
import {
  hashToCid as sdkHashToCid,
  cidToPreimageKey as sdkCidToPreimageKey,
} from "@parity/product-sdk-cloud-storage";
import { cidToPreimageKey, hashToCid } from "@/lib/cid";

/** Deterministic pseudo-random 32-byte hex hashes (no Math.random — repeatable). */
function sampleHash(seed: number): `0x${string}` {
  let hex = "";
  let x = seed;
  for (let i = 0; i < 32; i++) {
    x = (x * 1_103_515_245 + 12_345) & 0x7fffffff;
    hex += (x & 0xff).toString(16).padStart(2, "0");
  }
  return `0x${hex}`;
}

describe("local CID codecs stay byte-compatible with the cloud-storage SDK", () => {
  // The local copy exists so the sponsored preimage path doesn't depend on the
  // SDK's heavyweight chunk loading at runtime — but every CID it mints MUST be
  // identical to the SDK's, or previously stored libraries and share codes
  // would stop resolving. The SDK itself is the oracle here.

  it("hashToCid matches the SDK for 50 sampled hashes", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const hash = sampleHash(seed);
      expect(hashToCid(hash)).toBe(sdkHashToCid(hash));
    }
  });

  it("cidToPreimageKey matches the SDK and inverts hashToCid", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const hash = sampleHash(seed);
      const cid = sdkHashToCid(hash);
      expect(cidToPreimageKey(cid)).toBe(sdkCidToPreimageKey(cid));
      expect(cidToPreimageKey(hashToCid(hash))).toBe(hash);
    }
  });

  it("rejects malformed inputs with clear errors", () => {
    expect(() => hashToCid("0x1234" as `0x${string}`)).toThrow(/32-byte hex hash/);
    expect(() => cidToPreimageKey("Qmfoo")).toThrow(/base32 CIDv1/);
    expect(() => cidToPreimageKey("bnotacid")).toThrow();
  });
});
