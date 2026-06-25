import { useEffect, useState } from "react";
import { Dialog, Input, Button, ListItem } from "@novasamatech/tr-ui";
import { Tv, X } from "lucide-react";
import type { Channel, Playlist } from "@/types";
import { updatePlaylist } from "@/state/store";

type EditProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: Playlist | null;
};

export function EditPlaylist({ open, onOpenChange, playlist }: EditProps) {
  const [title, setTitle] = useState("");
  const [entries, setEntries] = useState<Channel[]>([]);
  const [busy, setBusy] = useState(false);

  // Reset local draft whenever a different playlist is opened.
  useEffect(() => {
    if (playlist) {
      setTitle(playlist.title);
      setEntries(playlist.entries);
    }
  }, [playlist]);

  if (!playlist) return null;

  const dirty =
    title.trim() !== playlist.title || entries.length !== playlist.entries.length;

  async function save() {
    if (!playlist) return;
    setBusy(true);
    try {
      await updatePlaylist(playlist.id, { title, entries });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="md" variant="tall">
        <Dialog.Header>
          <Dialog.Title>Edit playlist</Dialog.Title>
          <Dialog.Description>Rename the playlist or remove channels.</Dialog.Description>
        </Dialog.Header>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <Input
            value={title}
            placeholder="Playlist name"
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className="text-fg-secondary text-sm">
            {entries.length} channel{entries.length > 1 ? "s" : ""}
          </div>

          <div className="border-border-secondary -mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[12px] border">
            {entries.map((ch) => (
              <div key={ch.id} className="flex items-center gap-1 pr-2">
                <div className="min-w-0 flex-1">
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

        <Dialog.Footer>
          <div className="flex w-full flex-wrap justify-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !dirty || entries.length === 0} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
