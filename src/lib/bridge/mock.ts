import { sha256 } from "@noble/hashes/sha2.js";
import type { ChannelEnvelope, ChannelLike, HostBridge } from "./types";
import { cutAt, fetchBytes, fetchText, fetchTextPrefix } from "./http";
import { base64FromBytes, bytesFromBase64, utf8 } from "@/lib/bytes";

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

// Deterministic httpGet fixtures (e2e + demo): exact-URL → response body. A
// registered fixture short-circuits the network so EPG tests never flake on a
// live host. Stored on globalThis so a Playwright init script can seed it before
// the app boots. Anything not registered falls through to a real fetch (so the
// demo can still pull a real provider's XMLTV when CORS allows).
const HTTP_FIXTURES: Map<string, string> = ((
  globalThis as unknown as { __ANYTUB3_HTTP_FIXTURES__?: Map<string, string> }
).__ANYTUB3_HTTP_FIXTURES__ ??= new Map());

export function setHttpFixture(url: string, body: string): void {
  HTTP_FIXTURES.set(url, body);
}

// e2e/demo seam: simulate the statement store rejecting writes (what a real
// host does on quota/authorization failures), so tests can prove a failed
// resume-pointer publish is surfaced to the user instead of swallowed.
let channelWritesFail = false;
export function setChannelWriteFailure(fail: boolean): void {
  channelWritesFail = fail;
}

function getOrCreateSeed(): Uint8Array {
  const existing = localStorage.getItem(SEED_KEY);
  if (existing) return bytesFromBase64(existing);
  const seed = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(SEED_KEY, base64FromBytes(seed));
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
      // Same last-write-wins guard as write(): a late message from a lagging
      // tab must not regress the persisted head that read() then serves.
      const prev = this.read(channelName);
      if (prev && prev.timestamp > value.timestamp) return;
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
    if (channelWritesFail) throw new Error("Simulated statement rejection (demo seam)");
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
      return `mock-${base64FromBytes(seed).slice(0, 10)}`;
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

    async cloudStore(bytes: Uint8Array) {
      const digest = sha256(bytes);
      let hex = "";
      for (const b of digest) hex += b.toString(16).padStart(2, "0");
      const cid = `bafymock${hex.slice(0, 48)}`; // CID-ish, content-addressed
      localStorage.setItem(CLOUD_PREFIX + cid, base64FromBytes(bytes));
      return cid;
    },

    async cloudFetch(cid: string) {
      const raw = localStorage.getItem(CLOUD_PREFIX + cid);
      if (!raw) throw new Error(`Mock cloud: CID not found ${cid}`);
      return bytesFromBase64(raw);
    },

    // No fixture → behave like the real bridge (lets the demo fetch a real
    // provider's guide when CORS permits).
    async httpGet(url: string) {
      return HTTP_FIXTURES.get(url) ?? fetchText(url);
    },
    async httpGetBytes(url: string) {
      const fixture = HTTP_FIXTURES.get(url);
      return fixture !== undefined ? utf8(fixture) : fetchBytes(url);
    },
    async httpGetPrefix(url: string, opts) {
      const fixture = HTTP_FIXTURES.get(url);
      return fixture !== undefined ? cutAt(fixture, opts.until) : fetchTextPrefix(url, opts);
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
