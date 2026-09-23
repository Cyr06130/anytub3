import { Tv } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Channel } from "@/types";
import { EpgButton } from "@/components/EpgPanel";

type ChannelRowProps = {
  channel: Channel;
  /** Channel currently playing — drives the highlight + Live badge. */
  active?: boolean;
  onTune: () => void;
  onGuide: () => void;
};

/**
 * One channel line, shared by the library cards and the player sidebar: wide
 * tune button (D-pad focusable, `data-focus-key` for TV focus memory) with the
 * guide button BESIDE it — never nested — so opening the EPG can't also zap.
 * The whole row is the hover target; it must sit on a container surface (the
 * selection tokens resolve to the page colour on a bare page).
 */
export function ChannelRow({ channel, active = false, onTune, onGuide }: ChannelRowProps) {
  return (
    <div
      className={`flex items-center gap-1 rounded-small pr-1 transition-colors ${
        active
          ? "bg-selection-container-active"
          : "hover:bg-selection-container-hover focus-within:bg-selection-container-hover"
      }`}
    >
      <button
        onClick={onTune}
        aria-current={active || undefined}
        data-focus-key={channel.id}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-left"
      >
        <Tv aria-hidden className="text-fg-tertiary size-5 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-label-m text-fg-primary truncate">{channel.name}</span>
          {channel.group && <span className="text-body-s text-fg-tertiary truncate">{channel.group}</span>}
        </span>
        {active && <Badge className="ml-2 shrink-0">Live</Badge>}
      </button>
      <EpgButton onClick={onGuide} />
    </div>
  );
}
