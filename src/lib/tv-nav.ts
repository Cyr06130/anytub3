import type { Screen } from "@/state/store";
import { pushKeyHandler } from "@/lib/tv-input";

/**
 * D-pad focus navigation. Native DOM focus is the single source of truth — a
 * focused <button> + Enter fires click natively, the LG Magic Remote's pointer
 * clicks the same elements, and Playwright drives it with plain keyboard
 * presses. Arrows move focus geometrically: from the current element's rect,
 * pick the best candidate in the pressed direction's half-plane
 * (score = axial distance + 2 × orthogonal offset). No per-screen wiring.
 */

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && el.closest('[aria-hidden="true"]') === null,
  );
}

/** Focus + keep visible: fixes every native overflow-y-auto region for free. */
export function focusEl(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {
    /* older engines without options support */
  }
}

type Dir = "up" | "down" | "left" | "right";

function moveFocus(dir: Dir): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const hasOrigin = active && active !== document.body;
  const candidates = focusables().filter((el) => el !== active);
  if (!candidates.length) return false;
  if (!hasOrigin) {
    focusEl(candidates[0]);
    return true;
  }

  const from = active.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const horizontal = dir === "left" || dir === "right";
  // Two buckets: candidates whose rect OVERLAPS the origin on the cross axis
  // (truly "in that direction" — e.g. the wide row button left of its EPG
  // icon) always beat diagonal neighbors, however close those are.
  let bestAligned: HTMLElement | null = null;
  let bestAlignedScore = Infinity;
  let bestAny: HTMLElement | null = null;
  let bestAnyScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - cx;
    const dy = r.top + r.height / 2 - cy;
    const axial = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    if (axial <= 1) continue; // strictly in the pressed direction
    const ortho = horizontal ? Math.abs(dy) : Math.abs(dx);
    const overlaps = horizontal
      ? r.bottom > from.top + 1 && r.top < from.bottom - 1
      : r.right > from.left + 1 && r.left < from.right - 1;
    const score = axial + 2 * ortho;
    if (overlaps && score < bestAlignedScore) {
      bestAlignedScore = score;
      bestAligned = el;
    }
    if (score < bestAnyScore) {
      bestAnyScore = score;
      bestAny = el;
    }
  }
  const best = bestAligned ?? bestAny;
  if (!best) return false;
  focusEl(best);
  return true;
}

/** Base arrow-key handler (bottom of the input stack). */
export function installTvNav(): () => void {
  return pushKeyHandler((key) => {
    if (key !== "up" && key !== "down" && key !== "left" && key !== "right") return false;
    // Native <video controls> owns its keys on desktop.
    if (document.activeElement instanceof HTMLVideoElement) return false;
    return moveFocus(key);
  });
}

// ── Per-screen focus memory ──────────────────────────────────────────────────
// Back should land on the element the user left (e.g. the channel row that
// opened the guide). Rows advertise a stable `data-focus-key`; App records the
// last focused key per screen and restores it on (re)entry.

export const focusMemory = new Map<string, string>();

export function screenKeyOf(s: Screen): string {
  switch (s.name) {
    case "player":
    case "epg":
      return `${s.name}:${s.playlistId}:${s.channelId}`;
    case "edit":
    case "share":
      return `${s.name}:${s.playlistId}`;
    default:
      return s.name;
  }
}

/**
 * Entry focus for a screen: the remembered element if it still exists, else
 * the designated autofocus target, else the first focusable. Idempotent — a
 * no-op while focus is already inside the container — so it can safely re-run
 * when async data lands (or under StrictMode double-effects).
 */
export function focusScreen(container: HTMLElement, screenKey: string): void {
  const current = document.activeElement;
  if (current instanceof HTMLElement && current !== document.body && container.contains(current)) return;
  const remembered = focusMemory.get(screenKey);
  const target =
    (remembered
      ? container.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(remembered)}"]`)
      : null) ??
    container.querySelector<HTMLElement>("[data-tv-autofocus]") ??
    container.querySelector<HTMLElement>(FOCUSABLE);
  if (target) focusEl(target);
}
