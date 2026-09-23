import { Skeleton } from "@novasamatech/tr-ui";

/** Sized skeleton — tr-ui's Skeleton can't be sized directly (no className). */
export function SkeletonBlock({ className }: { className: string }) {
  return (
    <div className={className}>
      <Skeleton style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
