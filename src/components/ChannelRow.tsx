import { ListItem, Badge } from "@novasamatech/tr-ui";
import { Tv } from "lucide-react";
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
 */
export function ChannelRow({ channel, active = false, onTune, onGuide }: ChannelRowProps) {
  return (
    <div
      className={`flex items-center gap-1 rounded-[8px] pr-2 ${
        active
          ? "bg-bg-selection-container-hover"
          : "hover:bg-bg-selection-container-hover focus-within:bg-bg-selection-container-hover"
      }`}
    >
      <button
        onClick={onTune}
        aria-current={active || undefined}
        data-focus-key={channel.id}
        className="min-w-0 flex-1 text-left"
      >
        <ListItem
          variant="icon-label"
          icon={<Tv />}
          title={channel.name}
          description={channel.group}
          trailingLabel={active ? <Badge variant="primary">Live</Badge> : undefined}
        />
      </button>
      <EpgButton onClick={onGuide} />
    </div>
  );
}
