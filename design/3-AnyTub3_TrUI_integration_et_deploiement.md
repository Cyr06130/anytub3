# AnyTub3 × TrUI — intégration UI réelle + déploiement `.dot`

> **Addendum** au *Guide d'implémentation*. Remplace ses sections **§4 (theming)**, **§7 (UI)** et **§8 (déploiement)**. Le reste du guide (façade `lib/`, les 4 flux, tests, phases, sécurité) reste valable tel quel.
>
> TrUI = **`@novasamatech/tr-ui`** v0.2.x, Apache-2.0. React + Tailwind v4, composants sur **Radix UI** + `class-variance-authority`, toasts **sonner**, icônes **lucide**, identicons Polkadot. Toutes les API ci-dessous sont lues dans le repo que tu as fourni. Plus aucun `[confirmer TrUI]` : il ne reste que 3 inconnues hors-TrUI, listées en fin.

---

## 1. TrUI en bref

| Élément | Détail |
|---|---|
| Package | `@novasamatech/tr-ui` |
| Peers | `react`, `react-dom`, **`react-compiler-runtime`** (TrUI est compilé avec le React Compiler) |
| Entrées | `.` (composants) · `./styles.css` · `./themes` · `./tailwind.preset` (export par défaut = `spektrPreset`) |
| Theming | `ThemeProvider` (contexte maison, **pas** next-themes) + `useTheme()` → `{ mode, setMode, theme, setTheme }` ; `setMode('dark'\|'light')` applique les CSS vars **et** toggle `.dark` |
| Thèmes fournis | `defaultTheme`, `amberTheme`, `techTheme` (type `ThemeJSON = { light?: CSSVars; dark?: CSSVars }`) |
| Utilitaire | `cn()` (clsx + tailwind-merge) |
| Classes tokens | sémantiques via le preset : `bg-bg-action-primary`, `text-fg-primary`, `text-fg-secondary`, `bg-bg-selection-container-hover`, `border-border-secondary`, `bg-bg-status-error`… |

**Composants disponibles (extraits de `src/index.ts`) :** `Button`(+`buttonVariants`), `Badge`, `Card`(compound), `Input`, `Select`, `Checkbox`, `Switch`, `Accordion`, `Alert`, `AlertDialog`, `Dialog`(compound), `DropdownMenu`, `Empty`(compound), `Popover`, `RadioGroup`, `ListItem`(variantes), `ScrollArea`, `Skeleton`, `Tabs`, `Tooltip`+`TooltipProvider`, `Label`, `Combobox`, `Autocomplete`, `Copy`, `Table`, toasts (`Toaster`,`toastSuccess/Error/Info/Warning/Loading/Default`,`toastWithAction`,`toastPromise`), et les entités Polkadot **`Address`, `Hash`, `Identicon`, `Avatar`, `AppIcon`, `IconContainer`, `ProductHeader`**.

---

## 2. Installation & wiring

### `package.json` (delta vs guide)
Retire la couche `ui/` maison. Ajoute :
```jsonc
"dependencies": {
  "@novasamatech/tr-ui": "^0.2.11",
  "react": "^19",
  "react-dom": "^19",
  "react-compiler-runtime": "^1.0.0"
  // … (le reste des deps SDK + hls.js inchangé)
}
```

### Tailwind v4 + styles TrUI
`src/styles/app.css` (remplace l'ancien `tokens.css`) :
```css
@import "tailwindcss";
@import "@novasamatech/tr-ui/styles.css";   /* tokens + styles compilés des composants */
@config "../../tailwind.config.ts";          /* pour que TES classes utilisent les mêmes tokens */
```
`tailwind.config.ts` :
```ts
import spektrPreset from "@novasamatech/tr-ui/tailwind.preset";

export default {
  presets: [spektrPreset],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "./node_modules/@novasamatech/tr-ui/dist/**/*.{js,mjs}", // ne pas purger les classes de TrUI
  ],
};
```
> Plus de hand-rolled tokens : `styles.css` de TrUI fournit toute la palette sémantique (`--fg-*`, `--bg-*`, `--border-*`, rayons, ombres) en light **et** dark.

---

## 3. Theming + bridge host (remplace §4 theming)

`ThemeProvider` enveloppe l'app ; un petit pont mappe le thème du **host** (`themeSubscribe`) sur `setMode`.

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import "./styles/app.css";
import { ThemeProvider, Toaster } from "@novasamatech/tr-ui";
import { defaultTheme } from "@novasamatech/tr-ui/themes";
import { App } from "./App";
import { HostThemeBridge } from "./HostThemeBridge";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={defaultTheme} defaultMode="light">
    <HostThemeBridge />
    <App />
    <Toaster />        {/* monté une fois ; alimenté par toastInfo/Success/… */}
  </ThemeProvider>,
);
```

```tsx
// src/HostThemeBridge.tsx — host dark/light → TrUI setMode
import { useEffect } from "react";
import { useTheme } from "@novasamatech/tr-ui";
import { getTruApi } from "@parity/product-sdk-host";

export function HostThemeBridge() {
  const { setMode } = useTheme();
  useEffect(() => {
    let sub: { unsubscribe?: () => void } | undefined;
    (async () => {
      const tru = await getTruApi();
      sub = tru?.themeSubscribe(undefined, (theme: unknown) => {
        const dark = String(theme).toLowerCase().includes("dark"); // forme exacte du payload à confirmer (host)
        setMode(dark ? "dark" : "light");
      });
    })();
    return () => sub?.unsubscribe?.();
  }, [setMode]);
  return null;
}
```

> On a supprimé le toggle `.dark` manuel : `setMode` s'en charge (cf. `lib/theme.tsx` de TrUI). Si tu veux une teinte de marque, passe un `ThemeJSON` custom à `ThemeProvider` (maps `light`/`dark` de CSS vars) plutôt que `defaultTheme`.

---

## 4. Composants TrUI → écrans AnyTub3

| Écran | Composants TrUI |
|---|---|
| **Shell** | `ProductHeader` (nom + icône AnyTub3), `Toaster`, `Tabs` (par `group-title`) |
| **Library** | `Card` + `Card.Header/Title/Content`, `ListItem` `variant="icon-label"` (chaînes), `Empty` (biblio vide), `Skeleton` (chargement), `Badge` (« Live ») |
| **Player** | `Button` (`size="icon"`, `variant="ghost"`), `Badge`, `Dialog` (partage), `Tooltip` |
| **AddPlaylist** | `Dialog`, `Input` (URL `.m3u`, `invalid`/`leftIcon`), `Button` |
| **ShareSheet** | `Dialog`, `ListItem`/`Identicon`+`Address` (contacts), `Button` |
| **Reprise inter-host** | `toastInfo` / `toastWithAction` (« Repris depuis un autre appareil ») |

**Variantes utiles (réelles) :**
- `Button` — `variant`: `default`(primaire) `secondary` `outline` `ghost` `destructive` `link` ; `size`: `default` `sm` `lg` `mini` `icon` `icon-sm` `icon-lg` ; props `fullWidth` `pill` `isActive` `asChild`.
- `ListItem` — `variant`: `icon-label` (`{icon,title,description,trailingLabel}`), `icon-switch` (`{…,switchProps}`), `radio` (`{value,title,description,id}`).
- `Input` — `size` (`regular`…), `roundness`, `invalid`, `leftIcon`/`rightIcon`.
- `toast*` — `{ title, description?, duration?, id? }` ; `toastWithAction({…, action:{label,onClick}})` ; `toastPromise(p,{loading,success,error})`.

---

## 5. Écrans réécrits (code TrUI)

### Shell — `App.tsx`
```tsx
import { ProductHeader, Tabs } from "@novasamatech/tr-ui";
import anytubIcon from "./assets/anytub3.svg";

export function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-4">
      <ProductHeader name="AnyTub3" description="IPTV décentralisée" iconSrc={anytubIcon} />
      {/* routing d'écrans : Library par défaut */}
      <Library />
    </div>
  );
}
```

### Library — cartes + liste de chaînes + état vide
```tsx
import { Card, ListItem, Empty, Skeleton, Badge, Button, ScrollArea } from "@novasamatech/tr-ui";
import { Tv, Plus, Share2 } from "lucide-react";

function Library({ playlists, loading, nowPlayingId, onTune, onAdd }: LibraryProps) {
  if (loading) return <div className="flex flex-col gap-2">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-14 w-full" />)}</div>;

  if (!playlists.length) return (
    <Empty>
      <Empty.Header>
        <Empty.Title>Aucune playlist</Empty.Title>
        <Empty.Description>Ajoute un fichier .m3u ou une URL pour commencer.</Empty.Description>
      </Empty.Header>
      <Empty.Content><Button onClick={onAdd}><Plus /> Ajouter une playlist</Button></Empty.Content>
    </Empty>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-fg-primary text-lg font-semibold">Mes chaînes</h2>
        <Button size="sm" variant="secondary" onClick={onAdd}><Plus /> Ajouter</Button>
      </div>
      {playlists.map((pl) => (
        <Card key={pl.id}>
          <Card.Header><Card.Title>{pl.title}</Card.Title></Card.Header>
          <Card.Content className="p-0">
            <ScrollArea className="max-h-80">
              {pl.entries.map((ch) => (
                <button key={ch.id} onClick={() => onTune(pl, ch)} className="w-full text-left hover:bg-bg-selection-container-hover">
                  <ListItem
                    variant="icon-label"
                    icon={<Tv />}
                    title={ch.name}
                    description={ch.group}
                    trailingLabel={ch.id === nowPlayingId ? <Badge variant="primary">Live</Badge> : undefined}
                  />
                </button>
              ))}
            </ScrollArea>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}
```

### Player + partage — `Dialog`
```tsx
import { Button, Badge, Dialog, Tooltip } from "@novasamatech/tr-ui";
import { Share2 } from "lucide-react";
import { HlsPlayer } from "./player/HlsPlayer";

function Player({ channel, onShare }: PlayerProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-fg-primary font-medium">{channel.name} <Badge variant="primary">Live</Badge></span>
        <Tooltip content="Partager">
          <Button size="icon" variant="ghost" onClick={onShare}><Share2 /></Button>
        </Tooltip>
      </div>
      <HlsPlayer src={channel.url} onPlaying={() => {/* publishNowPlaying(...) */}} />
    </div>
  );
}
```

### ShareSheet — contacts du host
```tsx
import { Dialog, ListItem, Identicon, Address, Button } from "@novasamatech/tr-ui";

function ShareSheet({ open, onOpenChange, contacts, onPick }: ShareSheetProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header><Dialog.Title>Partager la playlist</Dialog.Title></Dialog.Header>
        <div className="flex flex-col">
          {contacts.map((c) => (
            <button key={c.address} onClick={() => onPick(c)} className="hover:bg-bg-selection-container-hover rounded-[8px]">
              <ListItem variant="icon-label" icon={<Identicon value={c.address} />} title={c.name} description={<Address value={c.address} />} />
            </button>
          ))}
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
```

### AddPlaylist — `Input` + parse
```tsx
import { Dialog, Input, Button } from "@novasamatech/tr-ui";
import { Link as LinkIcon } from "lucide-react";
import { useState } from "react";
import { parseM3U } from "./lib/m3u";

function AddPlaylist({ open, onOpenChange, onParsed }: AddProps) {
  const [url, setUrl] = useState(""); const [invalid, setInvalid] = useState(false);
  async function load() {
    try { const txt = await (await fetch(url)).text(); onParsed(parseM3U(txt)); onOpenChange(false); }
    catch { setInvalid(true); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header><Dialog.Title>Ajouter une playlist</Dialog.Title>
          <Dialog.Description>URL d'un fichier .m3u (http/https).</Dialog.Description></Dialog.Header>
        <Input leftIcon={<LinkIcon />} placeholder="https://…/playlist.m3u" value={url}
               invalid={invalid} onChange={(e)=>{setUrl(e.target.value); setInvalid(false);}} />
        <Dialog.Footer><Button onClick={load} fullWidth>Charger</Button></Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
```

### Toast de reprise inter-host
```tsx
import { toastInfo } from "@novasamatech/tr-ui";
// dans onNowPlayingChange, quand la valeur vient d'un autre host et est plus récente :
toastInfo({ title: "Repris depuis un autre appareil", description: channelName });
// variante : toastWithAction({ title:"Lecture reprise ailleurs", action:{ label:"Rester ici", onClick:pin } })
```

> **Focus :** ne pas réimposer de règle d'outline maison — les composants TrUI gèrent leur focus (anneau `ring-neutral-black/16`, et `…/white/16` en dark). Pour ton markup custom, garde la cohérence en t'appuyant sur les classes du preset.

---

## 6. Déploiement `.dot` (remplace §8 déploiement)

Le host charge AnyTub3 comme product. La sortie de build à déployer est **`build/`**, poussée via **`dot deploy`**.

### Vite → sortie dans `build/`
Vite génère `dist/` par défaut ; on aligne sur `build/` :
```ts
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "build", emptyOutDir: true },
});
```

### Séquence de lancement
```bash
pnpm build          # → ./build (bundle statique du product)
dot deploy          # déploie ./build comme product .dot
```
Puis le host charge AnyTub3 par son nom dotNS (`anytub3.dot`) et lui fournit compte, signer, product account (scope `anytub3.dot`), entropy, Cloud Storage, Statement Store, chat.

> Vérifier dans la doc du **CLI `dot`** : (a) s'il prend `./build` implicitement ou via un argument/flag (`dot deploy ./build`), (b) l'**auth** (compte/clé de déploiement), (c) le **réseau cible** (Paseo) et l'enregistrement/résolution dotNS de `anytub3.dot`. Ces points relèvent du CLI `dot`, pas de TrUI ni de `product-sdk`.

---

## 7. Ce qui reste à confirmer (hors TrUI)

1. **Forme exacte du payload de `themeSubscribe`** côté host (string `"dark"`/`"light"` vs objet) — le bridge tolère déjà les deux via `String(theme).includes("dark")`, à ajuster si besoin.
2. **Variant d'allocation `StatementStoreAllowance`** dans `AllocatableResource` (j'ai confirmé `BulletinAllowance` ; le variant Statement Store reste à vérifier dans le codec host).
3. **CLI `dot deploy`** : argument de chemin, auth, réseau cible, enregistrement dotNS — voir doc host/dotNS.

Tout le reste (composants, theming, structure d'écrans, façade SDK, 4 flux, continuité inter-hosts) est ancré sur du code réel : `@novasamatech/tr-ui` + `paritytech/product-sdk`.
