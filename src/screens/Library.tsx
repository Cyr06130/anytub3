import { Tv, Plus, Share2, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApp } from "@/state/app-state";
import { navigate } from "@/state/navigation";
import { deletePlaylist, tune } from "@/state/playlists";
import { ChannelRow } from "@/components/ChannelRow";

export function Library() {
  const { playlists, loading, nowPlayingChannelId } = useApp();

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="rounded-nested h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!playlists.length) {
    return (
      <div className="flex min-h-[58dvh] flex-col items-center justify-center gap-4 text-center">
        <div className="bg-surface-container shadow-1 flex size-14 items-center justify-center rounded-full">
          <Tv aria-hidden className="text-fg-secondary size-6" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-heading-m text-fg-primary">No playlists yet</h2>
          <p className="text-body-m text-fg-secondary max-w-sm">
            Add an .m3u file or URL — or paste a share code a contact sent you.
          </p>
        </div>
        <Button
          size="lg"
          className="rounded-full px-6 font-semibold hover:bg-action-primary-hover"
          onClick={() => navigate({ name: "add" })}
        >
          <Plus aria-hidden /> Add a playlist
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-heading-m text-fg-primary">My channels</h2>
        <Button
          size="sm"
          variant="secondary"
          className="hover:bg-action-secondary-hover"
          onClick={() => navigate({ name: "add" })}
        >
          <Plus aria-hidden /> Add
        </Button>
      </div>

      {playlists.map((pl) => (
        <Card key={pl.id} className="group/card">
          <CardHeader>
            <CardTitle className="min-w-0">
              <h3 className="truncate">{pl.title}</h3>
            </CardTitle>
            <CardAction className="flex items-center gap-1 sm:gap-2">
              <Badge variant="secondary">{pl.entries.length} channels</Badge>
              <Button
                size="icon-sm"
                variant="ghost"
                className="hover:bg-action-tertiary-hover"
                aria-label="Share playlist"
                disabled={!pl.cid}
                onClick={() => navigate({ name: "share", playlistId: pl.id })}
              >
                <Share2 />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="hover:bg-action-tertiary-hover"
                aria-label="Edit playlist"
                onClick={() => navigate({ name: "edit", playlistId: pl.id })}
              >
                <Pencil />
              </Button>
              {/* Destructive action: hidden at rest, revealed on hover/focus.
                  Deletion is immediate + Undo toast — no confirmation step. */}
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-fg-error opacity-0 transition-opacity group-hover/card:opacity-100 focus:opacity-100 tv:opacity-100 hover:bg-action-error"
                aria-label="Delete playlist"
                onClick={() => void deletePlaylist(pl.id)}
              >
                <Trash2 />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
