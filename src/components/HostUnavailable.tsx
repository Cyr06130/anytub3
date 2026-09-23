import { RotateCcw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { HostFailure } from "@/state/app-state";

type HostUnavailableProps = {
  failure: HostFailure;
  onRetry: () => void;
};

/**
 * Blocking in-host state: the Polkadot host bridge could not be established
 * (no connection, protocol version refused, SDK failed to load). Rendered in
 * place of the screens — a demo fallback here would "save" playlists to
 * localStorage under fake CIDs while the user believes Bulletin holds them.
 */
export function HostUnavailable({ failure, onRetry }: HostUnavailableProps) {
  return (
    <section role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
      <Unplug aria-hidden className="size-8 text-fg-tertiary" />
      <p className="text-label-l text-fg-primary">Can't reach the Polkadot host</p>
      <p className="text-body-s text-fg-secondary max-w-md break-words">{failure.message}</p>
      {failure.hint && <p className="text-body-s text-fg-tertiary max-w-md break-words">{failure.hint}</p>}
      {failure.details && (
        <p className="text-body-s text-fg-tertiary max-w-md break-all font-mono" aria-label="Diagnostics">
          {failure.details}
        </p>
      )}
      <Button className="hover:bg-action-primary-hover" onClick={onRetry} autoFocus>
        <RotateCcw aria-hidden /> Retry
      </Button>
    </section>
  );
}
