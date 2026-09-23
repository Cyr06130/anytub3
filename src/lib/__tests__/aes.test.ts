import { describe, expect, it } from "vitest";
import {
  aesGcmDecryptPacked as sdkDecrypt,
  aesGcmEncryptPacked as sdkEncrypt,
} from "@parity/product-sdk-crypto";
import { aesGcmDecryptPacked, aesGcmEncryptPacked } from "@/lib/aes";

const key = new Uint8Array(32).fill(9);
const payload = new TextEncoder().encode('{"v":1,"entries":["chaîne 📺"]}');

describe("packed AES-GCM stays byte-compatible with product-sdk-crypto", () => {
  // The local copy exists to keep the SDK barrel's tweetnacl re-export off the
  // first-paint bundle. Blobs already on Bulletin were sealed by the SDK, so
  // both directions must interoperate — the SDK itself is the oracle.

  it("SDK-sealed blobs open with the local decrypt", () => {
    expect(aesGcmDecryptPacked(sdkEncrypt(payload, key), key)).toEqual(payload);
  });

  it("locally-sealed blobs open with the SDK decrypt", () => {
    expect(sdkDecrypt(aesGcmEncryptPacked(payload, key), key)).toEqual(payload);
  });

  it("round-trips locally and produces a fresh nonce per call", () => {
    const a = aesGcmEncryptPacked(payload, key);
    const b = aesGcmEncryptPacked(payload, key);
    expect(aesGcmDecryptPacked(a, key)).toEqual(payload);
    expect(a).not.toEqual(b); // random nonce → different ciphertexts
  });

  it("rejects a wrong key and truncated data", () => {
    const packed = aesGcmEncryptPacked(payload, key);
    expect(() => aesGcmDecryptPacked(packed, new Uint8Array(32).fill(1))).toThrow();
    expect(() => aesGcmDecryptPacked(packed.subarray(0, 20), key)).toThrow(/too short/);
    expect(() => aesGcmEncryptPacked(payload, new Uint8Array(16))).toThrow(/32-byte key/);
  });
});
