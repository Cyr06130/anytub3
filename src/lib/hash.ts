/**
 * djb2 — small, dependency-free, stable string hash. Used for deterministic
 * entry ids (m3u) and cache keys (epg-cache); NOT cryptographic.
 */
export function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
