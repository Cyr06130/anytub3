# AnyTub3

**Decentralized `.dot` IPTV with inter-host continuity** — a Polkadot *product* (webview)
that runs inside the Mobile / Desktop / Web host.

- Pure-web IPTV playback (`hls.js` + an in-house, sanitized m3u parser).
- Durable, encrypted playlists on **Bulletin Chain** (Cloud Storage → CID).
- **Inter-host continuity**: opening AnyTub3 on another device resumes the
  current channel, via an encrypted `now-playing` state published on the
  **Statement Store** (LWW), with a durable library index (`library-head`) for cold resume.
- Playlist sharing with the host's contacts via a sealed pointer (`sealedBox`).
- Player with **fullscreen**, a **side channel list** during playback,
  **light/dark theme toggle**, and playlist **editing / deletion**.

Implemented from the documents in `design/` (design plan, implementation guide,
TrUI integration + deployment).

---

## Status

Everything is wired to the **real Parity SDK** (`@parity/product-sdk-*`) and **TrUI**
(`@novasamatech/tr-ui`). The app is also **fully runnable off-host** thanks to a
`lib/bridge` facade that switches to a local bridge (`BroadcastChannel` +
`localStorage`) — two tabs then simulate two hosts sharing a wallet.

Verified (`npm run build` + `npm run test:e2e`, 6 specs green):

| Flow | Verified |
|---|---|
| Boot + host theming (light/dark) | ✅ `boot.spec.ts` |
| m3u ingestion + sanitization + Bulletin save + HLS playback | ✅ `playlist.spec.ts` (HLS manifest actually loaded) |
| **Continuity — cold resume** (a new host restores the library + last channel) | ✅ `resume.spec.ts` |
| **Continuity — live handoff** (switching channels on host A switches host B) | ✅ `resume.spec.ts` |
| Outbound sharing (sealed to a contact) | ✅ `share.spec.ts` |
| Inbound reception (unsealed + imported into the library) | ✅ `share.spec.ts` |
| Light/dark theme toggle · fullscreen · side list | ✅ `ui.spec.ts` / `playlist.spec.ts` |
| Editing (rename / remove channels) + deletion | ✅ `ui.spec.ts` |

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 — off-host demo mode ("Demo mode" badge)
npm run build        # static bundle → ./build  (output expected by `dot deploy`)
npm run test:e2e     # Playwright (build + preview + 6 specs)
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
tr-ui included, is rem-based) and pads for overscan. `e2e/tv.spec.ts` drives all of
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

## Architecture

The application code **never** depends directly on the host SDK: everything goes through
the `lib/bridge` facade. Crypto and key derivation stay on the app side (pure JS, runs
everywhere); the bridge only provides the primitives owned by the host.

```
src/
├─ lib/
│  ├─ bridge/
│  │  ├─ types.ts      # HostBridge interface (the only host coupling point)
│  │  ├─ real.ts       # Parity SDK (dynamically imported → 0 chain deps off-host)
│  │  ├─ mock.ts       # BroadcastChannel + localStorage (demo/dev/e2e)
│  │  └─ index.ts      # getBridge(): detects the host, picks the impl
│  ├─ config.ts        # .dot identity, key domains, topics, heartbeats
│  ├─ keys.ts          # deriveEntropy → KeyManager (sym keys + Curve25519)
│  ├─ bulletin.ts      # encrypted store/fetch + library index (CID)
│  ├─ sync.ts          # continuity: now-playing + library-head channels (LWW)
│  ├─ share.ts         # sealedBox + chat (contacts)
│  ├─ m3u.ts           # parse + sanitization (XSS, design R3)
│  └─ sample.ts        # demo playlist (test HLS streams)
├─ player/HlsPlayer.tsx
├─ screens/            # Library · Player · AddPlaylist · ShareSheet (TrUI)
├─ state/store.ts      # app state + orchestration of the 4 flows + resume algo
├─ HostThemeBridge.tsx # host theme → TrUI setMode
├─ App.tsx · main.tsx
└─ styles/app.css      # Tailwind v4 + TrUI tokens (styles.css + preset)
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
   wallet entropy** (identical across all hosts, opaque to others). Heartbeat ~15 s to
   refresh the TTL. `timestamp` in cleartext = last-write-wins.
2. **Level 2 — cold resume**: `library-head` (`{indexCid, ts}`) points to a durable
   library index on Bulletin; mirrored in a local per-device cache.

**Resume algorithm** (on opening, any host): restore the library from
`library-head` → resume the freshest `now-playing` (channel vs cache) → subscribe to remote
changes (handoff) and incoming shares. See `state/store.ts → bootstrap()`.

Keys: `deriveEntropy(ctx)` (RFC-0007, deterministic/wallet) → `KeyManager.fromRawKey`, **not**
`fromSignature` (sr25519 signatures are non-deterministic — unsuitable cross-host). Context
domains are separated per usage (see `config.ts → KEY_CTX`).

---

## Security

- **m3u XSS (R3)**: `http(s)` URLs only (stream + logo), `javascript:`/`data:` rejected;
  names/groups rendered by React (never `innerHTML`). See `lib/m3u.ts`.
- **Strict CSP** in `index.html` (`worker-src blob:` justified for hls.js).
- **Statement Store budgets**: `now-playing` (~150-250 B) + `library-head` (~120 B) stay
  under `MAX_USER_TOTAL` (1024 B) and each statement < 512 B.
- Encryption: `aesGcmEncryptPacked` for contents/states; `sealedBox` for shares.

---

## `.dot` deployment

Deployment is done with **`bulletin-deploy`** ([paritytech/bulletin-deploy](https://github.com/paritytech/bulletin-deploy),
on npm; also published as `@parity/polkadot-app-deploy`, alias `pad`). It pushes the static
bundle to the **Bulletin Chain** and registers the name via **DotNS**. Default network:
`paseo-next-v2` testnet. Requires **Node ≥ 22**.

```bash
npm install -g bulletin-deploy
npm run build                         # → ./build
bulletin-deploy login                 # scan the QR with Polkadot Mobile (no mnemonic on disk)
bulletin-deploy ./build anytub3.dot   # add --js-merkle if the IPFS Kubo binary is missing
```

→ served at `https://anytub3.dot.li` (Web) and `anytub3.dot` (Desktop/Mobile). The host then
loads AnyTub3 by its dotNS name and provides account, signer, product account (scope `anytub3.dot`),
entropy, Bulletin, Statement Store and chat.

**Prerequisites (see the repo's `DEPLOYMENT.md`):** a `.dot` name (on the Parity testnet,
registration may require a Proof-of-Personhood — request via an issue on [paritytech/dotns](https://github.com/paritytech/dotns/issues));
Bulletin storage authorization (managed by `//Alice` on testnet; a classic first-run error:
`not authorized to upload`); a little Asset Hub funds for the DotNS fees ([faucet](https://faucet.polkadot.io/)).

> **Dev inside the host:** the product account is tied to the domain of the loaded URL — `localhost:<port>`
> in dev, `anytub3.dot` once deployed (so Bulletin writes only really validate
> once deployed under the correct name). To test inside the host, prefer **`npm run preview`**
> (built bundle) over `npm run dev`: Vite dev mode runs into the host's CSP restrictions.

---

## Points to confirm on the host side (outside TrUI / product-sdk — design doc 3 §7)

Marked `[confirmer host]` in `src/lib/bridge/real.ts`:

1. **`themeSubscribe` payload**: the bridge already tolerates `{ variant: "Light" | "Dark" }`
   as a string containing "dark".
2. **Discovering the recipient's Curve25519 key (R2)**: `listContacts()` returns the
   rooms (`roomId`/`participatingAs`); the recipient's display name and encryption key
   remain to be wired (profile topic / People Chain).
3. **`dot deploy` CLI**: path argument, auth, target network, dotNS registration.
4. **Bulletin storage**: we favor the **host's preimage manager**
   (`getPreimageManager().submit/lookup`), sponsored via the `BulletinAllowance` —
   no RPC connection or signer on the product side. Fall back to a direct
   `CloudStorageClient` (`createLazySigner(getProductAccountSigner)`) if the host doesn't
   expose a preimage manager.

Everything else (TrUI components, theming, the 4 flows, continuity) is anchored to the real APIs
of the installed packages.
