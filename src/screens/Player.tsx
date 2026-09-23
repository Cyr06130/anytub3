import { useRef, useState } from "react";
import { ArrowLeft, Share2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HlsPlayer, type HlsPlayerApi } from "@/player/HlsPlayer";
import { toastError } from "@/lib/toast";
import { useApp } from "@/state/app-state";
import type { Screen } from "@/state/app-state";
import { goLibrary, navigate } from "@/state/navigation";
import { tune } from "@/state/playlists";
import type { Channel } from "@/types";
import { isTv } from "@/lib/tv";
import { ChannelRow } from "@/components/ChannelRow";
import { EpgButton, EpgView } from "@/components/EpgPanel";
import { PlayerOverlay } from "@/components/PlayerOverlay";

type PlayerProps = {
  screen: Extract<Screen, { name: "player" }>;
};

export function PlayerScreen({ screen }: PlayerProps) {
  // Subscribe so the sidebar highlight follows live handoffs (and the playlist
  // stays fresh through the same subscription — never read unsubscribed state).
  const { nowPlayingChannelId, playlists } = useApp();
  const playlist = playlists.find((p) => p.id === screen.playlistId);
  const channel = playlist?.entries.find((c) => c.id === screen.channelId);
  // Channel whose guide is shown INLINE in the aside (the stream keeps playing —
  // navigating to the epg screen would unmount the player).
  const [guide, setGuide] = useState<Channel | null>(null);
  const api = useRef<HlsPlayerApi | null>(null);

  if (!playlist || !channel) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" className="font-normal hover:bg-action-tertiary-hover" onClick={goLibrary}>
          <ArrowLeft aria-hidden /> Library
        </Button>
        <p className="text-body-m text-fg-secondary">Channel not found.</p>
      </div>
    );
  }

  // TV: a full-bleed lean-back stage — no chrome, no native controls, no
  // Fullscreen API (pointless: the stage already fills the screen). All
  // interaction goes through the remote via PlayerOverlay.
  if (isTv) {
    return (
      <div className="fixed inset-0 z-[60] bg-black">
        <HlsPlayer
          src={channel.url}
          className="h-full"
          fill
          controls={false}
          fullscreenButton={false}
          apiRef={api}
          onError={(message) => toastError({ title: channel.name, description: message })}
        />
        <PlayerOverlay playlist={playlist} channel={channel} api={api} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="font-normal hover:bg-action-tertiary-hover" onClick={goLibrary}>
          <ArrowLeft aria-hidden /> Library
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="hover:bg-action-tertiary-hover"
              aria-label="Share"
              disabled={!playlist.cid}
              onClick={() => navigate({ name: "share", playlistId: playlist.id })}
            >
              <Share2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Share playlist</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex gap-4 max-lg:flex-col lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <HlsPlayer
            src={channel.url}
            onError={(message) => toastError({ title: channel.name, description: message })}
          />
          <div className="flex items-center gap-2">
            <span className="text-label-l text-fg-primary truncate">{channel.name}</span>
            <Badge>Live</Badge>
            {channel.group && <span className="text-body-s text-fg-tertiary">· {channel.group}</span>}
            <span className="ml-auto shrink-0">
              <EpgButton onClick={() => setGuide(channel)} />
            </span>
          </div>
        </div>

        {/* Channel list (or the inline guide), shown alongside the stream. */}
        <aside className="flex shrink-0 flex-col gap-2 lg:w-72">
          {guide ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-label-m text-fg-secondary min-w-0 truncate px-1">{guide.name}</h2>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="hover:bg-action-tertiary-hover"
                  aria-label="Close guide"
                  onClick={() => setGuide(null)}
                >
                  <X />
                </Button>
              </div>
              <EpgView playlist={playlist} channel={guide} />
            </>
          ) : (
            <>
              <h2 className="text-label-m text-fg-secondary px-1">{playlist.title}</h2>
              <div className="bg-surface-container rounded-container shadow-1 flex max-h-[60vh] flex-col overflow-y-auto p-1">
                {playlist.entries.map((ch) => (
                  <ChannelRow
                    key={ch.id}
                    channel={ch}
                    active={ch.id === (nowPlayingChannelId ?? screen.channelId)}
                    onTune={() => void tune(playlist.id, ch)}
                    onGuide={() => setGuide(ch)}
                  />
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
