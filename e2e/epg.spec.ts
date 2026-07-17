import { test, expect } from "@playwright/test";

const SAMPLE_EPG_URL = "https://anytub3.demo/sample-epg.xml";

// Build an XMLTV guide anchored on the browser's current time so there is always
// a deterministic "now" + "next" for the first sample channel (tvg-id mux.test).
// Seeded through the mock bridge's httpGet fixture registry — no network.
function seedFixture() {
  return (url: string) => {
    const now = Date.now();
    const fmt = (ms: number) => {
      const d = new Date(ms);
      const p = (n: number, w = 2) => String(n).padStart(w, "0");
      return (
        `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
        `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`
      );
    };
    const s0 = now - 10 * 60_000; // started 10 min ago → on air now
    const e0 = now + 50 * 60_000;
    const e1 = now + 110 * 60_000;
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?><tv>` +
      `<programme start="${fmt(s0)}" stop="${fmt(e0)}" channel="mux.test">` +
      `<title>E2E Live Show</title><desc>On air during the test.</desc><category>Test</category></programme>` +
      `<programme start="${fmt(e0)}" stop="${fmt(e1)}" channel="mux.test">` +
      `<title>E2E Next Show</title></programme>` +
      `</tv>`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__anytub3.setHttpFixture(url, xml);
  };
}

test.describe("EPG — lazy, on-demand programme guide", () => {
  test("opening a channel's guide shows now/next from the XMLTV feed", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Add a playlist" }).click();
    await page.getByRole("button", { name: "Load the sample" }).click();
    await expect(page.getByText("AnyTub3 Demo")).toBeVisible();

    // Seed a deterministic guide for the sample's EPG source (overrides the
    // demo fixture). Nothing has been fetched yet — EPG is lazy.
    await page.evaluate(seedFixture(), SAMPLE_EPG_URL);

    // The sample playlist advertises an EPG source, so each channel row exposes
    // a "Programme guide" button. Open the first channel's (mux.test) guide.
    const guideButtons = page.getByRole("button", { name: "Programme guide" });
    await expect(guideButtons.first()).toBeVisible();
    await guideButtons.first().click();

    // now / next + a progress bar, read on demand from the feed. ("E2E Live
    // Show" appears twice — the Now block and the schedule row — which is
    // exactly the expected layout, so scope to the first.)
    await expect(page.getByText("E2E Live Show").first()).toBeVisible();
    await expect(page.getByText("Now").first()).toBeVisible();
    await expect(page.getByText("E2E Next Show").first()).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeVisible();
  });

  test("a playlist without url-tvg still offers the guide (paste an XMLTV URL)", async ({ page }) => {
    await page.goto("/");

    // Import an .m3u with NO `url-tvg` header → no EPG source yet.
    await page.getByRole("button", { name: "Add a playlist" }).click();
    const m3u = [
      "#EXTM3U",
      '#EXTINF:-1 tvg-id="x" group-title="G",No EPG Channel',
      "https://example.com/x.m3u8",
      "",
    ].join("\n");
    await page.setInputFiles('input[type="file"]', {
      name: "plain.m3u",
      mimeType: "audio/x-mpegurl",
      buffer: Buffer.from(m3u),
    });
    await expect(page.getByText("No EPG Channel")).toBeVisible();

    // The guide button is always available; opening it offers to add a source.
    await page.getByRole("button", { name: "Programme guide" }).first().click();
    await expect(page.getByText(/No EPG source yet/)).toBeVisible();
    await expect(page.getByPlaceholder(/XMLTV/)).toBeVisible();
  });
});
