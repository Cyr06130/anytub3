import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Channel, EpgBinding } from "@/types";
import { getGuideChoices, type GuideChoices } from "@/lib/epg";
import { normalizeName } from "@/lib/epg-match";
import { errorMessage } from "@/lib/errors";

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
      <p className="text-body-s text-fg-secondary">
        Pick the channel that matches <span className="text-fg-primary font-medium">{channel.name}</span>
        {choices ? ` in the ${choices.source.label} directory.` : "."}
      </p>

      <div className="flex items-center gap-2">
        <select
          aria-label="Country"
          className="text-body-s text-fg-primary rounded-medium h-9 shrink-0 cursor-pointer border bg-transparent px-2 disabled:cursor-not-allowed disabled:opacity-50"
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
        <Input
          className="min-w-0 flex-1"
          placeholder="Search channels"
          value={query}
          disabled={!choices}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {state.status === "loading" && (
        <div className="flex flex-col gap-2">
          <Skeleton className="rounded-nested h-9 w-full" />
          <Skeleton className="rounded-nested h-9 w-full" />
          <Skeleton className="rounded-nested h-9 w-2/3" />
        </div>
      )}
      {state.status === "error" && <p className="text-body-s text-fg-secondary text-center">{state.message}</p>}
      {choices && !selectedCountry && (
        <p className="text-body-s text-fg-secondary text-center">Choose a country to list its channels.</p>
      )}
      {choices && selectedCountry && (
        <div className="bg-surface-container rounded-container shadow-1 flex max-h-[40vh] flex-col divide-y overflow-y-auto">
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              className="text-body-m text-fg-primary hover:bg-selection-container-hover focus-visible:bg-selection-container-hover cursor-pointer truncate px-3 py-2 text-left transition-colors"
              onClick={() => onPick({ source: choices.source.id, channelId: c.id, name: c.name })}
            >
              {c.name}
            </button>
          ))}
          {!rows.length && <p className="text-body-s text-fg-tertiary p-4 text-center">No channel matches.</p>}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="font-normal hover:bg-action-tertiary-hover" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
