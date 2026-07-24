import { describe, expect, it } from "vitest";
import { parseM3U, parseM3UHeader, sanitizeEntries, deriveTitle } from "@/lib/m3u";

const m3u = (...lines: string[]) => lines.join("\n");

describe("parseM3U", () => {
  it("parses name, group, tvg-id and logo", () => {
    const [ch] = parseM3U(
      m3u(
        "#EXTM3U",
        '#EXTINF:-1 tvg-id="bbc1" tvg-logo="https://x.test/l.png" group-title="News",BBC One',
        "https://x.test/bbc1.m3u8",
      ),
    );
    expect(ch).toMatchObject({
      name: "BBC One",
      group: "News",
      tvgId: "bbc1",
      logo: "https://x.test/l.png",
      url: "https://x.test/bbc1.m3u8",
    });
  });

  it("keeps commas inside quoted attributes out of the display name", () => {
    const [ch] = parseM3U(
      m3u("#EXTM3U", '#EXTINF:-1 group-title="News, Sports",BBC One', "https://x.test/a.m3u8"),
    );
    expect(ch.name).toBe("BBC One");
    expect(ch.group).toBe("News, Sports");
  });

  it("does not let an entry without a URL steal the next entry's stream", () => {
    const out = parseM3U(
      m3u(
        "#EXTM3U",
        '#EXTINF:-1 tvg-id="a",Channel A', // malformed: URL line missing
        '#EXTINF:-1 tvg-id="b",Channel B',
        "https://x.test/b.m3u8",
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "Channel B", url: "https://x.test/b.m3u8" });
  });

  it("drops a trailing entry whose URL never comes", () => {
    expect(parseM3U(m3u("#EXTM3U", "#EXTINF:-1,Lonely"))).toHaveLength(0);
  });

  it("rejects non-http(s) stream URLs and strips unsafe logos", () => {
    const out = parseM3U(
      m3u(
        "#EXTM3U",
        "#EXTINF:-1,Evil",
        "javascript:alert(1)",
        '#EXTINF:-1 tvg-logo="javascript:alert(1)",Ok',
        "https://x.test/ok.m3u8",
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Ok");
    expect(out[0].logo).toBeUndefined();
  });

  it("falls back to tvg-name, then a generic name", () => {
    const out = parseM3U(
      m3u(
        "#EXTM3U",
        '#EXTINF:-1 tvg-name="Named",',
        "https://x.test/1.m3u8",
        "#EXTINF:-1,",
        "https://x.test/2.m3u8",
      ),
    );
    expect(out.map((c) => c.name)).toEqual(["Named", "Channel"]);
  });

  it("tolerates CRLF, blank lines and interleaved comments", () => {
    const out = parseM3U(
      "#EXTM3U\r\n\r\n#EXTINF:-1,Ch\r\n#EXTVLCOPT:x=y\r\nhttps://x.test/ch.m3u8\r\n",
    );
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe("https://x.test/ch.m3u8");
  });

  it("de-dupes entries sharing a tvg-id", () => {
    const out = parseM3U(
      m3u(
        "#EXTM3U",
        '#EXTINF:-1 tvg-id="same",First',
        "https://x.test/1.m3u8",
        '#EXTINF:-1 tvg-id="same",Second',
        "https://x.test/2.m3u8",
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("First");
  });
});

describe("parseM3UHeader", () => {
  it.each(["url-tvg", "x-tvg-url", "tvg-url"])("reads %s", (key) => {
    expect(parseM3UHeader(`#EXTM3U ${key}="https://x.test/guide.xml"`)).toEqual({
      epgUrl: "https://x.test/guide.xml",
    });
  });

  it("takes the first http(s) URL of a comma-separated list", () => {
    expect(
      parseM3UHeader('#EXTM3U url-tvg="ftp://no.test/a, https://x.test/g.xml, https://y.test/h.xml"'),
    ).toEqual({ epgUrl: "https://x.test/g.xml" });
  });

  it("returns nothing for absent or non-http sources", () => {
    expect(parseM3UHeader("#EXTM3U")).toEqual({});
    expect(parseM3UHeader('#EXTM3U url-tvg="javascript:alert(1)"')).toEqual({});
  });
});

describe("sanitizeEntries", () => {
  it("drops non-http streams, strips unsafe logos, coerces and de-dupes", () => {
    const out = sanitizeEntries([
      { id: "safe", name: "Safe", url: "https://x.test/s.m3u8", logo: "javascript:alert(1)" },
      { id: "evil", name: "Evil", url: "file:///etc/passwd" },
      { id: "safe", name: "Dupe", url: "https://x.test/d.m3u8" },
      "not-an-object",
      { name: 42, url: "https://x.test/n.m3u8" },
    ]);
    expect(out.map((c) => c.name)).toEqual(["Safe", "Channel"]);
    expect(out[0].logo).toBeUndefined();
  });

  it("returns [] for a non-array body", () => {
    expect(sanitizeEntries({ entries: [] })).toEqual([]);
  });
});

describe("deriveTitle", () => {
  it("uses the URL basename without its extension", () => {
    expect(deriveTitle("https://x.test/lists/My%20List.m3u8", 3)).toBe("My List");
  });
  it("falls back to a counted title", () => {
    expect(deriveTitle(undefined, 4)).toBe("Playlist (4 channels)");
  });
});
