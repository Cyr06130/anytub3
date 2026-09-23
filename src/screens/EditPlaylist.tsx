import { useEffect, useState } from "react";
import { Tv, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Channel } from "@/types";
import { useApp } from "@/state/app-state";
import { goBack } from "@/state/navigation";
import { updatePlaylist } from "@/state/playlists";
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
        <p className="text-body-m text-fg-secondary">Playlist not found.</p>
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

        <p className="text-body-s text-fg-secondary">
          {entries.length} channel{entries.length !== 1 ? "s" : ""}
        </p>

        <div className="bg-surface-container rounded-container shadow-1 flex max-h-[55vh] flex-col overflow-y-auto p-1">
          {entries.map((ch) => (
            <div
              key={ch.id}
              className="group hover:bg-selection-container-hover focus-within:bg-selection-container-hover rounded-small flex items-center gap-2 py-2 pr-1 pl-3 transition-colors"
            >
              <Tv aria-hidden className="text-fg-tertiary size-5 shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-label-m text-fg-primary truncate">{ch.name}</span>
                {ch.group && <span className="text-body-s text-fg-tertiary truncate">{ch.group}</span>}
              </span>
              {/* Destructive: hidden at rest, revealed by the row's hover/focus. */}
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-fg-error opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 tv:opacity-100 hover:bg-action-error"
                aria-label={`Remove ${ch.name}`}
                disabled={busy}
                onClick={() => setEntries((prev) => prev.filter((c) => c.id !== ch.id))}
              >
                <X />
              </Button>
            </div>
          ))}
          {entries.length === 0 && (
            <p className="text-body-s text-fg-tertiary p-4 text-center">All channels have been removed.</p>
          )}
        </div>
      </div>

      {/* Bottom action slot: one primary pill commitment + its quiet alternative. */}
      <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
        <Button
          className="text-label-l w-full rounded-full px-6 py-3.5 font-semibold hover:bg-action-primary-hover"
          size="lg"
          disabled={busy || !dirty || entries.length === 0}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          className="w-full rounded-full font-normal hover:bg-action-tertiary-hover"
          disabled={busy}
          onClick={() => goBack()}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}
