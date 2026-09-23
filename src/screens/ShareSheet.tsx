import { useEffect, useState } from "react";
import { Copy as CopyIcon, MessageSquareShare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toastError, toastSuccess } from "@/lib/toast";
import { useApp } from "@/state/app-state";
import { goBack } from "@/state/navigation";
import { buildShareCode, shareCurrentPlaylist } from "@/state/sharing";
import { ScreenHeader } from "@/components/ScreenHeader";

type ShareSheetProps = {
  playlistId: string;
};

export function ShareSheet({ playlistId }: ShareSheetProps) {
  const { inHost, playlists } = useApp();
  const playlist = playlists.find((p) => p.id === playlistId);
  const [code, setCode] = useState("");

  useEffect(() => {
    let active = true;
    setCode("");
    void buildShareCode(playlistId).then((c) => {
      if (active) setCode(c ?? "");
    });
    return () => {
      active = false;
    };
  }, [playlistId]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      toastSuccess({ title: "Share code copied" });
    } catch {
      toastError({ title: "Could not copy", description: "Select the code and copy it manually." });
    }
  }

  if (!playlist) {
    return (
      <section className="flex flex-col gap-4">
        <ScreenHeader title="Share playlist" />
        <p className="text-body-m text-fg-secondary">Playlist not found.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <ScreenHeader
        title="Share playlist"
        description="A pointer is shared, never the playlist itself. Anyone holding the code can open it — send it through a channel you trust."
      />

      {/* The code is a machine handle, shown because sharing IS the explicit
          demand for it — rendered mono, per the identifier rules. */}
      <div className="flex items-center gap-2">
        <Input
          className="min-w-0 flex-1 font-mono"
          value={code}
          placeholder="Generating…"
          readOnly
          aria-label="Share code"
        />
        <Button
          variant="secondary"
          size="icon"
          className="hover:bg-action-secondary-hover"
          aria-label="Copy share code"
          disabled={!code}
          onClick={() => void copyCode()}
        >
          <CopyIcon />
        </Button>
      </div>

      {/* Bottom action slot: the pill commitment + its quiet alternative. */}
      <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
        <Button
          size="lg"
          className="text-label-l w-full rounded-full px-6 py-3.5 font-semibold hover:bg-action-primary-hover"
          onClick={() => goBack()}
        >
          Done
        </Button>
        {inHost && (
          <Button
            variant="ghost"
            size="lg"
            className="w-full rounded-full font-normal hover:bg-action-tertiary-hover"
            disabled={!code}
            onClick={() => void shareCurrentPlaylist(playlistId)}
          >
            <MessageSquareShare aria-hidden /> Send to chat
          </Button>
        )}
      </div>
    </section>
  );
}
