import { useEffect, useState } from "react";
import { Button, Input, Copy } from "@novasamatech/tr-ui";
import { Copy as CopyIcon, MessageSquareShare } from "lucide-react";
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

  if (!playlist) {
    return (
      <section className="flex flex-col gap-4">
        <ScreenHeader title="Share playlist" />
        <p className="text-fg-secondary">Playlist not found.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <ScreenHeader
        title="Share playlist"
        description="A pointer is shared, never the playlist itself. Anyone holding the code can open it — send it through a channel you trust."
      />

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input value={code} placeholder="Generating…" readOnly aria-label="Share code" />
        </div>
        <Copy value={code}>
          <Button variant="secondary" size="icon" aria-label="Copy share code" disabled={!code}>
            <CopyIcon />
          </Button>
        </Copy>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {inHost && (
          <Button
            variant="ghost"
            disabled={!code}
            onClick={() => void shareCurrentPlaylist(playlistId)}
          >
            <MessageSquareShare /> Send to chat
          </Button>
        )}
        <Button onClick={() => goBack()}>Done</Button>
      </div>
    </section>
  );
}
