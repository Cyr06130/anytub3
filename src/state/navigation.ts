import type { Screen } from "./app-state";
import { getState, setState } from "./app-state";
import { stopNpHeartbeat } from "@/lib/sync";

// ── Navigation ───────────────────────────────────────────────────────────────
// Screens form a stack so the TV Back key (and the UI back buttons) can retrace
// the user's path. `screen` stays in AppState (single render source); the stack
// only remembers where "back" leads. Teleports (cross-host resume/handoff,
// forced returns on delete/edit) clear it — a context switch has no "back".

let navStack: Screen[] = [];

export function navigate(screen: Screen): void {
  navStack.push(getState().screen);
  setState({ screen });
}

/** Push the current screen onto the back stack without changing screens —
 *  for callers that update `screen` themselves in a combined setState (tune). */
export function rememberForBack(): void {
  navStack.push(getState().screen);
}

/**
 * Go back one screen. Returns false when already at the library root — the
 * caller then leaves the key to the platform (webOS exits the app).
 */
export function goBack(): boolean {
  if (getState().screen.name === "player") stopNpHeartbeat();
  const prev = navStack.pop();
  if (prev) {
    setState({ screen: prev });
    return true;
  }
  if (getState().screen.name === "library") return false;
  setState({ screen: { name: "library" } }); // defensive: screen without history
  return true;
}

/** Teleport: replace the screen and the whole back stack. */
export function resetScreen(screen: Screen, stack: Screen[] = []): void {
  navStack = stack;
  setState({ screen });
}

/** Drop history entries the predicate rejects (e.g. screens of a deleted
 *  playlist) so Back can never land on them. */
export function pruneHistory(keep: (s: Screen) => boolean): void {
  navStack = navStack.filter(keep);
}

export function goLibrary(): void {
  stopNpHeartbeat();
  resetScreen({ name: "library" });
}
