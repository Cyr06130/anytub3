import { Button } from "@novasamatech/tr-ui";
import { ArrowLeft } from "lucide-react";
import { goBack } from "@/state/store";

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
        <Button variant="ghost" size="sm" onClick={() => goBack()}>
          <ArrowLeft /> Back
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-fg-primary text-lg font-semibold">{title}</h2>
        {description && <p className="text-fg-secondary text-sm">{description}</p>}
      </div>
    </div>
  );
}
