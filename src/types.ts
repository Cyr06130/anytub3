// Shared domain model for AnyTub3.
// Sizes vs the Statement Store 512B limit are tracked in design doc §9.

/** A single channel entry parsed from an m3u playlist. */
export type Channel = {
  /** Stable id of the entry within the playlist (used by now-playing handoff). */
  id: string;
  name: string;
  /** Stream URL — guaranteed http(s) by the m3u sanitizer. */
  url: string;
  /** Logo URL — http(s) only, else undefined (XSS hardening, design R3). */
  logo?: string;
  /** group-title from the m3u (used to group/tab channels). */
  group?: string;
  /** tvg-id, when present. */
  tvgId?: string;
  /** tvg-country (ISO 3166-1 alpha-2, upper-case), when present. */
  country?: string;
};

/** A playlist as held in app state and serialized to the Bulletin body. */
export type Playlist = {
  id: string;
  title: string;
  entries: Channel[];
  /** Bulletin CID once persisted (immutable, content-addressed). */
  cid?: string;
  /**
   * For a playlist imported from a share: the original Bulletin CID it came from.
   * Our own `cid` is a re-encryption under our key (so it survives restore); this
   * remembers the source purely to de-dupe re-imports of the same share.
   */
  sourceCid?: string;
  /**
   * http(s) URL the playlist was imported from, when known. Lets the guide
   * resolver derive the provider's own APIs (Xtream Codes). Carries the same
   * credentials as the stream URLs themselves — no new exposure.
   */
  sourceUrl?: string;
  /** Programme-guide configuration — resolved lazily, only when the user opens
   *  a channel's guide (lib/epg-resolve.ts, sources in lib/epg-sources.ts). */
  epg?: PlaylistEpg;
  addedAt: number;
};

/** Where a channel's programmes are read from: the join between a playlist
 *  entry and a channel id inside an external guide. */
export type EpgBinding = {
  /** A source id from lib/epg-sources.ts, or an XMLTV URL. */
  source: string;
  /** Channel id inside that source. */
  channelId: string;
  /** Channel name inside that source (provenance line). */
  name?: string;
};

export type PlaylistEpg = {
  /**
   * XMLTV guide URLs in priority order: the `url-tvg`/`x-tvg-url` list from
   * the m3u header, plus any URL the user pasted. http(s) only.
   */
  sources?: string[];
  /** User-confirmed guide channel per entry id. Automatic matches are NOT
   *  stored here (they live in the per-device cache and are recomputable) so a
   *  guide lookup never rewrites the Bulletin body. */
  bindings?: Record<string, EpgBinding>;
};

/** Serialized playlist body stored (encrypted) on Bulletin. */
export type PlaylistBody = {
  v: 1;
  id: string;
  title: string;
  entries: Channel[];
  /** @deprecated Bodies written before 2026-09 carry a single XMLTV URL here.
   *  Read as `epg.sources[0]`, never written again. */
  epgUrl?: string;
  sourceUrl?: string;
  epg?: PlaylistEpg;
};

/** Library index — the mutable head pointer lives in `library-head` (Statement Store). */
export type LibraryIndex = {
  v: 1;
  playlists: Array<{
    id: string;
    cid: string;
    title: string;
    channelCount: number;
    addedAt: number;
    /** Original CID, if this entry was imported from a share (de-dupe re-imports). */
    sourceCid?: string;
  }>;
  // NB: older stored indexes may carry an extra `lastPlayed` field; it was never
  // read (resume rides the now-playing statement + cache) and is ignored.
};

/** Live handoff state — published to the `now-playing` Statement Store channel. */
export type NowPlaying = {
  v: 1;
  playlistCid: string;
  channelId: string;
  /** Only meaningful for VOD/catch-up; live = live edge (design §8). */
  positionMs?: number;
  /** IN CLEAR in the envelope — drives last-write-wins. */
  timestamp: number;
};

/** Durable head pointer — published to the `library-head` Statement Store channel. */
export type LibraryHead = {
  indexCid: string;
  /** LWW key. FROZEN wire format: renaming to `timestamp` (like NowPlaying)
   *  would desync against already-deployed clients and cached heads. */
  ts: number;
};

/** Share pointer delivered through the host chat as a Custom message (design §7). */
export type SharePointer = {
  v: 1;
  playlistCid: string;
  /** Content key bytes so the recipient can decrypt the shared playlist. */
  key: number[];
  title: string;
};

// ── EPG (Electronic Program Guide) ───────────────────────────────────────────
// Programmes come from one of the configured sources (lib/epg-sources.ts): the
// provider's Xtream API, an XMLTV feed declared by the playlist (joined on
// tvg-id == `<channel id>`), or a public directory joined by channel name. All
// external EPG data is untrusted and sanitized before it reaches state
// (lib/epg-xmltv.ts), exactly like shared playlists.

/** One programme — an XMLTV `<programme>` element, sanitized. */
export type Programme = {
  /** XMLTV `channel` attribute — matches Channel.tvgId. */
  channelId: string;
  /** Epoch ms. */
  start: number;
  /** Epoch ms. */
  stop: number;
  /** Rendered by React (escaped) — never innerHTML. */
  title: string;
  desc?: string;
  category?: string;
  /** Programme icon — http(s) only, else undefined (XSS hardening). */
  icon?: string;
};

/** A single channel's guide, computed on demand for the EPG panel. */
export type ChannelEpg = {
  /** Channel id inside the source the programmes came from. */
  channelId: string;
  /** Programme airing at the reference time, if any. */
  now?: Programme;
  /** The programme right after `now`, if any. */
  next?: Programme;
  /** `now` + upcoming programmes, sorted by start, capped. */
  upcoming: Programme[];
  /** Source id (lib/epg-sources.ts) or XMLTV URL the programmes were read from. */
  source: string;
  /** Human label of that source, for the provenance line. */
  sourceLabel: string;
  /** The channel's name inside the source, when the source has one. */
  sourceChannelName?: string;
};

/** One channel of a public guide directory (lib/epg-guide-directory.ts). */
export type GuideChannel = {
  id: string;
  name: string;
};
