import { bytesToHex } from "@parity/product-sdk-crypto";
import { bridgeIfReady, getBridge } from "@/lib/bridge";
import { utf8 } from "@/lib/bytes";
import { openEnvelope, sealEnvelope } from "@/lib/envelope";
import type { ChannelEnvelope, ChannelLike } from "@/lib/bridge";
import {
  KEY_CTX,
  TOPIC,
  NP_HEARTBEAT_MS,
  LIB_HEARTBEAT_MS,
} from "@/lib/config";
import type { LibraryHead, NowPlaying } from "@/types";

// ── Generic encrypted, last-write-wins channel ───────────────────────────────
// Envelope = { timestamp (clear, LWW key), ct (AES-GCM packed payload) }.
// Channel name and key are both derived from wallet entropy → identical on every
// host, opaque to anyone without the wallet (design §8 / §10).

class SyncChannel<T> {
  // Lamport clock: timestamps are the LWW key, but wall clocks drift across
  // Desktop/Mobile/Web, so a device with a fast clock would always win. We keep
  // a logical clock ≥ every timestamp seen and emit `max(now, clock+1)`, so an
  // operation made *after* observing another host's write always supersedes it
  // — causal order survives clock skew (design §8).
  private clock = 0;

  constructor(
    private readonly ch: ChannelLike,
    private readonly key: Uint8Array,
    private readonly channelName: string,
  ) {}

  /** Next monotonic, skew-proof timestamp to stamp a write with. */
  tick(): number {
    const ts = Math.max(Date.now(), this.clock + 1);
    this.clock = ts;
    return ts;
  }
  private note(ts: number): void {
    if (ts > this.clock) this.clock = ts;
  }

  private seal(payload: T, timestamp: number): ChannelEnvelope {
    return sealEnvelope(payload, this.key, timestamp);
  }
  private open(e: ChannelEnvelope): T {
    return openEnvelope<T>(e, this.key);
  }

  async publish(payload: T, timestamp: number): Promise<void> {
    await this.ch.write(this.channelName, this.seal(payload, timestamp));
  }
  read(): { value: T; timestamp: number } | null {
    const e = this.ch.read(this.channelName);
    if (!e) return null;
    this.note(e.timestamp);
    // A corrupt/foreign persisted envelope degrades to "nothing", exactly like
    // onChange — a boot-time read must never throw past the caller.
    try {
      return { value: this.open(e), timestamp: e.timestamp };
    } catch {
      return null;
    }
  }
  onChange(cb: (value: T, timestamp: number) => void): () => void {
    return this.ch.onChange((_name, e) => {
      this.note(e.timestamp); // advance our clock past any observed write
      // Only decryption is "not for us / ignore" — an exception thrown by the
      // app callback is a real bug and must surface, not be swallowed here.
      let value: T;
      try {
        value = this.open(e);
      } catch {
        return; // undecryptable — ignore
      }
      cb(value, e.timestamp);
    });
  }
}

// ── Module state ─────────────────────────────────────────────────────────────

let np: SyncChannel<NowPlaying> | null = null;
let lib: SyncChannel<LibraryHead> | null = null;
let ready = false;

const NP_CACHE_KEY = "now-playing";
const LIB_CACHE_KEY = "library-head";

type BridgeHandle = Awaited<ReturnType<typeof getBridge>>;

/** Derive the channel name + encryption key from wallet entropy and construct
 *  the channel. Null (not a throw) when the underlying store is unavailable. */
async function wireChannel<T>(
  bridge: BridgeHandle,
  opts: { topic: string; namePrefix: string; nameCtx: string; encCtx: string; label: string },
): Promise<SyncChannel<T> | null> {
  try {
    const name = `${opts.namePrefix}${bytesToHex(await bridge.deriveEntropy(utf8(opts.nameCtx)))}`;
    const key = await bridge.deriveEntropy(utf8(opts.encCtx));
    return new SyncChannel<T>(bridge.channel(opts.topic), key, name);
  } catch (e) {
    console.warn(`[AnyTub3] ${opts.label} channel unavailable:`, e);
    return null;
  }
}

/**
 * Derive channel name + key and wire both channels. Idempotent. A channel that
 * cannot be wired (e.g. the Statement Store is down — the real bridge tolerates
 * that at init) stays null and every reader/publisher already degrades on null:
 * continuity is lost for the session but Bulletin restore must still proceed.
 */
export async function initSync(): Promise<void> {
  if (ready) return;
  const bridge = await getBridge();
  np = await wireChannel<NowPlaying>(bridge, {
    topic: TOPIC.nowPlaying,
    namePrefix: "anytub3/np/",
    nameCtx: KEY_CTX.npChannel,
    encCtx: KEY_CTX.npEnc,
    label: "now-playing",
  });
  lib = await wireChannel<LibraryHead>(bridge, {
    topic: TOPIC.libraryHead,
    namePrefix: "anytub3/lib/",
    nameCtx: KEY_CTX.libChannel,
    encCtx: KEY_CTX.libEnc,
    label: "library-head",
  });
  ready = true;
}

// ── now-playing (live handoff) ───────────────────────────────────────────────

export async function publishNowPlaying(s: Omit<NowPlaying, "timestamp" | "v">): Promise<NowPlaying> {
  await initSync();
  const full: NowPlaying = { ...s, v: 1, timestamp: np?.tick() ?? Date.now() };
  // Cache BEFORE publishing: the per-device cache is what same-device resume
  // reads on the next launch, so it must never depend on the statement landing.
  cacheNowPlaying(full);
  if (!np) throw new Error("now-playing channel unavailable");
  await np.publish(full, full.timestamp);
  return full;
}

export function readNowPlaying(): NowPlaying | null {
  return np?.read()?.value ?? null;
}

/** Subscribe to remote now-playing writes (handoff from another host). */
export function onNowPlayingChange(cb: (s: NowPlaying) => void): () => void {
  if (!np) return () => undefined;
  return np.onChange((value) => cb(value));
}

/** Periodic republish while the app is alive — refreshes the statement TTL.
 *  `start` replaces any running timer; a failed tick only warns (transient). */
class Heartbeat {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly intervalMs: number,
    private readonly label: string,
  ) {}

  start(tick: () => Promise<void> | undefined): void {
    this.stop();
    this.timer = setInterval(() => {
      void tick()?.catch((e) => console.warn(`[AnyTub3] ${this.label} heartbeat:`, e));
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

const npHeartbeat = new Heartbeat(NP_HEARTBEAT_MS, "np");
/** Republish now-playing on a timer to refresh the TTL during playback. */
export function startNpHeartbeat(get: () => Omit<NowPlaying, "timestamp" | "v"> | null): void {
  npHeartbeat.start(() => {
    const s = get();
    return s ? publishNowPlaying(s).then(() => undefined) : undefined;
  });
}
export function stopNpHeartbeat(): void {
  npHeartbeat.stop();
}

// ── library-head (durable resume pointer) ────────────────────────────────────

export async function publishLibraryHead(indexCid: string): Promise<void> {
  await initSync();
  const head: LibraryHead = { indexCid, ts: lib?.tick() ?? Date.now() };
  // Cache BEFORE publishing: cold restore on this device reads the cache, and
  // the lib heartbeat republishes from it — so a failed/unavailable statement
  // publish self-heals on the next tick instead of orphaning the library.
  cacheLibraryHead(head);
  if (!lib) throw new Error("library-head channel unavailable");
  await lib.publish(head, head.ts);
}

export function readLibraryHead(): LibraryHead | null {
  return lib?.read()?.value ?? null;
}

export function onLibraryHeadChange(cb: (h: LibraryHead) => void): () => void {
  if (!lib) return () => undefined;
  return lib.onChange((value) => cb(value));
}

const libHeartbeat = new Heartbeat(LIB_HEARTBEAT_MS, "lib");
export function startLibHeartbeat(get: () => string | null): void {
  libHeartbeat.start(() => {
    const cid = get();
    return cid ? publishLibraryHead(cid) : undefined;
  });
}
export function stopLibHeartbeat(): void {
  libHeartbeat.stop();
}

// ── Per-device cache (fast-path; not the source of truth) ─────────────────────

// Synchronous cache reads go through the bridge module's own singleton
// (bridgeIfReady) — no duplicated handle, no import-time side effect. They
// return null before the bridge resolves; both callers run after bootstrap's
// initSync, which awaits it.

export function cacheNowPlaying(s: NowPlaying): void {
  void getBridge().then((b) => b.localSet(NP_CACHE_KEY, JSON.stringify(s)));
}
export function readCachedNowPlaying(): NowPlaying | null {
  const raw = bridgeIfReady()?.localGet(NP_CACHE_KEY);
  return raw ? (JSON.parse(raw) as NowPlaying) : null;
}
export function cacheLibraryHead(h: LibraryHead): void {
  void getBridge().then((b) => b.localSet(LIB_CACHE_KEY, JSON.stringify(h)));
}
export function readCachedLibraryHead(): LibraryHead | null {
  const raw = bridgeIfReady()?.localGet(LIB_CACHE_KEY);
  return raw ? (JSON.parse(raw) as LibraryHead) : null;
}
