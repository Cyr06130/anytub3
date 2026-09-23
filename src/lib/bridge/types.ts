/**
 * Envelope written to a Statement Store channel: `timestamp` stays in clear
 * (the LWW key), `ct` is the AES-GCM packed ciphertext (design §8), base64 so
 * the JSON-encoded envelope fits the 512-byte statement limit (see
 * lib/envelope.ts). `number[]` is the legacy shape, still accepted on read.
 */
export type ChannelEnvelope = { timestamp: number; ct: string | number[] };

/** ChannelStore-shaped handle over one Statement Store topic. */
export interface ChannelLike {
  write(channelName: string, value: ChannelEnvelope): Promise<void>;
  read(channelName: string): ChannelEnvelope | undefined;
  /** Fires on remote writes (handoff from another host). Returns an unsubscribe. */
  onChange(cb: (channelName: string, value: ChannelEnvelope) => void): () => void;
}

/**
 * The single seam between AnyTub3 and the Polkadot host.
 *
 * App code (keys/bulletin/sync/share) talks only to this interface. Crypto and
 * key derivation stay in the app layer (pure JS, runs anywhere); the bridge
 * provides only host-owned primitives: entropy, cloud storage, statement
 * channels, per-device storage, identity, theme and contacts.
 *
 * Two implementations: RealHostBridge (Parity SDK, in a host) and
 * MockHostBridge (BroadcastChannel + localStorage, standalone dev/demo).
 */
export interface HostBridge {
  readonly inHost: boolean;
  init(): Promise<void>;

  /** Stable user identity — identical across hosts for the same wallet. */
  getUserId(): Promise<string | null>;

  /** light/dark from the host; returns an unsubscribe. */
  subscribeTheme(cb: (mode: "light" | "dark") => void): () => void;

  /** Deterministic, wallet-bound entropy (RFC-0007) — same bytes on every host. */
  deriveEntropy(context: Uint8Array): Promise<Uint8Array>;

  // ── Bulletin / Cloud Storage (durable, content-addressed) ──
  // Allowances are never requested explicitly: the host provisions Bulletin +
  // Statement Store allowances implicitly on the first write (RFC-0010), so
  // the user never sees an authorization dialog.
  cloudStore(bytes: Uint8Array): Promise<string>; // → CID
  cloudFetch(cid: string): Promise<Uint8Array>;

  /**
   * Fetch a public http(s) resource as text — used for EPG (XMLTV guides + the
   * iptv-org channel directory). Routed through the bridge so the real host can
   * apply its external-access policy and the mock can serve deterministic
   * fixtures for e2e. http(s) only; rejects other schemes.
   */
  httpGet(url: string): Promise<string>;
  /** As {@link httpGet}, raw bytes — for gzip-compressed (`.xml.gz`) guides. */
  httpGetBytes(url: string): Promise<Uint8Array>;
  /**
   * Stream a text resource and stop at the first `until` marker (or after
   * `maxBytes`), cancelling the download — reads a country guide's <channel>
   * directory without pulling the whole multi-MB file.
   */
  httpGetPrefix(url: string, opts: { until: string; maxBytes: number }): Promise<string>;

  // ── Statement Store channels (ephemeral, last-write-wins) ──
  channel(topic2: string): ChannelLike;

  // ── Per-device cache (does not traverse devices) ──
  localGet(key: string): string | null;
  localSet(key: string, value: string): void;

  // ── Sharing via host chat ──
  /**
   * Hand a share pointer to the host chat as a Custom message. The product
   * host-api exposes no contact directory and no recipient keys, so the *host*
   * owns recipient selection and end-to-end encryption: we register a product
   * room (idempotent) and post into it; the user forwards it to a contact from
   * the host's chat UI. Off-host this loops back to local subscribers (demo).
   */
  shareViaChat(messageType: string, payload: Uint8Array): Promise<void>;
  /** Inbound custom messages of the given type; returns an unsubscribe. */
  subscribeCustom(
    messageType: string,
    cb: (payload: Uint8Array, peer: string) => void,
  ): () => void;
}
