import type { Channel, EpgBinding, Playlist, PlaylistEpg } from "@/types";
import { isHttpUrl } from "@/lib/url";

// Pure helpers over a playlist's guide configuration (`Playlist.epg`): the
// trust boundary for bodies read from Bulletin and the value updates the
// state layer persists. Kept free of I/O so they are trivially unit-tested.

const MAX_FIELD = 128;

function shortString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() && v.length <= MAX_FIELD ? v.trim() : undefined;
}

function sanitizeBinding(raw: unknown): EpgBinding | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const source = typeof b.source === "string" && (isHttpUrl(b.source) || shortString(b.source)) ? b.source : undefined;
  const channelId = shortString(b.channelId);
  if (!source || !channelId) return undefined;
  const name = shortString(b.name);
  return { source, channelId, ...(name ? { name } : {}) };
}

/**
 * Re-validate an UNTRUSTED guide configuration (a body decrypted from
 * Bulletin — possibly authored by another user): http(s) sources only,
 * well-formed bindings, bounded strings. `legacyUrl` is the pre-2026-09
 * single `epgUrl` field. Returns undefined when nothing survives.
 */
export function sanitizePlaylistEpg(raw: unknown, legacyUrl?: unknown): PlaylistEpg | undefined {
  const epg = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sources: string[] = [];
  for (const s of [...(Array.isArray(epg.sources) ? epg.sources : []), legacyUrl]) {
    if (isHttpUrl(s) && !sources.includes(s)) sources.push(s);
  }
  const bindings: Record<string, EpgBinding> = {};
  if (epg.bindings && typeof epg.bindings === "object") {
    for (const [channelId, b] of Object.entries(epg.bindings as Record<string, unknown>)) {
      const clean = sanitizeBinding(b);
      if (clean && shortString(channelId)) bindings[channelId] = clean;
    }
  }
  const out: PlaylistEpg = {
    ...(sources.length ? { sources } : {}),
    ...(Object.keys(bindings).length ? { bindings } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** `epg` with `url` as the highest-priority source (a pasted URL must beat a
 *  declared one that failed). */
export function withEpgSource(epg: PlaylistEpg | undefined, url: string): PlaylistEpg {
  const rest = (epg?.sources ?? []).filter((s) => s !== url);
  return { ...epg, sources: [url, ...rest] };
}

export function withEpgBinding(epg: PlaylistEpg | undefined, channelId: string, binding: EpgBinding): PlaylistEpg {
  return { ...epg, bindings: { ...epg?.bindings, [channelId]: binding } };
}

/** The user-confirmed guide channel for `channel` in `source`, if any. */
export function userBinding(playlist: Playlist, channel: Channel, source: string): EpgBinding | undefined {
  const b = playlist.epg?.bindings?.[channel.id];
  return b?.source === source ? b : undefined;
}
