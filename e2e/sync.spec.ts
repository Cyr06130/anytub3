import { test, expect, type Page } from "@playwright/test";

// Cross-host library sync (design §8). Two tabs in one context share the channel
// + cloud (the "network") but have their OWN per-tab cache (sessionStorage), so
// they behave like two real devices on one wallet. Covers the operations that
// were desyncing: add (upload), import, edit (rename), delete.

async function waitForApp(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __anytub3?: unknown }).__anytub3));
}

async function open(context: import("@playwright/test").BrowserContext): Promise<Page> {
  const p = await context.newPage();
  await p.goto("/");
  await waitForApp(p);
  return p;
}

async function addSample(page: Page) {
  await page.getByRole("button", { name: "Add a playlist" }).click();
  await page.getByRole("button", { name: "Load the sample" }).click();
  await expect(page.getByText(/Playlist saved/)).toBeVisible();
}

function mintCode(page: Page, title: string): Promise<string> {
  return page.evaluate(
    (t) => (window as unknown as { __anytub3: { simulateShareCode(t?: string): Promise<string> } }).__anytub3.simulateShareCode(t),
    title,
  );
}

async function importCode(page: Page, code: string) {
  const addEmpty = page.getByRole("button", { name: "Add a playlist" });
  if (await addEmpty.isVisible().catch(() => false)) await addEmpty.click();
  else await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByPlaceholder("anytub3:…").fill(code);
  await page.getByRole("button", { name: "Import", exact: true }).click();
}

// rename / delete operate on a library with a single playlist → the inline
// card action buttons are unambiguous.
async function rename(page: Page, to: string) {
  await page.getByRole("button", { name: "Edit playlist" }).click();
  await expect(page.getByRole("heading", { name: "Edit playlist" })).toBeVisible();
  await page.getByPlaceholder("Playlist name").fill(to);
  await page.getByRole("button", { name: "Save" }).click();
}

async function remove(page: Page) {
  // Deletion is immediate (design system: act first, offer Undo in a toast).
  await page.getByRole("button", { name: "Delete playlist" }).click();
  await expect(page.getByText(/Playlist deleted/)).toBeVisible();
}

const H = (page: Page, name: string) => page.getByRole("heading", { name });

test.describe("cross-host library sync", () => {
  test("add (upload) propagates to another host", async ({ context }) => {
    const a = await open(context);
    await addSample(a);
    await expect(H(a, "AnyTub3 Demo")).toBeVisible();

    const b = await open(context);
    await expect(H(b, "AnyTub3 Demo")).toBeVisible(); // cold resume

    // A second, live add on A must appear on the already-open B.
    await importCode(a, await mintCode(a, "Added Live"));
    await expect(H(a, "Added Live")).toBeVisible();
    await expect(H(b, "Added Live")).toBeVisible();
  });

  test("import propagates to another host", async ({ context }) => {
    const a = await open(context);
    await importCode(a, await mintCode(a, "Imported Playlist"));
    await expect(H(a, "Imported Playlist")).toBeVisible();

    const b = await open(context);
    await expect(H(b, "Imported Playlist")).toBeVisible();
  });

  test("edit (rename) propagates to another host", async ({ context }) => {
    const a = await open(context);
    await addSample(a);

    const b = await open(context);
    await expect(H(b, "AnyTub3 Demo")).toBeVisible();

    await rename(a, "Renamed Across Hosts");
    await expect(H(a, "Renamed Across Hosts")).toBeVisible();
    await expect(H(b, "Renamed Across Hosts")).toBeVisible();
    await expect(H(b, "AnyTub3 Demo")).toHaveCount(0);
  });

  test("delete propagates to another host", async ({ context }) => {
    const a = await open(context);
    await addSample(a);

    const b = await open(context);
    await expect(H(b, "AnyTub3 Demo")).toBeVisible();

    await remove(a);
    await expect(a.getByText("No playlists")).toBeVisible();
    await expect(b.getByText("No playlists")).toBeVisible();
  });

  test("a lagging host's heartbeat does NOT roll back newer changes", async ({ context }) => {
    // Regression for the core desync: a host that applied a remote head must
    // adopt it, so its own heartbeat republishes the latest — not a stale index.
    const a = await open(context);
    await addSample(a); // P1: "AnyTub3 Demo"

    const b = await open(context);
    await expect(H(b, "AnyTub3 Demo")).toBeVisible();

    // B publishes a head of its own (so B has a non-empty cache to go stale).
    await importCode(b, await mintCode(b, "From B"));
    await expect(H(b, "From B")).toBeVisible();
    await expect(H(a, "From B")).toBeVisible();

    // A then publishes a NEWER head that B receives (B must adopt it).
    await importCode(a, await mintCode(a, "From A"));
    await expect(H(a, "From A")).toBeVisible();
    await expect(H(b, "From A")).toBeVisible();

    // Fire B's heartbeat tick. Pre-fix, B's cache was still its own "From B" head
    // (it never adopted A's), so this rolled everyone back and dropped "From A".
    await b.evaluate(() => (window as unknown as { __anytub3: { republishHead(): Promise<void> } }).__anytub3.republishHead());

    // Nothing is lost on either host.
    for (const p of [a, b]) {
      await expect(H(p, "AnyTub3 Demo")).toBeVisible();
      await expect(H(p, "From B")).toBeVisible();
      await expect(H(p, "From A")).toBeVisible();
    }
  });
});
