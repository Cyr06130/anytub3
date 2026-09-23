import Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import { errorMessage } from "@/lib/errors";
import { pushKeyHandler } from "@/lib/tv-input";

/** Imperative playback surface for the TV overlay's media keys. */
export type HlsPlayerApi = {
  play(): void;
  pause(): void;
  toggle(): void;
};

type HlsPlayerProps = {
  src: string;
  /** Fired once the stream is actually playing (used to publish now-playing). */
  onPlaying?: () => void;
  onError?: (message: string) => void;
  autoPlay?: boolean;
  className?: string;
  /** Native control bar (off on TV — it steals the D-pad arrows). */
  controls?: boolean;
  /** Fullscreen toggle button (pointless on TV: the stage is full-bleed). */
  fullscreenButton?: boolean;
  /** Fill the parent (TV full-bleed stage) instead of the aspect-video box. */
  fill?: boolean;
  /** Receives the playback API for imperative play/pause (media keys). */
  apiRef?: React.MutableRefObject<HlsPlayerApi | null>;
};

type VideoEl = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};
type FsDoc = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/** Silent fatal-error recoveries per kind before giving up (one toast). */
const MAX_RECOVERY_ATTEMPTS = 2;

function currentFullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as FsDoc).webkitFullscreenElement ?? null;
}

/**
 * Try to enter REAL fullscreen on a node, across vendor prefixes (incl. iOS
 * video-only). Returns true ONLY if it actually engaged.
 *
 * Why this is defensive: it works on Polkadot Web (the product iframe is granted
 * `allow="fullscreen"`, so `document.fullscreenEnabled` is true and the call
 * enters fullscreen) but NOT on Polkadot Desktop, where the API is either
 * disabled (fullscreenEnabled === false) or its promise resolves/hangs without
 * entering. So we (a) only try the standard API when it's actually enabled,
 * (b) never block on a pending promise, and (c) verify via
 * `document.fullscreenElement` rather than trusting the resolved promise — the
 * caller falls back to a CSS-fill when this returns false.
 */
async function requestFullscreenOn(node: FsEl | VideoEl | null): Promise<boolean> {
  if (!node) return false;
  const candidates: Array<{ fn?: () => Promise<void> | void; verifiable: boolean }> = [
    { fn: document.fullscreenEnabled ? node.requestFullscreen?.bind(node) : undefined, verifiable: true },
    { fn: (node as FsEl).webkitRequestFullscreen?.bind(node), verifiable: true },
    { fn: (node as VideoEl).webkitEnterFullscreen?.bind(node), verifiable: false }, // iOS: no fullscreenElement
  ];
  for (const { fn, verifiable } of candidates) {
    if (!fn) continue;
    try {
      const result = fn();
      if (result && typeof (result as Promise<void>).then === "function") {
        await Promise.race([result as Promise<void>, new Promise<void>((res) => setTimeout(res, 300))]);
      }
    } catch {
      continue; // blocked / unsupported — try the next
    }
    if (!verifiable) return true; // native video FS can't be read back
    if (currentFullscreenElement()) return true;
  }
  return currentFullscreenElement() != null;
}

/**
 * Thin wrapper around hls.js. IPTV streams are predominantly live, so we join
 * the live edge rather than seeking to an offset (design §8). Native HLS
 * (Safari/iOS) is used directly when available.
 *
 * CORS: many IPTV streams require a permissive proxy / headers — surfaced via
 * onError so the UI can tell the user (design R4).
 */
export function HlsPlayer({
  src,
  onPlaying,
  onError,
  autoPlay = true,
  className,
  controls = true,
  fullscreenButton = true,
  fill = false,
  apiRef,
}: HlsPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<VideoEl>(null);
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // CSS-fill fallback when the host blocks the real Fullscreen API (iframe).
  const [cssFs, setCssFs] = useState(false);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      play: () => void videoRef.current?.play().catch(() => undefined),
      pause: () => videoRef.current?.pause(),
      toggle: () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play().catch(() => undefined);
        else v.pause();
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setLoading(true);

    let hls: Hls | undefined;
    const onPlay = () => {
      setLoading(false);
      onPlaying?.();
    };
    video.addEventListener("playing", onPlay);

    try {
      if (Hls.isSupported()) {
        // Conservative config: a blob-spawned worker and low-latency MSE are the
        // most common triggers for a webview/GPU renderer crash on desktop hosts
        // (black screen, no catchable JS error). Neither is needed for IPTV.
        hls = new Hls({
          liveSyncDurationCount: 3,
          enableWorker: false,
          lowLatencyMode: false,
          backBufferLength: 30,
        });
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (autoPlay) void video.play().catch(() => undefined);
        });
        // Fatal errors: retry silently a bounded number of times, then give up
        // with ONE toast — an unbounded startLoad() loop on a dead/CORS-blocked
        // stream would otherwise toast forever. Counters reset on src change
        // (this effect re-runs).
        let networkRetries = 0;
        let mediaRecoveries = 0;
        const giveUp = (message: string) => {
          setLoading(false);
          onError?.(message);
          hls?.destroy();
        };
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (!data.fatal) return;
          // Recovery calls can themselves throw if the instance is already gone;
          // never let that escape the handler (it would crash the React tree).
          try {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (networkRetries++ < MAX_RECOVERY_ATTEMPTS) hls?.startLoad();
                else giveUp("Stream unreachable (network / CORS / permission). A proxy may be required.");
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (mediaRecoveries++ < MAX_RECOVERY_ATTEMPTS) hls?.recoverMediaError();
                else giveUp("Stream media error.");
                break;
              default:
                giveUp("Stream cannot be played.");
            }
          } catch {
            hls?.destroy();
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        if (autoPlay) void video.play().catch(() => undefined);
      } else {
        setLoading(false);
        onError?.("HLS is not supported by this browser.");
      }
    } catch (err) {
      // Synchronous failure constructing/attaching hls (e.g. blocked worker,
      // unavailable MediaSource): surface it, don't throw into render.
      setLoading(false);
      onError?.(errorMessage(err, "Could not start playback."));
    }

    return () => {
      video.removeEventListener("playing", onPlay);
      hls?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Track fullscreen state so the button icon reflects reality.
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(currentFullscreenElement()));
    const events = ["fullscreenchange", "webkitfullscreenchange"];
    events.forEach((e) => document.addEventListener(e, onChange));
    return () => events.forEach((e) => document.removeEventListener(e, onChange));
  }, []);

  // In CSS-fill mode, Back/Escape exits (the native key only works for real
  // fullscreen). Pushed on the input stack so it wins over screen-back.
  useEffect(() => {
    if (!cssFs) return;
    return pushKeyHandler((key) => {
      if (key !== "back") return false;
      setCssFs(false);
      return true;
    });
  }, [cssFs]);

  const toggleFullscreen = useCallback(async () => {
    // Exit whichever mode is active.
    if (currentFullscreenElement()) {
      const doc = document as FsDoc;
      await (document.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      setCssFs(false);
      return;
    }
    if (cssFs) {
      setCssFs(false);
      return;
    }
    // Real fullscreen (container, then <video>) only if it verifiably engages;
    // otherwise CSS-fill the webview viewport (the Polkadot Desktop path).
    const ok = (await requestFullscreenOn(containerRef.current)) || (await requestFullscreenOn(videoRef.current));
    if (!ok) setCssFs(true);
  }, [cssFs]);

  const fsActive = isFullscreen || cssFs;
  const fillMode = fsActive || fill;

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className={
          cssFs
            ? "group fixed inset-0 z-[60] flex items-center justify-center bg-black"
            : isFullscreen
              ? // Real fullscreen: let the UA size the :fullscreen element; we only
                // center the video (no `position`, so the UA fill rule applies).
                "group flex items-center justify-center bg-black"
              : fill
                ? "group relative h-full bg-black"
                : "group relative bg-black"
        }
      >
        <video
          ref={videoRef}
          controls={controls}
          playsInline
          className={
            fillMode
              ? // Fill the screen (scale up), not the intrinsic 720p/1080p box.
                "h-full w-full object-contain bg-black"
              : "rounded-container aspect-video w-full bg-black"
          }
        />
        {fullscreenButton && (
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={fsActive ? "Exit fullscreen" : "Fullscreen"}
            className={`rounded-medium text-fg-static-white absolute right-2 top-2 cursor-pointer bg-black/55 p-2 transition-opacity hover:bg-black/75 focus-visible:opacity-100 ${
              cssFs ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            {fsActive ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        )}
      </div>
      {loading && !cssFs && !fill && (
        <p className="text-body-s text-fg-secondary mt-2 text-center" aria-live="polite">
          Connecting to stream…
        </p>
      )}
    </div>
  );
}
