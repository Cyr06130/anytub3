import { aesGcmDecryptPacked, aesGcmEncryptPacked } from "@parity/product-sdk-crypto";
import { base64FromBytes, bytesFromBase64, utf8 } from "@/lib/bytes";
import type { ChannelEnvelope } from "@/lib/bridge/types";

/**
 * The statement store rejects statements whose encoded data exceeds 512 bytes
 * (SDK `MAX_STATEMENT_SIZE`). The envelope must stay under it AFTER JSON
 * encoding — which is why `ct` is base64 (~1.33× the ciphertext), not a JSON
 * number array (~3.6×): a now-playing payload encoded as numbers is ~600 bytes
 * and every publish is rejected.
 */
export const MAX_STATEMENT_BYTES = 512;

const decoder = new TextDecoder();

/** Encrypt a channel payload into the wire envelope; throws if the encoded
 *  envelope could not fit a statement (caller bug: payload too large). */
export function sealEnvelope<T>(payload: T, key: Uint8Array, timestamp: number): ChannelEnvelope {
  const envelope: ChannelEnvelope = {
    timestamp,
    ct: base64FromBytes(aesGcmEncryptPacked(utf8(JSON.stringify(payload)), key)),
  };
  const encoded = JSON.stringify(envelope).length;
  if (encoded > MAX_STATEMENT_BYTES) {
    throw new Error(`Channel envelope is ${encoded} bytes — over the ${MAX_STATEMENT_BYTES}-byte statement limit.`);
  }
  return envelope;
}

/** Decrypt a wire envelope. Also reads the legacy `number[]` ciphertext shape
 *  (pre-2026-08 statements still in flight); throws on wrong key/corrupt data. */
export function openEnvelope<T>(envelope: ChannelEnvelope, key: Uint8Array): T {
  const ct = typeof envelope.ct === "string" ? bytesFromBase64(envelope.ct) : new Uint8Array(envelope.ct);
  return JSON.parse(decoder.decode(aesGcmDecryptPacked(ct, key))) as T;
}
