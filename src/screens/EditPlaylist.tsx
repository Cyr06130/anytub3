import { useEffect, useState } from "react";
import { Input, Button, ListItem } from "@novasamatech/tr-ui";
import { Tv, X } from "lucide-react";
import type { Channel } from "@/types";
import { goBack, updatePlaylist, useApp } from "@/state/store";
import { ScreenHeader } from "@/components/ScreenHeader";

type EditProps = {
  playlistId: string;
};

export function EditPlaylist({ playlistId }: EditProps) {
  const { playlists } = useApp();
  const playlist = playlists.find((p) => p.id === playlistId);
  const [title, setTitle] = useState(playlist?.title ?? "");
  const [entries, setEntries] = useState<Channel[]>(playlist?.entries ?? []);
  const [busy, setBusy] = useState(false);

  // Reset the local draft if the target changes (defensive — the screen is
  // normally remounted per playlist).
  useEffect(() => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (pl) {
      setTitle(pl.title);
      setEntries(pl.entries);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  if (!playlist) {
    return (
      <section className="flex flex-col gap-4">
        <ScreenHeader title="Edit playlist" />
        <p className="text-fg-secondary">Playlist not found.</p>
      </section>
    );
  }

  const dirty = title.trim() !== playlist.title || entries.length !== playlist.entries.length;

  async function save() {
    setBusy(true);
    try {
      await updatePlaylist(playlistId, { title, entries });
      goBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <ScreenHeader title="Edit playlist" description="Rename the playlist or remove channels." />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Input
          value={title}
          placeholder="Playlist name"
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="text-fg-secondary text-sm">
          {entries.length} channel{entries.length !== 1 ? "s" : ""}
        </div>

        <div className="border-border-secondary -mx-1 flex max-h-[55vh] flex-col overflow-y-auto rounded-[12px] border">
          {entries.map((ch) => (
            <div key={ch.id} className="flex items-center gap-1 pr-2">
              <div className="min-w-0 flex-1">
                {/* trailingLabel is REQUIRED by the icon-label variant's type. */}
                <ListItem variant="icon-label" icon={<Tv />} title={ch.name} description={ch.group} trailingLabel={undefined} />
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${ch.name}`}
                disabled={busy}
                onClick={() => setEntries((prev) => prev.filter((c) => c.id !== ch.id))}
              >
                <X />
              </Button>
            </div>
          ))}
          {entries.length === 0 && (
            <p className="text-fg-tertiary p-4 text-center text-sm">All channels have been removed.</p>
          )}
        </div>
      </div>

      <div className="flex w-full flex-wrap justify-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => goBack()}>
          Cancel
        </Button>
        <Button disabled={busy || !dirty || entries.length === 0} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
