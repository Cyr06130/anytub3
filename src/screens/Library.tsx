import { useState } from "react";
import { Card, Empty, Badge, Button } from "@novasamatech/tr-ui";
import { Tv, Plus, Share2, Pencil, Trash2 } from "lucide-react";
import { useApp } from "@/state/app-state";
import { navigate } from "@/state/navigation";
import { deletePlaylist, tune } from "@/state/playlists";
import { ChannelRow } from "@/components/ChannelRow";

export function Library() {
  const { playlists, loading, nowPlayingChannelId } = useApp();
  // Playlist id awaiting delete confirmation (inline — no modal, TV friendly).
  const [confirming, setConfirming] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-bg-selection-container-hover h-14 w-full animate-pulse rounded-[12px]" />
        ))}
      </div>
    );
  }

  if (!playlists.length) {
    return (
      <div className="flex min-h-[58dvh] flex-col items-center justify-center">
        <Empty>
          <Empty.Media variant="icon">
            <Tv />
          </Empty.Media>
          <Empty.Header>
            <Empty.Title>No playlists yet</Empty.Title>
            <Empty.Description>
              Add an .m3u file or URL — or paste a share code a contact sent you.
            </Empty.Description>
          </Empty.Header>
          <Empty.Content>
            <Button size="lg" onClick={() => navigate({ name: "add" })}>
              <Plus /> Add a playlist
            </Button>
          </Empty.Content>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-fg-primary text-lg font-semibold">My channels</h2>
        <Button size="sm" variant="secondary" onClick={() => navigate({ name: "add" })}>
          <Plus /> Add
        </Button>
      </div>

      {playlists.map((pl) => (
        <Card key={pl.id}>
          <Card.Header>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <Card.Title>
                  <span className="block truncate">{pl.title}</span>
                </Card.Title>
              </div>
              <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                <Badge variant="secondary">{pl.entries.length} channels</Badge>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Share playlist"
                  disabled={!pl.cid}
                  onClick={() => navigate({ name: "share", playlistId: pl.id })}
                >
                  <Share2 />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Edit playlist"
                  onClick={() => navigate({ name: "edit", playlistId: pl.id })}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete playlist"
                  onClick={() => setConfirming(pl.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            {confirming === pl.id && (
              <div className="border-border-secondary mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border p-2">
                <span className="text-fg-primary text-sm font-medium">Delete playlist?</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setConfirming(null);
                      void deletePlaylist(pl.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </Card.Header>
          <Card.Content>
            <div className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
              {pl.entries.map((ch) => (
                <ChannelRow
                  key={ch.id}
                  channel={ch}
                  active={ch.id === nowPlayingChannelId}
                  onTune={() => void tune(pl.id, ch)}
                  onGuide={() => navigate({ name: "epg", playlistId: pl.id, channelId: ch.id })}
                />
              ))}
            </div>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}
