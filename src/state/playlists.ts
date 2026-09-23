import { toastError, toastSuccess, toastUndo } from "@/lib/toast";
import type { Channel, EpgBinding, Playlist, PlaylistEpg } from "@/types";
import { getBridge } from "@/lib/bridge";
import { buildLibraryIndex, storeLibraryIndex, storePlaylist } from "@/lib/bulletin";
import { withEpgBinding, withEpgSource } from "@/lib/epg-playlist";
import { errorMessage } from "@/lib/errors";
import { deriveTitle, parseM3U, parseM3UHeader } from "@/lib/m3u";
import { publishLibraryHead, publishNowPlaying, startNpHeartbeat, stopNpHeartbeat } from "@/lib/sync";
import { isHttpUrl } from "@/lib/url";
import { getState, setState } from "./app-state";
import { pruneHistory, rememberForBack, resetScreen } from "./navigation";

// ── Playlist lookup ──────────────────────────────────────────────────────────

export function findPlaylist(id: string): Playlist | undefined {
  return getState().playlists.find((p) => p.id === id);
}

export function findByCid(cid: string): Playlist | undefined {
  return getState().playlists.find((p) => p.cid === cid);
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function persistLibrary(): Promise<void> {
  // Always publish (even when empty) so deletions propagate to other hosts.
  // Build inside the try too: a degraded library-head must never bubble up and
  // abort the caller (e.g. an import that already updated the UI) — but it
  // must be VISIBLE: swallowing it silently makes "Playlist saved" a lie the
  // user only discovers when nothing reloads on the next launch.
  try {
    const index = buildLibraryIndex(getState().playlists);
    const indexCid = await storeLibraryIndex(index);
    await publishLibraryHead(indexCid);
  } catch (e) {
    console.warn("[AnyTub3] persistLibrary:", e);
    toastError({
      title: "Sync not saved",
      description: "The library may not reload on restart or on your other devices.",
    });
  }
}

function replacePlaylist(updated: Playlist): void {
  setState({ playlists: getState().playlists.map((p) => (p.id === updated.id ? updated : p)) });
}

/** Store the body on Bulletin, adopt the new CID in state, republish the
 *  library index. The one save path shared by add / edit / EPG-attach. */
async function saveAndPublish(playlist: Playlist): Promise<string> {
  const { cid } = await storePlaylist(playlist);
  replacePlaylist({ ...playlist, cid });
  await persistLibrary();
  return cid;
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type AddPlaylistOptions = {
  /** XMLTV guide URLs advertised by the m3u header (`url-tvg`). */
  epgUrls?: string[];
  /** Where the m3u was fetched from — lets the guide resolver derive provider APIs. */
  sourceUrl?: string;
};

export async function addPlaylist(title: string, entries: Channel[], opts: AddPlaylistOptions = {}): Promise<void> {
  if (!entries.length) {
    toastError({ title: "Empty playlist", description: "No valid channel found." });
    return;
  }
  const playlist: Playlist = {
    id: crypto.randomUUID(),
    title,
    entries,
    ...(isHttpUrl(opts.sourceUrl) ? { sourceUrl: opts.sourceUrl } : {}),
    ...(opts.epgUrls?.length ? { epg: { sources: opts.epgUrls } } : {}),
    addedAt: Date.now(),
  };
  setState({ playlists: [...getState().playlists, playlist] });
  try {
    const cid = await saveAndPublish(playlist);
    toastSuccess({ title: "Playlist saved", description: `${entries.length} channels · CID ${cid.slice(0, 12)}…` });
  } catch (e) {
    toastError({ title: "Save failed", description: errorMessage(e) });
  }
}

export async function addPlaylistFromUrl(url: string): Promise<Channel[]> {
  const trimmed = url.trim();
  // Enforce the scheme here too, not only in the UI — never fetch()
  // javascript:/file:/data: or other non-http(s) URLs (audit #2).
  if (!isHttpUrl(trimmed)) {
    throw new Error("Only http(s) playlist URLs are supported.");
  }
  // Through the bridge like every other external fetch (host policy, e2e fixtures).
  const text = await (await getBridge()).httpGet(trimmed);
  const entries = parseM3U(text);
  // Pick up the provider's EPG guide(s) (url-tvg) advertised in the m3u header,
  // and remember the origin: an Xtream panel URL unlocks its per-channel EPG.
  await addPlaylist(deriveTitle(url, entries.length), entries, { ...parseM3UHeader(text), sourceUrl: trimmed });
  return entries;
}

export async function tune(playlistId: string, channel: Channel): Promise<void> {
  const pl = findPlaylist(playlistId);
  // Zapping must not grow the back stack: replace in place when already on the
  // player, push only when coming from elsewhere (library, guide).
  if (getState().screen.name !== "player") rememberForBack();
  setState({ screen: { name: "player", playlistId, channelId: channel.id }, nowPlayingChannelId: channel.id });
  if (!pl?.cid) return; // not persisted yet — still play locally, just can't hand off
  // Continuity rides ONLY the now-playing statement + per-device cache: tuning
  // must never write to Bulletin. The library index is immutable content — a
  // per-zap rewrite would mint a new blob AND surface the host's "submit
  // preimage" authorization on every channel change.
  try {
    const np = await publishNowPlaying({ playlistCid: pl.cid, channelId: channel.id });
    setState({ nowPlayingTs: np.timestamp });
    // Resolve the playlist at tick time: editing it while playing re-stores the
    // body under a NEW CID (Bulletin is immutable), and a heartbeat stuck on
    // the tune-time CID would break handoff/resume on every other host.
    startNpHeartbeat(() => {
      const current = findPlaylist(playlistId);
      return current?.cid ? { playlistCid: current.cid, channelId: channel.id } : null;
    });
  } catch (e) {
    console.warn("[AnyTub3] tune publish:", e);
  }
}

/** Forced return: the screen we were on no longer makes sense (its channel or
 *  playlist is gone), so stop the heartbeat and teleport to the library. */
function exitPlayerToLibrary(): void {
  stopNpHeartbeat();
  setState({ nowPlayingChannelId: null });
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
  replacePlaylist(updated);

  // If the channel we're watching was removed, return to the library.
  const s = getState().screen;
  if (s.name === "player" && s.playlistId === id && !updated.entries.some((c) => c.id === s.channelId)) {
    exitPlayerToLibrary();
  }

  try {
    await saveAndPublish(updated);
    toastSuccess({ title: "Playlist updated", description: updated.title });
  } catch (e) {
    toastError({ title: "Update failed", description: errorMessage(e) });
  }
}

/**
 * Save a playlist's guide configuration. Bulletin is immutable, so this
 * re-stores the body under a new CID and republishes the library index — the
 * configuration then persists and syncs across hosts. Quiet (no toast): it's a
 * background refinement triggered from the guide panel.
 */
async function savePlaylistEpg(id: string, epg: PlaylistEpg): Promise<void> {
  const pl = findPlaylist(id);
  if (!pl) return;
  const updated: Playlist = { ...pl, epg };
  replacePlaylist(updated);
  try {
    await saveAndPublish(updated);
  } catch (e) {
    console.warn("[AnyTub3] savePlaylistEpg:", e);
  }
}

/** Add an XMLTV guide URL (pasted by the user) as the playlist's first source. */
export async function addPlaylistEpgSource(id: string, url: string): Promise<void> {
  const pl = findPlaylist(id);
  if (!pl || !isHttpUrl(url)) return;
  await savePlaylistEpg(id, withEpgSource(pl.epg, url));
}

/** Record the guide channel the user picked for one playlist entry. */
export async function bindPlaylistEpgChannel(id: string, channelId: string, binding: EpgBinding): Promise<void> {
  const pl = findPlaylist(id);
  if (!pl) return;
  await savePlaylistEpg(id, withEpgBinding(pl.epg, channelId, binding));
}

export async function deletePlaylist(id: string): Promise<void> {
  const pl = findPlaylist(id);
  if (!pl) return;
  const s = getState().screen;
  if (s.name === "player" && s.playlistId === id) {
    exitPlayerToLibrary();
  } else if (s.name !== "library" && "playlistId" in s && s.playlistId === id) {
    // On a sub-screen (edit/share/epg) of the deleted playlist.
    resetScreen({ name: "library" });
  } else {
    // Back must never land on a dead playlist's screen.
    pruneHistory((sc) => !("playlistId" in sc && sc.playlistId === id));
  }
  setState({ playlists: getState().playlists.filter((p) => p.id !== id) });
  await persistLibrary();
  // Act first, offer Undo — never a confirmation dialog. The body blob is
  // immutable on Bulletin, so restoring is just re-indexing the same CID.
  toastUndo({ title: "Playlist deleted", description: pl.title, onUndo: () => void restorePlaylist(pl) });
}

async function restorePlaylist(pl: Playlist): Promise<void> {
  setState({ playlists: [...getState().playlists, pl] });
  await persistLibrary();
}
