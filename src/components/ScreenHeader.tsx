import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { goBack } from "@/state/navigation";

type ScreenHeaderProps = {
  title: string;
  description?: string;
};

/** Shared sub-screen chrome: a Back button + title, replacing the old Dialog
 *  headers. Back pops the navigation stack — the same path the TV Back key and
 *  Escape take — so every surface stays reachable without a pointer. */
export function ScreenHeader({ title, description }: ScreenHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="font-normal hover:bg-action-tertiary-hover"
          onClick={() => goBack()}
        >
          <ArrowLeft aria-hidden /> Back
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-heading-m text-fg-primary">{title}</h2>
        {description && <p className="text-body-m text-fg-secondary">{description}</p>}
      </div>
    </div>
  );
}
