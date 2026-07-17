import { aesGcmEncryptPacked, aesGcmDecryptPacked } from "@parity/product-sdk-crypto";
import { getBridge } from "@/lib/bridge";
import { symKey } from "@/lib/keys";
import { sanitizeEntries } from "@/lib/m3u";
import { KEY_CTX } from "@/lib/config";
import type { LibraryIndex, Playlist, PlaylistBody } from "@/types";

const LIBRARY_INDEX_CTX = "anytub3/library-index/v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encryptJson(obj: unknown, key: Uint8Array): Uint8Array {
  return aesGcmEncryptPacked(encoder.encode(JSON.stringify(obj)), key);
}
function decryptJson<T>(blob: Uint8Array, key: Uint8Array): T {
  return JSON.parse(decoder.decode(aesGcmDecryptPacked(blob, key))) as T;
}

/** Guard against a missing/empty Bulletin read so decrypt gets real bytes. */
function ensureBlob(blob: Uint8Array | null | undefined, cid: string): Uint8Array {
  if (!blob || blob.length === 0) {
    throw new Error(`Playlist data not found on Bulletin (${cid.slice(0, 12)}…) — it may not be available yet.`);
  }
  return blob;
}

// ── Playlists (durable, content-addressed, immutable) ────────────────────────

/**
 * Encrypt + store a playlist body on Bulletin.
 * Returns the CID and the content key (the key is what a recipient needs to
 * decrypt a shared playlist — see share.ts).
 */
export async function storePlaylist(playlist: Playlist): Promise<{ cid: string; key: Uint8Array }> {
  const key = await symKey(KEY_CTX.playlist(playlist.id));
  const body: PlaylistBody = {
    v: 1,
    id: playlist.id,
    title: playlist.title,
    entries: playlist.entries,
    // Persist the EPG source so it survives a cold restore / cross-host sync.
    ...(playlist.epgUrl && /^https?:\/\//i.test(playlist.epgUrl) ? { epgUrl: playlist.epgUrl } : {}),
  };
  const bridge = await getBridge();
  const cid = await bridge.cloudStore(encryptJson(body, key));
  return { cid, key };
}

/** Fetch + decrypt a playlist body. `key` is the content key (own or shared). */
export async function loadPlaylist(cid: string, key: Uint8Array): Promise<PlaylistBody> {
  const bridge = await getBridge();
  const blob = ensureBlob(await bridge.cloudFetch(cid), cid);
  const body = decryptJson<PlaylistBody>(blob, key);
  // A wrong key or corrupt blob can decode to something without a channel list;
  // reject it here so callers never end up with `entries: null/undefined`.
  if (!body || typeof body !== "object" || !Array.isArray(body.entries)) {
    throw new Error("Shared playlist is malformed or the key is wrong.");
  }
  // Trust boundary: a shared playlist is authored by another (untrusted) user and
  // never passed through parseM3U — re-sanitize its entries (drop non-http(s)
  // streams, strip unsafe logos) before they reach state/the player (audit #1).
  return {
    v: 1,
    id: typeof body.id === "string" ? body.id : "",
    title: typeof body.title === "string" ? body.title : "",
    entries: sanitizeEntries(body.entries),
    // EPG source is a plain http(s) URL or nothing — validate the scheme too.
    ...(typeof body.epgUrl === "string" && /^https?:\/\//i.test(body.epgUrl) ? { epgUrl: body.epgUrl } : {}),
  };
}

/** Convenience: load one of *our own* playlists (content key is derived from id). */
export async function loadOwnPlaylist(id: string, cid: string): Promise<PlaylistBody> {
  return loadPlaylist(cid, await symKey(KEY_CTX.playlist(id)));
}

// ── Library index (durable; its mutable head lives in library-head, see sync) ─

export async function storeLibraryIndex(index: LibraryIndex): Promise<string> {
  const key = await symKey(LIBRARY_INDEX_CTX);
  const bridge = await getBridge();
  return bridge.cloudStore(encryptJson(index, key));
}

export async function loadLibraryIndex(cid: string): Promise<LibraryIndex> {
  const key = await symKey(LIBRARY_INDEX_CTX);
  const bridge = await getBridge();
  const blob = ensureBlob(await bridge.cloudFetch(cid), cid);
  return decryptJson<LibraryIndex>(blob, key);
}

/** Build a library index from the in-memory playlists (only persisted ones). */
export function buildLibraryIndex(
  playlists: Playlist[],
  lastPlayed?: LibraryIndex["lastPlayed"],
): LibraryIndex {
  return {
    v: 1,
    playlists: playlists
      .filter((p) => p.cid)
      .map((p) => ({
        id: p.id,
        cid: p.cid!,
        title: p.title,
        channelCount: p.entries?.length ?? 0,
        addedAt: p.addedAt,
        ...(p.sourceCid ? { sourceCid: p.sourceCid } : {}),
      })),
    lastPlayed,
  };
}
