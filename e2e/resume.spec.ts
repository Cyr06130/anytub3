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
