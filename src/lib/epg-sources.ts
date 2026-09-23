// ── EPG sources ──────────────────────────────────────────────────────────────
// The ordered list of guide sources the resolver walks when the user opens a
// channel's programme guide (lib/epg-resolve.ts). Array order = priority: the
// first source that yields programmes wins. Edit THIS file to add, remove or
// reorder sources — the resolver, the cache and the UI read it; nothing else
// hard-codes a guide host.
//
// Three kinds of source exist:
//  - "xtream"           the playlist's own provider, when it was imported from
//                       an Xtream Codes panel URL (…/get.php?username=…). The
//                       per-channel short-EPG API is tiny and matches by stream
//                       id — no guessing. Nothing to configure.
//  - "declared-xmltv"   the XMLTV guide(s) the playlist itself advertises in its
//                       #EXTM3U header (`url-tvg`), plus any URL the user pasted.
//                       Matched by tvg-id. Nothing to configure.
//  - "guide-directory"  a public XMLTV aggregator serving one file per country
//                       AND one small file per channel. We stream only the
//                       <channel> header of the country file (its channel
//                       directory), match our channel by name, then fetch that
//                       channel's programmes alone. Must send
//                       `Access-Control-Allow-Origin: *` — the app fetches from
//                       a browser/webview (checked 2026-09-23: epg.pw does;
//                       epgshare01.online, iptv-epg.org and open-epg.com don't).

export type XtreamSource = {
  kind: "xtream";
  id: string;
  /** Shown in the guide's provenance line. */
  label: string;
};

export type DeclaredXmltvSource = {
  kind: "declared-xmltv";
  id: string;
  label: string;
};

export type GuideDirectorySource = {
  kind: "guide-directory";
  id: string;
  label: string;
  /** Country XMLTV file — `{CC}` is the upper-case ISO 3166-1 alpha-2 code. */
  directoryUrl: string;
  /** Per-channel XMLTV — `{ID}` is the channel id read from the directory. */
  channelUrl: string;
  /** Countries the aggregator covers (ISO 3166-1 alpha-2). */
  countries: readonly string[];
  /** How long a downloaded channel directory stays valid on this device. */
  directoryTtlMs: number;
};

export type EpgSource = XtreamSource | DeclaredXmltvSource | GuideDirectorySource;

const WEEK_MS = 7 * 24 * 3_600_000;

export const EPG_SOURCES: readonly EpgSource[] = [
  { kind: "xtream", id: "xtream", label: "Provider guide" },
  { kind: "declared-xmltv", id: "playlist", label: "Playlist guide" },
  {
    kind: "guide-directory",
    id: "epg.pw",
    label: "epg.pw",
    directoryUrl: "https://epg.pw/xmltv/epg_{CC}.xml",
    channelUrl: "https://epg.pw/api/epg.xml?channel_id={ID}",
    // The areas epg.pw publishes as XMLTV (https://epg.pw/xmltv.html).
    countries: [
      "AU", "BR", "CA", "CN", "DE", "FR", "GB", "HK", "ID", "IN", "JP", "KR",
      "MY", "NZ", "PH", "RU", "SG", "TH", "TW", "US", "VN", "ZA",
    ],
    directoryTtlMs: WEEK_MS,
  },
];

/** iptv-org channel directory (canonical ids, alt names, countries) — used to
 *  resolve a missing tvg-id and to enrich the guide panel. Metadata only. */
export const IPTV_ORG_CHANNELS_URL = "https://iptv-org.github.io/api/channels.json";
export const IPTV_ORG_CHANNELS_TTL_MS = WEEK_MS;

/** Extracted programmes stay valid this long on the device (guides change ~daily). */
export const EPG_PROGRAMMES_TTL_MS = 6 * 3_600_000;
/** A channel that resolved to nothing is not retried before this delay (the
 *  player overlay asks for now/next on every zap). */
export const EPG_MISS_TTL_MS = 30 * 60_000;
/** Programmes requested from an Xtream panel per channel (today + tomorrow fit). */
export const EPG_XTREAM_LISTING_LIMIT = 40;
/** Hard stop when streaming a country file's <channel> header (memory bound). */
export const EPG_DIRECTORY_PREFIX_MAX_BYTES = 512 * 1024;
/** Programmes kept per channel in the device cache (the panel shows 30). */
export const EPG_CACHED_PROGRAMMES_MAX = 48;
/** Channels preloaded from one XMLTV download besides the requested one. */
export const EPG_PRELOAD_CHANNELS_MAX = 64;

export function guideDirectorySources(): GuideDirectorySource[] {
  return EPG_SOURCES.filter((s): s is GuideDirectorySource => s.kind === "guide-directory");
}

export function findEpgSource(id: string): EpgSource | undefined {
  return EPG_SOURCES.find((s) => s.id === id);
}

/** Substitute `{NAME}` placeholders, URL-encoding each value. */
export function fillUrlTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([A-Z]+)\}/g, (_, name: string) => encodeURIComponent(vars[name] ?? ""));
}
