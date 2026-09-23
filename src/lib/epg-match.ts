import type { Channel, GuideChannel } from "@/types";

// Matching a playlist channel to a guide channel by name — the join used when
// no exact id is available (public directories have their own ids). Both sides
// go through the same normalization so "FR| TF1 HD" and "TF1" meet at "tf1".

/** `FR| TF1`, `UK: BBC One`, `US - CNN` — a two-letter provider prefix. */
const PROVIDER_PREFIX = /^[A-Z]{2}\s*(?:[|:]|\s-\s)\s*/;
/** Bracketed notes: `(1080p)`, `[Geo-blocked]`. */
const BRACKETS = /\([^)]*\)|\[[^\]]*\]/g;
/** Quality/format noise that varies between playlists and guides. */
const NOISE = /\b(hd|fhd|uhd|4k|sd|tv|hevc|h265|h264|raw|backup|vip)\b/g;

/** Normalize a channel name for matching: strip prefixes, brackets, diacritics
 *  and quality noise; keep lower-case alphanumerics only. */
export function normalizeName(name: string): string {
  return name
    .replace(PROVIDER_PREFIX, "")
    .replace(BRACKETS, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(NOISE, "")
    .replace(/[^a-z0-9]+/g, "");
}

// ── tvg-id helpers ───────────────────────────────────────────────────────────
// iptv-org playlists (2025+) suffix ids with the feed: `TF1.fr@SD`. XMLTV
// channel ids never carry it.

export function baseTvgId(tvgId: string): string {
  return tvgId.trim().split("@")[0];
}

const COUNTRY_SUFFIX = /\.([a-z]{2})$/i;

/** `TF1.fr` → `TF1`; an id without a country suffix is returned whole. */
export function tvgIdName(tvgId: string): string {
  return baseTvgId(tvgId).replace(COUNTRY_SUFFIX, "");
}

/** `TF1.fr` → `fr` (raw, un-normalized), else undefined. */
export function tvgIdCountry(tvgId: string): string | undefined {
  return COUNTRY_SUFFIX.exec(baseTvgId(tvgId))?.[1];
}

// ── matching ─────────────────────────────────────────────────────────────────

/** Normalized names under which a channel may appear in a guide, most specific
 *  first: its display name, the name part of its tvg-id, then known aliases. */
export function channelMatchKeys(channel: Channel, aliases: readonly string[] = []): string[] {
  const raw = [channel.name, channel.tvgId ? tvgIdName(channel.tvgId) : "", ...aliases];
  const keys: string[] = [];
  for (const r of raw) {
    const k = normalizeName(r);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** Normalized name → guide channel (first occurrence wins). */
export type GuideIndex = Map<string, GuideChannel>;

export function indexGuideChannels(channels: readonly GuideChannel[]): GuideIndex {
  const index: GuideIndex = new Map();
  for (const c of channels) {
    const k = normalizeName(c.name);
    if (k && !index.has(k)) index.set(k, c);
  }
  return index;
}

/** Exact normalized match only — no fuzzy guessing (a wrong guide is worse than none). */
export function matchGuideChannel(
  channel: Channel,
  index: GuideIndex,
  aliases: readonly string[] = [],
): GuideChannel | undefined {
  for (const key of channelMatchKeys(channel, aliases)) {
    const hit = index.get(key);
    if (hit) return hit;
  }
  return undefined;
}

function similarity(keys: readonly string[], candidate: string): number {
  if (!candidate) return 0;
  let best = 0;
  for (const k of keys) {
    if (k === candidate) return 3;
    if (candidate.startsWith(k) || k.startsWith(candidate)) best = Math.max(best, 2);
    else if (candidate.includes(k) || k.includes(candidate)) best = Math.max(best, 1);
  }
  return best;
}

/** Directory channels ordered by likeness to `channel` (then by name), so the
 *  picker shows the probable match first — the D-pad reaches it in one press. */
export function rankGuideChannels(channel: Channel, channels: readonly GuideChannel[]): GuideChannel[] {
  const keys = channelMatchKeys(channel);
  return channels
    .map((c) => ({ c, score: similarity(keys, normalizeName(c.name)) }))
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .map(({ c }) => c);
}
