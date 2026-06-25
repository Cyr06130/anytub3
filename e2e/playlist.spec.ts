import { test, expect } from "@playwright/test";

test.describe("ingest + persist + play", () => {
  test("load the sample playlist, persist to Bulletin, tune a channel", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Add a playlist" }).click();
    await page.getByRole("button", { name: "Load the sample" }).click();

    // Saved to (mock) Bulletin → success toast + card visible.
    await expect(page.getByText("AnyTub3 Demo")).toBeVisible();
    await expect(page.getByText(/Playlist saved/)).toBeVisible();

    // Tune a channel → player screen with the live indicator + side channel list.
    await page.getByText("Mux — Test Stream").click();
    await expect(page.locator("video")).toBeVisible();
    await expect(page.getByText("Live").first()).toBeVisible();
    // Channel list sidebar is shown alongside the stream.
    await expect(page.getByText("Big Buck Bunny")).toBeVisible();
    // Fullscreen toggle is available.
    await expect(page.getByRole("button", { name: "Fullscreen" })).toBeVisible();
  });
});
