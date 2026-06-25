import { KeyManager } from "@parity/product-sdk-keys";
import { getBridge } from "@/lib/bridge";
import { KEY_CTX } from "@/lib/config";

const enc = (s: string) => new TextEncoder().encode(s);

// ── Deterministic, cross-host key material ───────────────────────────────────
// We derive from deriveEntropy (RFC-0007), NOT fromSignature: sr25519 signatures
// are non-deterministic, so fromSignature can't give the same key on two hosts
// (design §10). deriveEntropy(ctx) is wallet-bound and identical everywhere.

let cached: { km: KeyManager } | null = null;

/** Master key — identical on Mobile/Desktop/Web for the same wallet. */
export async function masterKey(): Promise<KeyManager> {
  if (cached) return cached.km;
  const bridge = await getBridge();
  const entropy = await bridge.deriveEntropy(enc(KEY_CTX.master));
  // The host must return 32 bytes of wallet-bound entropy; guard so a null/short
  // result gives a clear error instead of a cryptic `fromRawKey(null).length`.
  if (!entropy || entropy.length !== 32) {
    throw new Error(`Host returned invalid entropy (${entropy?.length ?? "null"} bytes); cannot derive keys.`);
  }
  const km = KeyManager.fromRawKey(entropy);
  cached = { km };
  return km;
}

/** Symmetric content key for a context domain (playlists, library, state). */
export async function symKey(ctx: string): Promise<Uint8Array> {
  return (await masterKey()).deriveSymmetricKey(ctx);
}

// Note: shares no longer carry an app-sealed envelope. The product host-api
// exposes no recipient encryption key, so sharing delegates confidentiality to
// the host chat's own end-to-end encryption (see lib/share.ts). No per-user
// Curve25519 keypair is derived here anymore.

/** Reset cached key material (e.g. on account switch). Mainly for tests. */
export function resetKeys() {
  cached = null;
}
