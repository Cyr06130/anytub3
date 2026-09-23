import { describe, expect, it } from "vitest";
import { parseXtreamShortEpg, xtreamAccount, xtreamShortEpgUrl, xtreamStreamId, xtreamXmltvUrl } from "@/lib/epg-xtream";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("xtreamAccount", () => {
  it("recognizes a get.php playlist URL", () => {
    expect(xtreamAccount("http://panel.test:8080/get.php?username=u1&password=p1&type=m3u_plus&output=ts")).toEqual({
      base: "http://panel.test:8080",
      username: "u1",
      password: "p1",
    });
    expect(xtreamAccount("https://panel.test/sub/get.php?username=u&password=p")?.base).toBe("https://panel.test/sub");
  });
  it("rejects anything else", () => {
    expect(xtreamAccount("https://x.test/playlist.m3u")).toBeUndefined();
    expect(xtreamAccount("https://x.test/get.php?username=u")).toBeUndefined();
    expect(xtreamAccount("javascript:alert(1)")).toBeUndefined();
    expect(xtreamAccount(undefined)).toBeUndefined();
  });
});

describe("xtreamStreamId", () => {
  const account = { base: "http://panel.test:8080", username: "u1", password: "p1" };
  it("reads the id after the credentials, with or without /live and extension", () => {
    expect(xtreamStreamId("http://panel.test:8080/live/u1/p1/1001.m3u8", account)).toBe("1001");
    expect(xtreamStreamId("http://panel.test:8080/u1/p1/1001.ts", account)).toBe("1001");
    expect(xtreamStreamId("http://panel.test:8080/u1/p1/1001", account)).toBe("1001");
  });
  it("refuses foreign or non-numeric streams", () => {
    expect(xtreamStreamId("http://panel.test:8080/live/other/p1/1001.m3u8", account)).toBeUndefined();
    expect(xtreamStreamId("http://panel.test:8080/live/u1/p1/abc.m3u8", account)).toBeUndefined();
    expect(xtreamStreamId("not a url", account)).toBeUndefined();
  });
});

describe("panel URLs", () => {
  const account = { base: "http://panel.test:8080", username: "u 1", password: "p&1" };
  it("builds the short-EPG and XMLTV URLs with encoded credentials", () => {
    expect(xtreamShortEpgUrl(account, "1001", 40)).toBe(
      "http://panel.test:8080/player_api.php?username=u+1&password=p%261&action=get_short_epg&stream_id=1001&limit=40",
    );
    expect(xtreamXmltvUrl(account)).toBe("http://panel.test:8080/xmltv.php?username=u+1&password=p%261");
  });
});

describe("parseXtreamShortEpg", () => {
  it("decodes base64 text and unix timestamps", () => {
    const [p] = parseXtreamShortEpg(
      {
        epg_listings: [
          {
            title: b64("Journal télévisé"),
            description: b64("Les infos"),
            start_timestamp: "1700000000",
            stop_timestamp: 1700003600,
          },
        ],
      },
      "1001",
    );
    expect(p).toMatchObject({ channelId: "1001", title: "Journal télévisé", desc: "Les infos", start: 1_700_000_000_000, stop: 1_700_003_600_000 });
  });

  it("keeps plain text that isn't base64, defaults an empty title, skips bad listings", () => {
    const out = parseXtreamShortEpg(
      {
        epg_listings: [
          { title: "News", start_timestamp: "1700000000", stop_timestamp: "1700003600" },
          { title: "", start_timestamp: "1700003600", stop_timestamp: "1700007200" },
          { title: b64("Reversed"), start_timestamp: "1700007200", stop_timestamp: "1700007200" },
          "junk",
        ],
      },
      "1001",
    );
    expect(out.map((p) => p.title)).toEqual(["News", "Untitled programme"]);
  });

  it("returns nothing for an unexpected shape", () => {
    expect(parseXtreamShortEpg(null, "1")).toEqual([]);
    expect(parseXtreamShortEpg({ user_info: {} }, "1")).toEqual([]);
  });
});
