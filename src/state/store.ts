import { useSyncExternalStore } from "react";
import { toastInfo, toastSuccess, toastError } from "@novasamatech/tr-ui";
import type { Channel, Playlist, SharePointer } from "@/types";
import { getBridge } from "@/lib/bridge";
import { currentUserId, preallocate } from "@/lib/host";
import { symKey } from "@/lib/keys";
import {
  buildLibraryIndex,
  loadOwnPlaylist,
  loadPlaylist,
  storeLibraryIndex,
  storePlaylist,
} from "@/lib/bulletin";
import { KEY_CTX } from "@/lib/config";
import {
  cacheLibraryHead,
  initSync,
  onLibraryHeadChange,
  onNowPlayingChange,
  publishLibraryHead,
  publishNowPlaying,
  readCachedLibraryHead,
  readCachedNowPlaying,
  readLibraryHead,
  readNowPlaying,
  startLibHeartbeat,
  startNpHeartbeat,
  stopNpHeartbeat,
} from "@/lib/sync";
import {
  decodeShareCode,
  encodeShareCode,
  listenShares,
  sharePlaylist,
  simulateIncomingShare,
} from "@/lib/share";
import { loadLibraryIndex } from "@/lib/bulletin";
import { parseM3U } from "@/lib/m3u";
import { SAMPLE_M3U, SAMPLE_EPG_URL, buildSampleXmltv } from "@/lib/sample";

// ── State shape ──────────────────────────────────────────────────────────────

export type Screen =
  | { name: "library" }
  | { name: "player"; playlistId: string; channelId: string }
  | { name: "add" }
  | { name: "edit"; playlistId: string }
  | { name: "share"; playlistId: string }
  | { name: "epg"; playlistId: string; channelId: string };

export type AppState = {
  ready: boolean;
  inHost: boolean;
  userId: string | null;
  loading: boolean;
  playlists: Playlist[];
  screen: Screen;
  /** Channel currently playing (for the "Live" badge), null if none. */
  nowPlayingChannelId: string | null;
  /** Timestamp of the now-playing state we currently hold (for LWW handoff). */
  nowPlayingTs: number;
  error: string | null;
};

const initial: AppState = {
  ready: false,
  inHost: false,
  userId: null,
  loading: true,
  playlists: [],
  screen: { name: "library" },
  nowPlayingChannelId: null,
  nowPlayingTs: 0,
  error: null,
};

let state: AppState = initial;
const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function getState(): AppState {
  return state;
}
function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ── Navigation ───────────────────────────────────────────────────────────────
// Screens form a stack so the TV Back key (and the UI back buttons) can retrace
// the user's path. `screen` stays in AppState (single render source); the stack
// only remembers where "back" leads. Teleports (cross-host resume/handoff,
// forced returns on delete/edit) clear it — a context switch has no "back".

let navStack: Screen[] = [];

export function navigate(screen: Screen): void {
  navStack.push(state.screen);
  setState({ screen });
}

/**
 * Go back one screen. Returns false when already at the library root — the
 * caller then leaves the key to the platform (webOS exits the app).
 */
export function goBack(): boolean {
  if (state.screen.name === "player") stopNpHeartbeat();
  const prev = navStack.pop();
  if (prev) {
    setState({ screen: prev });
    return true;
  }
  if (state.screen.name === "library") return false;
  setState({ screen: { name: "library" } }); // defensive: screen without history
  return true;
}

function resetScreen(screen: Screen, stack: Screen[] = []): void {
  navStack = stack;
  setState({ screen });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findPlaylist(id: string): Playlist | undefined {
  return state.playlists.find((p) => p.id === id);
}

function findByCid(cid: string): Playlist | undefined {
  return state.playlists.find((p) => p.cid === cid);
}

async function persistLibrary(lastPlayed?: { playlistCid: string; channelId: string }): Promise<void> {
  // Always publish (even when empty) so deletions propagate to other hosts.
  // Build inside the try too: a degraded library-head must never bubble up and
  // abort the caller (e.g. an import that already updated the UI).
  try {
    const index = buildLibraryIndex(state.playlists, lastPlayed);
    const indexCid = await storeLibraryIndex(index);
    await publishLibraryHead(indexCid);
  } catch (e) {
    console.warn("[AnyTub3] persistLibrary:", e);
  }
}

// ── Bootstrap + resume algorithm (design §8) ─────────────────────────────────

let booted = false;
export async function bootstrap(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    const bridge = await getBridge();
    setState({ inHost: bridge.inHost });
    await initSync();

    const userId = await currentUserId();
    setState({ userId });

    // Allowances: request once and remember the grant, so the host doesn't
    // re-prompt on every launch. `requestResourceAllocation` always shows the
    // dialog when called, but it's optional — the host provisions the allowance
    // implicitly on the first write anyway — so skipping it once granted never
    // blocks saving. Persisted per-account in the webview's local cache.
    if (bridge.inHost) {
      const grantedKey = `allowances.granted.${userId ?? "anon"}`;
      if (bridge.localGet(grantedKey) !== "1") {
        if (await preallocate()) {
          bridge.localSet(grantedKey, "1");
          toastSuccess({ title: "Permissions granted", description: "Bulletin + Statement Store" });
        } else {
          toastInfo({
            title: "Permissions denied",
            description: "Saving and continuity are limited without these permissions.",
          });
        }
      }
    }

    // Off-host: expose a few hooks so the share/receive path can be demoed and
    // e2e-tested without a second user or a real host.
    if (!bridge.inHost && typeof window !== "undefined") {
      const { setHttpFixture } = await import("@/lib/bridge/mock");
      // Demo guide for the sample playlist, anchored on "now" so there's always
      // a current programme. The mock bridge serves it for SAMPLE_EPG_URL — no
      // network in demo mode.
      setHttpFixture(SAMPLE_EPG_URL, buildSampleXmltv());
      (window as unknown as { __anytub3?: unknown }).__anytub3 = {
        getState,
        simulateReceiveSample,
        simulateShareCode,
        simulateMaliciousShareCode,
        republishHead,
        setHttpFixture, // e2e: seed deterministic EPG / directory responses
      };
    }

    // 1. Cold resume: restore playlists from the durable library index.
    await restoreLibrary();

    // 2. Live/optimistic resume: pick the freshest now-playing (channel vs cache).
    resumeNowPlaying();

    // 3. Keep in sync with other hosts + incoming shares.
    onNowPlayingChange(handleRemoteNowPlaying);
    onLibraryHeadChange(async (head) => {
      // Receiver-side LWW: ignore a head that isn't strictly newer (or is the one
      // we already hold), so a lagging host's heartbeat can't roll us back.
      const current = readCachedLibraryHead();
      if (current && (head.indexCid === current.indexCid || head.ts < current.ts)) return;
      try {
        const index = await loadLibraryIndex(head.indexCid);
        await mergeIndex(index);
        // Adopt this head as ours so our OWN heartbeat republishes the latest one
        // — not the stale cached value. This is the core cross-host desync fix:
        // without it, every host keeps broadcasting its last local index and they
        // overwrite each other forever.
        cacheLibraryHead(head);
      } catch (e) {
        console.warn("[AnyTub3] applyRemoteHead:", e);
      }
    });
    void listenShares(importSharedPointer);

    // 4. Heartbeat the library head while we're alive.
    startLibHeartbeat(() => {
      const cached = readCachedLibraryHead();
      return cached?.indexCid ?? null;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[AnyTub3] bootstrap failed:", e);
    setState({ error: msg });
    toastError({ title: "Initialization error", description: msg });
  } finally {
    setState({ ready: true, loading: false });
  }
}

async function restoreLibrary(): Promise<void> {
  const head = pickFreshest(readLibraryHead(), readCachedLibraryHead());
  if (!head) return;
  try {
    const index = await loadLibraryIndex(head.indexCid);
    await mergeIndex(index);
    // Adopt the freshest head (the channel may be ahead of our cache) so the
    // heartbeat republishes it rather than a stale local value.
    cacheLibraryHead(head);
  } catch (e) {
    console.warn("[AnyTub3] restoreLibrary:", e);
  }
}

async function mergeIndex(index: {
  playlists: Array<{ id: string; cid: string; title: string; sourceCid?: string }>;
}): Promise<void> {
  // Reconcile to the index: keep local-unpersisted playlists + those still in
  // the index, drop ones removed elsewhere, and load any we don't have yet.
  const indexCids = new Set(index.playlists.map((m) => m.cid));
  const kept = state.playlists.filter((p) => !p.cid || indexCids.has(p.cid));
  const haveCids = new Set(kept.map((p) => p.cid));

  const restored: Playlist[] = [];
  for (const meta of index.playlists) {
    if (haveCids.has(meta.cid)) continue;
    try {
      const body = await loadOwnPlaylist(meta.id, meta.cid);
      restored.push({
        id: body.id,
        title: body.title || meta.title,
        entries: body.entries,
        cid: meta.cid,
        sourceCid: meta.sourceCid,
        ...(body.epgUrl ? { epgUrl: body.epgUrl } : {}),
        addedAt: Date.now(),
      });
    } catch (e) {
      console.warn("[AnyTub3] restore playlist:", meta.cid, e);
    }
  }
  if (restored.length || kept.length !== state.playlists.length) {
    setState({ playlists: [...kept, ...restored] });
  }
}

function pickFreshest<T extends { ts?: number; timestamp?: number }>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  const ta = a.ts ?? a.timestamp ?? 0;
  const tb = b.ts ?? b.timestamp ?? 0;
  return ta >= tb ? a : b;
}

function resumeNowPlaying(): void {
  const np = pickFreshest(readNowPlaying(), readCachedNowPlaying());
  if (!np) return;
  const pl = findByCid(np.playlistCid);
  if (!pl) return; // playlist not (yet) restored
  setState({ nowPlayingChannelId: np.channelId, nowPlayingTs: np.timestamp });
  // Optimistic: jump straight to the player on the last channel. Seed the stack
  // with the library so Back from a cold-resumed player lands somewhere sane.
  resetScreen({ name: "player", playlistId: pl.id, channelId: np.channelId }, [{ name: "library" }]);
}

function handleRemoteNowPlaying(np: SharePointerlessNowPlaying): void {
  if (np.timestamp <= state.nowPlayingTs) return; // not newer → ignore
  const pl = findByCid(np.playlistCid);
  if (!pl) return;
  if (np.channelId === state.nowPlayingChannelId) {
    setState({ nowPlayingTs: np.timestamp });
    return;
  }
  setState({ nowPlayingChannelId: np.channelId, nowPlayingTs: np.timestamp });
  // A handoff is a context switch: clobber whatever sub-screen was open.
  resetScreen({ name: "player", playlistId: pl.id, channelId: np.channelId }, [{ name: "library" }]);
  const ch = pl.entries.find((c) => c.id === np.channelId);
  toastInfo({ title: "Resumed from another device", description: ch?.name ?? pl.title });
}

type SharePointerlessNowPlaying = { playlistCid: string; channelId: string; timestamp: number };

// ── Actions ──────────────────────────────────────────────────────────────────

export async function addPlaylist(
  title: string,
  entries: Channel[],
  opts?: { epgUrl?: string },
): Promise<void> {
  if (!entries.length) {
    toastError({ title: "Empty playlist", description: "No valid channel found." });
    return;
  }
  const playlist: Playlist = {
    id: crypto.randomUUID(),
    title,
    entries,
    ...(opts?.epgUrl ? { epgUrl: opts.epgUrl } : {}),
    addedAt: Date.now(),
  };
  setState({ playlists: [...state.playlists, playlist] });
  try {
    const { cid } = await storePlaylist(playlist);
    const withCid = { ...playlist, cid };
    setState({ playlists: state.playlists.map((p) => (p.id === playlist.id ? withCid : p)) });
    await persistLibrary();
    toastSuccess({ title: "Playlist saved", description: `${entries.length} channels · CID ${cid.slice(0, 12)}…` });
  } catch (e) {
    toastError({ title: "Save failed", description: e instanceof Error ? e.message : String(e) });
  }
}

export async function addPlaylistFromUrl(url: string): Promise<Channel[]> {
  const trimmed = url.trim();
  // Enforce the scheme here too, not only in the UI — never fetch()
  // javascript:/file:/data: or other non-http(s) URLs (audit #2).
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Only http(s) playlist URLs are supported.");
  }
  const res = await fetch(trimmed);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { parseM3U, parseM3UHeader, deriveTitle } = await import("@/lib/m3u");
  const text = await res.text();
  const entries = parseM3U(text);
  // Pick up the provider's EPG guide (url-tvg) advertised in the m3u header.
  const { epgUrl } = parseM3UHeader(text);
  await addPlaylist(deriveTitle(url, entries.length), entries, { epgUrl });
  return entries;
}

export async function tune(playlistId: string, channel: Channel): Promise<void> {
  const pl = findPlaylist(playlistId);
  // Zapping must not grow the back stack: replace in place when already on the
  // player, push only when coming from elsewhere (library, guide).
  if (state.screen.name !== "player") navStack.push(state.screen);
  setState({ screen: { name: "player", playlistId, channelId: channel.id }, nowPlayingChannelId: channel.id });
  if (!pl?.cid) return; // not persisted yet — still play locally, just can't hand off
  try {
    const np = await publishNowPlaying({ playlistCid: pl.cid, channelId: channel.id });
    setState({ nowPlayingTs: np.timestamp });
    startNpHeartbeat(() => (pl.cid ? { playlistCid: pl.cid, channelId: channel.id } : null));
    await persistLibrary({ playlistCid: pl.cid, channelId: channel.id });
  } catch (e) {
    console.warn("[AnyTub3] tune publish:", e);
  }
}

export function goLibrary(): void {
  stopNpHeartbeat();
  resetScreen({ name: "library" });
}

/**
 * Edit a playlist (rename and/or change its channels). Bulletin is immutable, so
 * saving re-stores the body → a NEW CID, then republishes the library index.
 */
export async function updatePlaylist(
  id: string,
  patch: { title?: string; entries?: Channel[] },
): Promise<void> {
  const pl = findPlaylist(id);
  if (!pl) return;
  const updated: Playlist = {
    ...pl,
    title: patch.title?.trim() || pl.title,
    entries: patch.entries ?? pl.entries,
  };
  setState({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) });

  // If the channel we're watching was removed, return to the library.
  const s = state.screen;
  if (s.name === "player" && s.playlistId === id && !updated.entries.some((c) => c.id === s.channelId)) {
    stopNpHeartbeat();
    setState({ nowPlayingChannelId: null });
    resetScreen({ name: "library" });
  }

  try {
    const { cid } = await storePlaylist(updated);
    setState({ playlists: state.playlists.map((p) => (p.id === id ? { ...updated, cid } : p)) });
    await persistLibrary();
    toastSuccess({ title: "Playlist updated", description: updated.title });
  } catch (e) {
    toastError({ title: "Update failed", description: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Attach (or change) the XMLTV EPG source of a playlist. Bulletin is immutable,
 * so this re-stores the body under a new CID and republishes the library index —
 * the EPG source then persists and syncs across hosts. Quiet (no toast): it's a
 * background refinement triggered from the guide panel.
 */
export async function setPlaylistEpgUrl(id: string, epgUrl: string): Promise<void> {
  const pl = findPlaylist(id);
  if (!pl || !/^https?:\/\//i.test(epgUrl)) return;
  const updated: Playlist = { ...pl, epgUrl };
  setState({ playlists: state.playlists.map((p) => (p.id === id ? updated : p)) });
  try {
    const { cid } = await storePlaylist(updated);
    setState({ playlists: state.playlists.map((p) => (p.id === id ? { ...updated, cid } : p)) });
    await persistLibrary();
  } catch (e) {
    console.warn("[AnyTub3] setPlaylistEpgUrl:", e);
  }
}

export async function deletePlaylist(id: string): Promise<void> {
  const pl = findPlaylist(id);
  if (!pl) return;
  const s = state.screen;
  if (s.name === "player" && s.playlistId === id) {
    stopNpHeartbeat();
    setState({ nowPlayingChannelId: null });
    resetScreen({ name: "library" });
  } else if (s.name !== "library" && "playlistId" in s && s.playlistId === id) {
    // On a sub-screen (edit/share/epg) of the deleted playlist.
    resetScreen({ name: "library" });
  } else {
    // Back must never land on a dead playlist's screen.
    navStack = navStack.filter((sc) => !("playlistId" in sc && sc.playlistId === id));
  }
  setState({ playlists: state.playlists.filter((p) => p.id !== id) });
  await persistLibrary();
  toastSuccess({ title: "Playlist deleted", description: pl.title });
}

/** Build a copyable share code for a saved playlist (CID + content key + title). */
export async function buildShareCode(playlistId: string): Promise<string | null> {
  const pl = findPlaylist(playlistId);
  if (!pl?.cid) return null;
  const key = await symKey(KEY_CTX.playlist(pl.id));
  return encodeShareCode({ playlistCid: pl.cid, key, title: pl.title });
}

/**
 * Best-effort delivery through the host chat. The chat-product surface isn't
 * implemented on every host build (registerRoom/sendMessage may return "Not
 * implemented"), so failure here is not fatal — the copyable code is the
 * dependable path. Returns true if the chat post went through.
 */
export async function shareCurrentPlaylist(playlistId: string): Promise<boolean> {
  const pl = findPlaylist(playlistId);
  if (!pl?.cid) {
    toastError({ title: "Cannot share", description: "Playlist not saved yet." });
    return false;
  }
  try {
    const key = await symKey(KEY_CTX.playlist(pl.id));
    await sharePlaylist({ playlistCid: pl.cid, key, title: pl.title });
    toastSuccess({
      title: "Sent to chat",
      description: state.inHost ? "Forward it to a contact from your chat." : pl.title,
    });
    return true;
  } catch (e) {
    console.warn("[AnyTub3] chat share unavailable:", e);
    toastInfo({
      title: "Chat unavailable on this host",
      description: "Copy the share code instead.",
    });
    return false;
  }
}

/** Have we already imported the playlist behind this (source) CID? Imported
 *  playlists are re-encrypted under our key, so their own `cid` differs — match
 *  on `sourceCid` too, and persist that so the check survives a restore. */
function alreadyImported(sourceCid: string): boolean {
  return state.playlists.some((p) => p.cid === sourceCid || p.sourceCid === sourceCid);
}

/** Import a playlist from a pasted share code. Returns true on success. */
export async function importShareCode(code: string): Promise<boolean> {
  const ptr = decodeShareCode(code);
  if (!ptr) {
    toastError({ title: "Invalid code", description: "That doesn't look like an AnyTub3 share code." });
    return false;
  }
  if (alreadyImported(ptr.playlistCid)) {
    toastInfo({ title: "Already in your library", description: ptr.title });
    return true;
  }
  return importSharedPointer(ptr);
}

/**
 * Dev/demo: persist a fresh playlist to Bulletin (not added to state), then
 * simulate receiving a share of it — exercising the full seal → deliver →
 * decrypt → import path end to end. Available on `window.__anytub3` off-host.
 */
export async function simulateReceiveSample(): Promise<void> {
  const entries = parseM3U(SAMPLE_M3U).slice(0, 2);
  const draft: Playlist = {
    id: crypto.randomUUID(),
    title: "Received playlist (demo)",
    entries,
    addedAt: Date.now(),
  };
  const { cid, key } = await storePlaylist(draft);
  await simulateIncomingShare({ playlistCid: cid, key, title: draft.title });
}

/**
 * Dev/demo: persist a fresh playlist (not added to state) and return a share
 * code for it — so the paste → decode → import path can be exercised without a
 * second user. Available on `window.__anytub3` off-host.
 */
export async function simulateShareCode(title = "Code-shared playlist (demo)"): Promise<string> {
  const entries = parseM3U(SAMPLE_M3U).slice(0, 2);
  const draft: Playlist = {
    id: crypto.randomUUID(),
    title,
    entries,
    addedAt: Date.now(),
  };
  const { cid, key } = await storePlaylist(draft);
  return encodeShareCode({ playlistCid: cid, key, title: draft.title });
}

/**
 * Dev/demo: simulate one library-head heartbeat tick — republish the locally
 * cached head, exactly as startLibHeartbeat does on its timer. Lets tests prove
 * a lagging host's heartbeat no longer rolls back the others (cross-host desync).
 */
export async function republishHead(): Promise<void> {
  const cached = readCachedLibraryHead();
  if (cached) await publishLibraryHead(cached.indexCid);
}

/**
 * Dev/demo: persist a playlist body mixing safe + malicious entries (bypassing
 * parseM3U, as a hostile sharer would) and return its code. Used to prove the
 * import path re-sanitizes (audit #1): the unsafe entries must be dropped.
 */
export async function simulateMaliciousShareCode(): Promise<string> {
  const draft: Playlist = {
    id: crypto.randomUUID(),
    title: "Malicious (demo)",
    entries: [
      { id: "safe-1", name: "Safe channel", url: "https://example.com/safe.m3u8" },
      { id: "evil-js", name: "Evil JS", url: "javascript:alert(document.cookie)" },
      { id: "evil-file", name: "Evil file", url: "file:///etc/passwd" },
      { id: "evil-logo", name: "Evil logo", url: "https://example.com/ok.m3u8", logo: "javascript:alert(1)" },
    ],
    addedAt: Date.now(),
  };
  const { cid, key } = await storePlaylist(draft);
  return encodeShareCode({ playlistCid: cid, key, title: draft.title });
}

async function importSharedPointer(ptr: SharePointer): Promise<boolean> {
  if (alreadyImported(ptr.playlistCid)) return true; // already have it
  try {
    // Decrypt with the sharer's key (carried by the pointer)…
    const body = await loadPlaylist(ptr.playlistCid, Uint8Array.from(ptr.key));
    const playlist: Playlist = {
      id: crypto.randomUUID(),
      title: ptr.title || body.title,
      entries: body.entries,
      sourceCid: ptr.playlistCid,
      ...(body.epgUrl ? { epgUrl: body.epgUrl } : {}),
      addedAt: Date.now(),
    };
    // …then re-store it under OUR OWN content key. The shared blob is encrypted
    // with the sharer's key, which we can't re-derive on a cold restore — only
    // this pointer carried it. Re-encrypting makes it a first-class owned
    // playlist that `loadOwnPlaylist` can decrypt later (fixes "lost on reload,
    // needs Edit to persist").
    const { cid } = await storePlaylist(playlist);
    setState({ playlists: [...state.playlists, { ...playlist, cid }] });
    await persistLibrary();
    toastSuccess({ title: "Playlist received", description: playlist.title });
    return true;
  } catch (e) {
    toastError({ title: "Receive failed", description: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
