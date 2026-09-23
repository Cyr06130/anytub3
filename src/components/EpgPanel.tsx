import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Channel, ChannelEpg, Playlist, Programme } from "@/types";
import { getChannelEpg, nowAndNext, progress } from "@/lib/epg";
import { errorMessage } from "@/lib/errors";
import { isHttpUrl } from "@/lib/url";
import { setPlaylistEpgUrl } from "@/state/playlists";

/** Small per-channel affordance that opens the guide. Lives BESIDE the tune
 *  button (never nested in it) so the EPG click doesn't also change channel. */
export function EpgButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="hover:bg-action-tertiary-hover"
      aria-label="Programme guide"
      onClick={onClick}
    >
      <CalendarClock />
    </Button>
  );
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Time span rendered in Martian Mono so the digits line up down a schedule. */
function TimeRange({ start, stop }: { start: number; stop?: number }) {
  return (
    <span className="text-body-s text-fg-tertiary shrink-0 font-mono">
      {fmtTime(start)}
      {stop !== undefined && `–${fmtTime(stop)}`}
    </span>
  );
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
        setState({ status: "error", message: errorMessage(e, "Could not load the guide.") });
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
      {categories && <p className="text-body-s text-fg-tertiary">{categories}</p>}

      {state.status === "loading" && (
        <div className="flex flex-col gap-3">
          <Skeleton className="rounded-container h-24 w-full" />
          <Skeleton className="rounded-nested h-9 w-2/3" />
          <Skeleton className="rounded-nested h-9 w-1/2" />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col gap-3 py-2">
          <p className="text-body-s text-fg-secondary text-center">{state.message}</p>
          <div className="flex items-center gap-2">
            <Input
              className="min-w-0 flex-1"
              placeholder="https://…/guide.xml (XMLTV)"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && draftUrl.trim() && applyUrl()}
            />
            <Button
              variant="secondary"
              className="hover:bg-action-secondary-hover"
              disabled={!draftUrl.trim()}
              onClick={applyUrl}
            >
              Load
            </Button>
          </div>
          <p className="text-caption text-fg-tertiary text-center">
            Paste an XMLTV guide URL — e.g. your provider's EPG (the{" "}
            <code className="font-mono">url-tvg</code> from its m3u). It's saved to this playlist.
          </p>
        </div>
      )}

      {state.status === "ready" && <Guide epg={state.epg} now={now} />}
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div
      className="bg-surface-nested h-1.5 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="bg-action-primary h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ScheduleRow({ programme, isNow }: { programme: Programme; isNow: boolean }) {
  return (
    <div
      className={`flex items-baseline gap-3 px-3 py-2 ${isNow ? "bg-selection-container-active" : ""}`}
    >
      <span className="w-24 shrink-0">
        <TimeRange start={programme.start} stop={programme.stop} />
      </span>
      <span className="text-body-m text-fg-primary min-w-0 flex-1 truncate">{programme.title}</span>
      {isNow && <Badge>Now</Badge>}
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
        <div className="bg-surface-container rounded-container shadow-1 flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Now</Badge>
            {current.category && <Badge variant="secondary">{current.category}</Badge>}
            <TimeRange start={current.start} stop={current.stop} />
          </div>
          <span className="text-label-l text-fg-primary">{current.title}</span>
          <ProgressBar value={progress(current, now)} />
          {current.desc && <p className="text-body-s text-fg-secondary">{current.desc}</p>}
        </div>
      ) : (
        <p className="text-body-s text-fg-secondary">Nothing on air right now.</p>
      )}

      {next && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Next</Badge>
          <TimeRange start={next.start} />
          <span className="text-body-m text-fg-primary min-w-0 truncate">{next.title}</span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="text-label-m text-fg-secondary px-1">Schedule</h3>
        <div className="bg-surface-container rounded-container shadow-1 flex max-h-[40vh] flex-col divide-y overflow-y-auto">
          {list.map((p) => (
            <ScheduleRow key={`${p.start}-${p.stop}-${p.title}`} programme={p} isNow={p === current} />
          ))}
        </div>
      </div>
    </div>
  );
}
