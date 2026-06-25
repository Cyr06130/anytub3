import { aesGcmEncryptPacked, aesGcmDecryptPacked, bytesToHex } from "@parity/product-sdk-crypto";
import { getBridge } from "@/lib/bridge";
import type { ChannelEnvelope, ChannelLike } from "@/lib/bridge";
import {
  KEY_CTX,
  TOPIC,
  NP_HEARTBEAT_MS,
  LIB_HEARTBEAT_MS,
} from "@/lib/config";
import type { LibraryHead, NowPlaying } from "@/types";

const enc = (s: string) => new TextEncoder().encode(s);
const encoder = new TextEncoder();
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
    return { timestamp, ct: Array.from(aesGcmEncryptPacked(encoder.encode(JSON.stringify(payload)), this.key)) };
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
    return { value: this.open(e), timestamp: e.timestamp };
  }
  onChange(cb: (value: T, timestamp: number) => void): () => void {
    return this.ch.onChange((_name, e) => {
      this.note(e.timestamp); // advance our clock past any observed write
      try {
        cb(this.open(e), e.timestamp);
      } catch {
        /* not for us / undecryptable — ignore */
      }
    });
  }
}

// ── Module state ─────────────────────────────────────────────────────────────

let np: SyncChannel<NowPlaying> | null = null;
let lib: SyncChannel<LibraryHead> | null = null;
let ready = false;

const NP_CACHE_KEY = "now-playing";
const LIB_CACHE_KEY = "library-head";

/** Derive channel name + key and wire both channels. Idempotent. */
export async function initSync(): Promise<void> {
  if (ready) return;
  const bridge = await getBridge();

  const npName = `anytub3/np/${bytesToHex(await bridge.deriveEntropy(enc(KEY_CTX.npChannel)))}`;
  const npKey = await bridge.deriveEntropy(enc(KEY_CTX.npEnc));
  np = new SyncChannel<NowPlaying>(bridge.channel(TOPIC.nowPlaying), npKey, npName);

  const libName = `anytub3/lib/${bytesToHex(await bridge.deriveEntropy(enc(KEY_CTX.libChannel)))}`;
  const libKey = await bridge.deriveEntropy(enc(KEY_CTX.libEnc));
  lib = new SyncChannel<LibraryHead>(bridge.channel(TOPIC.libraryHead), libKey, libName);

  ready = true;
}

// ── now-playing (live handoff) ───────────────────────────────────────────────

export async function publishNowPlaying(s: Omit<NowPlaying, "timestamp" | "v">): Promise<NowPlaying> {
  await initSync();
  const full: NowPlaying = { ...s, v: 1, timestamp: np!.tick() };
  await np!.publish(full, full.timestamp);
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
    if (s) void publishNowPlaying(s);
  }, NP_HEARTBEAT_MS);
}
export function stopNpHeartbeat(): void {
  if (npHb) clearInterval(npHb);
  npHb = undefined;
}

// ── library-head (durable resume pointer) ────────────────────────────────────

export async function publishLibraryHead(indexCid: string): Promise<void> {
  await initSync();
  const head: LibraryHead = { indexCid, ts: lib!.tick() };
  await lib!.publish(head, head.ts);
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
    if (cid) void publishLibraryHead(cid);
  }, LIB_HEARTBEAT_MS);
}
export function stopLibHeartbeat(): void {
  if (libHb) clearInterval(libHb);
  libHb = undefined;
}

// ── Per-device cache (fast-path; not the source of truth) ─────────────────────

export function cacheNowPlaying(s: NowPlaying): void {
  void getBridge().then((b) => b.localSet(NP_CACHE_KEY, JSON.stringify(s)));
}
export function readCachedNowPlaying(): NowPlaying | null {
  if (!singletonBridge) return null;
  const raw = singletonBridge.localGet(NP_CACHE_KEY);
  return raw ? (JSON.parse(raw) as NowPlaying) : null;
}
export function cacheLibraryHead(h: LibraryHead): void {
  void getBridge().then((b) => b.localSet(LIB_CACHE_KEY, JSON.stringify(h)));
}
export function readCachedLibraryHead(): LibraryHead | null {
  if (!singletonBridge) return null;
  const raw = singletonBridge.localGet(LIB_CACHE_KEY);
  return raw ? (JSON.parse(raw) as LibraryHead) : null;
}

// Keep a synchronous handle to the bridge for cache reads after init.
let singletonBridge: Awaited<ReturnType<typeof getBridge>> | null = null;
void getBridge().then((b) => {
  singletonBridge = b;
});
