import { describe, expect, it } from "vitest";
import { sanitizePlaylistEpg, userBinding, withEpgBinding, withEpgSource } from "@/lib/epg-playlist";
import type { Playlist } from "@/types";

describe("sanitizePlaylistEpg", () => {
  it("keeps http(s) sources, folds the legacy epgUrl in, drops junk bindings", () => {
    expect(
      sanitizePlaylistEpg(
        {
          sources: ["https://a.test/g.xml", "javascript:alert(1)", 42, "https://a.test/g.xml"],
          bindings: {
            ch1: { source: "epg.pw", channelId: "443174", name: "TF1" },
            ch2: { source: "epg.pw" },
            ch3: "nope",
            ch4: { source: "https://b.test/x.xml", channelId: "TF1.fr", name: 7 },
          },
        },
        "https://legacy.test/old.xml",
      ),
    ).toEqual({
      sources: ["https://a.test/g.xml", "https://legacy.test/old.xml"],
      bindings: {
        ch1: { source: "epg.pw", channelId: "443174", name: "TF1" },
        ch4: { source: "https://b.test/x.xml", channelId: "TF1.fr" },
      },
    });
  });

  it("returns undefined when nothing survives", () => {
    expect(sanitizePlaylistEpg(undefined)).toBeUndefined();
    expect(sanitizePlaylistEpg({ sources: ["ftp://x"] }, "not a url")).toBeUndefined();
    expect(sanitizePlaylistEpg("garbage")).toBeUndefined();
  });

  it("bounds string lengths", () => {
    const long = "x".repeat(200);
    expect(sanitizePlaylistEpg({ bindings: { ch: { source: "epg.pw", channelId: long } } })).toBeUndefined();
  });
});

describe("value updates", () => {
  it("puts a pasted source first, without duplicates", () => {
    expect(withEpgSource({ sources: ["https://a.test", "https://b.test"] }, "https://b.test")).toEqual({
      sources: ["https://b.test", "https://a.test"],
    });
    expect(withEpgSource(undefined, "https://c.test")).toEqual({ sources: ["https://c.test"] });
  });

  it("adds a binding while keeping the others", () => {
    const epg = withEpgBinding({ bindings: { a: { source: "s", channelId: "1" } } }, "b", { source: "s", channelId: "2" });
    expect(Object.keys(epg.bindings!)).toEqual(["a", "b"]);
  });

  it("finds the user binding for one source only", () => {
    const channel = { id: "a", name: "A", url: "https://x.test/a.m3u8" };
    const playlist: Playlist = {
      id: "p",
      title: "P",
      entries: [channel],
      addedAt: 0,
      epg: { bindings: { a: { source: "epg.pw", channelId: "1" } } },
    };
    expect(userBinding(playlist, channel, "epg.pw")?.channelId).toBe("1");
    expect(userBinding(playlist, channel, "https://other.test")).toBeUndefined();
  });
});
