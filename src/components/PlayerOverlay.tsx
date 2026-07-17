import { useEffect, useRef, useState } from "react";
import type { Channel, Playlist, Programme } from "@/types";
import { getChannelEpg, progress } from "@/lib/epg";
import { goLibrary, navigate, tune } from "@/state/store";
import { pushKeyHandler } from "@/lib/tv-input";
import { focusEl } from "@/lib/tv-nav";
import type { HlsPlayerApi } from "@/player/HlsPlayer";

const FLASH_MS = 3_000;
const OPEN_MS = 5_000;

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * hidden — pure video; Up/Down zap, OK/Left/Right open, Back → library.
 * flash  — channel-identity banner after a tune/zap; Up/Down KEEP zapping
 *          (rapid zapping must not degrade into list browsing), OK opens.
 * open   — full overlay with the focusable channel rail + actions.
 */
type OverlayMode = "hidden" | "flash" | "open";

type PlayerOverlayProps = {
  playlist: Playlist;
  channel: Channel;
  api: React.MutableRefObject<HlsPlayerApi | null>;
};

/**
 * TV lean-back layer over the full-bleed stream. Shows Now/Next lazily (silent
 * on EPG errors), auto-hides after a few seconds of inactivity, and the Magic
 * Remote pointer wakes it (pointermove). Media keys drive playback in every
 * mode.
 */
export function PlayerOverlay({ playlist, channel, api }: PlayerOverlayProps) {
  // Flash on entry so a tune/zap always announces the channel identity.
  const [mode, setMode] = useState<OverlayMode>("flash");
  const [nowNext, setNowNext] = useState<{ now?: Programme; next?: Programme } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The key handler stays mounted (stable stack position above the base
  // navigation handlers); mutable state goes through refs.
  const modeRef = useRef(mode);
  const playlistRef = useRef(playlist);
  const channelRef = useRef(channel);
  useEffect(() => {
    modeRef.current = mode;
    playlistRef.current = playlist;
    channelRef.current = channel;
  });

  function goTo(next: OverlayMode) {
    setMode(next);
    modeRef.current = next; // keep key handling coherent within the same tick
    if (timerRef.current) clearTimeout(timerRef.current);
    if (next !== "hidden") {
      timerRef.current = setTimeout(() => setMode("hidden"), next === "flash" ? FLASH_MS : OPEN_MS);
    }
  }

  useEffect(() => {
    goTo("flash"); // arm the initial auto-hide
    const openOnPointer = () => goTo("open"); // Magic Remote cursor
    window.addEventListener("pointermove", openOnPointer);
    return () => {
      window.removeEventListener("pointermove", openOnPointer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return pushKeyHandler((key) => {
      // Media keys work in every mode.
      switch (key) {
        case "play":
          api.current?.play();
          return true;
        case "pause":
          api.current?.pause();
          return true;
        case "playpause":
          api.current?.toggle();
          return true;
        default:
          break;
      }

      const zap = (delta: number) => {
        const entries = playlistRef.current.entries;
        if (!entries.length) return;
        const i = entries.findIndex((c) => c.id === channelRef.current.id);
        const target = entries[(i + delta + entries.length) % entries.length];
        void tune(playlistRef.current.id, target);
        goTo("flash");
      };

      switch (modeRef.current) {
        case "hidden":
        case "flash":
          switch (key) {
            case "down":
              zap(+1);
              return true;
            case "up":
              zap(-1);
              return true;
            case "ok":
            case "left":
            case "right":
              goTo("open");
              return true;
            case "back":
              if (modeRef.current === "flash") {
                goTo("hidden");
                return true;
              }
              return false; // hidden: fall through → screen stack → library
            default:
              return false;
          }
        case "open":
          if (key === "back") {
            goTo("hidden");
            return true;
          }
          goTo("open"); // any activity re-arms the auto-hide
          return false; // arrows/OK keep working on the focused rail
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy Now/Next when shown (cache makes repeats cheap); silent on EPG errors.
  useEffect(() => {
    if (mode === "hidden") return;
    let active = true;
    setNowNext(null);
    getChannelEpg(playlist, channel)
      .then((epg) => active && setNowNext({ now: epg.now, next: epg.next }))
      .catch(() => active && setNowNext(null));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode !== "hidden", playlist.id, channel.id]);

  // Land focus on the active channel in the rail when the overlay opens fully.
  useEffect(() => {
    if (mode !== "open") return;
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-focus-key="${CSS.escape(channel.id)}"]`,
    );
    if (el) focusEl(el);
  }, [mode, channel.id]);

  if (mode === "hidden") return null;

  const now = nowNext?.now;
  const next = nowNext?.next;

  return (
    <div
      ref={rootRef}
      className={`absolute inset-0 z-10 flex items-stretch justify-between gap-8 text-white ${
        mode === "open" ? "bg-black/55" : "bg-gradient-to-t from-black/80 via-black/25 to-transparent"
      }`}
      style={{ padding: "3.5vh 3.5vw" }}
    >
      <div className="flex min-w-0 flex-1 flex-col justify-end gap-4">
        <div className="flex items-center gap-3">
          <h2 className="min-w-0 truncate text-2xl font-semibold">{channel.name}</h2>
          <span className="shrink-0 rounded-full bg-white/25 px-3 py-1 text-sm font-medium">Live</span>
          {channel.group && <span className="shrink-0 text-sm text-white/70">· {channel.group}</span>}
        </div>

        {now && (
          <div className="flex max-w-xl flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <span className="shrink-0 text-sm font-semibold uppercase tracking-wide text-white/70">Now</span>
              <span className="min-w-0 truncate">{now.title}</span>
              <span className="shrink-0 text-sm tabular-nums text-white/70">
                {fmtTime(now.start)}–{fmtTime(now.stop)}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${Math.round(progress(now, Date.now()) * 100)}%` }}
              />
            </div>
            {next && (
              <div className="flex items-baseline gap-3">
                <span className="shrink-0 text-sm font-semibold uppercase tracking-wide text-white/70">Next</span>
                <span className="min-w-0 truncate text-white/90">{next.title}</span>
                <span className="shrink-0 text-sm tabular-nums text-white/70">{fmtTime(next.start)}</span>
              </div>
            )}
          </div>
        )}

        {mode === "open" && (
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-[8px] bg-white/15 px-4 py-2 hover:bg-white/25"
              onClick={() => navigate({ name: "epg", playlistId: playlist.id, channelId: channel.id })}
            >
              Guide
            </button>
            <button
              type="button"
              className="rounded-[8px] bg-white/15 px-4 py-2 hover:bg-white/25"
              onClick={() => goLibrary()}
            >
              Library
            </button>
          </div>
        )}
      </div>

      {/* Channel rail (full overlay only): OK tunes, stays open while zapping. */}
      {mode === "open" && (
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-[12px] bg-black/60">
          <h3 className="truncate px-4 py-3 text-sm font-medium text-white/70">{playlist.title}</h3>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {playlist.entries.map((ch) => {
              const active = ch.id === channel.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  data-focus-key={ch.id}
                  aria-current={active}
                  onClick={() => void tune(playlist.id, ch)}
                  className={`block w-full truncate px-4 py-2.5 text-left ${
                    active ? "bg-white/25 font-medium" : "hover:bg-white/10"
                  }`}
                >
                  {ch.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
