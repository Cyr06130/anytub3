import type { ChannelStore as ChannelStoreT } from "@parity/product-sdk-statement-store";
import type { CloudStorageClient as CloudStorageClientT } from "@parity/product-sdk-cloud-storage";
import { CLOUD_ENVIRONMENT, DOTNS_IDENTIFIER, APP_NAME, PRODUCT_DERIVATION_INDEX, SHARE_ROOM, STATEMENT_TTL_SECONDS } from "@/lib/config";
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

export async function createRealBridge(): Promise<HostBridge> {
  // Loaded in init(); getBridge() awaits init() before returning.
  let host!: HostMod;
  let accountsProvider: Awaited<ReturnType<HostMod["getAccountsProvider"]>> = null;
  let productAccount: ProductAccount | null = null;
  let csMod: typeof import("@parity/product-sdk-cloud-storage") | null = null;
  let preimage: Awaited<ReturnType<HostMod["getPreimageManager"]>> = null;
  let cloudClient: CloudStorageClientT | null = null;
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
      //    our behalf, sponsored via the granted BulletinAllowance (no direct
      //    Bulletin RPC connection or product signer required). Fall back to a
      //    direct CloudStorageClient only if the host doesn't expose one.
      try {
        csMod = await import("@parity/product-sdk-cloud-storage");
        preimage = await host.getPreimageManager();
        if (!preimage) {
          const signer = csMod.createLazySigner(
            () =>
              accountsProvider && productAccount
                ? accountsProvider.getProductAccountSigner(productAccount)
                : null,
            "AnyTub3: no product account available",
          );
          cloudClient = await csMod.CloudStorageClient.create({ environment: CLOUD_ENVIRONMENT, signer });
        }
      } catch (e) {
        console.warn("[AnyTub3] Bulletin storage init:", e);
      }

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
      return host.deriveEntropy(context);
    },

    async preallocate() {
      try {
        const outcomes = await host.requestResourceAllocation([
          host.enumValue("BulletinAllowance", undefined),
          host.enumValue("StatementStoreAllowance", undefined),
        ]);
        // Outcome tags: "Allocated" | "Rejected" | "NotAvailable".
        const granted = outcomes.every((o) => o.tag !== "Rejected");
        console.info("[AnyTub3] allowances:", outcomes.map((o) => o.tag).join(", "));
        return granted;
      } catch (e) {
        console.warn("[AnyTub3] preallocate:", e);
        return false;
      }
    },

    async cloudStore(bytes: Uint8Array) {
      // Sponsored host path: submit → preimage key → CID (interoperable pointer).
      if (preimage && csMod) {
        const key = (await preimage.submit(bytes)) as `0x${string}`;
        return csMod.hashToCid(key);
      }
      if (cloudClient) {
        const result = await cloudClient.store(bytes).send();
        const cid = result.cid?.toString();
        if (!cid) throw new Error("Cloud Storage: missing CID in receipt");
        return cid;
      }
      throw new Error("Bulletin storage unavailable (preimage manager missing)");
    },

    async cloudFetch(cid: string) {
      // Demo-mode CIDs (mock localStorage) can't be resolved on real Bulletin —
      // fail fast with a clear message instead of a 30s lookup timeout.
      if (cid.startsWith("bafymock")) {
        throw new Error("This share code was created in demo mode and can't be opened inside the host.");
      }
      if (preimage && csMod) {
        const key = csMod.cidToPreimageKey(cid);
        return await new Promise<Uint8Array>((resolve, reject) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            sub?.unsubscribe?.();
            reject(new Error("Bulletin read timed out"));
          }, 30_000);
          const sub = preimage!.lookup(key, (data) => {
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
      if (cloudClient) return cloudClient.fetchBytes(cid);
      throw new Error("Bulletin read unavailable (preimage manager missing)");
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
          await store.write(channelName, value);
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
      await chat.sendMessage(SHARE_ROOM.roomId, { tag: "Custom", value: { messageType, payload } });
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
            cb(content.value.payload, action.peer);
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
