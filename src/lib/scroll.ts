// Keeping a list's active row in view without moving the page: a channel list
// that remounts (back from the guide, the fullscreen fallback, a new screen)
// starts at scrollTop 0, while the user expects to land on the channel that is
// playing. `scrollIntoView` would also scroll the window — on a phone, the
// player sidebar sits below the video, and scrolling the page to the list
// would hide the very stream being watched.

function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Scroll `el`'s nearest scrollable ancestor so `el` sits in its middle — only
 * when `el` is not already fully visible there (a visible row must not jump).
 * Never scrolls the window.
 */
export function revealInScrollParent(el: HTMLElement): void {
  const parent = scrollParentOf(el);
  if (!parent) return;
  const row = el.getBoundingClientRect();
  const view = parent.getBoundingClientRect();
  if (row.top >= view.top && row.bottom <= view.bottom) return;
  const offsetInParent = row.top - view.top + parent.scrollTop;
  parent.scrollTop = offsetInParent - (view.height - row.height) / 2;
}
