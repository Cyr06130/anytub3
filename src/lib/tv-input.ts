import { isTv } from "@/lib/tv";

/**
 * Remote-control input layer. ONE window keydown listener (capture phase)
 * normalizes webOS remote keys — and their desktop equivalents — into semantic
 * events, dispatched through a LIFO handler stack: the player overlay or a
 * fullscreen surface pushes itself above the base navigation handlers and wins.
 * A handler returns true to consume the key; unhandled keys fall through to the
 * platform on purpose (Back on the library root lets webOS leave the app).
 */

export type TvKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "ok"
  | "back"
  | "play"
  | "pause"
  | "playpause";

export type TvKeyHandler = (key: TvKey, e: KeyboardEvent) => boolean;

const handlers: TvKeyHandler[] = [];

/** Push a handler on top of the stack; returns its remover. */
export function pushKeyHandler(h: TvKeyHandler): () => void {
  handlers.push(h);
  return () => {
    const i = handlers.indexOf(h);
    if (i >= 0) handlers.splice(i, 1);
  };
}

function mapKey(e: KeyboardEvent): TvKey | null {
  // keyCode first: webOS remotes are dependable on codes (461 = Back has no
  // standard `key` on every firmware); `key` covers the rest.
  switch (e.keyCode) {
    case 37:
      return "left";
    case 38:
      return "up";
    case 39:
      return "right";
    case 40:
      return "down";
    case 13:
      return "ok";
    case 27: // Escape — desktop/e2e parity
    case 461: // webOS Back
      return "back";
    case 415:
      return "play";
    case 19:
      return "pause";
    case 179:
      return "playpause";
  }
  switch (e.key) {
    case "GoBack":
      return "back";
    case "MediaPlay":
      return "play";
    case "MediaPause":
      return "pause";
    case "MediaPlayPause":
      return "playpause";
  }
  return null;
}

function isTextTarget(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
  );
}

/** Walk the stack top-down; returns true if some handler consumed the key. */
function dispatch(key: TvKey, e: KeyboardEvent): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i](key, e)) {
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
  }
  return false;
}

let lastBackTs = 0;

function onKeyDown(e: KeyboardEvent): void {
  const key = mapKey(e);
  if (!key) return;
  if (key === "back") lastBackTs = Date.now();

  // Text-field coexistence: left/right/ok belong to the field (caret movement,
  // OSK confirm — component-level Enter handlers keep working). Back dismisses
  // the field/OSK first; the NEXT Back navigates. Up/down fall through to the
  // focus engine, which moves focus away FROM the field's rect (no premature
  // blur — that would lose the geometric origin).
  const active = document.activeElement;
  if (isTextTarget(active)) {
    if (key === "left" || key === "right" || key === "ok") return;
    if (key === "back") {
      active.blur();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }

  dispatch(key, e);
}

/**
 * webOS-browser hardening: some firmwares route the Back key to browser
 * history instead of delivering keyCode 461. A pushState sentinel turns that
 * into a popstate we can treat as Back — and when nothing handles it (library
 * root), we do NOT re-arm, so the next Back genuinely leaves the page.
 */
function onPopState(): void {
  const rearm = () => {
    try {
      history.pushState({ anytub3Tv: true }, "");
    } catch {
      /* history quota — give up silently */
    }
  };
  // If a real 461 keydown was just handled, this popstate is its echo: re-arm
  // without dispatching a second Back.
  if (Date.now() - lastBackTs < 350) {
    rearm();
    return;
  }
  const synthetic = new KeyboardEvent("keydown", { cancelable: true });
  if (dispatch("back", synthetic)) rearm();
}

let uninstall: (() => void) | null = null;

/** Install the global listener (idempotent; returns the uninstaller). */
export function installTvInput(): () => void {
  if (uninstall) return uninstall;
  window.addEventListener("keydown", onKeyDown, true);
  if (isTv) {
    try {
      history.pushState({ anytub3Tv: true }, "");
    } catch {
      /* ignore */
    }
    window.addEventListener("popstate", onPopState);
  }
  uninstall = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("popstate", onPopState);
    uninstall = null;
  };
  return uninstall;
}
