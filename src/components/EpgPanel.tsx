import { useEffect, useState } from "react";
import { Badge, Button, Skeleton, Input } from "@novasamatech/tr-ui";
import { CalendarClock, Link as LinkIcon } from "lucide-react";
import type { Channel, ChannelEpg, Playlist } from "@/types";
import { getChannelEpg, nowAndNext, progress } from "@/lib/epg";
import { isHttpUrl } from "@/lib/url";
import { setPlaylistEpgUrl } from "@/state/store";

/** Small per-channel affordance that opens the guide. Lives BESIDE the tune
 *  button (never nested in it) so the EPG click doesn't also change channel. */
export function EpgButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="icon-sm" variant="ghost" aria-label="Programme guide" onClick={onClick}>
      <CalendarClock />
    </Button>
  );
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; epg: ChannelEpg };

type EpgViewProps = {
  playlist: Playlist;
  channel: Channel;
};

/**
 * On-demand programme guide for a single channel — embeddable anywhere (the
 * EPG screen, the player sidebar), not a modal. Fetching happens ONLY while
 * mounted — never on render of the channel lists — which is what keeps EPG
 * lazy and the memory footprint small. When the playlist has no EPG source
 * yet, it lets the user paste an XMLTV guide URL (saved to the playlist), so
 * the guide is reachable for any playlist, not just those whose m3u advertised
 * a `url-tvg`.
 */
export function EpgView({ playlist, channel }: EpgViewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  // A source pasted in this session (overrides playlist.epgUrl until persisted).
  const [override, setOverride] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState("");

  // Reset the per-target inputs whenever the target changes.
  useEffect(() => {
    setOverride(null);
    setDraftUrl("");
  }, [playlist.id, channel.id]);

  // Load the guide on mount, when the target changes, or when a source is set.
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    setNow(Date.now());
    void getChannelEpg(playlist, channel, { sourceOverride: override ?? undefined })
      .then((epg) => active && setState({ status: "ready", epg }))
      .catch((e) => {
        if (!active) return;
        const message = e instanceof Error ? e.message : "Could not load the guide.";
        setState({ status: "error", message });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist.id, playlist.epgUrl, channel.id, override]);

  // Keep "now"/progress live while the guide stays open (no refetch).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  function applyUrl() {
    const url = draftUrl.trim();
    if (!isHttpUrl(url)) return;
    setOverride(url); // drives an immediate reload via the effect above
    void setPlaylistEpgUrl(playlist.id, url); // persist for next time + sync
  }

  const categories =
    state.status === "ready" ? state.epg.meta?.categories?.join(" · ") : undefined;

  return (
    <div className="flex flex-col gap-3">
      {categories && <p className="text-fg-secondary text-sm">{categories}</p>}

      {state.status === "loading" && (
        <div className="flex flex-col gap-3">
          <SkeletonBlock className="h-20 w-full" />
          <SkeletonBlock className="h-9 w-2/3" />
          <SkeletonBlock className="h-9 w-1/2" />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col gap-3 py-2">
          <p className="text-fg-secondary text-center text-sm">{state.message}</p>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Input
                leftIcon={<LinkIcon />}
                placeholder="https://…/guide.xml (XMLTV)"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && draftUrl.trim() && applyUrl()}
              />
            </div>
            <Button variant="secondary" disabled={!draftUrl.trim()} onClick={applyUrl}>
              Load
            </Button>
          </div>
          <p className="text-fg-secondary text-center text-xs">
            Paste an XMLTV guide URL — e.g. your provider's EPG (the <code>url-tvg</code> from
            its m3u). It's saved to this playlist.
          </p>
        </div>
      )}

      {state.status === "ready" && <Guide epg={state.epg} now={now} />}
    </div>
  );
}

/** Sized skeleton — tr-ui's Skeleton can't be sized directly (no className). */
function SkeletonBlock({ className }: { className: string }) {
  return (
    <div className={className}>
      <Skeleton style={{ height: "100%", width: "100%" }} />
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div
      className="bg-bg-selection-container-hover h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="bg-bg-action-primary h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Guide({ epg, now }: { epg: ChannelEpg; now: number }) {
  // Derive current/next from the loaded programmes at the live `now` so the
  // panel stays correct as time passes, without refetching.
  const list = epg.upcoming;
  const { now: current, next } = nowAndNext(list, now);

  return (
    <div className="flex flex-col gap-4">
      {current ? (
        <div className="border-border-secondary flex flex-col gap-2 rounded-[12px] border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="primary">Now</Badge>
            {current.category && <Badge variant="secondary">{current.category}</Badge>}
            <span className="text-fg-secondary text-sm tabular-nums">
              {fmtTime(current.start)}–{fmtTime(current.stop)}
            </span>
          </div>
          <span className="text-fg-primary font-medium">{current.title}</span>
          <ProgressBar value={progress(current, now)} />
          {current.desc && <p className="text-fg-secondary text-sm">{current.desc}</p>}
        </div>
      ) : (
        <p className="text-fg-secondary text-sm">Nothing on air right now.</p>
      )}

      {next && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Next</Badge>
          <span className="text-fg-secondary shrink-0 text-sm tabular-nums">{fmtTime(next.start)}</span>
          <span className="text-fg-primary min-w-0 truncate">{next.title}</span>
        </div>
      )}

      <div>
        <h3 className="text-fg-secondary mb-1 px-1 text-sm font-medium">Schedule</h3>
        <div className="border-border-secondary flex max-h-[40vh] flex-col overflow-y-auto rounded-[12px] border">
          {list.map((p) => {
            const isNow = p === current;
            return (
              <div
                key={`${p.start}-${p.stop}-${p.title}`}
                className={`flex items-baseline gap-3 px-3 py-2 ${isNow ? "bg-bg-selection-container-hover" : ""}`}
              >
                <span className="text-fg-secondary w-24 shrink-0 text-sm tabular-nums">
                  {fmtTime(p.start)}–{fmtTime(p.stop)}
                </span>
                <span className="text-fg-primary min-w-0 flex-1 truncate">{p.title}</span>
                {isNow && <Badge variant="primary">Now</Badge>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
