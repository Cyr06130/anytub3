import { useRef, useState } from "react";
import { Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { goBack } from "@/state/navigation";
import { addPlaylist, addPlaylistFromUrl } from "@/state/playlists";
import { importShareCode } from "@/state/sharing";
import { parseM3U, parseM3UHeader, deriveTitle } from "@/lib/m3u";
import { SAMPLE_M3U } from "@/lib/sample";
import { isTv } from "@/lib/tv";
import { isHttpUrl } from "@/lib/url";
import { ScreenHeader } from "@/components/ScreenHeader";

/**
 * Full screen (not a modal — remote/TV friendly) offering every ingest path:
 * URL, sample, pasted share code, and (pointer platforms only) a local file.
 */
export function AddPlaylist() {
  const [url, setUrl] = useState("");
  const [code, setCode] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function importCode() {
    setBusy(true);
    try {
      if (await importShareCode(code)) goBack();
    } finally {
      setBusy(false);
    }
  }

  async function loadUrl() {
    const trimmed = url.trim();
    if (!isHttpUrl(trimmed)) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    try {
      await addPlaylistFromUrl(trimmed);
      goBack();
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
      await addPlaylist(deriveTitle(file.name, entries.length), entries, parseM3UHeader(text));
      goBack();
    } finally {
      setBusy(false);
    }
  }

  async function loadSample() {
    setBusy(true);
    try {
      await addPlaylist("AnyTub3 Demo", parseM3U(SAMPLE_M3U), parseM3UHeader(SAMPLE_M3U));
      goBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <ScreenHeader
        title="Add a playlist"
        description="URL of an .m3u file (http/https) or local import."
      />

      <div className="flex flex-col gap-3">
        <Input
          placeholder="https://…/playlist.m3u"
          value={url}
          aria-invalid={invalid || undefined}
          disabled={busy}
          onChange={(e) => {
            setUrl(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && void loadUrl()}
        />
        {invalid && (
          <p className="text-body-s text-fg-error text-center">
            Invalid or unreachable URL (CORS?). Check the link or import a file.
          </p>
        )}
        <Button
          className="w-full hover:bg-action-primary-hover"
          onClick={() => void loadUrl()}
          disabled={busy || !url}
        >
          {busy ? "Loading…" : "Load"}
        </Button>

        <div className="flex flex-wrap justify-center gap-2">
          {/* No file system on a TV — the picker is a pointer-platform affordance. */}
          {!isTv && (
            <>
              <Button
                variant="secondary"
                className="hover:bg-action-secondary-hover"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload aria-hidden /> Import an .m3u
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
            </>
          )}
          <Button
            variant="ghost"
            className="font-normal hover:bg-action-tertiary-hover"
            disabled={busy}
            onClick={() => void loadSample()}
          >
            <Sparkles aria-hidden /> Load the sample
          </Button>
        </div>

        {/* Import a playlist shared with you, by pasting its share code. */}
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-label-m text-fg-secondary text-center">Received a share code?</p>
          <div className="flex items-center gap-2">
            <Input
              className="min-w-0 flex-1 font-mono"
              placeholder="anytub3:…"
              value={code}
              disabled={busy}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && code.trim() && void importCode()}
            />
            <Button
              variant="secondary"
              className="hover:bg-action-secondary-hover"
              disabled={busy || !code.trim()}
              onClick={() => void importCode()}
            >
              Import
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
