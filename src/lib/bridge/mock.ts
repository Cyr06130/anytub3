import { sha256 } from "@parity/product-sdk-crypto";
import type { ChannelEnvelope, ChannelLike, HostBridge } from "./types";

// ── Standalone / dev bridge ──────────────────────────────────────────────────
// Emulates the host out of a container (design: "dev off-host → degraded mode").
//
//  - deriveEntropy: deterministic from a per-browser "wallet" seed (so keys/CIDs
//    are stable across reloads — mimics RFC-0007 being wallet-bound).
//  - cloud storage: content-addressed blobs in localStorage (immutable, durable).
//  - statement channels: BroadcastChannel for live cross-tab handoff + localStorage
//    for the last value → opening a SECOND TAB genuinely demonstrates inter-host
//    continuity. Each tab is a different "host" sharing one wallet.
//  - per-device cache (localGet/localSet): sessionStorage, so EACH TAB has its
//    own cache — like a real device. The real bridge uses each webview's own
//    localStorage; sharing one localStorage across tabs would wrongly merge the
//    per-device caches and hide cross-host sync bugs (the heartbeat clobber).
//  - chat: shareViaChat echoes to local subscribers (a single-user loopback);
//    the receive path is therefore exercised by the exact production code.

const SEED_KEY = "anytub3.mock.walletSeed";
const CLOUD_PREFIX = "anytub3.mock.cloud.";
const CHAN_PREFIX = "anytub3.mock.chan.";
const LOCAL_PREFIX = "anytub3.mock.local.";

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getOrCreateSeed(): Uint8Array {
  const existing = localStorage.getItem(SEED_KEY);
  if (existing) return b64decode(existing);
  const seed = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(SEED_KEY, b64encode(seed));
  return seed;
}

class MockChannel implements ChannelLike {
  private bc: BroadcastChannel | null;
  private subs = new Set<(name: string, value: ChannelEnvelope) => void>();
  private prefix: string;
  /** Highest timestamp delivered per channel — dedupes BroadcastChannel + storage. */
  private lastTs = new Map<string, number>();

  constructor(topic2: string) {
    this.prefix = `${CHAN_PREFIX}${topic2}.`;

    // storage events: fire in OTHER same-origin tabs only — exactly handoff
    // semantics (the writer never notifies itself). Reliable across tabs.
    window.addEventListener("storage", (e: StorageEvent) => {
      if (!e.key || !e.newValue || !e.key.startsWith(this.prefix)) return;
      this.deliver(e.key.slice(this.prefix.length), JSON.parse(e.newValue) as ChannelEnvelope);
    });

    // BroadcastChannel: same/cross-context fast path (deduped against storage).
    this.bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHAN_PREFIX + topic2) : null;
    this.bc?.addEventListener("message", (ev: MessageEvent) => {
      const { channelName, value } = ev.data as { channelName: string; value: ChannelEnvelope };
      this.persist(channelName, value);
      this.deliver(channelName, value);
    });
  }

  private storageKey(channelName: string) {
    return this.prefix + channelName;
  }
  private persist(channelName: string, value: ChannelEnvelope) {
    localStorage.setItem(this.storageKey(channelName), JSON.stringify(value));
  }
  private deliver(channelName: string, value: ChannelEnvelope) {
    const seen = this.lastTs.get(channelName) ?? 0;
    if (value.timestamp <= seen) return; // already delivered (LWW + dedupe)
    this.lastTs.set(channelName, value.timestamp);
    for (const cb of this.subs) cb(channelName, value);
  }

  async write(channelName: string, value: ChannelEnvelope): Promise<void> {
    const prev = this.read(channelName);
    if (prev && prev.timestamp > value.timestamp) return; // last-write-wins
    this.persist(channelName, value);
    this.lastTs.set(channelName, value.timestamp); // never re-notify our own write
    this.bc?.postMessage({ channelName, value });
  }

  read(channelName: string): ChannelEnvelope | undefined {
    const raw = localStorage.getItem(this.storageKey(channelName));
    return raw ? (JSON.parse(raw) as ChannelEnvelope) : undefined;
  }

  onChange(cb: (channelName: string, value: ChannelEnvelope) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
}

export function createMockBridge(): HostBridge {
  const seed = getOrCreateSeed();
  const channels = new Map<string, MockChannel>();
  const customSubs = new Map<string, Set<(payload: Uint8Array, peer: string) => void>>();

  return {
    inHost: false,

    async init() {
      /* nothing to connect */
    },

    async getUserId() {
      // Stable pseudo-identity from the seed.
      return `mock-${b64encode(seed).slice(0, 10)}`;
    },

    subscribeTheme(cb) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => cb(mq.matches ? "dark" : "light");
      handler();
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    },

    async deriveEntropy(context: Uint8Array) {
      // sha256(seed || context) — deterministic, wallet-bound (mock of RFC-0007).
      const buf = new Uint8Array(seed.length + context.length);
      buf.set(seed, 0);
      buf.set(context, seed.length);
      return sha256(buf);
    },

    async preallocate() {
      return true; // no allowances needed off-host
    },

    async cloudStore(bytes: Uint8Array) {
      const digest = sha256(bytes);
      let hex = "";
      for (const b of digest) hex += b.toString(16).padStart(2, "0");
      const cid = `bafymock${hex.slice(0, 48)}`; // CID-ish, content-addressed
      localStorage.setItem(CLOUD_PREFIX + cid, b64encode(bytes));
      return cid;
    },

    async cloudFetch(cid: string) {
      const raw = localStorage.getItem(CLOUD_PREFIX + cid);
      if (!raw) throw new Error(`Mock cloud: CID not found ${cid}`);
      return b64decode(raw);
    },

    channel(topic2: string) {
      let ch = channels.get(topic2);
      if (!ch) {
        ch = new MockChannel(topic2);
        channels.set(topic2, ch);
      }
      return ch;
    },

    localGet(key: string) {
      // Per-tab (≈ per-device) cache, see header. Channel/cloud stay shared.
      return sessionStorage.getItem(LOCAL_PREFIX + key);
    },
    localSet(key: string, value: string) {
      sessionStorage.setItem(LOCAL_PREFIX + key, value);
    },

    async shareViaChat(messageType: string, payload: Uint8Array) {
      // Loopback echo: a single-user mock "network" standing in for the host
      // chat. Delivers to local subscribers so the receive → import path runs
      // exactly the production code (importing one's own playlist is a no-op,
      // so this is harmless for a self-share and drives simulateReceiveSample).
      const subs = customSubs.get(messageType);
      if (!subs) return;
      const peer = (await this.getUserId()) ?? "self";
      for (const cb of subs) cb(payload, peer);
    },

    subscribeCustom(messageType: string, cb) {
      let subs = customSubs.get(messageType);
      if (!subs) {
        subs = new Set();
        customSubs.set(messageType, subs);
      }
      subs.add(cb);
      return () => subs!.delete(cb);
    },
  };
}
