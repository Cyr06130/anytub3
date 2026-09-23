import type { Programme } from "@/types";
import { bytesFromBase64 } from "@/lib/bytes";
import { UNTITLED_PROGRAMME } from "@/lib/epg-xmltv";
import { isHttpUrl } from "@/lib/url";

// Xtream Codes panels — the de-facto IPTV provider API. A playlist imported
// from `…/get.php?username=U&password=P` gives us the credentials; every live
// stream URL of that playlist embeds the stream id (`…/live/U/P/1001.m3u8`),
// and `player_api.php?action=get_short_epg&stream_id=…` returns that channel's
// next programmes as a few KB of JSON. Titles and descriptions are base64.

export type XtreamAccount = { base: string; username: string; password: string };

const GET_PHP = /\/get\.php$/i;

/** Recognize an Xtream playlist URL and extract the panel base + credentials. */
export function xtreamAccount(playlistUrl: string | undefined): XtreamAccount | undefined {
  if (!isHttpUrl(playlistUrl)) return undefined;
  let u: URL;
  try {
    u = new URL(playlistUrl);
  } catch {
    return undefined;
  }
  if (!GET_PHP.test(u.pathname)) return undefined;
  const username = u.searchParams.get("username");
  const password = u.searchParams.get("password");
  if (!username || !password) return undefined;
  return { base: u.origin + u.pathname.replace(GET_PHP, ""), username, password };
}

/** Numeric stream id from a live stream URL of `account`: the path segment
 *  right after `<username>/<password>`, minus its extension. */
export function xtreamStreamId(streamUrl: string, account: XtreamAccount): string | undefined {
  let u: URL;
  try {
    u = new URL(streamUrl);
  } catch {
    return undefined;
  }
  const segments = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const at = segments.findIndex((s, i) => s === account.username && segments[i + 1] === account.password);
  if (at < 0) return undefined;
  const id = segments[at + 2]?.replace(/\.[a-z0-9]+$/i, "");
  return id && /^\d+$/.test(id) ? id : undefined;
}

function panelUrl(account: XtreamAccount, script: string, params: Record<string, string>): string {
  const u = new URL(`${account.base}/${script}`);
  u.searchParams.set("username", account.username);
  u.searchParams.set("password", account.password);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export function xtreamShortEpgUrl(account: XtreamAccount, streamId: string, limit: number): string {
  return panelUrl(account, "player_api.php", { action: "get_short_epg", stream_id: streamId, limit: String(limit) });
}

/** The panel's full XMLTV guide (all streams) — a regular declared source. */
export function xtreamXmltvUrl(account: XtreamAccount): string {
  return panelUrl(account, "xmltv.php", {});
}

// ── response parsing ─────────────────────────────────────────────────────────

type Listing = {
  title?: unknown;
  description?: unknown;
  start_timestamp?: unknown;
  stop_timestamp?: unknown;
};

function epochMs(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/** Xtream base64-encodes text fields; a value that doesn't decode to valid
 *  UTF-8 is taken as already-plain text (some panels skip the encoding). */
function decodeText(v: unknown): string {
  if (typeof v !== "string") return "";
  try {
    return strictUtf8.decode(bytesFromBase64(v)).trim();
  } catch {
    return v.trim();
  }
}

/** Programmes from a `get_short_epg` response; malformed listings are skipped. */
export function parseXtreamShortEpg(json: unknown, channelId: string): Programme[] {
  const listings = (json as { epg_listings?: unknown } | null)?.epg_listings;
  if (!Array.isArray(listings)) return [];
  const out: Programme[] = [];
  for (const item of listings) {
    if (!item || typeof item !== "object") continue;
    const l = item as Listing;
    const start = epochMs(l.start_timestamp);
    const stop = epochMs(l.stop_timestamp);
    if (start == null || stop == null || stop <= start) continue;
    out.push({
      channelId,
      start,
      stop,
      title: decodeText(l.title) || UNTITLED_PROGRAMME,
      desc: decodeText(l.description) || undefined,
    });
  }
  return out;
}
