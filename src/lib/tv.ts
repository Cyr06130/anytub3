/**
 * TV mode — 10-foot layout + D-pad friendliness. Detected once at boot (it
 * can't change mid-session): LG webOS identifies as "Web0S" (with a zero) in
 * the user agent; `?tv` forces the mode for dev and e2e.
 *
 * The mode itself is mostly CSS: `initTvMode()` stamps a `tv` class on <html>
 * — the root font-size scaling in app.css does the rest, because both the app
 * and tr-ui are rem-based throughout. Components consult `isTv` only for the
 * few structural differences (no file picker, no native video controls).
 */
export const isTv: boolean =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).has("tv") ||
    /\bWeb0S\b|webOS|SMART-TV/i.test(navigator.userAgent));

export function initTvMode(): void {
  if (isTv) document.documentElement.classList.add("tv");
}
