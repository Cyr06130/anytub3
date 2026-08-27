import type { Channel, Playlist } from "@/types";
import { storePlaylist } from "@/lib/bulletin";
import { parseM3U } from "@/lib/m3u";
import { SAMPLE_M3U } from "@/lib/sample";
import { encodeShareCode, simulateIncomingShare } from "@/lib/share";
import { publishLibraryHead, readCachedLibraryHead } from "@/lib/sync";

// Dev/demo simulation hooks, exposed on `window.__anytub3` off-host (see
// bootstrap) so the share/receive and sync paths can be demoed and e2e-tested
// without a second user or a real host. Never reachable from the UI.

function draftPlaylist(title: string, entries: Channel[]): Playlist {
  return { id: crypto.randomUUID(), title, entries, addedAt: Date.now() };
}

function sampleEntries(): Channel[] {
  return parseM3U(SAMPLE_M3U).slice(0, 2);
}

/** Persist a draft to Bulletin (not added to state) and return its share code. */
async function shareCodeFor(draft: Playlist): Promise<string> {
  const { cid, key } = await storePlaylist(draft);
  return encodeShareCode({ playlistCid: cid, key, title: draft.title });
}

/**
 * Persist a fresh playlist to Bulletin (not added to state), then simulate
 * receiving a share of it — exercising the full seal → deliver → decrypt →
 * import path end to end.
 */
export async function simulateReceiveSample(): Promise<void> {
  const draft = draftPlaylist("Received playlist (demo)", sampleEntries());
  const { cid, key } = await storePlaylist(draft);
  await simulateIncomingShare({ playlistCid: cid, key, title: draft.title });
}

/**
 * Persist a fresh playlist (not added to state) and return a share code for it
 * — so the paste → decode → import path can be exercised without a second user.
 */
export async function simulateShareCode(title = "Code-shared playlist (demo)"): Promise<string> {
  return shareCodeFor(draftPlaylist(title, sampleEntries()));
}

/**
 * Persist a playlist body mixing safe + malicious entries (bypassing parseM3U,
 * as a hostile sharer would) and return its code. Used to prove the import path
 * re-sanitizes (audit #1): the unsafe entries must be dropped.
 */
export async function simulateMaliciousShareCode(): Promise<string> {
  return shareCodeFor(
    draftPlaylist("Malicious (demo)", [
      { id: "safe-1", name: "Safe channel", url: "https://example.com/safe.m3u8" },
      { id: "evil-js", name: "Evil JS", url: "javascript:alert(document.cookie)" },
      { id: "evil-file", name: "Evil file", url: "file:///etc/passwd" },
      { id: "evil-logo", name: "Evil logo", url: "https://example.com/ok.m3u8", logo: "javascript:alert(1)" },
    ]),
  );
}

/**
 * Simulate one library-head heartbeat tick — republish the locally cached head,
 * exactly as startLibHeartbeat does on its timer. Lets tests prove a lagging
 * host's heartbeat no longer rolls back the others (cross-host desync).
 */
export async function republishHead(): Promise<void> {
  const cached = readCachedLibraryHead();
  if (cached) await publishLibraryHead(cached.indexCid);
}
