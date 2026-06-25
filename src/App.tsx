import { lazy, Suspense, useEffect, useState } from "react";
import { ProductHeader, Badge, Button, Tooltip, useTheme, toastError } from "@novasamatech/tr-ui";
import { Moon, Sun } from "lucide-react";
import anytubIcon from "@/assets/anytub3.svg";
import { bootstrap, goLibrary, useApp } from "@/state/store";
import { Library } from "@/screens/Library";
import { AddPlaylist } from "@/screens/AddPlaylist";
import { ShareSheet } from "@/screens/ShareSheet";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
          {dark ? <Sun /> : <Moon />}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>{dark ? "Light mode" : "Dark mode"}</Tooltip.Content>
    </Tooltip>
  );
}

export function App() {
  const app = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [shareFor, setShareFor] = useState<string | null>(null);

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
    const onRejection = (e: PromiseRejectionEvent) =>
      report(e.reason instanceof Error ? e.reason.message : String(e.reason ?? ""));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  function openShare(playlistId: string) {
    setShareFor(playlistId);
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
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
      <ErrorBoundary key={app.screen.name} onReset={goLibrary}>
        {app.screen.name === "library" ? (
          <Library onAdd={() => setAddOpen(true)} onShare={openShare} />
        ) : (
          <Suspense fallback={<PlayerFallback />}>
            <PlayerScreen screen={app.screen} onShare={openShare} />
          </Suspense>
        )}
      </ErrorBoundary>

      <AddPlaylist open={addOpen} onOpenChange={setAddOpen} />
      <ShareSheet
        open={shareFor !== null}
        onOpenChange={(o) => !o && setShareFor(null)}
        playlistId={shareFor}
      />
    </div>
  );
}
