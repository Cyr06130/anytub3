import { test, expect, type Locator, type Page } from "@playwright/test";

// TV mode — `?tv=1` forces what the Web0S user agent triggers on a real LG set:
// 10-foot root scaling, screens instead of modals, D-pad-only navigation
// (arrows move DOM focus, Enter activates, Escape/461/GoBack = Back), and the
// full-bleed player with its lean-back overlay. Everything here is driven with
// the keyboard only — no clicks.

async function gotoTv(page: Page) {
  await page.goto("/?tv=1");
}

/** D-pad walk: press `key` until `target` holds focus (geometric nav is layout-
 *  dependent, so tests assert reachability, not an exact press count). */
async function pressUntilFocused(page: Page, key: string, target: Locator, max = 10) {
  for (let i = 0; i < max; i++) {
    const focused = await target
      .evaluate((el) => el === document.activeElement, undefined, { timeout: 500 })
      .catch(() => false);
    if (focused) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

test.describe("TV mode", () => {
  test("boots 10-foot: root scaling, entry focus, no modals, no file picker", async ({ page }) => {
    await gotoTv(page);
    await expect(page.locator("html")).toHaveClass(/tv/);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("24px");

    // Entry focus lands on the empty-state CTA once loading settles.
    const addBtn = page.getByRole("button", { name: "Add a playlist" });
    await expect(addBtn).toBeFocused();

    // Enter opens the add SCREEN (no dialog role anywhere in TV mode).
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Add a playlist" })).toBeVisible();
    await expect(page.locator('[role="dialog"], [role="alertdialog"]')).toHaveCount(0);

    // No file system on TV → the .m3u picker is not rendered.
    await expect(page.getByRole("button", { name: "Import an .m3u" })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);

    // Back (Escape) returns to the library root.
    await page.keyboard.press("Escape");
    await expect(page.getByText("No playlists")).toBeVisible();
  });

  test("keyboard-only journey: add sample → tune → overlay → zap → back", async ({ page }) => {
    await gotoTv(page);

    // Add the sample playlist with the remote only.
    await expect(page.getByRole("button", { name: "Add a playlist" })).toBeFocused();
    await page.keyboard.press("Enter");
    await pressUntilFocused(page, "ArrowDown", page.getByRole("button", { name: "Load the sample" }));
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Playlist saved/)).toBeVisible();

    // Back on the library, walk down to the first channel row (the EPG column
    // is the straight-down path; one ArrowLeft lands on the wide tune button).
    await expect(page.getByRole("heading", { name: "AnyTub3 Demo" })).toBeVisible();
    await pressUntilFocused(page, "ArrowDown", page.getByRole("button", { name: "Programme guide" }).first());
    await page.keyboard.press("ArrowLeft");
    const muxRow = page.getByRole("button", { name: /Mux — Test Stream/ });
    await expect(muxRow).toBeFocused();

    // Tune → full-bleed TV player, the overlay flashes the channel identity.
    await page.keyboard.press("Enter");
    await expect(page.locator("video")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mux — Test Stream" })).toBeVisible();
    // Native controls are off on TV (they'd steal the D-pad arrows).
    expect(await page.locator("video").evaluate((v) => (v as HTMLVideoElement).controls)).toBe(false);

    // OK opens the full overlay: focus lands on the active channel in the rail.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Mux — Test Stream" })).toBeFocused();

    // Back hides the overlay (the stream keeps playing underneath).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Mux — Test Stream" })).toHaveCount(0);

    // Overlay hidden: Down zaps to the next channel and re-flashes the banner;
    // arrows KEEP zapping while the banner shows (rapid zapping).
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("heading", { name: "Big Buck Bunny" })).toBeVisible();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("heading", { name: "Mux — Test Stream" })).toBeVisible();

    // Back hides the overlay, a second Back leaves the player…
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "My channels" })).toBeVisible();
    // …and focus is restored to the row we left from.
    await expect(page.getByRole("button", { name: /Mux — Test Stream/ })).toBeFocused();
  });

  test("webOS Back key: keyCode 461 and key GoBack both pop the screen stack", async ({ page }) => {
    await gotoTv(page);
    await expect(page.getByRole("button", { name: "Add a playlist" })).toBeFocused();

    // Open the add screen, then send a raw webOS Back (keyCode 461 — not a
    // value KeyboardEvent init accepts, so it's stubbed via defineProperty).
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Add a playlist" })).toBeVisible();
    await page.evaluate(() => {
      const e = new KeyboardEvent("keydown", { cancelable: true, bubbles: true });
      Object.defineProperty(e, "keyCode", { get: () => 461 });
      window.dispatchEvent(e);
    });
    await expect(page.getByText("No playlists")).toBeVisible();

    // Same via the `key: "GoBack"` firmware variant.
    await page.keyboard.press("Enter"); // focus is restored on the CTA → reopens
    await expect(page.getByRole("heading", { name: "Add a playlist" })).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "GoBack", cancelable: true, bubbles: true }));
    });
    await expect(page.getByText("No playlists")).toBeVisible();
  });

  test("webOS browser fallback: history Back (popstate sentinel) pops the screen", async ({ page }) => {
    await gotoTv(page);
    await expect(page.getByRole("button", { name: "Add a playlist" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Add a playlist" })).toBeVisible();

    // Some firmwares route the Back key to browser history instead of
    // delivering keyCode 461 — the pushState sentinel must turn the resulting
    // popstate into a screen-back…
    await page.evaluate(() => history.back());
    await expect(page.getByText("No playlists")).toBeVisible();

    // …and re-arm itself, so the next history-back works too.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Add a playlist" })).toBeVisible();
    await page.evaluate(() => history.back());
    await expect(page.getByText("No playlists")).toBeVisible();
  });

  test("a text field keeps left/right/enter; up/down/back leave it", async ({ page }) => {
    await gotoTv(page);
    await expect(page.getByRole("button", { name: "Add a playlist" })).toBeFocused();
    await page.keyboard.press("Enter"); // → add screen
    const url = page.getByPlaceholder("https://…/playlist.m3u");

    // Walk into the URL field and type.
    await pressUntilFocused(page, "ArrowDown", url);
    await url.pressSequentially("https://x.test/a.m3u");
    await expect(url).toHaveValue("https://x.test/a.m3u");

    // Left/right stay in the field (caret movement, no focus hop).
    await page.keyboard.press("ArrowLeft");
    await expect(url).toBeFocused();

    // First Back only blurs the field (OSK dismiss)…
    await page.keyboard.press("Escape");
    await expect(url).not.toBeFocused();
    await expect(page.getByRole("heading", { name: "Add a playlist" })).toBeVisible();
    // …the second Back navigates.
    await page.keyboard.press("Escape");
    await expect(page.getByText("No playlists")).toBeVisible();
  });
});
