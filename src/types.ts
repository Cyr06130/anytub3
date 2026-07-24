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
   * XMLTV EPG source for this playlist (the `url-tvg`/`x-tvg-url` from the m3u
   * header, or user-supplied). Fetched lazily, only when the user opens a
   * channel's guide. http(s) only. See lib/epg.ts.
   */
  epgUrl?: string;
  addedAt: number;
};

/** Serialized playlist body stored (encrypted) on Bulletin. */
export type PlaylistBody = {
  v: 1;
  id: string;
  title: string;
  entries: Channel[];
  /** Persisted EPG source so it survives a cold restore / cross-host sync. */
  epgUrl?: string;
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
  lastPlayed?: { playlistCid: string; channelId: string; positionMs?: number };
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
// Modeled on the iptv-org data model: the channel `id` (== Channel.tvgId ==
// XMLTV `<channel id>`) is the join key. iptv-org/api gives the channel
// directory + guide pointers (metadata only); the actual programmes come from an
// XMLTV feed (the playlist's `url-tvg`). All external EPG data is untrusted and
// sanitized before it reaches state (lib/epg.ts), exactly like shared playlists.

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
  channelId: string;
  /** Programme airing at the reference time, if any. */
  now?: Programme;
  /** The programme right after `now`, if any. */
  next?: Programme;
  /** `now` + upcoming programmes, sorted by start, capped. */
  upcoming: Programme[];
  /** XMLTV source the programmes were read from. */
  source: string;
  /** Optional enrichment resolved from the iptv-org channel directory. */
  meta?: { name?: string; logo?: string; categories?: string[] };
};

/** iptv-org `channels.json` entry (subset we use to resolve/enrich a channel). */
export type DirectoryChannel = {
  id: string;
  name: string;
  alt_names?: string[];
  country?: string;
  categories?: string[];
  /** Closed channels are skipped when resolving a missing tvg-id. */
  closed?: string | null;
};
