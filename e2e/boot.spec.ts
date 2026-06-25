import { test, expect } from "@playwright/test";

test.describe("boot", () => {
  test("renders the shell, demo badge and empty library", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");

    await expect(page.getByText("AnyTub3")).toBeVisible();
    // Off-host → demo mode badge.
    await expect(page.getByText("Demo mode")).toBeVisible();
    // Fresh storage → empty state.
    await expect(page.getByText("No playlists")).toBeVisible();

    expect(errors, `page errors: ${errors.join("\n")}`).toEqual([]);
  });
});
