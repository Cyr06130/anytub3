import type { Channel, ChannelEpg, Playlist, Programme } from "@/types";
import { getBridge } from "@/lib/bridge";
import { cachedFetchText } from "@/lib/epg-cache";
import { resolveTvgId, channelMeta } from "@/lib/epg-directory";

// EPG = the programmes for a channel, read on demand from an XMLTV feed.
//
// Design notes:
//  - Lazy: nothing is fetched until the user opens a channel's guide. Only that
//    channel's programmes are extracted from the (cached, compressed) XMLTV, and
//    we never retain the whole guide in memory — bounding both network and RAM.
//  - Untrusted: XMLTV comes from a third party. We parse with the browser's
//    DOMParser (no external-entity resolution → XXE-safe), accept http(s) icons
//    only, and React escapes all text. Same trust posture as shared playlists.

const XMLTV_TTL_MS = 6 * 3_600_000; // guides change ~daily; 6h is plenty fresh
const MAX_PROGRAMMES = 500; // per channel — memory bound on a hostile/huge guide
const MAX_UPCOMING = 30; // programmes surfaced in the panel
const SAFE_URL = /^https?:\/\//i;

export type EpgErrorCode = "no-source" | "no-id" | "no-programmes" | "fetch-failed";

/** A user-presentable EPG failure (the panel renders `.message`). */
export class EpgError extends Error {
  constructor(
    readonly code: EpgErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EpgError";
  }
}

// ── XMLTV time parsing ───────────────────────────────────────────────────────
// Format: `YYYYMMDDHHMMSS ±HHMM` (offset optional; seconds/minutes optional).
const XMLTV_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*([+-]\d{4})?/;

function parseXmltvTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = XMLTV_TIME.exec(s.trim());
  if (!m) return null;
  const [, Y, Mo, D, h = "00", mi = "00", se = "00", tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "+00:00"; // default UTC
  const t = Date.parse(`${Y}-${Mo}-${D}T${h}:${mi}:${se}${offset}`);
  return Number.isNaN(t) ? null : t;
}

// ── Per-channel programme extraction ─────────────────────────────────────────
// Scan for <programme …>…</programme> blocks and parse ONLY those whose
// `channel` attribute matches — so a multi-channel guide doesn't materialize a
// giant DOM. Each matched block is parsed in isolation with DOMParser (robust +
// XXE-safe). A malformed block is skipped, never throws.

function openingTag(block: string): string {
  const gt = block.indexOf(">");
  return gt < 0 ? block : block.slice(0, gt);
}

function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return m?.[1];
}

function parseProgrammeBlock(block: string, channelId: string): Programme | null {
  const doc = new DOMParser().parseFromString(block, "text/xml");
  const el = doc.documentElement;
  if (!el || el.nodeName !== "programme" || doc.getElementsByTagName("parsererror").length) {
    return null;
  }
  const start = parseXmltvTime(el.getAttribute("start"));
  const stop = parseXmltvTime(el.getAttribute("stop"));
  if (start == null || stop == null || stop <= start) return null;

  const text = (tag: string) => el.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;
  const iconSrc = el.getElementsByTagName("icon")[0]?.getAttribute("src")?.trim();

  return {
    channelId,
    start,
    stop,
    title: text("title") || "Untitled programme",
    desc: text("desc"),
    category: text("category"),
    icon: iconSrc && SAFE_URL.test(iconSrc) ? iconSrc : undefined, // http(s) only
  };
}

/** Extract (up to MAX_PROGRAMMES) programmes for one channel from an XMLTV doc. */
export function extractChannelProgrammes(xml: string, channelId: string): Programme[] {
  const out: Programme[] = [];
  const OPEN = "<programme";
  const CLOSE = "</programme>";
  let from = 0;
  while (out.length < MAX_PROGRAMMES) {
    const start = xml.indexOf(OPEN, from);
    if (start < 0) break;
    const close = xml.indexOf(CLOSE, start);
    if (close < 0) break;
    const end = close + CLOSE.length;
    const block = xml.slice(start, end);
    from = end;
    if (attrValue(openingTag(block), "channel") !== channelId) continue; // not ours
    const p = parseProgrammeBlock(block, channelId);
    if (p) out.push(p);
  }
  return out;
}

// ── now / next ───────────────────────────────────────────────────────────────

function computeNowNext(
  programmes: Programme[],
  at: number,
): { now?: Programme; next?: Programme; upcoming: Programme[] } {
  const sorted = [...programmes].sort((a, b) => a.start - b.start);
  const now = sorted.find((p) => p.start <= at && at < p.stop);
  let next: Programme | undefined;
  if (now) next = sorted[sorted.indexOf(now) + 1];
  else next = sorted.find((p) => p.start > at);
  const upcoming = sorted.filter((p) => p.stop > at).slice(0, MAX_UPCOMING);
  return { now, next, upcoming };
}

/** Fraction [0,1] of `p` elapsed at `at` — drives the progress bar. */
export function progress(p: Programme, at: number = Date.now()): number {
  const span = p.stop - p.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (at - p.start) / span));
}

// ── public entry point ───────────────────────────────────────────────────────

/**
 * Load the guide for one channel — the single thing the EPG panel calls. Throws
 * an {@link EpgError} with a user-presentable message on every failure mode
 * (no source, unmatched channel, fetch error, empty guide).
 */
export async function getChannelEpg(
  playlist: Playlist,
  channel: Channel,
  opts: { at?: number; sourceOverride?: string } = {},
): Promise<ChannelEpg> {
  const at = opts.at ?? Date.now();
  const source = (opts.sourceOverride ?? playlist.epgUrl)?.trim();
  if (!source) {
    throw new EpgError("no-source", "No EPG source yet — paste an XMLTV guide URL below.");
  }
  const bridge = await getBridge();

  // Match the XMLTV <channel id> via tvg-id; fall back to the iptv-org directory
  // (loads it on demand) only when the channel carries no tvg-id.
  let channelId = channel.tvgId?.trim();
  if (!channelId) {
    channelId = await resolveTvgId(bridge, channel.name);
    if (!channelId) {
      throw new EpgError("no-id", "This channel has no tvg-id and no match in the iptv-org directory.");
    }
  }

  let xml: string;
  try {
    xml = await cachedFetchText(bridge, source, "xml", XMLTV_TTL_MS);
  } catch (e) {
    throw new EpgError("fetch-failed", e instanceof Error ? e.message : "Could not load the EPG.");
  }

  const programmes = extractChannelProgrammes(xml, channelId);
  if (!programmes.length) {
    throw new EpgError("no-programmes", "No programmes found for this channel in the guide.");
  }

  const { now, next, upcoming } = computeNowNext(programmes, at);
  const meta = await channelMeta(channelId).catch(() => undefined);
  return { channelId, now, next, upcoming, source, meta };
}
