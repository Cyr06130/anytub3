import { test, expect, type Page } from "@playwright/test";

async function loadSample(page: Page) {
  await page.getByRole("button", { name: "Add a playlist" }).click();
  await page.getByRole("button", { name: "Load the sample" }).click();
  await expect(page.getByText(/Playlist saved/)).toBeVisible();
}

test.describe("theme toggle", () => {
  const bodyBg = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test("switches between light and dark (incl. page background)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const light = await bodyBg(page);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "berlin-night");
    const dark = await bodyBg(page);

    // The body background must actually change (the reported bug: it stayed white).
    expect(dark).not.toBe(light);
    // Dark surface should be near-black, not white.
    expect(dark).not.toBe("rgb(255, 255, 255)");

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "berlin-day");
    expect(await bodyBg(page)).toBe(light);
  });
});

test.describe("fullscreen", () => {
  test("falls back to CSS-fill when the host blocks the Fullscreen API", async ({ page }) => {
    // Simulate an iframe without allow="fullscreen": make all fullscreen APIs fail.
    await page.addInitScript(() => {
      Element.prototype.requestFullscreen = () => Promise.reject(new Error("blocked"));
      // @ts-expect-error vendor-prefixed, not in lib.dom
      Element.prototype.webkitRequestFullscreen = undefined;
      // @ts-expect-error vendor-prefixed, not in lib.dom
      HTMLVideoElement.prototype.webkitEnterFullscreen = undefined;
    });
    await page.goto("/");
    await loadSample(page);
    await page.getByText("Mux — Test Stream").click();
    await expect(page.locator("video")).toBeVisible();

    const containerPosition = () =>
      page.evaluate(() => {
        const c = document.querySelector("video")?.parentElement;
        return c ? getComputedStyle(c).position : null;
      });

    await expect.poll(containerPosition).toBe("relative");
    await page.getByRole("button", { name: "Fullscreen" }).click();
    // Fallback engaged: the player container fills the viewport.
    await expect.poll(containerPosition).toBe("fixed");

    await page.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect.poll(containerPosition).toBe("relative");
  });
});

test.describe("edit + delete playlist", () => {
  test("rename a playlist", async ({ page }) => {
    await page.goto("/");
    await loadSample(page);

    await page.getByRole("button", { name: "Edit playlist" }).first().click();

    const input = page.getByPlaceholder("Playlist name");
    await input.fill("My renamed playlist");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByRole("heading", { name: "My renamed playlist" })).toBeVisible();
    await expect(page.getByText(/Playlist updated/)).toBeVisible();
  });

  test("remove a channel from a playlist", async ({ page }) => {
    await page.goto("/");
    await loadSample(page);

    await page.getByRole("button", { name: "Edit playlist" }).first().click();
    await page.getByRole("button", { name: "Remove Big Buck Bunny" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(/Playlist updated/)).toBeVisible();
    // Count badge drops from 4 to 3 channels.
    await expect(page.getByText("3 channels")).toBeVisible();
  });

  test("delete acts immediately and Undo restores the playlist", async ({ page }) => {
    await page.goto("/");
    await loadSample(page);

    // One click — no confirmation dialog. The action happens immediately…
    await page.getByRole("button", { name: "Delete playlist" }).first().click();
    await expect(page.getByText("No playlists")).toBeVisible();
    // …and the toast offers a grace-period Undo.
    await expect(page.getByText(/Playlist deleted/)).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("heading", { name: "AnyTub3 Demo" })).toBeVisible();

    // Deleting again (without Undo) leaves the empty state.
    await page.getByRole("button", { name: "Delete playlist" }).first().click();
    await expect(page.getByText("No playlists")).toBeVisible();
  });
});
