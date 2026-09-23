import { test, expect, type Page } from "@playwright/test";

// Helpers ────────────────────────────────────────────────────────────────────

async function waitForApp(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __anytub3?: unknown }).__anytub3));
}

/** Mint a share code for a fresh playlist we don't own (dev hook, off-host). */
function mintCode(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { __anytub3: { simulateShareCode(): Promise<string> } }).__anytub3.simulateShareCode(),
  );
}

async function importCode(page: Page, code: string) {
  // The Add entry point differs between empty ("Add a playlist") and non-empty ("Add").
  const addEmpty = page.getByRole("button", { name: "Add a playlist" });
  if (await addEmpty.isVisible().catch(() => false)) {
    await addEmpty.click();
  } else {
    await page.getByRole("button", { name: "Add", exact: true }).click();
  }
  await page.getByPlaceholder("anytub3:…").fill(code);
  await page.getByRole("button", { name: "Import", exact: true }).click();
}

async function loadSample(page: Page) {
  await page.getByRole("button", { name: "Add a playlist" }).click();
  await page.getByRole("button", { name: "Load the sample" }).click();
  await expect(page.getByText(/Playlist saved/)).toBeVisible();
}

// Tests ───────────────────────────────────────────────────────────────────────

test.describe("sharing", () => {
  test("outbound: a copyable share code is generated", async ({ page }) => {
    await page.goto("/");
    await loadSample(page);

    await page.getByRole("button", { name: "Share playlist" }).first().click();
    await expect(page.getByText("Share playlist")).toBeVisible();
    await expect(page.getByLabel("Share code", { exact: true })).toHaveValue(/^anytub3:/);
  });

  test("import into an EMPTY library", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No playlists")).toBeVisible();
    await waitForApp(page);

    await importCode(page, await mintCode(page));

    await expect(page.getByRole("heading", { name: "Code-shared playlist (demo)" })).toBeVisible();
    await expect(page.getByText("No playlists")).toHaveCount(0);
  });

  test("import into a NON-EMPTY library (keeps both)", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await loadSample(page);
    await expect(page.getByRole("heading", { name: "AnyTub3 Demo" })).toBeVisible();

    await importCode(page, await mintCode(page));

    await expect(page.getByRole("heading", { name: "Code-shared playlist (demo)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "AnyTub3 Demo" })).toBeVisible();
  });

  test("import re-stores under our own key and survives a reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No playlists")).toBeVisible();
    await waitForApp(page);

    await importCode(page, await mintCode(page));
    // Wait for the success toast: it fires only after the library index is persisted.
    await expect(page.getByText(/Playlist received/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Code-shared playlist (demo)" })).toBeVisible();

    // Re-encrypted under our own key → our own cid differs from the source CID.
    const ids = await page.evaluate(() => {
      const p = (
        window as unknown as {
          __anytub3: { getState(): { playlists: Array<{ title: string; cid?: string; sourceCid?: string }> } };
        }
      ).__anytub3
        .getState()
        .playlists.find((x) => x.title === "Code-shared playlist (demo)");
      return { cid: p?.cid, sourceCid: p?.sourceCid };
    });
    expect(ids.sourceCid).toBeTruthy();
    expect(ids.cid).toBeTruthy();
    expect(ids.cid).not.toEqual(ids.sourceCid);

    // The actual bug: it must still be there after a cold reload (restored from
    // the index, decryptable because it was re-stored under our key).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Code-shared playlist (demo)" })).toBeVisible();
  });

  test("re-importing an owned playlist is a no-op, not a crash", async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    const code = await mintCode(page);

    await importCode(page, code);
    await expect(page.getByRole("heading", { name: "Code-shared playlist (demo)" })).toBeVisible();

    await importCode(page, code);
    await expect(page.getByText(/Already in your library/)).toBeVisible();
    // Still exactly one copy, app intact.
    await expect(page.getByRole("heading", { name: "Code-shared playlist (demo)" })).toHaveCount(1);
  });

  test("an unknown CID fails cleanly without crashing the app", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No playlists")).toBeVisible();
    await waitForApp(page);

    const ghost = await page.evaluate(() => {
      const json = JSON.stringify({
        v: 1,
        playlistCid: "bafymockGHOST00000000000000000000000000000000000",
        key: Array(32).fill(7),
        title: "Ghost",
      });
      return "anytub3:" + btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    });
    await importCode(page, ghost);

    await expect(page.getByText(/Receive failed/)).toBeVisible();
    // No white screen: the shell survives, and Back returns to the empty state
    // (the failed import leaves us on the add screen).
    await expect(page.getByText("AnyTub3").first()).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByText("No playlists")).toBeVisible();
  });

  test("a malformed code is rejected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No playlists")).toBeVisible();

    await importCode(page, "this-is-not-a-valid-code");
    await expect(page.getByText(/Invalid code/)).toBeVisible();
  });

  test("import re-sanitizes a hostile playlist (drops non-http(s) entries)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No playlists")).toBeVisible();
    await waitForApp(page);

    const code = await page.evaluate(() =>
      (window as unknown as { __anytub3: { simulateMaliciousShareCode(): Promise<string> } }).__anytub3.simulateMaliciousShareCode(),
    );
    await importCode(page, code);

    // The playlist imports, but only the safe http(s) channels survive.
    await expect(page.getByRole("heading", { name: "Malicious (demo)" })).toBeVisible();
    await expect(page.getByText("Safe channel")).toBeVisible();
    await expect(page.getByText("Evil logo")).toBeVisible(); // kept; its unsafe logo is stripped
    await expect(page.getByText("Evil JS")).toHaveCount(0); // javascript: URL → dropped
    await expect(page.getByText("Evil file")).toHaveCount(0); // file: URL → dropped
  });

  test("inbound (chat): a delivered pointer is decoded and imported", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("No playlists")).toBeVisible();
    await waitForApp(page);

    await page.evaluate(async () => {
      await (window as unknown as { __anytub3: { simulateReceiveSample(): Promise<void> } }).__anytub3.simulateReceiveSample();
    });

    await expect(page.getByRole("heading", { name: "Received playlist (demo)" })).toBeVisible();
    await expect(page.getByText("No playlists")).toHaveCount(0);
  });
});
