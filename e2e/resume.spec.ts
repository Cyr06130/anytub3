import { test, expect } from "@playwright/test";

// The core feature (design §8): opening AnyTub3 on another host resumes the
// same channel. Two tabs in one context share localStorage + BroadcastChannel
// → they act as two hosts on the same wallet.
// Note: channel names + the "Live" badge appear in BOTH the player title and the
// side channel list, so player-screen assertions use .first().
test.describe("inter-host continuity", () => {
  test("cold resume: a new host restores the library and last channel", async ({ context }) => {
    const hostA = await context.newPage();
    await hostA.goto("/");

    // Host A: add the sample playlist and tune a channel.
    await hostA.getByRole("button", { name: "Add a playlist" }).click();
    await hostA.getByRole("button", { name: "Load the sample" }).click();
    await expect(hostA.getByText(/Playlist saved/)).toBeVisible();
    await hostA.getByText("Tears of Steel").click();
    await expect(hostA.getByText("Live").first()).toBeVisible();

    // Host B: open fresh → resume algorithm restores playlists (library-head)
    // and the now-playing channel without any manual action.
    const hostB = await context.newPage();
    await hostB.goto("/");
    await expect(hostB.locator("video")).toBeVisible();
    await expect(hostB.getByText("Tears of Steel").first()).toBeVisible();
    await expect(hostB.getByText("Live").first()).toBeVisible();
  });

  test("quit/return on the SAME device: a reload restores the library and channel", async ({ page }) => {
    // The user-reported flow: load a playlist, watch a channel, leave the app,
    // come back — everything must be back without any manual action. A reload
    // keeps sessionStorage (the mock's per-device cache), so this exercises the
    // cache path exactly like a same-device app relaunch.
    await page.goto("/");
    await page.getByRole("button", { name: "Add a playlist" }).click();
    await page.getByRole("button", { name: "Load the sample" }).click();
    await expect(page.getByText(/Playlist saved/)).toBeVisible();
    await page.getByText("Big Buck Bunny").click();
    await expect(page.getByText("Live").first()).toBeVisible();

    await page.reload();
    await expect(page.locator("video")).toBeVisible();
    await expect(page.getByText("Big Buck Bunny").first()).toBeVisible();
    await expect(page.getByText("AnyTub3 Demo")).toBeVisible();
  });

  test("restore survives a statement outage at save time (cache-first pointer)", async ({ page }) => {
    // Regression for the real-host bug: the resume pointer was cached only
    // AFTER a successful statement publish, so a host rejecting statement
    // writes (quota, authorization, size) silently orphaned the library —
    // saved on Bulletin but unreachable on the next launch.
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Add a playlist" })).toBeVisible();
    await page.evaluate(() => {
      (
        window as unknown as { __anytub3: { setChannelWriteFailure(fail: boolean): void } }
      ).__anytub3.setChannelWriteFailure(true);
    });

    await page.getByRole("button", { name: "Add a playlist" }).click();
    await page.getByRole("button", { name: "Load the sample" }).click();
    // The body IS saved; the failed pointer publish must be SURFACED, not silent.
    await expect(page.getByText(/Playlist saved/)).toBeVisible();
    await expect(page.getByText("Sync not saved")).toBeVisible();

    // Same-device relaunch (statement never landed): the per-device cache alone
    // must bring the library back.
    await page.reload();
    await expect(page.getByText("AnyTub3 Demo")).toBeVisible();
  });

  test("live handoff: tuning on host A switches host B", async ({ context }) => {
    const hostA = await context.newPage();
    await hostA.goto("/");
    await hostA.getByRole("button", { name: "Add a playlist" }).click();
    await hostA.getByRole("button", { name: "Load the sample" }).click();
    await expect(hostA.getByText(/Playlist saved/)).toBeVisible();
    await hostA.getByText("Mux — Test Stream").click();
    await expect(hostA.getByText("Live").first()).toBeVisible();

    const hostB = await context.newPage();
    await hostB.goto("/");
    await expect(hostB.locator("video")).toBeVisible();

    // Now switch channel on A → B should follow live (BroadcastChannel handoff).
    await hostA.getByRole("button", { name: "Library" }).click();
    await hostA.getByText("Apple — BipBop Advanced").click();

    await expect(hostB.getByText("Resumed from another device")).toBeVisible();
    await expect(hostB.getByText("Apple — BipBop Advanced").first()).toBeVisible();
  });
});
