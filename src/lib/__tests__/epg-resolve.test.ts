// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { HostBridge } from "@/lib/bridge/types";
import { cutAt } from "@/lib/bridge/http";
import { loadGuideChoices, resolveChannelGuide, type ResolveStep } from "@/lib/epg-resolve";
import { xmltvTime } from "@/lib/sample";
import type { Channel, Playlist } from "@/types";

// The cascade end to end against a fake bridge: fixtures by exact URL, an
// in-memory per-device cache, and call logs to prove what was (not) fetched.

type Fake = { bridge: HostBridge; calls: string[]; prefixCalls: string[]; fixtures: Map<string, string> };

function fakeBridge(fixtures: Record<string, string>): Fake {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const prefixCalls: string[] = [];
  const fx = new Map(Object.entries(fixtures));
  const get = async (url: string) => {
    calls.push(url);
    const body = fx.get(url);
    if (body === undefined) throw new Error(`HTTP 404 (${url})`);
    return body;
  };
  const bridge = {
    httpGet: get,
    httpGetBytes: async (url: string) => new TextEncoder().encode(await get(url)),
    httpGetPrefix: async (url: string, opts: { until: string }) => {
      prefixCalls.push(url);
      return cutAt(await get(url), opts.until);
    },
    localGet: (k: string) => store.get(k) ?? null,
    localSet: (k: string, v: string) => {
      store.set(k, v);
    },
  } as unknown as HostBridge;
  return { bridge, calls, prefixCalls, fixtures: fx };
}

const NOW = Date.now();
const HOUR = 3_600_000;
/** A one-hour programme; offset 0 started 30 min ago (on air now). */
const programme = (channel: string, title: string, offsetHours = 0) =>
  `<programme start="${xmltvTime(NOW + offsetHours * HOUR - HOUR / 2)}" stop="${xmltvTime(NOW + (offsetHours + 1) * HOUR - HOUR / 2)}" channel="${channel}"><title>${title}</title></programme>`;
const channelEl = (id: string, name: string) => `<channel id="${id}"><display-name>${name}</display-name></channel>`;
const guide = (...parts: string[]) => `<?xml version="1.0"?><tv>${parts.join("")}</tv>`;

const ch = (id: string, name: string, patch: Partial<Channel> = {}): Channel => ({
  id,
  name,
  url: `https://streams.test/${id}.m3u8`,
  ...patch,
});
const pl = (entries: Channel[], patch: Partial<Playlist> = {}): Playlist => ({ id: "pl1", title: "P", entries, addedAt: 0, ...patch });

const DECLARED = "https://provider.test/guide.xml";
const EPG_PW_FR = "https://epg.pw/xmltv/epg_FR.xml";
const EPG_PW_US = "https://epg.pw/xmltv/epg_US.xml";
const epgPwChannel = (id: string) => `https://epg.pw/api/epg.xml?channel_id=${id}`;

describe("declared XMLTV guides", () => {
  const tf1 = ch("c1", "TF1", { tvgId: "TF1.fr@SD" });
  const f2 = ch("c2", "France 2", { tvgId: "France2.fr" });

  it("matches a feed-suffixed tvg-id (`TF1.fr@SD`) on the guide's `TF1.fr`", async () => {
    const { bridge } = fakeBridge({ [DECLARED]: guide(programme("TF1.fr", "Journal")) });
    const g = await resolveChannelGuide(bridge, pl([tf1], { epg: { sources: [DECLARED] } }), tf1);
    expect(g).toMatchObject({ source: DECLARED, sourceLabel: "Playlist guide", channelId: "TF1.fr" });
    expect(g.programmes.map((p) => p.title)).toEqual(["Journal"]);
  });

  it("serves the playlist's sibling channels from the same download", async () => {
    const { bridge, calls } = fakeBridge({
      [DECLARED]: guide(programme("TF1.fr", "A"), programme("France2.fr", "B")),
    });
    const playlist = pl([tf1, f2], { epg: { sources: [DECLARED] } });
    await resolveChannelGuide(bridge, playlist, tf1);
    expect(calls).toEqual([DECLARED]);
    const g = await resolveChannelGuide(bridge, playlist, f2);
    expect(g.programmes.map((p) => p.title)).toEqual(["B"]);
    expect(calls).toEqual([DECLARED]); // no second fetch
  });

  it("matches by name against the guide's own channel list when there is no tvg-id", async () => {
    const arte = ch("c3", "FR| Arte HD");
    const { bridge } = fakeBridge({ [DECLARED]: guide(channelEl("arte1", "Arte"), programme("arte1", "Doc")) });
    const g = await resolveChannelGuide(bridge, pl([arte], { epg: { sources: [DECLARED] } }), arte);
    expect(g).toMatchObject({ channelId: "arte1", channelName: "Arte" });
  });

  it("tries every declared URL in order", async () => {
    const second = "https://provider.test/guide-2.xml";
    const { bridge, calls } = fakeBridge({
      [DECLARED]: guide(programme("Other.fr", "X")),
      [second]: guide(programme("TF1.fr", "Journal")),
    });
    const g = await resolveChannelGuide(bridge, pl([tf1], { epg: { sources: [DECLARED, second] } }), tf1);
    expect(g.source).toBe(second);
    expect(calls).toEqual([DECLARED, second]);
  });
});

describe("Xtream Codes provider", () => {
  const sourceUrl = "http://panel.test/get.php?username=u&password=p&type=m3u_plus";
  const shortEpg = "http://panel.test/player_api.php?username=u&password=p&action=get_short_epg&stream_id=1001&limit=40";
  const sports = ch("s1", "Sports One", { url: "http://panel.test/live/u/p/1001.m3u8" });
  const b64 = (s: string) => btoa(s);
  const listing = (title: string, offsetHours = 0) => ({
    title: b64(title),
    start_timestamp: String(Math.floor((NOW + offsetHours * HOUR - HOUR / 2) / 1000)),
    stop_timestamp: String(Math.floor((NOW + (offsetHours + 1) * HOUR - HOUR / 2) / 1000)),
  });

  it("is consulted before the declared guide", async () => {
    const { bridge, calls } = fakeBridge({
      [shortEpg]: JSON.stringify({ epg_listings: [listing("Match"), listing("Highlights", 1)] }),
      [DECLARED]: guide(programme("Sports.fr", "Never")),
    });
    const g = await resolveChannelGuide(bridge, pl([sports], { sourceUrl, epg: { sources: [DECLARED] } }), sports);
    expect(g).toMatchObject({ source: "xtream", sourceLabel: "Provider guide", channelId: "1001" });
    expect(g.programmes.map((p) => p.title)).toEqual(["Match", "Highlights"]);
    expect(calls).toEqual([shortEpg]);
  });

  it("falls through when the panel has no listings", async () => {
    const { bridge } = fakeBridge({
      [shortEpg]: JSON.stringify({ epg_listings: [] }),
      [DECLARED]: guide(programme("Sports.fr", "From XMLTV")),
    });
    const withId = { ...sports, tvgId: "Sports.fr" };
    const g = await resolveChannelGuide(bridge, pl([withId], { sourceUrl, epg: { sources: [DECLARED] } }), withId);
    expect(g.source).toBe(DECLARED);
  });
});

describe("public guide directory", () => {
  const tf1 = ch("c1", "FR| TF1 HD", { tvgId: "TF1.fr" });
  const directoryFr = guide(channelEl("443174", "TF1"), channelEl("2", "France 2"), programme("443174", "never read"));

  it("infers the country from the tvg-id, streams the directory, matches by name, fetches one channel", async () => {
    const { bridge, calls, prefixCalls } = fakeBridge({
      [EPG_PW_FR]: directoryFr,
      [epgPwChannel("443174")]: guide(programme("443174", "Journal")),
    });
    const steps: ResolveStep[] = [];
    const g = await resolveChannelGuide(bridge, pl([tf1]), tf1, { onStep: (s) => steps.push(s) });
    expect(g).toMatchObject({ source: "epg.pw", sourceLabel: "epg.pw", channelId: "443174", channelName: "TF1" });
    expect(prefixCalls).toEqual([EPG_PW_FR]);
    expect(calls).toEqual([EPG_PW_FR, epgPwChannel("443174")]);
    expect(steps.map((s) => s.source)).toContain("epg.pw");

    // Everything is cached: re-opening the guide costs no request.
    await resolveChannelGuide(bridge, pl([tf1]), tf1);
    expect(calls).toHaveLength(2);
  });

  it("falls back to the device's country for a channel without any clue", async () => {
    const mystery = ch("m", "Mystery");
    const { bridge, prefixCalls } = fakeBridge({
      [EPG_PW_US]: guide(channelEl("5", "Mystery")),
      [epgPwChannel("5")]: guide(programme("5", "Mystery Hour")),
    });
    const g = await resolveChannelGuide(bridge, pl([mystery]), mystery, { deviceCountry: "US" });
    expect(g.channelId).toBe("5");
    expect(prefixCalls).toEqual([EPG_PW_US]);
  });

  it("reports no-match and does not retry before the miss expires", async () => {
    const unknown = ch("u", "Unknown", { tvgId: "Unknown.fr" });
    const { bridge, calls } = fakeBridge({ [EPG_PW_FR]: directoryFr });
    await expect(resolveChannelGuide(bridge, pl([unknown]), unknown)).rejects.toMatchObject({ code: "no-match" });
    const n = calls.length;
    await expect(resolveChannelGuide(bridge, pl([unknown]), unknown)).rejects.toMatchObject({ code: "no-match" });
    expect(calls).toHaveLength(n);
  });

  it("does not remember a network failure as a miss", async () => {
    const fake = fakeBridge({});
    await expect(resolveChannelGuide(fake.bridge, pl([tf1]), tf1)).rejects.toMatchObject({ code: "fetch-failed" });
    fake.fixtures.set(EPG_PW_FR, directoryFr);
    fake.fixtures.set(epgPwChannel("443174"), guide(programme("443174", "Journal")));
    await expect(resolveChannelGuide(fake.bridge, pl([tf1]), tf1)).resolves.toMatchObject({ channelId: "443174" });
  });

  it("skips a country the directory doesn't cover", async () => {
    const rai = ch("r", "Rai 1", { tvgId: "Rai1.it" });
    const { bridge, calls } = fakeBridge({});
    await expect(resolveChannelGuide(bridge, pl([rai]), rai)).rejects.toMatchObject({ code: "no-source" });
    expect(calls).toEqual([]);
  });
});

describe("user choices", () => {
  const tf1 = ch("c1", "TF1", { tvgId: "TF1.fr" });

  it("a picked directory channel wins over every automatic source", async () => {
    const { bridge, calls } = fakeBridge({
      [DECLARED]: guide(programme("TF1.fr", "From the declared guide")),
      [epgPwChannel("999")]: guide(programme("999", "From the pick")),
    });
    const playlist = pl([tf1], {
      epg: { sources: [DECLARED], bindings: { c1: { source: "epg.pw", channelId: "999", name: "TF1 (picked)" } } },
    });
    const g = await resolveChannelGuide(bridge, playlist, tf1);
    expect(g).toMatchObject({ source: "epg.pw", channelId: "999", channelName: "TF1 (picked)" });
    expect(g.programmes[0].title).toBe("From the pick");
    expect(calls).toEqual([epgPwChannel("999")]);
  });

  it("a fix to the configuration is retried at once despite a remembered miss", async () => {
    const unknown = ch("u", "Unknown", { tvgId: "Unknown.fr" });
    const fake = fakeBridge({
      [EPG_PW_FR]: guide(channelEl("1", "TF1")),
      [epgPwChannel("7")]: guide(programme("7", "Found")),
    });
    await expect(resolveChannelGuide(fake.bridge, pl([unknown]), unknown)).rejects.toMatchObject({ code: "no-match" });
    const fixed = pl([unknown], { epg: { bindings: { u: { source: "epg.pw", channelId: "7" } } } });
    await expect(resolveChannelGuide(fake.bridge, fixed, unknown)).resolves.toMatchObject({ channelId: "7" });
  });
});

describe("loadGuideChoices (the picker)", () => {
  it("lists the country directory with the likely match first", async () => {
    const tf1 = ch("c1", "TF1", { tvgId: "TF1.fr" });
    const { bridge } = fakeBridge({ [EPG_PW_FR]: guide(channelEl("2", "Arte"), channelEl("1", "TF1")) });
    const choices = await loadGuideChoices(bridge, tf1);
    expect(choices?.country).toBe("FR");
    expect(choices?.channels.map((c) => c.name)).toEqual(["TF1", "Arte"]);
  });

  it("returns an empty list without a country until the user picks one", async () => {
    const rai = ch("r", "Rai 1", { tvgId: "Rai1.it" });
    const fake = fakeBridge({ [EPG_PW_FR]: guide(channelEl("1", "TF1")) });
    const choices = await loadGuideChoices(fake.bridge, rai);
    expect(choices?.country).toBeUndefined();
    expect(choices?.channels).toEqual([]);
    expect((await loadGuideChoices(fake.bridge, rai, "FR"))?.channels).toHaveLength(1);
  });
});
