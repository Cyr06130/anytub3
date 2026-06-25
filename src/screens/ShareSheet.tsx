import { useEffect, useState } from "react";
import { Dialog, Button, Input, Copy } from "@novasamatech/tr-ui";
import { Copy as CopyIcon, MessageSquareShare } from "lucide-react";
import { buildShareCode, shareCurrentPlaylist, useApp } from "@/state/store";

type ShareSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string | null;
};

export function ShareSheet({ open, onOpenChange, playlistId }: ShareSheetProps) {
  const { inHost } = useApp();
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open || !playlistId) {
      setCode("");
      return;
    }
    let active = true;
    void buildShareCode(playlistId).then((c) => {
      if (active) setCode(c ?? "");
    });
    return () => {
      active = false;
    };
  }, [open, playlistId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="sm">
        <Dialog.Header>
          <Dialog.Title>Share playlist</Dialog.Title>
          <Dialog.Description>
            A pointer is shared, never the playlist itself. Anyone holding the code can open it — send
            it through a channel you trust.
          </Dialog.Description>
        </Dialog.Header>

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

        <Dialog.Footer>
          <div className="flex w-full flex-wrap justify-center gap-2">
            {inHost && (
              <Button
                variant="ghost"
                disabled={!code || !playlistId}
                onClick={() => playlistId && void shareCurrentPlaylist(playlistId)}
              >
                <MessageSquareShare /> Send to chat
              </Button>
            )}
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
