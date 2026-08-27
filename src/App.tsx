import { lazy, Suspense, useEffect, useRef } from "react";
import { ProductHeader, Badge, Button, Tooltip, useTheme, toastError } from "@novasamatech/tr-ui";
import { Moon, Sun } from "lucide-react";
import anytubIcon from "@/assets/anytub3.svg";
import { useApp } from "@/state/app-state";
import type { Screen } from "@/state/app-state";
import { bootstrap } from "@/state/bootstrap";
import { goBack, goLibrary } from "@/state/navigation";
import { errorMessage } from "@/lib/errors";
import { isTv } from "@/lib/tv";
import { installTvInput, pushKeyHandler } from "@/lib/tv-input";
import { focusMemory, focusScreen, installTvNav } from "@/lib/tv-nav";
import { Library } from "@/screens/Library";
import { AddPlaylist } from "@/screens/AddPlaylist";
import { ShareSheet } from "@/screens/ShareSheet";
import { EditPlaylist } from "@/screens/EditPlaylist";
import { EpgGuide } from "@/screens/EpgGuide";
import { ErrorBoundary } from "@/components/ErrorBoundary";

/** Stable key for the TV focus memory — one slot per distinct screen target. */
function screenKeyOf(s: Screen): string {
  switch (s.name) {
    case "player":
    case "epg":
      return `${s.name}:${s.playlistId}:${s.channelId}`;
    case "edit":
    case "share":
      return `${s.name}:${s.playlistId}`;
    default:
      return s.name;
  }
}

// The player pulls in hls.js (~530 kB min) and is only needed once a channel is
// tuned — lazy-load it so the library (first paint) stays light.
const PlayerScreen = lazy(() => import("@/screens/Player").then((m) => ({ default: m.PlayerScreen })));

function PlayerFallback() {
  return <div className="bg-bg-selection-container-hover aspect-video w-full animate-pulse rounded-[12px]" />;
}

function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const dark = mode === "dark";
  return (
    <Tooltip>
      <Tooltip.Trigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setMode(dark ? "light" : "dark")}
        >
          {dark ? <Moon /> : <Sun />}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{dark ? "Light mode" : "Dark mode"}</Tooltip.Content>
    </Tooltip>
  );
}

function ActiveScreen({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "library":
      return <Library />;
    case "player":
      return (
        <Suspense fallback={<PlayerFallback />}>
          <PlayerScreen screen={screen} />
        </Suspense>
      );
    case "add":
      return <AddPlaylist />;
    case "edit":
      return <EditPlaylist playlistId={screen.playlistId} />;
    case "share":
      return <ShareSheet playlistId={screen.playlistId} />;
    case "epg":
      return <EpgGuide playlistId={screen.playlistId} channelId={screen.channelId} />;
  }
}

export function App() {
  const app = useApp();
  const mainRef = useRef<HTMLElement>(null);
  const screenKey = screenKeyOf(app.screen);
  const screenKeyRef = useRef(screenKey);

  // Remote/keyboard input: arrows move DOM focus, Back/Escape pops the screen
  // stack. Installed everywhere (desktop keyboards get the same navigation).
  useEffect(() => {
    const uninstallInput = installTvInput();
    const removeNav = installTvNav();
    const removeBack = pushKeyHandler((key) => (key === "back" ? goBack() : false));
    return () => {
      removeBack();
      removeNav();
      uninstallInput();
    };
  }, []);

  // Per-screen focus memory (TV): remember the last data-focus-key element so
  // Back restores focus to the row the user left.
  useEffect(() => {
    screenKeyRef.current = screenKey;
  }, [screenKey]);
  useEffect(() => {
    if (!isTv) return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>("[data-focus-key]") : null;
      const k = t?.dataset.focusKey;
      if (k) focusMemory.set(screenKeyRef.current, k);
    };
    window.addEventListener("focusin", onFocusIn);
    return () => window.removeEventListener("focusin", onFocusIn);
  }, []);

  // Entry focus per screen (TV): restore the remembered element, else the first
  // focusable. Re-runs when async data lands (loading flip / playlists arriving)
  // and no-ops whenever focus is already inside the screen.
  useEffect(() => {
    if (!isTv) return;
    const el = mainRef.current;
    if (el) focusScreen(el, screenKey);
  }, [screenKey, app.loading, app.playlists.length]);

  useEffect(() => {
    void bootstrap();

    // Surface uncaught errors that the React error boundary can't catch (async
    // handlers, hls.js callbacks): show a toast instead of a silent failure. If
    // even this stays quiet on a black screen, the webview's renderer process
    // crashed (not a JS error) — handled by the conservative player config.
    let last = "";
    const report = (msg: string) => {
      if (!msg || /ResizeObserver loop/i.test(msg) || msg === last) return;
      last = msg;
      toastError({ title: "Unexpected error", description: msg });
    };
    const onError = (e: ErrorEvent) => report(e.message || String(e.error ?? ""));
    const onRejection = (e: PromiseRejectionEvent) => report(errorMessage(e.reason ?? ""));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return (
    <div className="app-shell mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ProductHeader name="AnyTub3" description="Decentralized IPTV" iconSrc={anytubIcon} />
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {app.ready && !app.inHost && (
            <Badge variant="outline" title="Outside Polkadot container — state simulated locally">
              Demo mode
            </Badge>
          )}
        </div>
      </div>

      {/* Keyed per screen so a crash in the player can't black-screen the whole
          app: the boundary shows a recoverable message and remounts on nav. */}
      <main ref={mainRef} className="contents">
        <ErrorBoundary key={app.screen.name} onReset={goLibrary}>
          <ActiveScreen screen={app.screen} />
        </ErrorBoundary>
      </main>
    </div>
  );
}
