// App identity (design doc 2 §0).
export const DOTNS_IDENTIFIER = "anytub3.dot";
export const APP_NAME = "anytub3";
export const PRODUCT_DERIVATION_INDEX = 0;

/** Cloud Storage (Bulletin) network. */
export const CLOUD_ENVIRONMENT = "paseo" as const;

// Key derivation context domains — never reuse a key across domains (design §10).
export const KEY_CTX = {
  master: "anytub3/master/v1",
  npChannel: "anytub3/np-channel/v1",
  npEnc: "anytub3/np-enc/v1",
  libChannel: "anytub3/lib-channel/v1",
  libEnc: "anytub3/lib-enc/v1",
  // FROZEN: this domain doesn't follow the `anytub3/<name>/v1` convention, but
  // changing it would re-derive every playlist content key and orphan all blobs
  // already stored on Bulletin. Do not align it.
  playlist: (id: string) => `playlist:${id}`,
} as const;

// Statement Store topics (topic2).
export const TOPIC = {
  nowPlaying: "anytub3-np",
  libraryHead: "anytub3-lib",
} as const;

// Custom chat message type for playlist shares.
export const SHARE_MESSAGE_TYPE = "anytub3/playlist-share";

// Host chat room the product posts shares into. The host surfaces this room in
// its chat UI; the user picks/forwards to a contact there (the product host-api
// exposes no contact directory and no recipient keys — design §7 / R2).
export const SHARE_ROOM = { roomId: "anytub3-shares", name: "AnyTub3", icon: "" } as const;

// Heartbeats (design §8): now-playing refresh ~15s; library-head longer.
export const NP_HEARTBEAT_MS = 15_000;
export const LIB_HEARTBEAT_MS = 60_000;
// Statement TTL. The SDK's ChannelStore only supports ONE client-wide TTL (no
// per-write override), so both channels expire after this. That's the right
// bound for now-playing (a stopped device must fade fast); the library head
// relies on the 60s heartbeat while any host is alive and on the per-device
// cache (readCachedLibraryHead) for cold resume, so it doesn't need its own.
export const STATEMENT_TTL_SECONDS = 120;
