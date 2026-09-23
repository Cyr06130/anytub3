import { toastError, toastInfo, toastSuccess } from "@/lib/toast";
import type { Playlist, SharePointer } from "@/types";
import { loadPlaylist, playlistEpgFields, storePlaylist } from "@/lib/bulletin";
import { KEY_CTX } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import { symKey } from "@/lib/keys";
import { decodeShareCode, encodeShareCode, sharePlaylist } from "@/lib/share";
import { getState, setState } from "./app-state";
import { findPlaylist, persistLibrary } from "./playlists";

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
      description: getState().inHost ? "Forward it to a contact from your chat." : pl.title,
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
  return getState().playlists.some((p) => p.cid === sourceCid || p.sourceCid === sourceCid);
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

export async function importSharedPointer(ptr: SharePointer): Promise<boolean> {
  if (alreadyImported(ptr.playlistCid)) return true; // already have it
  try {
    // Decrypt with the sharer's key (carried by the pointer)…
    const body = await loadPlaylist(ptr.playlistCid, Uint8Array.from(ptr.key));
    const playlist: Playlist = {
      id: crypto.randomUUID(),
      title: ptr.title || body.title,
      entries: body.entries,
      sourceCid: ptr.playlistCid,
      ...playlistEpgFields(body),
      addedAt: Date.now(),
    };
    // …then re-store it under OUR OWN content key. The shared blob is encrypted
    // with the sharer's key, which we can't re-derive on a cold restore — only
    // this pointer carried it. Re-encrypting makes it a first-class owned
    // playlist that `loadOwnPlaylist` can decrypt later (fixes "lost on reload,
    // needs Edit to persist").
    const { cid } = await storePlaylist(playlist);
    setState({ playlists: [...getState().playlists, { ...playlist, cid }] });
    await persistLibrary();
    toastSuccess({ title: "Playlist received", description: playlist.title });
    return true;
  } catch (e) {
    toastError({ title: "Receive failed", description: errorMessage(e) });
    return false;
  }
}
