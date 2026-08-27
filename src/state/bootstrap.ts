import { toastError, toastInfo } from "@novasamatech/tr-ui";
import type { LibraryHead, LibraryIndex, NowPlaying, Playlist } from "@/types";
import { getBridge } from "@/lib/bridge";
import { loadLibraryIndex, loadOwnPlaylist } from "@/lib/bulletin";
import { errorMessage } from "@/lib/errors";
import { currentUserId } from "@/lib/host";
import { pickFreshest } from "@/lib/lww";
import { SAMPLE_EPG_URL, buildSampleXmltv } from "@/lib/sample";
import { listenShares } from "@/lib/share";
import {
  cacheLibraryHead,
  initSync,
  onLibraryHeadChange,
  onNowPlayingChange,
  readCachedLibraryHead,
  readCachedNowPlaying,
  readLibraryHead,
  readNowPlaying,
  startLibHeartbeat,
} from "@/lib/sync";
import { getState, setState } from "./app-state";
import {
  republishHead,
  simulateMaliciousShareCode,
  simulateReceiveSample,
  simulateShareCode,
} from "./demo";
import { resetScreen } from "./navigation";
import { findByCid } from "./playlists";
import { importSharedPointer } from "./sharing";

// ── Bootstrap + resume algorithm (design §8) ─────────────────────────────────

let booted = false;
export async function bootstrap(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    const bridge = await getBridge();
    setState({ inHost: bridge.inHost });
    await initSync();

    setState({ userId: await currentUserId() });

    // Allowances are never requested here: `requestResourceAllocation` always
    // shows the host dialog, while the host provisions Bulletin + Statement
    // Store allowances implicitly on the first write (RFC-0010). Skipping the
    // explicit request keeps saving fully functional with zero prompts.

    if (!bridge.inHost) await exposeDemoHooks();

    // 1. Subscribe to library-head changes BEFORE the one-shot restore read:
    //    the host replays the store's initial state asynchronously after
    //    connect, so a replay landing between a read and a later subscription
    //    would be lost — and with it the whole library. (applyHead serializes
    //    and dedupes, so getting the same head from both paths is harmless.)
    onLibraryHeadChange(applyRemoteHead);
    void listenShares(importSharedPointer);

    // 2. Cold resume: restore playlists from the durable library index.
    await restoreLibrary();

    // 3. Live/optimistic resume: pick the freshest now-playing (channel vs
    //    cache) — then subscribe. Order matters here, unlike the library head:
    //    resume must set nowPlayingTs first so the replay of our OWN last
    //    statement hits the "not newer" guard instead of re-toasting a resume.
    resumeNowPlaying();
    onNowPlayingChange(handleRemoteNowPlaying);

    // 4. Heartbeat the library head while we're alive.
    startLibHeartbeat(() => readCachedLibraryHead()?.indexCid ?? null);
  } catch (e) {
    const msg = errorMessage(e);
    console.error("[AnyTub3] bootstrap failed:", e);
    setState({ error: msg });
    toastError({ title: "Initialization error", description: msg });
  } finally {
    setState({ ready: true, loading: false });
  }
}

/** Off-host only: hooks for the demo and the e2e suite (no second user or real
 *  host available) + a deterministic EPG fixture for the sample playlist. */
async function exposeDemoHooks(): Promise<void> {
  if (typeof window === "undefined") return;
  const { setHttpFixture, setChannelWriteFailure } = await import("@/lib/bridge/mock");
  // Demo guide for the sample playlist, anchored on "now" so there's always a
  // current programme. The mock bridge serves it for SAMPLE_EPG_URL — no
  // network in demo mode.
  setHttpFixture(SAMPLE_EPG_URL, buildSampleXmltv());
  (window as unknown as { __anytub3?: unknown }).__anytub3 = {
    getState,
    simulateReceiveSample,
    simulateShareCode,
    simulateMaliciousShareCode,
    republishHead,
    setHttpFixture, // e2e: seed deterministic EPG / directory responses
    setChannelWriteFailure, // e2e: simulate the host rejecting statement writes
  };
}

// Merges are serialized: the host's initial-state replay can deliver a head
// WHILE restoreLibrary is still merging, and two concurrent mergeIndex calls
// would each see the playlists as missing and double-load them.
let applyChain: Promise<void> = Promise.resolve();

/** Load the index behind `head`, merge it, then adopt the head as ours so our
 *  OWN heartbeat republishes the latest one — not a stale cached value (the
 *  core cross-host desync fix: without it, every host keeps broadcasting its
 *  last local index and they overwrite each other forever). */
function applyHead(head: LibraryHead, label: string): Promise<void> {
  applyChain = applyChain.then(async () => {
    try {
      const index = await loadLibraryIndex(head.indexCid);
      await mergeIndex(index);
      cacheLibraryHead(head);
    } catch (e) {
      console.warn(`[AnyTub3] ${label}:`, e);
    }
  });
  return applyChain;
}

async function applyRemoteHead(head: LibraryHead): Promise<void> {
  // Receiver-side LWW: ignore a head that isn't strictly newer (or is the one
  // we already hold), so a lagging host's heartbeat can't roll us back.
  const current = readCachedLibraryHead();
  if (current && (head.indexCid === current.indexCid || head.ts < current.ts)) return;
  await applyHead(head, "applyRemoteHead");
}

async function restoreLibrary(): Promise<void> {
  const head = pickFreshest(readLibraryHead(), readCachedLibraryHead());
  if (!head) return;
  await applyHead(head, "restoreLibrary");
}

async function mergeIndex(index: LibraryIndex): Promise<void> {
  // Reconcile to the index: keep local-unpersisted playlists + those still in
  // the index, drop ones removed elsewhere, and load any we don't have yet.
  const indexCids = new Set(index.playlists.map((m) => m.cid));
  const kept = getState().playlists.filter((p) => !p.cid || indexCids.has(p.cid));
  const haveCids = new Set(kept.map((p) => p.cid));

  // Load missing playlists concurrently (cold boot scales with library size);
  // allSettled keeps the per-item degradation, result order follows the index.
  const results = await Promise.allSettled(
    index.playlists
      .filter((meta) => !haveCids.has(meta.cid))
      .map(async (meta): Promise<Playlist> => {
        const body = await loadOwnPlaylist(meta.id, meta.cid);
        return {
          id: body.id,
          title: body.title || meta.title,
          entries: body.entries,
          cid: meta.cid,
          sourceCid: meta.sourceCid,
          ...(body.epgUrl ? { epgUrl: body.epgUrl } : {}),
          addedAt: Date.now(),
        };
      }),
  );
  const restored: Playlist[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") restored.push(r.value);
    else console.warn("[AnyTub3] restore playlist:", r.reason);
  }
  if (restored.length || kept.length !== getState().playlists.length) {
    setState({ playlists: [...kept, ...restored] });
  }
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

function handleRemoteNowPlaying(np: NowPlaying): void {
  if (np.timestamp <= getState().nowPlayingTs) return; // not newer → ignore
  const pl = findByCid(np.playlistCid);
  if (!pl) return;
  if (np.channelId === getState().nowPlayingChannelId) {
    setState({ nowPlayingTs: np.timestamp });
    return;
  }
  setState({ nowPlayingChannelId: np.channelId, nowPlayingTs: np.timestamp });
  // A handoff is a context switch: clobber whatever sub-screen was open.
  resetScreen({ name: "player", playlistId: pl.id, channelId: np.channelId }, [{ name: "library" }]);
  const ch = pl.entries.find((c) => c.id === np.channelId);
  toastInfo({ title: "Resumed from another device", description: ch?.name ?? pl.title });
}
