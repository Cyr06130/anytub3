import type { Programme } from "@/types";
import { compressText, decompressText, gunzipBytes, isGzip } from "@/lib/codec";
import type { HostBridge } from "@/lib/bridge/types";
import { EPG_CACHED_PROGRAMMES_MAX, EPG_PROGRAMMES_TTL_MS } from "@/lib/epg-sources";
import { djb2 } from "@/lib/hash";

// Per-device EPG cache. Guide data is public, large and refreshed at most
// daily, so it lives ONLY in the per-device KV cache (localGet/localSet) —
// never on Bulletin or the Statement Store (it would waste encrypted storage
// and blow the 512B statement budget). Two layers:
//  - small JSON records (extracted programmes per channel, channel directories,
//    resolution results) — the hot path, a few KB each;
//  - the raw XMLTV text of a declared guide, gzip-compressed (codec.ts) and
//    size-bounded, so re-opening another channel of the same guide is free.

function hashKey(s: string): string {
  return djb2(s).toString(36);
}

// ── JSON records ─────────────────────────────────────────────────────────────

type JsonRecord<T> = { at: number; value: T };

export function readCachedJson<T>(bridge: HostBridge, key: string, ttlMs: number): T | undefined {
  const raw = bridge.localGet(key);
  if (!raw) return undefined;
  try {
    const rec = JSON.parse(raw) as JsonRecord<T>;
    return rec && Date.now() - rec.at < ttlMs ? rec.value : undefined;
  } catch {
    return undefined; // corrupt/old record — treated as a miss
  }
}

/** Best-effort: a quota or serialization failure never fails the caller. */
export function writeCachedJson<T>(bridge: HostBridge, key: string, value: T): void {
  try {
    bridge.localSet(key, JSON.stringify({ at: Date.now(), value } satisfies JsonRecord<T>));
  } catch {
    /* quota — the value is simply recomputed next time */
  }
}

export async function cachedJson<T>(
  bridge: HostBridge,
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = readCachedJson<T>(bridge, key, ttlMs);
  if (hit !== undefined) return hit;
  const value = await compute();
  writeCachedJson(bridge, key, value);
  return value;
}

// ── programmes ───────────────────────────────────────────────────────────────

function programmesKey(sourceKey: string, channelId: string): string {
  return `epg:prog:${hashKey(sourceKey)}:${hashKey(channelId)}`;
}

/** The slice worth keeping: what still airs, sorted, capped (the panel shows 30). */
export function trimProgrammes(programmes: readonly Programme[], at: number = Date.now()): Programme[] {
  return [...programmes]
    .filter((p) => p.stop > at)
    .sort((a, b) => a.start - b.start)
    .slice(0, EPG_CACHED_PROGRAMMES_MAX);
}

export function readCachedProgrammes(bridge: HostBridge, sourceKey: string, channelId: string): Programme[] | undefined {
  return readCachedJson<Programme[]>(bridge, programmesKey(sourceKey, channelId), EPG_PROGRAMMES_TTL_MS);
}

/** Store a channel's programmes (trimmed); an empty list is not worth a record. */
export function writeCachedProgrammes(bridge: HostBridge, sourceKey: string, channelId: string, programmes: Programme[]): Programme[] {
  const kept = trimProgrammes(programmes);
  if (kept.length) writeCachedJson(bridge, programmesKey(sourceKey, channelId), kept);
  return kept;
}

/** Cached programmes of one channel of one source, computed on a miss. */
export async function cachedProgrammes(
  bridge: HostBridge,
  sourceKey: string,
  channelId: string,
  compute: () => Promise<Programme[]>,
): Promise<Programme[]> {
  return readCachedProgrammes(bridge, sourceKey, channelId) ?? writeCachedProgrammes(bridge, sourceKey, channelId, await compute());
}

// ── raw guide text ───────────────────────────────────────────────────────────

// `url` is stored so a hit can be verified: the key is a 32-bit hash and a
// collision must not silently serve another URL's body.
type TextRecord = { at: number; url: string; blob: string };

// localStorage quota is ~5MB; don't cache a blob that could threaten it. An
// oversized guide is still usable — its channels' programmes are cached
// instead, and the raw text is re-fetched when another channel needs it.
const MAX_CACHED_BLOB = 2_000_000; // base64 chars (~1.5 MB)

/**
 * Fetch `url` as text through the bridge, backed by a compressed per-device
 * cache keyed by (namespace, url) with a TTL. The decompressed text is returned
 * to the caller but never retained here — callers extract what they need and
 * drop the rest, so we don't hold a multi-MB guide in memory.
 */
export async function cachedFetchText(bridge: HostBridge, url: string, ns: string, ttlMs: number): Promise<string> {
  const key = `epg:${ns}:${hashKey(url)}`;

  const cached = bridge.localGet(key);
  if (cached) {
    try {
      const rec = JSON.parse(cached) as TextRecord;
      if (rec && typeof rec.blob === "string" && rec.url === url && Date.now() - rec.at < ttlMs) {
        return await decompressText(rec.blob);
      }
    } catch {
      /* corrupt/old record — fall through and refetch */
    }
  }

  const text = await fetchGuideText(bridge, url);
  try {
    const blob = await compressText(text);
    if (blob.length <= MAX_CACHED_BLOB) {
      bridge.localSet(key, JSON.stringify({ at: Date.now(), url, blob } satisfies TextRecord));
    }
  } catch {
    /* caching is best-effort (quota / codec) — never fail the fetch over it */
  }
  return text;
}

/** Download an XMLTV guide as text, inflating a gzip file (`.xml.gz`) when the
 *  server hands one over as raw bytes. */
export async function fetchGuideText(bridge: HostBridge, url: string): Promise<string> {
  if (!/\.gz(\?|$)/i.test(url)) return bridge.httpGet(url);
  const bytes = await bridge.httpGetBytes(url);
  return new TextDecoder().decode(isGzip(bytes) ? await gunzipBytes(bytes) : bytes);
}
