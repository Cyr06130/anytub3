import { useState } from "react";
import { Card, ListItem, Empty, Badge, Button, DropdownMenu, AlertDialog } from "@novasamatech/tr-ui";
import { Tv, Plus, Share2, MoreVertical, Pencil, Trash2 } from "lucide-react";
import type { Playlist } from "@/types";
import { deletePlaylist, tune, useApp } from "@/state/store";
import { EditPlaylist } from "@/screens/EditPlaylist";

type LibraryProps = {
  onAdd: () => void;
  onShare: (playlistId: string) => void;
};

export function Library({ onAdd, onShare }: LibraryProps) {
  const { playlists, loading, nowPlayingChannelId } = useApp();
  const [editing, setEditing] = useState<Playlist | null>(null);
  const [deleting, setDeleting] = useState<Playlist | null>(null);

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
            <Button size="lg" onClick={onAdd}>
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
        <Button size="sm" variant="secondary" onClick={onAdd}>
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
                  onClick={() => onShare(pl.id)}
                >
                  <Share2 />
                </Button>
                <DropdownMenu>
                  <DropdownMenu.Trigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label="Playlist actions">
                      <MoreVertical />
                    </Button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content>
                    <DropdownMenu.Item onSelect={() => setEditing(pl)}>
                      <Pencil /> Edit
                    </DropdownMenu.Item>
                    <DropdownMenu.Item variant="destructive" onSelect={() => setDeleting(pl)}>
                      <Trash2 /> Delete
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu>
              </div>
            </div>
          </Card.Header>
          <Card.Content>
            <div className="-mx-2 flex max-h-80 flex-col overflow-y-auto">
              {pl.entries.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => void tune(pl.id, ch)}
                  className="hover:bg-bg-selection-container-hover w-full rounded-[8px] text-left"
                >
                  <ListItem
                    variant="icon-label"
                    icon={<Tv />}
                    title={ch.name}
                    description={ch.group}
                    trailingLabel={
                      ch.id === nowPlayingChannelId ? <Badge variant="primary">Live</Badge> : undefined
                    }
                  />
                </button>
              ))}
            </div>
          </Card.Content>
        </Card>
      ))}

      <EditPlaylist open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} playlist={editing} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialog.Content>
          <AlertDialog.Header>
            <AlertDialog.Title>Delete playlist?</AlertDialog.Title>
            <AlertDialog.Description>
              "{deleting?.title}" will be removed from your library. The channels remain retrievable from Bulletin as long as you know the CID.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <div className="flex w-full flex-wrap justify-center gap-2">
              <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                variant="destructive"
                onClick={() => {
                  const target = deleting;
                  setDeleting(null);
                  if (target) void deletePlaylist(target.id);
                }}
              >
                Delete
              </AlertDialog.Action>
            </div>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog>
    </div>
  );
}
