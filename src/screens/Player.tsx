import { useRef, useState } from "react";
import { Button, Badge, Tooltip, ListItem } from "@novasamatech/tr-ui";
import { toastError } from "@novasamatech/tr-ui";
import { ArrowLeft, Share2, Tv, X } from "lucide-react";
import { HlsPlayer, type HlsPlayerApi } from "@/player/HlsPlayer";
import { goLibrary, getState, navigate, tune, useApp } from "@/state/store";
import type { Screen } from "@/state/store";
import type { Channel } from "@/types";
import { isTv } from "@/lib/tv";
import { EpgButton, EpgView } from "@/components/EpgPanel";
import { PlayerOverlay } from "@/components/PlayerOverlay";

type PlayerProps = {
  screen: Extract<Screen, { name: "player" }>;
};

export function PlayerScreen({ screen }: PlayerProps) {
  // Subscribe so the sidebar highlight follows live handoffs.
  const { nowPlayingChannelId } = useApp();
  const playlist = getState().playlists.find((p) => p.id === screen.playlistId);
  const channel = playlist?.entries.find((c) => c.id === screen.channelId);
  // Channel whose guide is shown INLINE in the aside (the stream keeps playing —
  // navigating to the epg screen would unmount the player).
  const [guide, setGuide] = useState<Channel | null>(null);
  const api = useRef<HlsPlayerApi | null>(null);

  if (!playlist || !channel) {
    return (
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" onClick={goLibrary}>
          <ArrowLeft /> Library
        </Button>
        <p className="text-fg-secondary">Channel not found.</p>
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
        <Button variant="ghost" size="sm" onClick={goLibrary}>
          <ArrowLeft /> Library
        </Button>
        <Tooltip>
          <Tooltip.Trigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Share"
              disabled={!playlist.cid}
              onClick={() => navigate({ name: "share", playlistId: playlist.id })}
            >
              <Share2 />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Share playlist</Tooltip.Content>
        </Tooltip>
      </div>

      <div className="flex max-lg:flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <HlsPlayer
            src={channel.url}
            onError={(message) => toastError({ title: channel.name, description: message })}
          />
          <div className="flex items-center gap-2">
            <span className="text-fg-primary truncate font-medium">{channel.name}</span>
            <Badge variant="primary">Live</Badge>
            {channel.group && <span className="text-fg-secondary text-sm">· {channel.group}</span>}
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
                <h2 className="text-fg-secondary min-w-0 truncate px-1 text-sm font-medium">{guide.name}</h2>
                <Button size="icon-sm" variant="ghost" aria-label="Close guide" onClick={() => setGuide(null)}>
                  <X />
                </Button>
              </div>
              <EpgView playlist={playlist} channel={guide} />
            </>
          ) : (
            <>
              <h2 className="text-fg-secondary px-1 text-sm font-medium">{playlist.title}</h2>
              <div className="border-border-secondary flex max-h-[60vh] flex-col overflow-y-auto rounded-[12px] border">
                {playlist.entries.map((ch) => {
                  const active = ch.id === (nowPlayingChannelId ?? screen.channelId);
                  return (
                    <div
                      key={ch.id}
                      className={`flex items-center gap-1 pr-2 ${active ? "bg-bg-selection-container-hover" : "hover:bg-bg-selection-container-hover focus-within:bg-bg-selection-container-hover"}`}
                    >
                      <button
                        onClick={() => void tune(playlist.id, ch)}
                        aria-current={active}
                        data-focus-key={ch.id}
                        className="min-w-0 flex-1 text-left"
                      >
                        <ListItem
                          variant="icon-label"
                          icon={<Tv />}
                          title={ch.name}
                          description={ch.group}
                          trailingLabel={active ? <Badge variant="primary">Live</Badge> : undefined}
                        />
                      </button>
                      <EpgButton onClick={() => setGuide(ch)} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
