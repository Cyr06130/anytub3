import { compressText, decompressText } from "@/lib/codec";
import type { HostBridge } from "@/lib/bridge/types";
import { djb2 } from "@/lib/hash";

// Per-device EPG cache. EPG data (XMLTV guides, the iptv-org directory) is
// public, large and refreshed at most daily, so it lives ONLY in the per-device
// KV cache (localGet/localSet) — never on Bulletin or the Statement Store (it
// would waste encrypted storage and blow the 512B statement budget). Values are
// gzip-compressed (see codec.ts) to keep the footprint — and the memory we hold
// — small, which is the whole point of fetching lazily.

// `url` is stored so a hit can be verified: the key is a 32-bit hash and a
// collision must not silently serve another URL's body.
type CacheRecord = { at: number; url: string; blob: string };

// localStorage quota is ~5MB; don't cache a blob that could threaten it. An
// oversized guide is still usable — it's just re-fetched next time instead.
const MAX_CACHED_BLOB = 2_000_000; // base64 chars (~1.5 MB)

function hashKey(s: string): string {
  return djb2(s).toString(36);
}

/**
 * Fetch `url` as text through the bridge, backed by a compressed per-device
 * cache keyed by (namespace, url) with a TTL. The decompressed text is returned
 * to the caller but never retained here — callers extract what they need and
 * drop the rest, so we don't hold a multi-MB guide in memory.
 */
export async function cachedFetchText(
  bridge: HostBridge,
  url: string,
  ns: string,
  ttlMs: number,
): Promise<string> {
  const key = `epg:${ns}:${hashKey(url)}`;

  const cached = bridge.localGet(key);
  if (cached) {
    try {
      const rec = JSON.parse(cached) as CacheRecord;
      if (rec && typeof rec.blob === "string" && rec.url === url && Date.now() - rec.at < ttlMs) {
        return await decompressText(rec.blob);
      }
    } catch {
      /* corrupt/old record — fall through and refetch */
    }
  }

  const text = await bridge.httpGet(url);
  try {
    const blob = await compressText(text);
    if (blob.length <= MAX_CACHED_BLOB) {
      bridge.localSet(key, JSON.stringify({ at: Date.now(), url, blob } satisfies CacheRecord));
    }
  } catch {
    /* caching is best-effort (quota / codec) — never fail the fetch over it */
  }
  return text;
}

/** As {@link cachedFetchText}, parsed as JSON. */
export async function cachedFetchJson<T>(
  bridge: HostBridge,
  url: string,
  ns: string,
  ttlMs: number,
): Promise<T> {
  return JSON.parse(await cachedFetchText(bridge, url, ns, ttlMs)) as T;
}
