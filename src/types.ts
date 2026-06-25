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
  addedAt: number;
};

/** Serialized playlist body stored (encrypted) on Bulletin. */
export type PlaylistBody = {
  v: 1;
  id: string;
  title: string;
  entries: Channel[];
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
