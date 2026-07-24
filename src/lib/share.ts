import { getBridge } from "@/lib/bridge";
import { base64UrlFromBytes, bytesFromBase64Url, utf8 } from "@/lib/bytes";
import { SHARE_MESSAGE_TYPE } from "@/lib/config";
import type { SharePointer } from "@/types";

const decoder = new TextDecoder();

/** Prefix on the copyable share code (a bearer pointer, like a magnet link). */
const SHARE_CODE_PREFIX = "anytub3:";

/** The payload shared is a tiny pointer, never the playlist itself (design §7). */
export type OutgoingPointer = { playlistCid: string; key: Uint8Array; title: string };

function toPointer(p: OutgoingPointer): SharePointer {
  return { v: 1, playlistCid: p.playlistCid, key: Array.from(p.key), title: p.title };
}

function encodePointer(p: OutgoingPointer): Uint8Array {
  return utf8(JSON.stringify(toPointer(p)));
}

// ── Share code (base64url, host-independent) ─────────────────────────────────
// The host chat surface isn't available on every host build, so a share is also
// expressible as a copyable code the user sends through any channel. It carries
// the content key in clear: whoever holds it can fetch+decrypt the playlist
// (bearer semantics — the user chooses a trusted channel to send it).

/** Encode a pointer as a copyable `anytub3:` share code. */
export function encodeShareCode(p: OutgoingPointer): string {
  return SHARE_CODE_PREFIX + base64UrlFromBytes(encodePointer(p));
}

/**
 * Parse + validate untrusted pointer bytes — the single gate for both delivery
 * paths (pasted share code, host-chat message). Null unless it's one of ours.
 */
function parsePointer(bytes: Uint8Array): SharePointer | null {
  try {
    const ptr = JSON.parse(decoder.decode(bytes)) as SharePointer;
    if (ptr?.v === 1 && ptr.playlistCid && Array.isArray(ptr.key)) return ptr;
  } catch {
    /* malformed — not one of ours */
  }
  return null;
}

/** Decode a share code (with or without the prefix); null if malformed. */
export function decodeShareCode(code: string): SharePointer | null {
  const trimmed = code.trim();
  const body = trimmed.startsWith(SHARE_CODE_PREFIX) ? trimmed.slice(SHARE_CODE_PREFIX.length) : trimmed;
  if (!body) return null;
  try {
    return parsePointer(bytesFromBase64Url(body));
  } catch {
    return null; // not base64
  }
}

/**
 * Hand a share pointer to the host chat. The product host-api exposes no contact
 * directory and no recipient encryption keys, so we don't seal the pointer or
 * pick a recipient ourselves — the host owns both. The pointer rides in a Custom
 * message; the user forwards it to a contact from the host chat, which is itself
 * end-to-end encrypted (design §7). [confirm host] this is what keeps the
 * content key in the pointer confidential on the wire.
 */
export async function sharePlaylist(p: OutgoingPointer): Promise<void> {
  const bridge = await getBridge();
  await bridge.shareViaChat(SHARE_MESSAGE_TYPE, encodePointer(p));
}

/**
 * Listen for incoming shares. Each inbound Custom message is parsed as a share
 * pointer; anything malformed (or not one of ours) is ignored. Returns an
 * unsubscribe.
 */
export async function listenShares(onPointer: (ptr: SharePointer) => void): Promise<() => void> {
  const bridge = await getBridge();
  return bridge.subscribeCustom(SHARE_MESSAGE_TYPE, (payload) => {
    const ptr = parsePointer(payload);
    if (ptr) onPointer(ptr);
  });
}

/**
 * Dev-only: dispatch a pointer through the exact same delivery path so the
 * receive → import flow can be demonstrated standalone (no second user needed).
 * Off-host the mock bridge loops messages back to local subscribers.
 */
export async function simulateIncomingShare(p: OutgoingPointer): Promise<void> {
  await sharePlaylist(p);
}
