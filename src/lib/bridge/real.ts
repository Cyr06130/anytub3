import type { ChannelStore as ChannelStoreT } from "@parity/product-sdk-statement-store";
import type { CloudStorageClient as CloudStorageClientT } from "@parity/product-sdk-cloud-storage";
import { cidToPreimageKey, hashToCid } from "@/lib/cid";
import { CLOUD_ENVIRONMENT, DOTNS_IDENTIFIER, APP_NAME, PRODUCT_DERIVATION_INDEX, SHARE_ROOM, STATEMENT_TTL_SECONDS } from "@/lib/config";
import { errorMessage } from "@/lib/errors";
import type { ChannelEnvelope, ChannelLike, HostBridge } from "./types";
import { isHttpUrl } from "@/lib/url";

// ── Real host bridge ─────────────────────────────────────────────────────────
// Wires the Parity product SDK. The SDK is *dynamically* imported so the
// standalone/mock build never pulls in polkadot-api & friends. All host-runtime
// behaviour that cannot be verified offline is marked [confirm host].
//
// Per-device cache uses the webview's own localStorage (sync, sufficient for the
// optimistic fast-path); the host's HostLocalStorage can be substituted later
// if cross-context durability is required.

const REAL_LOCAL_PREFIX = "anytub3.local.";

type HostMod = typeof import("@parity/product-sdk-host");
type ProductAccount = { dotNsIdentifier: string; derivationIndex: number; publicKey: Uint8Array };
type PreimageManager = NonNullable<Awaited<ReturnType<HostMod["getPreimageManager"]>>>;

const HOST_READY_TIMEOUT_MS = 15_000;
const HOST_READY_POLL_MS = 250;

/**
 * Wait for the host's TruAPI handshake to complete. `isInsideContainer()` is a
 * synchronous heuristic (iframe/webview marker), but every service getter
 * (`getPreimageManager`, `getAccountsProvider`, `getStatementStore`, …) returns
 * null until the transport is actually CONNECTED — resolving them during the
 * handshake races it and freezes the bridge into a session-long "Bulletin
 * storage unavailable (preimage manager missing)" state. Resolves false when
 * the host never comes up within the timeout.
 */
export async function waitForTruApi(
  host: Pick<HostMod, "getTruApi">,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const { timeoutMs = HOST_READY_TIMEOUT_MS, pollMs = HOST_READY_POLL_MS } = opts;
  const deadline = Date.now() + timeoutMs;
  do {
    if (await host.getTruApi()) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (Date.now() < deadline);
  return (await host.getTruApi()) != null;
}

const PREIMAGE_LOOKUP_TIMEOUT_MS = 30_000;

/** Resolve a preimage's bytes via the host's lookup subscription, or time out. */
function lookupPreimageBytes(preimage: PreimageManager, key: `0x${string}`): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sub?.unsubscribe?.();
      reject(new Error("Bulletin read timed out"));
    }, PREIMAGE_LOOKUP_TIMEOUT_MS);
    const sub = preimage.lookup(key, (data) => {
      if (settled) return;
      // lookup is a subscription: while the preimage isn't available it may
      // fire with empty/undefined data. Ignore those and keep waiting (a
      // later callback delivers the bytes), else we'd resolve null and the
      // caller would decrypt garbage. Genuine misses fall through to timeout.
      const bytes = data as Uint8Array | null | undefined;
      if (!bytes || bytes.length === 0) return;
      settled = true;
      clearTimeout(timer);
      sub?.unsubscribe?.();
      resolve(bytes);
    });
  });
}

export async function createRealBridge(): Promise<HostBridge> {
  // Loaded in init(); getBridge() awaits init() before returning.
  let host!: HostMod;
  let accountsProvider: Awaited<ReturnType<HostMod["getAccountsProvider"]>> = null;
  let productAccount: ProductAccount | null = null;
  let preimage: PreimageManager | null = null;
  let cloudClient: CloudStorageClientT | null = null;
  let bulletinInitError: unknown = null;
  let ssc: import("@parity/product-sdk-statement-store").StatementStoreClient | null = null;
  let ChannelStoreCtor: typeof ChannelStoreT | null = null;
  const channels = new Map<string, ChannelLike>();
  let shareRoomReady = false; // registerRoom is idempotent; only call it once.

  function accountId(): [string, number] {
    return [
      productAccount?.dotNsIdentifier ?? DOTNS_IDENTIFIER,
      productAccount?.derivationIndex ?? PRODUCT_DERIVATION_INDEX,
    ];
  }

  /** Resolve (and cache) the sponsored preimage manager. Retried on every call:
   *  a transient failure at init must not condemn Bulletin for the session. */
  async function ensurePreimage(): Promise<PreimageManager | null> {
    if (preimage) return preimage;
    try {
      preimage = await host.getPreimageManager();
      if (preimage) bulletinInitError = null;
    } catch (e) {
      bulletinInitError = e;
      console.warn("[AnyTub3] getPreimageManager:", e);
    }
    return preimage;
  }

  /** Fallback for hosts without a preimage manager: a direct Bulletin client.
   *  Loaded lazily — the cloud-storage package drags polkadot-api plus ~2MB of
   *  chain-metadata chunks, and that load failing must never take down the
   *  sponsored path (it used to: both lived in one try). Retried per call. */
  async function ensureCloudClient(): Promise<CloudStorageClientT | null> {
    if (cloudClient) return cloudClient;
    try {
      const csMod = await import("@parity/product-sdk-cloud-storage");
      const signer = csMod.createLazySigner(
        () =>
          accountsProvider && productAccount
            ? accountsProvider.getProductAccountSigner(productAccount)
            : null,
        "AnyTub3: no product account available",
      );
      cloudClient = await csMod.CloudStorageClient.create({ environment: CLOUD_ENVIRONMENT, signer });
      bulletinInitError = null;
    } catch (e) {
      bulletinInitError = e;
      console.warn("[AnyTub3] CloudStorageClient init:", e);
    }
    return cloudClient;
  }

  /** Both Bulletin paths failed — say WHY, not just that they did. */
  function bulletinUnavailable(operation: string): Error {
    const cause = bulletinInitError
      ? ` — ${errorMessage(bulletinInitError)}`
      : " (host exposes no preimage manager and no direct client could connect)";
    return new Error(`Bulletin ${operation} unavailable${cause}`);
  }

  type ChatManager = NonNullable<Awaited<ReturnType<HostMod["getChatManager"]>>>;
  async function ensureShareRoom(chat: ChatManager): Promise<void> {
    if (shareRoomReady) return; // registerRoom is idempotent ("New" | "Exists").
    try {
      await chat.registerRoom({ ...SHARE_ROOM });
    } catch (e) {
      // Some host builds don't implement host_chat_create_room (returns
      // "Not implemented"). Don't hard-fail: posting may still work, and if it
      // doesn't the caller falls back to the copyable share code. Mark ready so
      // we don't re-attempt registration on every share.
      console.warn("[AnyTub3] registerRoom unsupported by host; continuing best-effort:", e);
    }
    shareRoomReady = true;
  }

  return {
    inHost: true,

    async init() {
      host = await import("@parity/product-sdk-host");

      // 0. Gate on the transport: without this, a slow handshake makes every
      //    service below resolve null and the session boots half-dead. On a
      //    genuine timeout, throw — getBridge()'s fallback boundary then hands
      //    the app to the mock bridge instead of a broken real one.
      if (!(await waitForTruApi(host))) {
        throw new Error("Host transport not ready (TruAPI handshake timed out)");
      }

      // 1. Accounts: ensure the host session is connected, resolve the product account.
      accountsProvider = await host.getAccountsProvider();
      if (accountsProvider) {
        await accountsProvider.requestLogin("AnyTub3").match(
          (r) => console.info("[AnyTub3] login:", r),
          (e) => console.warn("[AnyTub3] login error:", e),
        );
        productAccount = await accountsProvider
          .getProductAccount(DOTNS_IDENTIFIER, PRODUCT_DERIVATION_INDEX)
          .match(
            (acc) => acc as ProductAccount,
            (e) => {
              // In dev the app loads as localhost:<port>, not anytub3.dot, so the
              // host may reject the product-account domain — chain writes then fail.
              console.warn("[AnyTub3] getProductAccount failed (domain?):", e);
              return null;
            },
          );
      }

      // 2. Bulletin storage. Prefer the host preimage manager — it submits on
      //    our behalf, sponsored via the implicit BulletinAllowance (no direct
      //    Bulletin RPC connection or product signer required). The direct
      //    CloudStorageClient fallback is resolved lazily at first use, so its
      //    heavyweight chunk graph can never gate the sponsored path.
      await ensurePreimage();

      // 3. Statement Store, connected in sponsored host mode (no per-update signing).
      try {
        const ss = await import("@parity/product-sdk-statement-store");
        ChannelStoreCtor = ss.ChannelStore;
        ssc = new ss.StatementStoreClient({ appName: APP_NAME, defaultTtlSeconds: STATEMENT_TTL_SECONDS });
        await ssc.connect({ mode: "host", accountId: accountId() });
      } catch (e) {
        console.warn("[AnyTub3] Statement Store unavailable:", e);
      }
    },

    async getUserId() {
      if (!accountsProvider) return null;
      return accountsProvider.getUserId().match(
        (r) => r.primaryUsername,
        () => null,
      );
    },

    subscribeTheme(cb) {
      let sub: { unsubscribe?: () => void } | undefined;
      let disposed = false;
      void (async () => {
        const tp = await host.getThemeProvider();
        if (disposed) return;
        sub = tp?.subscribeTheme((theme: { variant?: string }) =>
          cb(String(theme?.variant).toLowerCase().includes("dark") ? "dark" : "light"),
        );
      })();
      return () => {
        disposed = true;
        sub?.unsubscribe?.();
      };
    },

    async deriveEntropy(context: Uint8Array) {
      const result = await host.deriveEntropy(context);
      if (!result.ok) throw new Error(`deriveEntropy: ${host.formatHostError(result.error)}`);
      return result.value;
    },

    async cloudStore(bytes: Uint8Array) {
      // Sponsored host path: submit → preimage key → CID (interoperable pointer).
      const pm = await ensurePreimage();
      if (pm) {
        return hashToCid(await pm.submit(bytes));
      }
      const client = await ensureCloudClient();
      if (client) {
        const result = await client.store(bytes).send();
        const cid = result.cid?.toString();
        if (!cid) throw new Error("Cloud Storage: missing CID in receipt");
        return cid;
      }
      throw bulletinUnavailable("save");
    },

    async cloudFetch(cid: string) {
      // Demo-mode CIDs (mock localStorage) can't be resolved on real Bulletin —
      // fail fast with a clear message instead of a 30s lookup timeout.
      if (cid.startsWith("bafymock")) {
        throw new Error("This share code was created in demo mode and can't be opened inside the host.");
      }
      const pm = await ensurePreimage();
      if (pm) {
        return lookupPreimageBytes(pm, cidToPreimageKey(cid));
      }
      const client = await ensureCloudClient();
      if (client) {
        const result = await client.fetchBytes(cid);
        if (!result.ok) throw result.error;
        return result.value;
      }
      throw bulletinUnavailable("read");
    },

    async httpGet(url: string) {
      // Enforce the scheme here too (not just in callers): never fetch
      // javascript:/file:/data: URLs. In-host, this fetch is subject to the
      // host's external-access permission (the user may be prompted), like the
      // external streams.
      if (!isHttpUrl(url)) throw new Error("Only http(s) URLs are supported.");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    },

    channel(topic2: string): ChannelLike {
      let ch = channels.get(topic2);
      if (ch) return ch;
      if (!ssc || !ChannelStoreCtor) throw new Error("Statement Store not connected");
      const store: ChannelStoreT<ChannelEnvelope> = new ChannelStoreCtor<ChannelEnvelope>(ssc, { topic2 });
      ch = {
        async write(channelName, value) {
          // ChannelStore.write returns a Result and never throws (SDK ≥0.6) —
          // a rejected statement must surface to the caller, not vanish.
          const result = await store.write(channelName, value);
          if (!result.ok) throw result.error;
        },
        read(channelName) {
          return store.read(channelName);
        },
        onChange(cb) {
          const sub = store.onChange((name, value) => cb(name, value));
          return () => sub.unsubscribe();
        },
      };
      channels.set(topic2, ch);
      return ch;
    },

    localGet(key: string) {
      return localStorage.getItem(REAL_LOCAL_PREFIX + key);
    },
    localSet(key: string, value: string) {
      localStorage.setItem(REAL_LOCAL_PREFIX + key, value);
    },

    async shareViaChat(messageType: string, payload: Uint8Array) {
      // The host-api has no contacts/address-book method and won't hand a
      // product the recipient's encryption key (the ChatRoom shape is only
      // `{ roomId, participatingAs }`). So we don't pick a recipient or seal the
      // pointer ourselves: we register our product room and post the pointer as
      // a Custom message. The host renders it in the user's chat with AnyTub3,
      // and the user forwards it to a contact — host-side P2P chat is end-to-end
      // encrypted (P-256 ECDH + AES-GCM), which is what protects the pointer.
      // [confirm host] confidentiality relies on the host encrypting the
      // forwarded Custom message to the chosen contact.
      const chat = await host.getChatManager();
      if (!chat) throw new Error("Chat unavailable");
      await ensureShareRoom(chat);
      await chat.sendMessage(SHARE_ROOM.roomId, {
        tag: "Custom",
        value: { messageType, payload: host.toHex(payload) },
      });
    },

    subscribeCustom(messageType: string, cb) {
      let sub: { unsubscribe?: () => void } | undefined;
      let disposed = false;
      void (async () => {
        const chat = await host.getChatManager();
        if (disposed || !chat) return;
        // Ensure our product room exists on the receive side too, so the host
        // has somewhere to surface inbound shares ([confirm host]).
        await ensureShareRoom(chat);
        if (disposed) return;
        sub = chat.subscribeAction((action) => {
          const p = action.payload;
          if (p.tag !== "MessagePosted") return;
          const content = p.value; // ChatMessageContent
          if (content.tag === "Custom" && content.value.messageType === messageType) {
            cb(host.fromHex(content.value.payload), action.peer);
          }
        });
      })();
      return () => {
        disposed = true;
        sub?.unsubscribe?.();
      };
    },
  };
}
