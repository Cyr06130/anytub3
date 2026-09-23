import { useEffect, useRef, useState } from "react";
import { Moon, RotateCcw, Sun } from "lucide-react";
import anytubIcon from "@/assets/anytub3.webp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/errors";
import { createModuleLoader } from "@/lib/lazy-module";
import { toastError } from "@/lib/toast";
import { isTv } from "@/lib/tv";
import { installTvInput, pushKeyHandler } from "@/lib/tv-input";
import { focusMemory, focusScreen, installTvNav } from "@/lib/tv-nav";
import { useThemeMode } from "@/lib/use-theme-mode";
import { useApp } from "@/state/app-state";
import type { Screen } from "@/state/app-state";
import { bootstrap, retryBootstrap } from "@/state/bootstrap";
import { goBack, goLibrary } from "@/state/navigation";
import { setTheme } from "@/theme/theme";
import { Library } from "@/screens/Library";
import { AddPlaylist } from "@/screens/AddPlaylist";
import { ShareSheet } from "@/screens/ShareSheet";
import { EditPlaylist } from "@/screens/EditPlaylist";
import { EpgGuide } from "@/screens/EpgGuide";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { HostUnavailable } from "@/components/HostUnavailable";

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
// tuned — it stays a separate chunk so the library (first paint) stays light,
// but it is PREFETCHED right after boot and loaded through a retrying loader:
// hosts serve chunks from their own layer (Polkadot Web: a service worker fed
// the archive in memory), which can be cold or restarting minutes later, and a
// failed `import()` there must not brick the player until a full reload.
const playerModule = createModuleLoader(() => import("@/screens/Player"));

function PlayerFallback() {
  return <Skeleton className="rounded-container aspect-video w-full" />;
}

function ChunkLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center" role="alert">
      <p className="text-label-l text-fg-primary">The player couldn't be loaded.</p>
      <p className="text-body-s text-fg-secondary max-w-md break-words">{message}</p>
      <div className="flex gap-2">
        <Button className="hover:bg-action-primary-hover" onClick={onRetry} autoFocus>
          <RotateCcw aria-hidden /> Retry
        </Button>
        <Button variant="ghost" className="hover:bg-action-tertiary-hover" onClick={goLibrary}>
          Back to library
        </Button>
      </div>
    </div>
  );
}

/** Loads the player chunk (retrying) and renders it; a definitive failure shows
 *  Retry instead of a screen crash, and a retry starts a fresh load cycle. */
function PlayerScreenLoader({ screen }: { screen: Extract<Screen, { name: "player" }> }) {
  const [mod, setMod] = useState(playerModule.peek());
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mod) return;
    let active = true;
    setError(null);
    playerModule.load().then(
      (m) => {
        if (active) setMod(m);
      },
      (e: unknown) => {
        if (active) setError(errorMessage(e, "Unknown error"));
      },
    );
    return () => {
      active = false;
    };
  }, [mod, attempt]);

  if (error) return <ChunkLoadError message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!mod) return <PlayerFallback />;
  const { PlayerScreen } = mod;
  return <PlayerScreen screen={screen} />;
}

function ThemeToggle() {
  const dark = useThemeMode() === "dark";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="hover:bg-action-tertiary-hover"
          aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(dark ? "berlin-day" : "berlin-night")}
        >
          {dark ? <Moon /> : <Sun />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{dark ? "Light mode" : "Dark mode"}</TooltipContent>
    </Tooltip>
  );
}

function ActiveScreen({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "library":
      return <Library />;
    case "player":
      return <PlayerScreenLoader screen={screen} />;
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
    // Prefetch the player chunk once boot settles, while the host's serving
    // layer is warm — a later cold service worker then can't fail the import.
    void bootstrap().then(() => {
      const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
      if (idle) idle(() => playerModule.prefetch());
      else setTimeout(() => playerModule.prefetch(), 1_000);
    });

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
        <header className="flex items-center gap-3">
          <img src={anytubIcon} alt="" width={36} height={36} className="size-9" />
          <div className="flex min-w-0 flex-col">
            <h1 className="text-heading-s text-fg-primary">AnyTub3</h1>
            <p className="text-caption text-fg-tertiary">Decentralized IPTV</p>
          </div>
        </header>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          {app.ready && !app.inHost && !app.hostError && (
            <Badge variant="secondary" title="Outside Polkadot container — state simulated locally">
              Demo mode
            </Badge>
          )}
        </div>
      </div>

      {/* Keyed per screen so a crash in the player can't black-screen the whole
          app: the boundary shows a recoverable message and remounts on nav. */}
      <main ref={mainRef} className="contents">
        {app.hostError ? (
          <HostUnavailable failure={app.hostError} onRetry={() => void retryBootstrap()} />
        ) : (
          <ErrorBoundary key={app.screen.name} onReset={goLibrary}>
            <ActiveScreen screen={app.screen} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
