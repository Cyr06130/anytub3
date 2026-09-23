# AnyTub3

**Decentralized `.dot` IPTV with inter-host continuity** — a Polkadot *product* (webview)
that runs inside the Mobile / Desktop / Web host.

- Pure-web IPTV playback (`hls.js` + an in-house, sanitized m3u parser).
- Durable, encrypted playlists on **Bulletin Chain** (Cloud Storage → CID).
- **Inter-host continuity**: opening AnyTub3 on another device resumes the
  current channel, via an encrypted `now-playing` state published on the
  **Statement Store** (LWW), with a durable library index (`library-head`) for cold resume.
- Playlist sharing through a copyable **share code** (a bearer pointer to the encrypted
  playlist), also handed to the host chat where a host implements it.
- A **programme guide** resolved automatically per channel — the provider's API, the
  playlist's own XMLTV, or a public directory (see below).
- **TV mode** for LG webOS: no modals, D-pad navigation, lean-back player overlay.
- Player with **fullscreen**, a **side channel list** during playback,
  **light/dark theme toggle**, and playlist **editing / deletion** (act first, Undo).

Implemented from the documents in `design/` (design plan, implementation guide,
design-system integration + deployment).

---

## Status

Everything is wired to the **real Parity SDK** (`@parity/product-sdk-*`); the UI is built
on the **Polkadot design system** (semantic tokens, Berlin Day/Night themes) with
**shadcn/ui** components and **Sonner** toasts. The app is also **fully runnable off-host** thanks to a
`lib/bridge` facade that switches to a local bridge (`BroadcastChannel` +
`localStorage`) — two tabs then simulate two hosts sharing a wallet.

Verified by `npm run typecheck`, `npm run test:unit` (166 tests, 24 files) and
`npm run test:e2e` (36 tests, 8 specs, run against the built bundle on the mock bridge):

| Flow | Verified |
|---|---|
| Boot + host theming (light/dark) | ✅ `boot.spec.ts` |
| m3u ingestion + sanitization + Bulletin save + HLS playback | ✅ `playlist.spec.ts` (HLS manifest actually loaded) |
| **Continuity — cold resume** (a new host restores the library + last channel) | ✅ `resume.spec.ts` |
| **Continuity — live handoff** (switching channels on host A switches host B) | ✅ `resume.spec.ts` |
| Same-device reload restore · restore despite a statement outage at save time | ✅ `resume.spec.ts` |
| **Cross-host library sync** (add / import / edit / delete propagate; a lagging heartbeat never rolls back) | ✅ `sync.spec.ts` |
| Sharing: share code out · import into an empty / non-empty library · hostile import re-sanitized · chat pointer in | ✅ `share.spec.ts` |
| Light/dark theme toggle · fullscreen fallback · side list | ✅ `ui.spec.ts` / `playlist.spec.ts` |
| Editing (rename / remove channels) · deletion with Undo | ✅ `ui.spec.ts` |
| **TV mode**: keyboard-only journey, Back key variants, no Bulletin write per zap | ✅ `tv.spec.ts` |
| **Programme guide**: declared XMLTV · epg.pw auto-match · directory pick persisted · Xtream provider · TV variant | ✅ `epg.spec.ts` |

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 — off-host demo mode ("Demo mode" badge)
npm run build        # static bundle → ./build  (what bulletin-deploy publishes)
npm run test:unit    # Vitest — parsers, crypto oracles, bridge, EPG resolver
npm run test:e2e     # Playwright (build + preview + 8 specs, mock bridge)
npm run typecheck    # tsc -b --noEmit
```

In demo mode: *Add a playlist → Load the sample* loads public test HLS streams
(CORS-friendly) and actually plays the video. Opening a **second tab** demonstrates
inter-host continuity (resume + live handoff).

---

## TV mode (LG webOS)

The UI is remote-friendly end to end: **no modals** (every surface is a screen with
a Back affordance), D-pad focus navigation (`src/lib/tv-input.ts` + `src/lib/tv-nav.ts`),
and a 10-foot theme. TV mode activates on the webOS user agent (`Web0S`) or with the
`?tv=1` query override:

```bash
npm run dev          # then open http://localhost:5173/?tv=1 and drive with the keyboard
```

Keyboard/remote mapping: arrows move focus (geometric, DOM focus is the source of
truth), OK/Enter activates, **Back** (keyCode 461 / `GoBack` / Escape) pops the screen
stack — in the player it zaps (Up/Down), shows the overlay (OK) and returns to the
library; media keys play/pause. `html.tv` scales the root font to 24px (the whole UI,
design tokens and shadcn components included, is rem-based) and pads for overscan. `e2e/tv.spec.ts` drives all of
this keyboard-only.

### Checklist on a real TV (open the deployed/preview URL in the webOS browser)

1. **Back key reaches the page** — screens pop, and from the library root Back leaves
   the app. If the browser chrome swallows keyCode 461, the `popstate` sentinel in
   `tv-input.ts` must kick in (verify both paths).
2. **OSK**: OK on a text field opens the on-screen keyboard; the first Back dismisses
   it without navigating, the second navigates.
3. **Focus ring** legible at ~3 m in both light and dark themes.
4. **Playback**: the sample HLS streams play (hls.js/MSE path) and zapping stays < 2 s;
   zap ~20 channels in a row — no renderer crash (`enableWorker:false` is already set).
5. **Magic Remote pointer**: hover + click work everywhere; moving the cursor over the
   player wakes the overlay.
6. **Geometry**: nothing clipped in the overscan margins at 1920×1080, no horizontal
   scroll.
7. **Styling on older models**: JS is transpiled to Chrome 79 (webOS 6/2021,
   `build.target` in `vite.config.ts`), but Tailwind v4's CSS (`color-mix`,
   `@property`) officially targets Chrome 111+ — expect minor color/ring degradation
   below webOS 24; layout should hold.

---

## Programme guide (EPG)

Opening a channel's guide (the calendar icon) runs a **guide resolver** that walks the
sources configured in `src/lib/epg-sources.ts`, in order, until one has programmes for
that channel. Nothing is fetched before the click, and only that channel's programmes are
kept (per-device cache, 6 h).

| Source | Join | What is fetched |
|---|---|---|
| Provider (Xtream Codes) — when the playlist was imported from `…/get.php?username=…` | stream id from the stream URL | `player_api.php?action=get_short_epg` (a few KB) |
| Playlist guide(s) — every `url-tvg` / `x-tvg-url` of the m3u header, plus pasted URLs | `tvg-id` (feed suffix `@SD` ignored), else channel name | the XMLTV file once; the playlist's other channels are extracted from the same download |
| Public directory (epg.pw) | channel name, within the channel's country | the country file's `<channel>` header only (streamed, cancelled at the first `<programme>`), then one per-channel XMLTV |

The channel's country comes from its `tvg-id` suffix (`TF1.fr`), `tvg-country`, a provider
prefix (`FR| TF1`), else the device locale. When nothing matches, the panel offers to **pick
the channel in the directory** (any platform) or to **paste an XMLTV URL** (not on TV); both
are saved to the playlist and follow it across hosts. A picked channel wins over the
automatic cascade from then on. Misses are remembered for 30 minutes so zapping never
re-downloads a directory.

To add, remove or reorder sources, edit `EPG_SOURCES` in `src/lib/epg-sources.ts` — a public
aggregator must send `Access-Control-Allow-Origin: *` (the app fetches from a browser/
webview). `epg-sources.test.ts` validates the shape of that list; `e2e/epg.spec.ts` drives the
declared, directory, picker, Xtream and TV paths through the mock bridge's URL fixtures.

---

## Architecture

The application code **never** depends directly on the host SDK: everything goes through
the `lib/bridge` facade. Crypto and key derivation stay on the app side (pure JS, runs
everywhere); the bridge only provides the primitives owned by the host.

```
src/
├─ lib/
│  ├─ bridge/
│  │  ├─ types.ts        # HostBridge interface (the only host coupling point)
│  │  ├─ real.ts         # Parity SDK (dynamically imported → 0 chain deps off-host)
│  │  ├─ mock.ts         # BroadcastChannel + localStorage + URL fixtures (demo/dev/e2e)
│  │  ├─ http.ts         # http(s)-only fetch helpers, incl. the streamed prefix read
│  │  ├─ index.ts        # getBridge(): detects the host, picks the impl (no mock fallback in-host)
│  │  ├─ errors.ts       # HostBridgeError → blocking "Can't reach the Polkadot host" screen
│  │  └─ diagnostics.ts  # which host transport this page got (shared client / port / iframe)
│  ├─ config.ts          # .dot identity, key domains, topics, heartbeats, statement TTL
│  ├─ dotns.ts           # dotNS identifier from the loaded hostname (Web gateway `.li` stripped)
│  ├─ allowance.ts       # re-request a lapsed RFC-0010 allowance once, on write failure only
│  ├─ keys.ts · aes.ts · cid.ts      # HKDF content keys, packed AES-GCM, CIDv1 — byte-compatible with the SDKs (oracle-tested)
│  ├─ bulletin.ts        # encrypted playlist bodies + library index (CID), body re-validation
│  ├─ sync.ts · envelope.ts · lww.ts # continuity channels (≤ 512 B envelopes, Lamport last-write-wins)
│  ├─ share.ts           # share codes (base64url pointer) + host chat delivery
│  ├─ m3u.ts · url.ts    # parse + sanitization (XSS, design R3); the one http(s) predicate
│  ├─ epg-sources.ts     # CONFIG — the ordered guide sources (edit here)
│  ├─ epg-resolve.ts     # the cascade; epg.ts = now/next + the panel's entry points
│  ├─ epg-xtream.ts · epg-xmltv.ts · epg-guide-directory.ts   # one module per source kind
│  ├─ epg-match.ts · epg-country.ts · epg-playlist.ts · epg-cache.ts · codec.ts
│  │                     # name matching, country clues, per-playlist guide config, per-device cache (gzip)
│  ├─ tv.ts · tv-input.ts · tv-nav.ts   # TV mode detection, remote keys, geometric focus
│  ├─ lazy-module.ts     # retrying lazy import (the host's service worker can 404 when cold)
│  ├─ toast.ts · cn.ts · errors.ts · bytes.ts · hash.ts · host.ts
│  └─ sample.ts          # demo playlist (test HLS streams) + generated demo guide
├─ components/
│  ├─ ui/                # shadcn/ui — installed, never hand-edited
│  ├─ ChannelRow · EpgPanel · EpgChannelPicker · PlayerOverlay
│  └─ ScreenHeader · ErrorBoundary · HostUnavailable · AppToaster
├─ screens/              # Library · Player · AddPlaylist · EditPlaylist · ShareSheet · EpgGuide
├─ player/HlsPlayer.tsx
├─ state/                # app state + actions, one module per responsibility
│  ├─ app-state.ts       # state container (useApp / getState / setState)
│  ├─ navigation.ts      # screen stack (navigate / goBack / teleports)
│  ├─ playlists.ts       # playlist CRUD + tune + guide configuration (save → CID → republish index)
│  ├─ sharing.ts         # share codes + chat share + import
│  ├─ bootstrap.ts       # boot + resume algorithm + cross-host subscriptions + host failure screen
│  └─ demo.ts            # off-host simulation hooks (window.__anytub3, e2e)
├─ HostThemeBridge.tsx   # host theme → setTheme(berlin-day | berlin-night)
├─ App.tsx · main.tsx
├─ theme/                # Polkadot design-system token bundle (5 themes)
└─ styles/app.css        # imports theme/index.css + TV-mode rules
```

### Why a bridge rather than direct imports

- **Host volatility**: a single file (`real.ts`) touches the SDK; the rest is isolated.
- **Runnable off-host**: `real.ts` is imported **dynamically**, so the demo bundle
  doesn't embed `polkadot-api` & co. (chain metadata — ~800 KB/chain — is loaded
  **only** in a real host).
- **Testable**: the mock exercises exactly the same application code (parser, keys, crypto,
  bulletin, sync, share) as the real host.

---

## Inter-host continuity (the core — design §8)

Two-level state:

1. **Level 1 — live handoff**: `now-playing` (`{playlistCid, channelId, ts}`) encrypted,
   published on a Statement Store channel whose **name and key are derived from the
   wallet entropy** (identical across all hosts, opaque to others). Heartbeat ~15 s keeps the
   pointer fresh. `timestamp` in cleartext = last-write-wins on a **Lamport clock** (robust to
   device clock skew); statements live 7 days — staleness is LWW's job, not the TTL's.
2. **Level 2 — cold resume**: `library-head` (`{indexCid, ts}`) points to a durable
   library index on Bulletin; mirrored in a local per-device cache.

**Resume algorithm** (on opening, any host): restore the library from
`library-head` → resume the freshest `now-playing` (channel vs cache) → subscribe to remote
changes (handoff) and incoming shares. See `state/bootstrap.ts → bootstrap()`.

Keys: `deriveEntropy(ctx)` (RFC-0007, deterministic/wallet) → HKDF-SHA256 content keys
(`lib/keys.ts`, byte-compatible with the SDK's `KeyManager`), **not** `fromSignature` (sr25519
signatures are non-deterministic — unsuitable cross-host). Context domains are separated per
usage (see `config.ts → KEY_CTX`).

---

## Security

- **m3u XSS (R3)**: `http(s)` URLs only (stream + logo), `javascript:`/`data:` rejected;
  names/groups rendered by React (never `innerHTML`). See `lib/m3u.ts`.
- **Strict CSP** in `index.html` (`worker-src blob:` justified for hls.js; `connect-src` also
  allows **loopback** `ws://127.0.0.1:*` / `http://127.0.0.1:*` because native hosts (Polkadot
  Mobile/Desktop) bridge TruAPI through a document-start script that connects the product to
  `ws://127.0.0.1:<port>/?t=<token>` — without it every host call is blocked once the meta CSP
  is parsed).
- **Lazy chunks are prefetched and retried** (`lib/lazy-module.ts`, used for the player chunk):
  hosts serve product assets from their own layer (Polkadot Web: a service worker fed the Bulletin
  archive in memory), which can be cold or restarting minutes after boot; a failed `import()`
  then 404s on the host's nginx. The player is fetched right after boot and a failure shows Retry
  instead of a screen crash.
  For the same reason the entry stylesheet is **inlined into `index.html`** at build time
  (`inlineEntryCss` in `vite.config.ts`): a `<link>` that lost the race against the service
  worker came back as the host's HTML 404 page and left the first paint unstyled.
- **Statement Store budgets**: `now-playing` (~150-250 B) + `library-head` (~120 B) stay
  under `MAX_USER_TOTAL` (1024 B) and each statement < 512 B.
- Encryption: packed AES-GCM (`lib/aes.ts`) for contents and states. A share code carries the
  content key in clear — bearer semantics, the user picks a trusted channel to send it; an
  imported body is re-sanitized like a fresh m3u and re-stored under the recipient's own key.
- **Guide data is untrusted and stays local**: XMLTV is parsed block by block with `DOMParser`
  (no external entities), programme icons are http(s) only, and guides live only in the
  per-device cache — never on Bulletin. The automatic resolver only contacts the configured
  directory hosts and the playlist's own provider.

---

## `.dot` deployment

Deployment is done with **`bulletin-deploy`** ([paritytech/bulletin-deploy](https://github.com/paritytech/bulletin-deploy),
on npm; also published as `@parity/polkadot-app-deploy`, alias `pad`). It pushes the static
bundle to the **Bulletin Chain**, registers the name via **DotNS** and, with `--config`,
publishes the **product manifest** (`bulletin-deploy.config.ts`: display name, description,
icon, one executable per modality) as dotNS text records. Default network: `paseo-next-v2`
testnet. Requires **Node ≥ 22** and bulletin-deploy **≥ 0.19**.

```bash
npm install -g bulletin-deploy
npm run build                         # → ./build
bulletin-deploy login                 # scan the QR with Polkadot Mobile (no mnemonic on disk)
# With --config, pass the FULL domain (env TLD included: paseo-next-v2 → .paseo, preview → .test):
# the manifest step compares the config's domain to the positional argument as typed, so the
# bare label uploads the bundle fine but then fails with "does not match deploy domain".
bulletin-deploy --env paseo-next-v2 --config bulletin-deploy.config.ts ./build anytub3tv.paseo
ANYTUB3_DOTNS=anytub3tv.test bulletin-deploy --env preview --config bulletin-deploy.config.ts ./build anytub3tv.test
```

→ served at `https://anytub3tv.paseo.li` (Web) and `anytub3tv.paseo` (Desktop/Mobile). The
config's `domain` must equal the deployed name (env TLD included), hence the `ANYTUB3_DOTNS`
override for other environments. Every deploy mints a new root CID even for identical files
(the CAR embeds a `deployed_at` manifest); the gateway
`https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/<cid>/` returns that raw CAR, and
`https://anytub3tv.paseo.li` returns the Web *host* shell, which then loads the product. The host then loads AnyTub3 by its dotNS name and provides
account, signer, product account (scoped to that name — derived at runtime from the loaded
hostname, see `lib/dotns.ts`), entropy, Bulletin, Statement Store and chat.

Names deployed so far on `paseo-next-v2`: `anytub3tv.paseo` and `anytub3epg.paseo`
(2026-09-23, this `main`). Both belong to bulletin-deploy's default worker account until claimed
with `bulletin-deploy login` then `bulletin-deploy --env paseo-next-v2 transfer <name>`.

**Inspect what hosts see on dotNS** (root manifest, `app.` executable record, resolvers,
contenthash) without a device: `npm run dotns:inspect -- paseo-next-v2 anytub3tv` (needs the
global bulletin-deploy). A host that finds the root manifest but no `app.` record shows
"This product doesn't have an app on this device"; Polkadot Mobile also caches a product's
resolution for the process lifetime, so after a fresh deploy force-quit it before retrying.

> **Protocol compatibility — check before every deploy.** The host ⇄ product wire protocol
> (`@parity/truapi`) is versioned and **not** backward compatible: truapi ≤ 0.13 speaks codec
> v1, 0.16 codec v2, 0.17+ codec **v3** (frames changed; a v2 peer is refused at the handshake).
> Every current host — Polkadot Web (Rust core as `truapi_provider_bg.wasm`), Desktop, Mobile —
> enforces v3. **truapi 0.17.0 is buggy**: its frames are v3 but its client announces "2" in
> the handshake, so a product built on it gets `UnsupportedProtocolVersion` from every host;
> 0.18.0 fixes the announced number. `@parity/product-sdk-host` 0.21 still resolves truapi
> `^0.17`, hence the `overrides` entry in package.json forcing `@parity/truapi` **0.19.0** — drop
> it once a host SDK release depends on ≥ 0.19. The three SDKs (`-host` / `-cloud-storage` /
> `-statement-store`) must be bumped **in lockstep** (the latter two pin an exact host version).
> After `npm install`, `grep -o "TRUAPI_CODEC_VERSION = [0-9]*" node_modules/@parity/truapi/dist/generated/client.js`
> must print 3. A mismatched build shows the blocking "Can't reach the Polkadot host / protocol
> version refused" screen instead of silently running in demo mode.
>
> **Native hosts share their client (truapi ≥ 0.19).** Since 2026-09-22 Polkadot Mobile /
> Desktop inject a shared browser container at document start: it opens the loopback
> WebSocket itself and publishes a ready-made client on `window.__HOST_API_CLIENT__`, which
> truapi 0.19 adopts — so on native hosts the codec is the host's own and the connection
> survives socket resets. Older SDKs get a compatibility `MessagePort` (`__HOST_API_PORT__`)
> that silently drops frames while the container's socket is down: that is what the
> "handshake timed out after 10000ms" screen on Mobile was (our pre-loopback CSP blocked the
> socket). The failure screen now prints a `transport=… origin=…` diagnostics line
> (`lib/bridge/diagnostics.ts`) — ask for it in any in-host bug report.

**Prerequisites (see bulletin-deploy's `DEPLOYMENT.md`):** a `.dot` name (on the Parity testnet,
registration may require a Proof-of-Personhood — request via an issue on [paritytech/dotns](https://github.com/paritytech/dotns/issues));
Bulletin storage authorization (managed by `//Alice` on testnet; a classic first-run error:
`not authorized to upload`); a little Asset Hub funds for the DotNS fees ([faucet](https://faucet.polkadot.io/)).

> **Dev inside the host:** the product account is tied to the domain of the loaded URL — `localhost:<port>`
> in dev, the deployed name (e.g. `anytub3tv.paseo`) in production (so Bulletin writes only really
> validate once deployed under the correct name). To test inside the host, prefer **`npm run preview`**
> (built bundle) over `npm run dev`: Vite dev mode runs into the host's CSP restrictions.

---

## Host-side status (outside product-sdk — design doc 3 §7)

Resolved since the design documents:

- **Deployment**: `bulletin-deploy` with the product manifest (see above) — there is no `dot deploy` CLI.
- **Bulletin storage**: the **host's preimage manager** (`getPreimageManager().submit/lookup`),
  sponsored via the `BulletinAllowance` — no RPC connection or signer on the product side; a direct
  `CloudStorageClient` (`createLazySigner(getProductAccountSigner)`) is the fallback for hosts
  without one. Allowances are never requested up front (RFC-0010 provisions them implicitly on
  the first write); a write failing for want of one re-requests it **once** and retries
  (`lib/allowance.ts`) — the only path that may show the host dialog.
- **Handshake**: `init()` waits for the transport to report `connected`, then calls
  `system.handshake()`; `UnsupportedProtocolVersion` blocks with a redeploy hint, a host that never
  answers (the SDK's 10 s deadline rejects) blocks with transport diagnostics — every later call
  would otherwise wait out its 120 s deadline. Other domain errors only warn.
- **Contacts and recipient keys (R2)**: the product host-api exposes no contact directory and no
  recipient key, so the product never seals to a contact itself. A share is a copyable code;
  "Send to chat" posts a Custom message into a product room the host may surface (current host
  builds answer `registerRoom` with "Not implemented", so that path stays best-effort).

Still marked `[confirm host]` in `src/lib/bridge/real.ts`:

1. **Theme payload**: the bridge tolerates `{ variant: "Light" | "Dark" }` as well as a string
   containing "dark".
2. **Chat**: room registration, and the confidentiality of Custom messages once a host implements chat.
3. **External fetches in-host**: guide downloads (`httpGet*`) fall under the host's external-access
   permission like the streams — the prompt/allow behaviour on Mobile and Desktop is unverified.

Everything else (components, theming, the flows above, continuity) is anchored to the real APIs
of the installed packages.
