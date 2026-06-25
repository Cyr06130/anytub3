import { useRef, useState } from "react";
import { Dialog, Input, Button } from "@novasamatech/tr-ui";
import { Link as LinkIcon, Upload, Sparkles, Ticket } from "lucide-react";
import { addPlaylist, addPlaylistFromUrl, importShareCode } from "@/state/store";
import { parseM3U, deriveTitle } from "@/lib/m3u";
import { SAMPLE_M3U } from "@/lib/sample";

type AddProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AddPlaylist({ open, onOpenChange }: AddProps) {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function close() {
    setUrl("");
    setCode("");
    setInvalid(false);
    onOpenChange(false);
  }

  async function importCode() {
    setBusy(true);
    try {
      if (await importShareCode(code)) close();
    } finally {
      setBusy(false);
    }
  }

  async function loadUrl() {
    if (!/^https?:\/\//i.test(url)) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      await addPlaylistFromUrl(url.trim());
      close();
    } catch {
      setInvalid(true);
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const entries = parseM3U(text);
      await addPlaylist(deriveTitle(file.name, entries.length), entries);
      close();
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    setBusy(true);
    try {
      await addPlaylist("AnyTub3 Demo", parseM3U(SAMPLE_M3U));
      close();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Add a playlist</Dialog.Title>
          <Dialog.Description>URL of an .m3u file (http/https) or local import.</Dialog.Description>
        </Dialog.Header>

        <div className="flex flex-col gap-3">
          <Input
            leftIcon={<LinkIcon />}
            placeholder="https://…/playlist.m3u"
            value={url}
            invalid={invalid}
            disabled={busy}
            onChange={(e) => {
              setUrl(e.target.value);
              setInvalid(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && void loadUrl()}
          />
          {invalid && (
            <p className="text-fg-status-error text-center text-sm">
              Invalid or unreachable URL (CORS?). Check the link or import a file.
            </p>
          )}

          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload /> Import an .m3u
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void loadSample()}>
              <Sparkles /> Load the sample
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
                e.target.value = "";
              }}
            />
          </div>

          {/* Import a playlist shared with you, by pasting its share code. */}
          <div className="border-border-secondary flex flex-col gap-2 border-t pt-3">
            <p className="text-fg-secondary text-center text-sm">Received a share code?</p>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  leftIcon={<Ticket />}
                  placeholder="anytub3:…"
                  value={code}
                  disabled={busy}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && code.trim() && void importCode()}
                />
              </div>
              <Button variant="secondary" disabled={busy || !code.trim()} onClick={() => void importCode()}>
                Import
              </Button>
            </div>
          </div>
        </div>

        <Dialog.Footer>
          <Button onClick={() => void loadUrl()} disabled={busy || !url} fullWidth>
            {busy ? "Loading…" : "Load"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
