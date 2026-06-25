import { getBridge } from "@/lib/bridge";

/** Whether we're running inside a Polkadot host container. */
export async function inHost(): Promise<boolean> {
  return (await getBridge()).inHost;
}

/** Stable user identity (same across hosts for one wallet). */
export async function currentUserId(): Promise<string | null> {
  return (await getBridge()).getUserId();
}

/**
 * Pre-allocate Bulletin + Statement Store allowances. Low-level: each call shows
 * the host allowance dialog, so callers must gate it (bootstrap requests it once
 * per account and remembers the grant to avoid re-prompting every launch).
 */
export async function preallocate(): Promise<boolean> {
  return (await getBridge()).preallocate();
}
