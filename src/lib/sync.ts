import { aesGcmEncryptPacked, aesGcmDecryptPacked, bytesToHex } from "@parity/product-sdk-crypto";
import { bridgeIfReady, getBridge } from "@/lib/bridge";
import { utf8 } from "@/lib/bytes";
import type { ChannelEnvelope, ChannelLike } from "@/lib/bridge";
import {
  KEY_CTX,
  TOPIC,
  NP_HEARTBEAT_MS,
  LIB_HEARTBEAT_MS,
} from "@/lib/config";
import type { LibraryHead, NowPlaying } from "@/types";

const decoder = new TextDecoder();

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
    return { timestamp, ct: Array.from(aesGcmEncryptPacked(utf8(JSON.stringify(payload)), this.key)) };
  }
  private open(e: ChannelEnvelope): T {
    return JSON.parse(decoder.decode(aesGcmDecryptPacked(new Uint8Array(e.ct), this.key))) as T;
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

/**
 * Derive channel name + key and wire both channels. Idempotent. A channel that
 * cannot be wired (e.g. the Statement Store is down — the real bridge tolerates
 * that at init) stays null and every reader/publisher already degrades on null:
 * continuity is lost for the session but Bulletin restore must still proceed.
 */
export async function initSync(): Promise<void> {
  if (ready) return;
  const bridge = await getBridge();

  try {
    const npName = `anytub3/np/${bytesToHex(await bridge.deriveEntropy(utf8(KEY_CTX.npChannel)))}`;
    const npKey = await bridge.deriveEntropy(utf8(KEY_CTX.npEnc));
    np = new SyncChannel<NowPlaying>(bridge.channel(TOPIC.nowPlaying), npKey, npName);
  } catch (e) {
    console.warn("[AnyTub3] now-playing channel unavailable:", e);
  }

  try {
    const libName = `anytub3/lib/${bytesToHex(await bridge.deriveEntropy(utf8(KEY_CTX.libChannel)))}`;
    const libKey = await bridge.deriveEntropy(utf8(KEY_CTX.libEnc));
    lib = new SyncChannel<LibraryHead>(bridge.channel(TOPIC.libraryHead), libKey, libName);
  } catch (e) {
    console.warn("[AnyTub3] library-head channel unavailable:", e);
  }

  ready = true;
}

// ── now-playing (live handoff) ───────────────────────────────────────────────

export async function publishNowPlaying(s: Omit<NowPlaying, "timestamp" | "v">): Promise<NowPlaying> {
  await initSync();
  if (!np) throw new Error("now-playing channel unavailable");
  const full: NowPlaying = { ...s, v: 1, timestamp: np.tick() };
  await np.publish(full, full.timestamp);
  cacheNowPlaying(full); // mirror locally for instant same-device resume
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

let npHb: ReturnType<typeof setInterval> | undefined;
/** Republish now-playing on a timer to refresh the TTL during playback. */
export function startNpHeartbeat(get: () => Omit<NowPlaying, "timestamp" | "v"> | null): void {
  stopNpHeartbeat();
  npHb = setInterval(() => {
    const s = get();
    if (s) publishNowPlaying(s).catch((e) => console.warn("[AnyTub3] np heartbeat:", e));
  }, NP_HEARTBEAT_MS);
}
export function stopNpHeartbeat(): void {
  if (npHb) clearInterval(npHb);
  npHb = undefined;
}

// ── library-head (durable resume pointer) ────────────────────────────────────

export async function publishLibraryHead(indexCid: string): Promise<void> {
  await initSync();
  if (!lib) throw new Error("library-head channel unavailable");
  const head: LibraryHead = { indexCid, ts: lib.tick() };
  await lib.publish(head, head.ts);
  cacheLibraryHead(head);
}

export function readLibraryHead(): LibraryHead | null {
  return lib?.read()?.value ?? null;
}

export function onLibraryHeadChange(cb: (h: LibraryHead) => void): () => void {
  if (!lib) return () => undefined;
  return lib.onChange((value) => cb(value));
}

let libHb: ReturnType<typeof setInterval> | undefined;
export function startLibHeartbeat(get: () => string | null): void {
  stopLibHeartbeat();
  libHb = setInterval(() => {
    const cid = get();
    if (cid) publishLibraryHead(cid).catch((e) => console.warn("[AnyTub3] lib heartbeat:", e));
  }, LIB_HEARTBEAT_MS);
}
export function stopLibHeartbeat(): void {
  if (libHb) clearInterval(libHb);
  libHb = undefined;
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
