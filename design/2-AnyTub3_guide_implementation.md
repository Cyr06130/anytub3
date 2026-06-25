# AnyTub3 — Guide d'implémentation (du design au lancement)

> Companion du *Plan de design — continuité inter-hosts*. Ici on passe à l'exécution : scaffold → câblage SDK → 4 flux → UI → lancement.
>
> **UI / TrUI :** je n'ai pas pu lire ton `~/Dev/trUI` (sandbox sans accès à ta machine). La couche UI ci-dessous est ancrée sur **`polkadot-design-system`** (tokens Figma, vérifiés depuis le site docs de `product-sdk`) — la fondation de TrUI. Elle est isolée dans `src/ui/` : dès que tu partages TrUI, on substitue les primitives (`Button`, `Card`, `List`…) sans toucher au reste. Les points à confirmer contre TrUI sont marqués **[confirmer TrUI]**.
>
> **Source des API SDK :** toutes les méthodes citées existent dans `paritytech/product-sdk` (packages `host`, `cloud-storage`, `statement-store`, `crypto`, `keys`). SDK marqué « prototype / non audité » par Parity.

---

## 0. Identité de l'app

| Champ | Valeur |
|---|---|
| Nom | **AnyTub3** |
| `dotNsIdentifier` | `anytub3.dot` |
| `appName` (Statement Store, topic1) | `anytub3` |
| Domaines de dérivation de clés | `anytub3/np-channel/v1`, `anytub3/np-enc/v1`, `anytub3/lib-channel/v1`, `anytub3/lib-enc/v1`, `playlist:<id>` |

---

## 1. Stack & décisions

| Choix | Pourquoi |
|---|---|
| **Vite + TypeScript + React** | Les démos `product-sdk` sont Vite+TS ; React pour une UI riche pilotée par composants (et TrUI est selon toute vraisemblance React — **[confirmer TrUI]**). |
| **Tailwind v4 (`@theme inline`)** | C'est exactement l'approche du design system (`docs/app/globals.css`) : tokens sémantiques en CSS vars, mappés en utilitaires. |
| **`polkadot-design-system` tokens** | Source de vérité visuelle. TrUI est bâti dessus → en s'y ancrant, le swap vers TrUI est cosmétique. |
| **`hls.js`** | Lecture HLS (cas IPTV dominant : flux live). |
| **Couche `lib/` (façade SDK)** | Isole le code applicatif des API host volatiles. Tout passe par `@parity/product-sdk-host`, jamais par `@novasamatech/*` en direct (le wrapper host est volatile). |
| **Couche `ui/` (façade composants)** | Absorbe TrUI quand dispo, sinon primitives sur tokens DS. |

---

## 2. Arborescence

```
anytub3/
├─ index.html
├─ vite.config.ts
├─ package.json
├─ tsconfig.json
├─ playwright.config.ts
├─ src/
│  ├─ main.tsx                 # bootstrap : detect host, theme, monte <App/>
│  ├─ App.tsx                  # routing d'écrans (Library / Player / Add / Share)
│  ├─ styles/
│  │  └─ tokens.css            # polkadot-design-system (vérifié) + accents marque
│  ├─ lib/                     # FAÇADE SDK — code applicatif n'importe que ça
│  │  ├─ host.ts               # truapi, accounts, userId, entropy, theme, allowance
│  │  ├─ keys.ts               # deriveEntropy → KeyManager ; clés sym + Curve25519
│  │  ├─ bulletin.ts           # Cloud Storage : store/fetch chiffré + index biblio
│  │  ├─ sync.ts               # continuité : ChannelStore now-playing + lib-head
│  │  ├─ share.ts              # sealedBox + chat (contacts)
│  │  └─ m3u.ts                # parse + sanitize
│  ├─ player/
│  │  └─ HlsPlayer.tsx         # wrapper hls.js
│  ├─ ui/                      # FAÇADE COMPOSANTS — swap TrUI ici
│  │  ├─ Button.tsx  Card.tsx  List.tsx  Sheet.tsx  Toast.tsx  Spinner.tsx
│  │  └─ index.ts
│  ├─ screens/
│  │  ├─ Library.tsx  Player.tsx  AddPlaylist.tsx  ShareSheet.tsx
│  └─ state/
│     └─ store.ts              # état app (playlist courante, biblio, now-playing)
└─ e2e/                        # Playwright contre @parity/host-api-test-sdk
   ├─ boot.spec.ts  resume.spec.ts  share.spec.ts
```

---

## 3. `package.json` (dépendances réelles)

```jsonc
{
  "name": "anytub3",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@parity/product-sdk-host": "^<latest>",
    "@parity/product-sdk-cloud-storage": "^<latest>",
    "@parity/product-sdk-statement-store": "^<latest>",
    "@parity/product-sdk-crypto": "^<latest>",
    "@parity/product-sdk-keys": "^<latest>",
    "@parity/product-sdk-address": "^<latest>",
    "@parity/product-sdk-signer": "^<latest>",
    "hls.js": "^1.5",
    "react": "^18",
    "react-dom": "^18"
    // + @parity/trui  ← [confirmer TrUI : nom + version exacts]
  },
  "devDependencies": {
    "@parity/host-api-test-sdk": "^<latest>",
    "@playwright/test": "^<latest>",
    "tailwindcss": "^4",
    "@tailwindcss/vite": "^4",
    "typescript": "^5",
    "vite": "^5",
    "@vitejs/plugin-react": "^4"
  }
}
```

> Tu peux aussi prendre l'umbrella `@parity/product-sdk` (re-exporte tout) si tu préfères un seul import ; pour le tree-shaking, les sous-packages ciblés sont mieux.

---

## 4. Bootstrap + theming host

### `src/styles/tokens.css` (extrait vérifié de `polkadot-design-system`)

```css
@import "tailwindcss";

:root {
  /* neutres (échelle primitive) */
  --color-neutral-white:#fff; --color-neutral-50:#fafafa; --color-neutral-100:#f5f5f5;
  --color-neutral-150:#ebebeb; --color-neutral-200:#e5e5e5; --color-neutral-500:#737373;
  --color-neutral-850:#1f1f1f; --color-neutral-900:#171717; --color-neutral-950:#0a0a0a; --color-neutral-black:#000;
  /* fg / bg / action / border (sémantiques — NE PAS mettre de hex dans les composants) */
  --fg-primary:var(--color-neutral-950); --fg-secondary:var(--color-neutral-600); --fg-tertiary:var(--color-neutral-500);
  --fg-error:#dc2626; --fg-success:#16a34a;
  --bg-surface-main:var(--color-neutral-50); --bg-surface-container:#fff; --bg-surface-nested:var(--color-neutral-50);
  --bg-surface-overlay:rgba(0,0,0,.48);
  --bg-action-primary:var(--color-neutral-black); --bg-action-primary-hover:var(--color-neutral-850);
  --bg-action-secondary:var(--color-neutral-100); --bg-action-secondary-hover:var(--color-neutral-150);
  --border-default:var(--color-neutral-100); --border-divider:var(--color-neutral-100);
  --focus-ring:#000;
  --shadow-1:0 4px 24px -4px rgba(0,0,0,.16); --shadow-2:0 8px 32px -4px rgba(0,0,0,.24);
  --radius-container:16px; --radius-nested:12px; --radius-small:8px;
  /* accents MARQUE Polkadot — usage PARCIMONIEUX (now-playing, logo) */
  --accent-pink:#FF2670; --accent-violet:#7916F3;
}
.dark {
  --fg-primary:var(--color-neutral-100); --fg-secondary:var(--color-neutral-400); --fg-tertiary:var(--color-neutral-600);
  --bg-surface-main:var(--color-neutral-950); --bg-surface-container:var(--color-neutral-900); --bg-surface-nested:var(--color-neutral-850);
  --bg-action-primary:var(--color-neutral-150); --bg-action-primary-hover:var(--color-neutral-200);
  --bg-action-secondary:var(--color-neutral-800);
  --border-default:var(--color-neutral-800); --border-divider:var(--color-neutral-800);
  --focus-ring:#fff;
}

@theme inline {
  --color-primary:var(--fg-primary); --color-secondary:var(--fg-secondary); --color-tertiary:var(--fg-tertiary);
  --color-surface-main:var(--bg-surface-main); --color-surface-container:var(--bg-surface-container);
  --color-action-primary:var(--bg-action-primary); --color-action-secondary:var(--bg-action-secondary);
  --color-error:var(--fg-error); --color-success:var(--fg-success);
  --radius-container:16px; --radius-nested:12px; --radius-small:8px;
  --font-sans:Inter, system-ui, sans-serif;
  --font-display:"DM Serif Display", serif;
}

/* règles imposées par le design system : */
@layer base { *,::before,::after { border-color: var(--border-default); } }   /* bordure par défaut */
*:focus-visible { outline:2px solid var(--focus-ring); outline-offset:2px; box-shadow:none; }  /* outline, PAS ring Tailwind */
html,body { background:var(--bg-surface-main); color:var(--fg-primary); }
```

**Règles non négociables du design system :**
- Pas de `dark:` dans les composants — les vars sémantiques basculent toutes seules via `.dark`.
- Focus = `outline` (pas `ring`/`box-shadow`).
- Surfaces **monochromes** ; **pink/violet en accent seulement** (indicateur « en lecture », logo). Polices : Inter (corps) + DM Serif Display (titres). Rayons 16/12/8.

### `src/lib/host.ts` (façade host)

```ts
import {
  getTruApi, isInsideContainer, getAccountsProvider,
  requestResourceAllocation, createProofAuthorized, enumValue,
} from "@parity/product-sdk-host";

export const inHost = () => isInsideContainer();

/** Sync le dark-mode du host vers <html>.dark */
export async function bindHostTheme() {
  const tru = await getTruApi();
  tru?.themeSubscribe(undefined, (theme: unknown) => {
    const dark = String(theme).toLowerCase().includes("dark");          // [confirmer forme exacte du payload theme]
    document.documentElement.classList.toggle("dark", dark);
  });
}

export async function currentAccount() {
  const ap = await getAccountsProvider();
  // userId / compte courant — voir getUserId()/requestLogin() sur l'accounts provider
  return ap;
}

/** Pré-alloue les autorisations (1 prompt unique, pas de re-prompt ensuite). */
export async function preallocate() {
  return requestResourceAllocation([
    { tag: "BulletinAllowance", value: undefined },
    // { tag: "StatementStoreAllowance", value: undefined }  // [confirmer le variant exact dans AllocatableResource]
  ]);
}

export { createProofAuthorized, enumValue };
```

### `src/main.tsx`

```tsx
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import { App } from "./App";
import { inHost, bindHostTheme } from "./lib/host";

(async () => {
  if (!(await inHost())) {
    // dev hors host : on émule via @parity/host-api-test-sdk (voir §8)
    console.warn("AnyTub3 hors host container");
  }
  await bindHostTheme();
  createRoot(document.getElementById("root")!).render(<App />);
})();
```

---

## 5. Couche d'accès SDK (`lib/`)

### `src/lib/keys.ts` — clés déterministes cross-host

```ts
import { deriveEntropy } from "@parity/product-sdk-host";
import { KeyManager } from "@parity/product-sdk-keys";

const enc = (s: string) => new TextEncoder().encode(s);

/** Master key déterministe & identique sur Mobile/Desktop/Web (RFC-0007). */
export async function masterKey(): Promise<KeyManager> {
  const entropy = await deriveEntropy(enc("anytub3/master/v1"));   // déterministe / wallet
  return KeyManager.fromRawKey(entropy);                            // PAS fromSignature (sr25519 non-déterministe)
}

export async function symKey(ctx: string) {
  return (await masterKey()).deriveSymmetricKey(ctx);
}
/** Curve25519 pour recevoir des partages scellés. */
export async function myEncryptionKeypair() {
  return (await masterKey()).deriveKeypairs().encryption;
}
```

### `src/lib/bulletin.ts` — playlists durables (CID)

```ts
import { CloudStorageClient, cidToPreimageKey } from "@parity/product-sdk-cloud-storage";
import { aesGcmEncryptPacked, aesGcmDecryptPacked } from "@parity/product-sdk-crypto";
import { symKey } from "./keys";

let client: CloudStorageClient | null = null;
async function cs(signer: unknown) {
  return (client ??= await CloudStorageClient.create({ environment: "paseo", signer } as any));
}

export async function storePlaylist(signer: unknown, id: string, playlist: unknown) {
  const key  = await symKey(`playlist:${id}`);
  const blob = aesGcmEncryptPacked(new TextEncoder().encode(JSON.stringify(playlist)), key);
  const c    = await cs(signer);
  const auth = await c.checkAuthorization(/* address */ "" as any);   // sur testnet géré : Console faucet
  return await c.store(blob).submit();                                // → CIDv1 (immuable, durable)
}

export async function loadPlaylist<T>(signer: unknown, id: string, cid: string): Promise<T> {
  const key  = await symKey(`playlist:${id}`);
  const c    = await cs(signer);
  const blob = await c.fetchBytes(cid);                               // ou getPreimageManager().lookup(cidToPreimageKey(cid), cb)
  return JSON.parse(new TextDecoder().decode(aesGcmDecryptPacked(blob, key)));
}
```

### `src/lib/sync.ts` — **continuité inter-hosts** (le cœur)

```ts
import { StatementStoreClient, ChannelStore } from "@parity/product-sdk-statement-store";
import { deriveEntropy } from "@parity/product-sdk-host";
import { aesGcmEncryptPacked, aesGcmDecryptPacked, toHex } from "@parity/product-sdk-crypto";

const enc = (s: string) => new TextEncoder().encode(s);

export type NowPlaying = {
  v: 1; playlistCid: string; channelId: string; positionMs?: number; timestamp: number;
};
type Envelope = { timestamp: number; ct: number[] };   // timestamp EN CLAIR (LWW) ; ct = aesGcmPacked

let np: ChannelStore<Envelope> | null = null;
let npChannelName = "", npKey = new Uint8Array();

/** À l'init : dérive canal + clé (identiques sur tous les hosts, non devinables) et connecte. */
export async function initSync(accountId: [string, number]) {
  npChannelName = `anytub3/np/${toHex(await deriveEntropy(enc("anytub3/np-channel/v1")))}`;
  npKey         = await deriveEntropy(enc("anytub3/np-enc/v1"));
  const ssc = new StatementStoreClient({ appName: "anytub3", defaultTtlSeconds: 120 });
  await ssc.connect({ mode: "host", accountId });        // host crée le proof ; sponsorisé via allowance
  np = new ChannelStore<Envelope>(ssc, { topic2: "anytub3-np" });
}

function seal(s: NowPlaying): Envelope {
  return { timestamp: s.timestamp, ct: Array.from(aesGcmEncryptPacked(enc(JSON.stringify(s)), npKey)) };
}
function open(e: Envelope): NowPlaying {
  return JSON.parse(new TextDecoder().decode(aesGcmDecryptPacked(new Uint8Array(e.ct), npKey)));
}

/** Publie l'état (changement de chaîne / pause) + heartbeat pour rafraîchir le TTL. */
export async function publishNowPlaying(s: Omit<NowPlaying, "timestamp">) {
  await np!.write(npChannelName, seal({ ...s, v: 1, timestamp: Date.now() }));
}
let hb: number | undefined;
export function startHeartbeat(get: () => Omit<NowPlaying, "timestamp"> | null) {
  stopHeartbeat();
  hb = window.setInterval(() => { const s = get(); if (s) void publishNowPlaying(s); }, 15_000);
}
export function stopHeartbeat() { if (hb) clearInterval(hb); hb = undefined; }

/** Reprise : lit la valeur courante (handoff live) + s'abonne aux changements. */
export function readNowPlaying(): NowPlaying | null {
  const e = np?.read(npChannelName); return e ? open(e) : null;
}
export function onNowPlayingChange(cb: (s: NowPlaying) => void) {
  return np!.onChange((_n, e) => cb(open(e)));
}
```

> **`library-head`** (reprise à froid / liste des playlists sur appareil neuf) : même schéma, second `ChannelStore` sur le canal dérivé de `anytub3/lib-channel/v1`, valeur `{ indexCid, ts }`, TTL long, heartbeat au premier plan, miroir dans le local-storage host. L'algorithme complet de reprise est dans le plan de design §8.

### `src/lib/share.ts` — partage via contacts

```ts
import { sealedBoxEncrypt, sealedBoxDecrypt } from "@parity/product-sdk-crypto";
import { getChatManager, matchChatCustomRenderers } from "@parity/product-sdk-host";
import { myEncryptionKeypair } from "./keys";

const MSG = "anytub3/playlist-share";

export async function sharePlaylist(roomId: string, recipientCurve25519: Uint8Array, ptr: {
  playlistCid: string; key: number[]; title: string;
}) {
  const sealed = sealedBoxEncrypt(new TextEncoder().encode(JSON.stringify({ v: 1, ...ptr })), recipientCurve25519);
  const chat = await getChatManager();
  await chat?.sendMessage(roomId, { messageType: MSG, payload: sealed });   // [confirmer signature sendMessage]
}

/** Renderer inline + ingestion à la réception. */
export async function listenShares(onPointer: (ptr: any) => void) {
  const chat = await getChatManager();
  const { encryption } = await myEncryptionKeypair();
  chat?.subscribeAction?.(matchChatCustomRenderers({
    [MSG]: (params: any) => {
      const ptr = JSON.parse(new TextDecoder().decode(sealedBoxDecrypt(params.payload, encryption.secretKey)));
      onPointer(ptr);
      return /* élément rendu inline dans le chat */ null as any;
    },
  }));
}
```

> **Découverte de la clé Curve25519 du destinataire** (seule étape non câblée) : publier ta clé publique d'encryption sur un topic « profil » bien connu, ou via un handshake chat. À spécifier avec l'équipe host (probable champ profil/People Chain). Voir plan de design R2.

### `src/lib/m3u.ts` — ingestion + sanitization

```ts
const SAFE = /^https?:\/\//i;
export type Entry = { id: string; name: string; url: string; logo?: string; group?: string };

export function parseM3U(text: string): Entry[] {
  const out: Entry[] = []; const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("#EXTINF")) continue;
    const meta = lines[i], url = (lines[i + 1] ?? "").trim();
    if (!SAFE.test(url)) continue;                                   // refuse javascript:/data:/etc.
    const name = (meta.split(",").pop() ?? "Chaîne").trim();
    const logo = /tvg-logo="([^"]*)"/.exec(meta)?.[1];
    const group = /group-title="([^"]*)"/.exec(meta)?.[1];
    out.push({
      id: crypto.randomUUID(),
      name,                                                          // échapper à l'affichage (jamais innerHTML)
      url,
      logo: logo && SAFE.test(logo) ? logo : undefined,             // logo http(s) only
      group,
    });
  }
  return out;
}
```

---

## 6. Les 4 flux — où ça s'assemble

| Flux | Modules | Séquence |
|---|---|---|
| **Ingestion m3u** | `m3u.ts`, `HlsPlayer` | upload/URL → `parseM3U` → liste → `hls.js` au tap d'une chaîne |
| **Sauvegarde** | `bulletin.ts`, `keys.ts` | encrypt(corps, `playlist:<id>`) → `store().submit()` → CID → MAJ index biblio |
| **Continuité** | `sync.ts`, `keys.ts` | `initSync` → à chaque tune `publishNowPlaying` + `startHeartbeat` ; à l'ouverture `readNowPlaying`/`onNowPlayingChange` → reprendre |
| **Partage** | `share.ts`, `keys.ts` | seal pointeur → `getChatManager().sendMessage` ; réception → `sealedBoxDecrypt` → `loadPlaylist` → biblio |

### `HlsPlayer.tsx` (essentiel)

```tsx
import Hls from "hls.js";
import { useEffect, useRef } from "react";

export function HlsPlayer({ src, onPlaying }: { src: string; onPlaying?: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current!; let hls: Hls | undefined;
    if (Hls.isSupported()) { hls = new Hls(); hls.loadSource(src); hls.attachMedia(v); }
    else if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = src; }   // Safari natif
    v.addEventListener("playing", () => onPlaying?.());
    return () => hls?.destroy();
  }, [src]);
  return <video ref={ref} controls playsInline className="w-full rounded-[var(--radius-nested)] bg-black" />;
}
```

> Live = on rejoint le *live edge* (la « position » ne s'applique qu'au VOD/catch-up). CORS : beaucoup de flux exigent un proxy / en-têtes permissifs — à documenter par flux.

---

## 7. UI — écrans & couche `ui/`

### `ui/` : primitives sur tokens (à remplacer par TrUI)

```tsx
// ui/Button.tsx — variante primaire = action-primary (noir clair / clair sombre)
export function Button({ variant = "primary", ...p }: any) {
  const base = "px-4 h-11 rounded-[var(--radius-small)] font-medium transition-colors";
  const styles = variant === "primary"
    ? "bg-[var(--bg-action-primary)] text-[var(--fg-primary-inverted)] hover:bg-[var(--bg-action-primary-hover)]"
    : "bg-[var(--bg-action-secondary)] text-[var(--fg-primary)] hover:bg-[var(--bg-action-secondary-hover)]";
  return <button className={`${base} ${styles}`} {...p} />;
}
// ui/Card.tsx — surface conteneur, rayon 16
export const Card = (p: any) =>
  <div className="bg-[var(--bg-surface-container)] rounded-[var(--radius-container)] shadow-[var(--shadow-1)] p-4" {...p} />;
```

> **Substitution TrUI :** `ui/index.ts` re-exporte ; quand TrUI arrive, `export { Button, Card, List } from "@parity/trui"` et on supprime les implémentations locales. Le reste de l'app importe toujours depuis `@/ui`. **[confirmer noms/props TrUI]**

### Écrans

| Écran | Contenu | Tokens / notes |
|---|---|---|
| **Library** | Cartes de playlists + grille de chaînes ; bouton « Ajouter » | `Card` + `List` ; indicateur **« en lecture »** en `--accent-pink` (seul accent) |
| **Player** | `HlsPlayer` plein cadre + barre titre chaîne + bouton Partager | vidéo en `--radius-nested`, fond noir |
| **AddPlaylist** | Champ URL / upload `.m3u` ; preview parsée | états error/success via `--fg-error`/`--fg-success` |
| **ShareSheet** | Liste de contacts (host chat) → tap = `sharePlaylist` | `Sheet` (overlay `--bg-surface-overlay`) |
| **Toast « repris sur X »** | Quand `onNowPlayingChange` bascule depuis un autre host | `Toast`, discret, 2-3 s |

**Direction visuelle (modèle DS / TrUI) :** monochrome, dense mais aéré, Inter + DM Serif Display pour les titres, focus en outline, accents pink/violet **rares**. Pas le dark-néon habituel des apps IPTV — c'est ce qui « ressemble à un product Polkadot ».

---

## 8. Lancer — dev → host → production

### Dev hors host (rapide)
```bash
pnpm dev          # vite : l'app charge, host absent → mode dégradé
```
Émule le host avec **`@parity/host-api-test-sdk`** (présent dans les démos `product-sdk`) pour exercer accounts/entropy/statement-store/cloud-storage sans Mobile/Desktop réel.

### Dev dans le host réel
- Build/serve l'app sur une URL locale, puis charge-la dans le host (Desktop accepte une URL de product en dev — **[confirmer le flux de chargement dev avec l'équipe host]**).
- Détection : `isInsideContainer()` doit renvoyer `true` (iframe / `__HOST_WEBVIEW_MARK__` / `__HOST_API_PORT__`).

### Production (`.dot`)
1. `pnpm build` → bundle statique.
2. Déployer le bundle sur **Bulletin** (les products Polkadot persistent sur Bulletin) → CID.
3. Enregistrer `anytub3.dot` (dotNS) pointant vers le product. **[confirmer la procédure exacte d'enregistrement/déploiement `.dot` avec l'équipe host]**
4. Le host charge AnyTub3 par son nom dotNS ; il fournit compte, signer, product account (scope `anytub3.dot`), entropy, Cloud Storage, Statement Store, chat.

> Ce que je peux garantir depuis le code : le modèle product/host, `dotNsIdentifier`, les API consommées. La **mécanique précise de packaging `.dot` + enregistrement dotNS** n'est pas dans `product-sdk` que j'ai lu → à confirmer en interne (probable doc host/dotNS).

---

## 9. Tests e2e (pattern des démos)

Les démos `statement-store-demo` ont `e2e/{boot,publish,subscribe,channel}.spec.ts` (Playwright + `@parity/host-api-test-sdk`). À répliquer :

| Spec | Vérifie |
|---|---|
| `boot.spec.ts` | détection host, theme appliqué, accounts résolus |
| `resume.spec.ts` | **le cœur** : host A publie `now-playing` → host B (autre contexte) lit la même chaîne ; `onChange` bascule en live ; reprise à froid via `library-head` |
| `share.spec.ts` | seal → envoi → réception → `sealedBoxDecrypt` → playlist en biblio |

---

## 10. Séquence de lancement (phases → MVP lançable)

| Phase | Livrable | « Done » quand |
|---|---|---|
| **P1 Socle** | Vite+React+TS, tokens.css, `host.ts`, détection + theme, `m3u.ts`, `HlsPlayer` | une chaîne d'un `.m3u` joue dans le host |
| **P2 Persistance** | `keys.ts`, `bulletin.ts`, index biblio | playlist sauvegardée → CID → relue après reload |
| **P3 Continuité Niv.1** | `sync.ts` now-playing + heartbeat + `createProofAuthorized` | ouvrir sur un 2e host (ou 2e contexte) reprend la chaîne |
| **P4 Continuité Niv.2** | `library-head`, cache local, algo reprise complet | appareil neuf retrouve playlists + dernière chaîne |
| **P5 Partage** | `share.ts`, ShareSheet, renderer, découverte de clé | un contact reçoit et lit une playlist partagée |
| **P6 UI/Durcissement** | swap **TrUI**, CSP, CORS, budgets taille, e2e verts | revue design OK + e2e CI verts |

---

## 11. Checklist pré-lancement

- [ ] **XSS m3u** : URLs `http(s)` only (flux + logo), aucun `innerHTML` sur nom/groupe. (Risque élevé — plan de design R3)
- [ ] **CSP** stricte (blob/worker pour hls.js justifiés) + **HSTS**.
- [ ] **CORS** flux HLS documenté / proxy au besoin.
- [ ] **Budgets Statement Store** : `now-playing` + `library-head` < 1024 o cumulés ; chaque statement < 512 o.
- [ ] **Domaines de clés** séparés (jamais de réutilisation inter-domaine).
- [ ] **`createProofAuthorized`** branché → l'utilisateur ne paie/ne signe rien par update.
- [ ] **Reprise à froid** : heartbeat `library-head` au premier plan ; (option) ancre on-chain si garantie dure voulue (plan de design §8).
- [ ] **Pas de `@novasamatech/*` importé en direct** — uniquement via `@parity/product-sdk-host`.
- [ ] **Swap TrUI** effectué : `ui/index.ts` pointe sur les composants TrUI ; tokens identiques.

---

*Tout ce qui est marqué **[confirmer …]** dépend soit de TrUI (que je n'ai pas pu lire — envoie-le pour la fidélité composant), soit de la procédure de déploiement host/dotNS (hors `product-sdk`). Le reste est ancré sur le source réel du SDK.*
