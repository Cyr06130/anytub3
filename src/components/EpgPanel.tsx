import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Channel, ChannelEpg, Playlist, Programme } from "@/types";
import { getChannelEpg, nowAndNext, progress } from "@/lib/epg";
import { guideDirectorySources } from "@/lib/epg-sources";
import { errorMessage } from "@/lib/errors";
import { isTv } from "@/lib/tv";
import { isHttpUrl } from "@/lib/url";
import { addPlaylistEpgSource, bindPlaylistEpgChannel } from "@/state/playlists";
import { EpgChannelPicker } from "@/components/EpgChannelPicker";

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
  | { status: "loading"; step?: string }
  | { status: "error"; message: string }
  | { status: "ready"; epg: ChannelEpg };

/** What the panel shows: the guide, the directory picker, or the URL field. */
type PanelMode = "guide" | "pick" | "paste";

const CAN_PICK = guideDirectorySources().length > 0;

type EpgViewProps = {
  playlist: Playlist;
  channel: Channel;
};

/**
 * On-demand programme guide for a single channel — embeddable anywhere (the
 * EPG screen, the player sidebar), not a modal. Opening it runs the guide
 * resolver (provider API → playlist guides → public directory) and shows which
 * step is running; fetching happens ONLY while mounted, never on render of the
 * channel lists, which is what keeps EPG lazy. When nothing matches, the user
 * can pick the channel in the public directory or paste an XMLTV URL — both
 * are saved to the playlist.
 */
export function EpgView({ playlist, channel }: EpgViewProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState<PanelMode>("guide");

  useEffect(() => setMode("guide"), [playlist.id, channel.id]);

  // Resolve on mount, when the target changes, or when the playlist's guide
  // configuration changes (a pasted URL, a picked channel).
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    setNow(Date.now());
    void getChannelEpg(playlist, channel, {
      onStep: (step) => active && setState({ status: "loading", step: step.label }),
    })
      .then((epg) => active && setState({ status: "ready", epg }))
      .catch((e) => active && setState({ status: "error", message: errorMessage(e, "Could not load the guide.") }));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist.id, playlist.epg, playlist.sourceUrl, channel.id]);

  // Keep "now"/progress live while the guide stays open (no refetch).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (mode === "pick") {
    return (
      <EpgChannelPicker
        channel={channel}
        onPick={(binding) => {
          void bindPlaylistEpgChannel(playlist.id, channel.id, binding);
          setMode("guide");
        }}
        onCancel={() => setMode("guide")}
      />
    );
  }

  if (mode === "paste") {
    return (
      <PasteGuideUrl
        onApply={(url) => {
          void addPlaylistEpgSource(playlist.id, url);
          setMode("guide");
        }}
        onCancel={() => setMode("guide")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {state.status === "loading" && (
        <div className="flex flex-col gap-3">
          <Skeleton className="rounded-container h-24 w-full" />
          <Skeleton className="rounded-nested h-9 w-2/3" />
          <Skeleton className="rounded-nested h-9 w-1/2" />
          <p className="text-caption text-fg-tertiary text-center" aria-live="polite">
            {state.step ? `Checking ${state.step}…` : "Looking for a guide…"}
          </p>
        </div>
      )}

      {state.status === "error" && (
        <NoGuide message={state.message} onPick={() => setMode("pick")} onPaste={() => setMode("paste")} />
      )}

      {state.status === "ready" && (
        <>
          <Guide epg={state.epg} now={now} />
          <Provenance epg={state.epg} channel={channel} onChange={() => setMode("pick")} />
        </>
      )}
    </div>
  );
}

// ── remedies ─────────────────────────────────────────────────────────────────

type NoGuideProps = { message: string; onPick: () => void; onPaste: () => void };

/** The resolver found nothing: offer the directory picker (any platform) and
 *  the URL field (pointer platforms — there's no keyboard on a TV). */
function NoGuide({ message, onPick, onPaste }: NoGuideProps) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <p className="text-body-s text-fg-secondary text-center">{message}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {CAN_PICK && (
          <Button variant="secondary" className="hover:bg-action-secondary-hover" onClick={onPick}>
            Choose the channel
          </Button>
        )}
        {!isTv && (
          <Button variant="ghost" className="font-normal hover:bg-action-tertiary-hover" onClick={onPaste}>
            Paste a guide URL
          </Button>
        )}
      </div>
    </div>
  );
}

type PasteGuideUrlProps = { onApply: (url: string) => void; onCancel: () => void };

function PasteGuideUrl({ onApply, onCancel }: PasteGuideUrlProps) {
  const [draft, setDraft] = useState("");
  const url = draft.trim();
  const valid = isHttpUrl(url);
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <Input
          className="min-w-0 flex-1"
          placeholder="https://…/guide.xml (XMLTV)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && valid && onApply(url)}
        />
        <Button variant="secondary" className="hover:bg-action-secondary-hover" disabled={!valid} onClick={() => onApply(url)}>
          Load
        </Button>
      </div>
      <p className="text-caption text-fg-tertiary text-center">
        Paste an XMLTV guide URL — e.g. your provider's EPG (the <code className="font-mono">url-tvg</code> from
        its m3u). It's saved to this playlist.
      </p>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="font-normal hover:bg-action-tertiary-hover" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type ProvenanceProps = { epg: ChannelEpg; channel: Channel; onChange: () => void };

/** Where the programmes came from, and the way to correct a wrong match. */
function Provenance({ epg, channel, onChange }: ProvenanceProps) {
  const alias = epg.sourceChannelName && epg.sourceChannelName !== channel.name ? `${epg.sourceChannelName} · ` : "";
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-caption text-fg-tertiary min-w-0 truncate">
        Guide: {alias}
        {epg.sourceLabel}
      </span>
      {CAN_PICK && (
        <Button variant="ghost" size="sm" className="font-normal hover:bg-action-tertiary-hover" onClick={onChange}>
          Wrong channel?
        </Button>
      )}
    </div>
  );
}

// ── the guide itself ─────────────────────────────────────────────────────────

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
