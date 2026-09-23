import { useEffect, useMemo, useState } from "react";
import { Button, Input } from "@novasamatech/tr-ui";
import { Search } from "lucide-react";
import type { Channel, EpgBinding } from "@/types";
import { getGuideChoices, type GuideChoices } from "@/lib/epg";
import { normalizeName } from "@/lib/epg-match";
import { errorMessage } from "@/lib/errors";
import { SkeletonBlock } from "@/components/SkeletonBlock";

type EpgChannelPickerProps = {
  channel: Channel;
  onPick: (binding: EpgBinding) => void;
  onCancel: () => void;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; choices: GuideChoices };

const MAX_ROWS = 200;

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Manual fallback of the guide resolver: the public directory's channels for
 * the channel's country, most likely match first (one D-pad press away), with
 * a search field and a country override. Picking one is persisted to the
 * playlist and wins over the automatic cascade from then on.
 */
export function EpgChannelPicker({ channel, onPick, onCancel }: EpgChannelPickerProps) {
  const [country, setCountry] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    getGuideChoices(channel, country)
      .then((choices) => {
        if (!active) return;
        setState(
          choices
            ? { status: "ready", choices }
            : { status: "error", message: "No public guide directory is configured." },
        );
      })
      .catch((e) => active && setState({ status: "error", message: errorMessage(e, "Could not load the directory.") }));
    return () => {
      active = false;
    };
  }, [channel, country]);

  const choices = state.status === "ready" ? state.choices : undefined;
  const selectedCountry = country ?? choices?.country ?? "";
  const countries = choices?.source.countries ?? [];

  const rows = useMemo(() => {
    if (!choices) return [];
    const q = normalizeName(query);
    const all = choices.channels;
    return (q ? all.filter((c) => normalizeName(c.name).includes(q)) : all).slice(0, MAX_ROWS);
  }, [choices, query]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-fg-secondary text-sm">
        Pick the channel that matches <span className="text-fg-primary font-medium">{channel.name}</span>
        {choices ? ` in the ${choices.source.label} directory.` : "."}
      </p>

      <div className="flex items-center gap-2">
        <select
          aria-label="Country"
          className="border-border-secondary text-fg-primary h-9 shrink-0 rounded-[8px] border bg-transparent px-2 text-sm"
          value={selectedCountry}
          disabled={!countries.length}
          onChange={(e) => setCountry(e.target.value || undefined)}
        >
          {!selectedCountry && <option value="">Country…</option>}
          {countries.map((cc) => (
            <option key={cc} value={cc}>
              {regionName(cc)}
            </option>
          ))}
        </select>
        <div className="min-w-0 flex-1">
          <Input
            leftIcon={<Search />}
            placeholder="Search channels"
            value={query}
            disabled={!choices}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {state.status === "loading" && (
        <div className="flex flex-col gap-2">
          <SkeletonBlock className="h-9 w-full" />
          <SkeletonBlock className="h-9 w-full" />
          <SkeletonBlock className="h-9 w-2/3" />
        </div>
      )}
      {state.status === "error" && <p className="text-fg-secondary text-center text-sm">{state.message}</p>}
      {choices && !selectedCountry && (
        <p className="text-fg-secondary text-center text-sm">Choose a country to list its channels.</p>
      )}
      {choices && selectedCountry && (
        <div className="border-border-secondary flex max-h-[40vh] flex-col overflow-y-auto rounded-[12px] border">
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              className="text-fg-primary hover:bg-bg-selection-container-hover focus-visible:bg-bg-selection-container-hover truncate px-3 py-2 text-left"
              onClick={() => onPick({ source: choices.source.id, channelId: c.id, name: c.name })}
            >
              {c.name}
            </button>
          ))}
          {!rows.length && <p className="text-fg-tertiary p-4 text-center text-sm">No channel matches.</p>}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
