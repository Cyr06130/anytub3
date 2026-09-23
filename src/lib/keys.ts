import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getBridge } from "@/lib/bridge";
import { utf8 } from "@/lib/bytes";
import { KEY_CTX } from "@/lib/config";

// ── Deterministic, cross-host key material ───────────────────────────────────
// We derive from deriveEntropy (RFC-0007), NOT fromSignature: sr25519 signatures
// are non-deterministic, so fromSignature can't give the same key on two hosts
// (design §10). deriveEntropy(ctx) is wallet-bound and identical everywhere.
//
// The derivation is HKDF-SHA256 (IKM = master entropy, salt = "", info = ctx) —
// BYTE-COMPATIBLE with product-sdk-keys' KeyManager.deriveSymmetricKey, which
// this replaced (oracle-tested in keys.test.ts). The KeyManager class carries
// sr25519/Curve25519/HDKD methods the app never calls, and a class defeats
// tree-shaking — importing it put ~400 KB of elliptic-curve code on the
// first-paint path for what is one HKDF call.

let cached: Uint8Array | null = null;

/** Master entropy — identical on Mobile/Desktop/Web for the same wallet. */
async function masterEntropy(): Promise<Uint8Array> {
  if (cached) return cached;
  const bridge = await getBridge();
  const entropy = await bridge.deriveEntropy(utf8(KEY_CTX.master));
  // The host must return 32 bytes of wallet-bound entropy; guard so a null/short
  // result gives a clear error instead of a cryptic downstream length failure.
  if (!entropy || entropy.length !== 32) {
    throw new Error(`Host returned invalid entropy (${entropy?.length ?? "null"} bytes); cannot derive keys.`);
  }
  cached = entropy;
  return cached;
}

/** Symmetric content key for a context domain (playlists, library, state). */
export async function symKey(ctx: string): Promise<Uint8Array> {
  return deriveSymmetricKey(await masterEntropy(), ctx);
}

/** HKDF-SHA256(masterKey, salt=∅, info=context) → 32 bytes. Exported for the
 *  byte-compatibility oracle test; app code goes through {@link symKey}. */
export function deriveSymmetricKey(master: Uint8Array, ctx: string): Uint8Array {
  return hkdf(sha256, master, undefined, utf8(ctx), 32);
}

// Note: shares no longer carry an app-sealed envelope. The product host-api
// exposes no recipient encryption key, so sharing delegates confidentiality to
// the host chat's own end-to-end encryption (see lib/share.ts). No per-user
// Curve25519 keypair is derived here anymore.
