/**
 * Last-write-wins pick between two timestamped values (either may be absent).
 * Accepts both clock field spellings used by the sync payloads (`ts` on
 * LibraryHead, `timestamp` on NowPlaying). Ties keep `a` — callers pass the
 * authoritative source first.
 */
export function pickFreshest<T extends { ts?: number; timestamp?: number }>(
  a: T | null,
  b: T | null,
): T | null {
  if (!a) return b;
  if (!b) return a;
  return clockOf(a) >= clockOf(b) ? a : b;
}

function clockOf(v: { ts?: number; timestamp?: number }): number {
  return v.ts ?? v.timestamp ?? 0;
}
