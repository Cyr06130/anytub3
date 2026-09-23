import { describe, expect, it } from "vitest";
import { buildLibraryIndex } from "@/lib/bulletin";
import type { Playlist } from "@/types";

function playlist(overrides: Partial<Playlist>): Playlist {
  return {
    id: "id-1",
    title: "Title",
    entries: [{ id: "ch1", name: "One", url: "https://example.com/1.m3u8" }],
    addedAt: 1_000,
    ...overrides,
  };
}

describe("buildLibraryIndex", () => {
  it("indexes only persisted playlists (those carrying a CID)", () => {
    const persisted = playlist({ id: "a", cid: "bafy-a" });
    const unsaved = playlist({ id: "b" }); // optimistic add, save still pending
    const index = buildLibraryIndex([persisted, unsaved]);
    expect(index.playlists.map((m) => m.id)).toEqual(["a"]);
  });

  it("carries the metadata a cold restore needs", () => {
    const p = playlist({ id: "a", cid: "bafy-a", title: "News", addedAt: 42 });
    const index = buildLibraryIndex([p]);
    expect(index.playlists[0]).toEqual({
      id: "a",
      cid: "bafy-a",
      title: "News",
      channelCount: 1,
      addedAt: 42,
    });
  });

  it("keeps sourceCid on imported playlists (re-import de-dupe key)", () => {
    const imported = playlist({ id: "a", cid: "bafy-mine", sourceCid: "bafy-theirs" });
    expect(buildLibraryIndex([imported]).playlists[0].sourceCid).toBe("bafy-theirs");
    const own = playlist({ id: "b", cid: "bafy-own" });
    expect(buildLibraryIndex([own]).playlists[0]).not.toHaveProperty("sourceCid");
  });

  it("still emits a (versioned) empty index so deletions propagate", () => {
    expect(buildLibraryIndex([])).toEqual({ v: 1, playlists: [] });
  });

  it("never records playback state — tuning must not rewrite the index", () => {
    // Regression: a per-zap index rewrite minted a new Bulletin blob and
    // surfaced the host's "submit preimage" authorization on every channel
    // change. The index is a function of the playlists alone.
    expect(Object.keys(buildLibraryIndex([playlist({ cid: "bafy-a" })]))).toEqual(["v", "playlists"]);
  });
});
