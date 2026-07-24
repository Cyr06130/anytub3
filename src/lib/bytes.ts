// Shared byte/string codecs — the single home for the UTF-8 and base64
// conversions that were hand-rolled per module (codec, share, mock bridge,
// sync, keys). Chunked encoding so multi-MB payloads (EPG guides) stay clear
// of String.fromCharCode argument-length limits.

const encoder = new TextEncoder();

/** UTF-8 encode (shared TextEncoder — no per-call allocation). */
export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

export function base64FromBytes(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

export function bytesFromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** URL-safe variant (share codes): `+/` → `-_`, padding stripped. */
export function base64UrlFromBytes(bytes: Uint8Array): string {
  return base64FromBytes(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function bytesFromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return bytesFromBase64(b64 + (b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : ""));
}
