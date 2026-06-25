import { Button, Badge, Tooltip, ListItem } from "@novasamatech/tr-ui";
import { toastError } from "@novasamatech/tr-ui";
import { ArrowLeft, Share2, Tv } from "lucide-react";
import { HlsPlayer } from "@/player/HlsPlayer";
import { goLibrary, getState, tune, useApp } from "@/state/store";
import type { Screen } from "@/state/store";

type PlayerProps = {
  screen: Extract<Screen, { name: "player" }>;
  onShare: (playlistId: string) => void;
};

export function PlayerScreen({ screen, onShare }: PlayerProps) {
  // Subscribe so the sidebar highlight follows live handoffs.
  const { nowPlayingChannelId } = useApp();
  const playlist = getState().playlists.find((p) => p.id === screen.playlistId);
  const channel = playlist?.entries.find((c) => c.id === screen.channelId);

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
              onClick={() => onShare(playlist.id)}
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
          </div>
        </div>

        {/* Channel list, shown alongside the stream. */}
        <aside className="flex shrink-0 flex-col gap-2 lg:w-72">
          <h2 className="text-fg-secondary px-1 text-sm font-medium">{playlist.title}</h2>
          <div className="border-border-secondary flex max-h-[60vh] flex-col overflow-y-auto rounded-[12px] border">
            {playlist.entries.map((ch) => {
              const active = ch.id === (nowPlayingChannelId ?? screen.channelId);
              return (
                <button
                  key={ch.id}
                  onClick={() => void tune(playlist.id, ch)}
                  aria-current={active}
                  className={`w-full text-left ${active ? "bg-bg-selection-container-hover" : "hover:bg-bg-selection-container-hover"}`}
                >
                  <ListItem
                    variant="icon-label"
                    icon={<Tv />}
                    title={ch.name}
                    description={ch.group}
                    trailingLabel={active ? <Badge variant="primary">Live</Badge> : undefined}
                  />
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
