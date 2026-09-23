import { test, expect, type Page } from "@playwright/test";
import { SAMPLE_EPG_URL, xmltvTime } from "../src/lib/sample";

// EPG e2e: the guide resolver end to end in the built app, through the mock
// bridge's httpGet fixture registry (exact URL → body) — no network. Fixtures
// are seeded from the app's own URL builders/constants where they exist, and
// from the epg.pw templates of src/lib/epg-sources.ts otherwise.

const HOUR = 3_600_000;
const EPG_PW_DIRECTORY = (cc: string) => `https://epg.pw/xmltv/epg_${cc}.xml`;
const EPG_PW_CHANNEL = (id: string) => `https://epg.pw/api/epg.xml?channel_id=${id}`;

/** A one-hour programme; offset 0 started 10 min ago (on air now). */
function programme(channel: string, title: string, now: number, offsetHours = 0): string {
  const start = now + offsetHours * HOUR - 10 * 60_000;
  return `<programme start="${xmltvTime(start)}" stop="${xmltvTime(start + HOUR)}" channel="${channel}"><title>${title}</title></programme>`;
}
const channelEl = (id: string, name: string) => `<channel id="${id}"><display-name>${name}</display-name></channel>`;
const guide = (...parts: string[]) => `<?xml version="1.0" encoding="UTF-8"?><tv>${parts.join("")}</tv>`;

async function seedFixtures(page: Page, fixtures: Record<string, string>): Promise<void> {
  // The demo hooks are exposed once the app has booted (async) — wait for them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => Boolean((window as any).__anytub3));
  await page.evaluate((entries) => {
    for (const [url, body] of entries) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__anytub3.setHttpFixture(url, body);
    }
  }, Object.entries(fixtures));
}

async function importM3uFile(page: Page, name: string, m3u: string): Promise<void> {
  await page.getByRole("button", { name: "Add a playlist" }).click();
  await page.setInputFiles('input[type="file"]', { name, mimeType: "audio/x-mpegurl", buffer: Buffer.from(m3u) });
}

async function importM3uUrl(page: Page, url: string): Promise<void> {
  await page.getByRole("button", { name: "Add a playlist" }).click();
  await page.getByPlaceholder(/playlist\.m3u/).fill(url);
  await page.getByRole("button", { name: "Load", exact: true }).click();
}

const openGuide = (page: Page) => page.getByRole("button", { name: "Programme guide" }).first().click();

// The device locale is the last clue for a channel's country.
test.use({ locale: "en-US" });

test.describe("EPG — lazy, on-demand programme guide", () => {
  test("a guide declared by the playlist (url-tvg) shows now/next", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add a playlist" }).click();
    await page.getByRole("button", { name: "Load the sample" }).click();
    await expect(page.getByText("AnyTub3 Demo")).toBeVisible();

    // Seed a deterministic guide for the sample's declared source (overrides
    // the demo fixture). Nothing has been fetched yet — EPG is lazy.
    const now = Date.now();
    await seedFixtures(page, {
      [SAMPLE_EPG_URL]: guide(programme("mux.test", "E2E Live Show", now), programme("mux.test", "E2E Next Show", now, 1)),
    });

    await openGuide(page);
    // "E2E Live Show" appears twice — the Now block and the schedule row.
    await expect(page.getByText("E2E Live Show").first()).toBeVisible();
    await expect(page.getByText("Now").first()).toBeVisible();
    await expect(page.getByText("E2E Next Show").first()).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByText("Guide: Playlist guide")).toBeVisible();
  });

  test("a playlist without url-tvg gets its guide from the public directory automatically", async ({ page }) => {
    await page.goto("/");
    await importM3uFile(
      page,
      "france.m3u",
      ["#EXTM3U", '#EXTINF:-1 tvg-id="TF1.fr@SD" group-title="France",FR| TF1 HD', "https://example.com/tf1.m3u8", ""].join("\n"),
    );
    await expect(page.getByText("FR| TF1 HD")).toBeVisible();

    // The channel's country (FR) comes from its tvg-id; epg.pw's country file
    // is streamed for its channel list, then only TF1's programmes are fetched.
    const now = Date.now();
    await seedFixtures(page, {
      [EPG_PW_DIRECTORY("FR")]: guide(channelEl("443174", "TF1"), channelEl("2", "France 2"), programme("443174", "never read", now)),
      [EPG_PW_CHANNEL("443174")]: guide(programme("443174", "Journal de 20h", now), programme("443174", "Le Film", now, 1)),
    });

    await openGuide(page);
    await expect(page.getByText("Journal de 20h").first()).toBeVisible();
    await expect(page.getByText("Le Film").first()).toBeVisible();
    await expect(page.getByText("Guide: TF1 · epg.pw")).toBeVisible();
  });

  test("an unmatched channel can be picked in the directory; the choice survives a reload", async ({ page }) => {
    await page.goto("/");
    await importM3uFile(page, "mystery.m3u", ["#EXTM3U", "#EXTINF:-1,Mystery Channel", "https://example.com/m.m3u8", ""].join("\n"));
    await expect(page.getByText("Mystery Channel")).toBeVisible();

    // No tvg-id, no prefix → the device locale (en-US) picks the US directory.
    const now = Date.now();
    const fixtures = {
      [EPG_PW_DIRECTORY("US")]: guide(channelEl("778", "Other News"), channelEl("777", "Mystery TV")),
      [EPG_PW_CHANNEL("777")]: guide(programme("777", "Mystery Hour", now)),
    };
    await seedFixtures(page, fixtures);

    await openGuide(page);
    await expect(page.getByText("No guide found for this channel yet.")).toBeVisible();
    await page.getByRole("button", { name: "Choose the channel" }).click();

    // The picker lists the US directory, likeliest match first.
    await expect(page.getByRole("combobox", { name: "Country" })).toHaveValue("US");
    const rows = page.getByRole("button", { name: /Mystery TV|Other News/ });
    await expect(rows.first()).toHaveText("Mystery TV");
    await rows.first().click();

    await expect(page.getByText("Mystery Hour").first()).toBeVisible();
    await expect(page.getByText("Guide: Mystery TV · epg.pw")).toBeVisible();

    // The binding is saved to the playlist (Bulletin), not just cached: drop
    // the per-device EPG cache, reload, and the guide resolves straight away.
    await page.evaluate(() => {
      for (const k of Object.keys(sessionStorage)) if (k.includes("epg:")) sessionStorage.removeItem(k);
    });
    await page.reload();
    await expect(page.getByText("Mystery Channel")).toBeVisible();
    await seedFixtures(page, fixtures); // the fixture registry does not survive a reload
    await openGuide(page);
    await expect(page.getByText("Mystery Hour").first()).toBeVisible();
  });

  test("a playlist imported from an Xtream panel uses the provider's per-channel EPG", async ({ page }) => {
    await page.goto("/");
    const playlistUrl = "http://panel.test:8080/get.php?username=u1&password=p1&type=m3u_plus";
    const shortEpgUrl = "http://panel.test:8080/player_api.php?username=u1&password=p1&action=get_short_epg&stream_id=1001&limit=40";
    const now = Math.floor(Date.now() / 1000);
    const listing = (title: string, offsetHours: number) => ({
      title: Buffer.from(title).toString("base64"),
      description: Buffer.from("Live").toString("base64"),
      start_timestamp: String(now + offsetHours * 3600 - 600),
      stop_timestamp: String(now + (offsetHours + 1) * 3600 - 600),
    });
    await seedFixtures(page, {
      [playlistUrl]: ["#EXTM3U", '#EXTINF:-1 group-title="Sport",Sports One', "http://panel.test:8080/live/u1/p1/1001.m3u8", ""].join("\n"),
      [shortEpgUrl]: JSON.stringify({ epg_listings: [listing("Match of the Day", 0), listing("Highlights", 1)] }),
    });

    await importM3uUrl(page, playlistUrl);
    await expect(page.getByText("Sports One")).toBeVisible();

    await openGuide(page);
    await expect(page.getByText("Match of the Day").first()).toBeVisible();
    await expect(page.getByText("Highlights").first()).toBeVisible();
    await expect(page.getByText("Guide: Provider guide")).toBeVisible();
  });

  test("TV mode offers the directory picker but no URL field (no keyboard)", async ({ page }) => {
    await page.goto("/?tv=1");
    const playlistUrl = "https://lists.test/tv.m3u";
    await seedFixtures(page, {
      [playlistUrl]: ["#EXTM3U", "#EXTINF:-1,Mystery Channel", "https://example.com/m.m3u8", ""].join("\n"),
      [EPG_PW_DIRECTORY("US")]: guide(channelEl("1", "Something Else")),
    });
    await importM3uUrl(page, playlistUrl);
    await expect(page.getByText("Mystery Channel")).toBeVisible();

    await openGuide(page);
    await expect(page.getByText("No guide found for this channel yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose the channel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Paste a guide URL" })).toHaveCount(0);
  });
});
