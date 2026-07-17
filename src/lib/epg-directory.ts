import type { DirectoryChannel } from "@/types";
import type { HostBridge } from "@/lib/bridge/types";
import { cachedFetchText } from "@/lib/epg-cache";

// iptv-org channel directory (the "annuaire") — channels.json.
//
// Role here: the programmes always come from an XMLTV feed; iptv-org/api itself
// serves no programme data. The directory is used to (1) resolve a MISSING
// tvg-id by matching the channel name to a canonical iptv-org id (so it lines up
// with the XMLTV `<channel id>`), and (2) enrich the guide panel (canonical name,
// categories). channels.json is several MB, so it is fetched ONLY when actually
// needed (a channel without a tvg-id), cached compressed per-device, and indexed
// in memory once per session. The common path (channels that carry a tvg-id)
// never loads it — keeping the lazy/low-memory promise.

const DIRECTORY_URL = "https://iptv-org.github.io/api/channels.json";
const TTL_MS = 7 * 24 * 3_600_000; // a week — the directory changes slowly

let byIdPromise: Promise<Map<string, DirectoryChannel>> | null = null;
let nameToId: Map<string, string> | null = null;

/** Normalize a channel name for matching: lowercase, drop accents & noise. */
function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks)
    .toLowerCase()
    .replace(/\b(hd|fhd|uhd|4k|sd|tv)\b/g, "") // common quality/suffix noise
    .replace(/[^a-z0-9]+/g, ""); // keep alphanumerics only
}

function load(bridge: HostBridge): Promise<Map<string, DirectoryChannel>> {
  if (byIdPromise) return byIdPromise;
  byIdPromise = (async () => {
    const raw = await cachedFetchText(bridge, DIRECTORY_URL, "directory", TTL_MS);
    const arr = JSON.parse(raw) as unknown;
    const byId = new Map<string, DirectoryChannel>();
    const byName = new Map<string, string>();
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const c = item as Record<string, unknown>;
        if (typeof c.id !== "string") continue;
        const dc: DirectoryChannel = {
          id: c.id,
          name: typeof c.name === "string" ? c.name : "",
          alt_names: Array.isArray(c.alt_names) ? (c.alt_names.filter((n) => typeof n === "string") as string[]) : undefined,
          country: typeof c.country === "string" ? c.country : undefined,
          categories: Array.isArray(c.categories) ? (c.categories.filter((n) => typeof n === "string") as string[]) : undefined,
          closed: typeof c.closed === "string" ? c.closed : null,
        };
        byId.set(dc.id, dc);
        if (dc.closed) continue; // never resolve a missing id to a closed channel
        for (const candidate of [dc.name, ...(dc.alt_names ?? [])]) {
          const k = normalizeName(candidate);
          if (k && !byName.has(k)) byName.set(k, dc.id);
        }
      }
    }
    nameToId = byName;
    return byId;
  })();
  return byIdPromise;
}

/**
 * Resolve a canonical iptv-org channel id from a display name, loading the
 * directory on demand. Used only when a channel has no tvg-id. Normalized exact
 * match only (no fuzzy guessing) to avoid wrong associations.
 */
export async function resolveTvgId(bridge: HostBridge, name: string): Promise<string | undefined> {
  await load(bridge);
  return nameToId?.get(normalizeName(name));
}

/**
 * Enrichment for the guide panel — canonical name + categories. Best-effort and
 * non-loading: returns undefined unless the directory is ALREADY in memory (so
 * opening a guide for a channel that has a tvg-id never triggers a multi-MB
 * download). The directory is in memory whenever {@link resolveTvgId} ran.
 */
export async function channelMeta(
  channelId: string,
): Promise<{ name?: string; categories?: string[] } | undefined> {
  if (!byIdPromise) return undefined;
  const byId = await byIdPromise;
  const dc = byId.get(channelId);
  if (!dc) return undefined;
  return { name: dc.name || undefined, categories: dc.categories };
}
