import { getBridge } from "@/lib/bridge";

/** Stable user identity (same across hosts for one wallet). */
export async function currentUserId(): Promise<string | null> {
  return (await getBridge()).getUserId();
}
