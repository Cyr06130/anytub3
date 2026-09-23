import { describe, expect, it } from "vitest";
import {
  baseTvgId,
  channelMatchKeys,
  indexGuideChannels,
  matchGuideChannel,
  normalizeName,
  rankGuideChannels,
  tvgIdCountry,
  tvgIdName,
} from "@/lib/epg-match";
import type { Channel } from "@/types";

const channel = (name: string, tvgId?: string): Channel => ({ id: "c", name, url: "https://x.test/s.m3u8", tvgId });

describe("normalizeName", () => {
  it.each([
    ["TF1", "tf1"],
    ["FR| TF1 HD", "tf1"],
    ["UK: BBC One", "bbcone"],
    ["US - CNN", "cnn"],
    ["Canal+ Séries FHD", "canalseries"],
    ["6ter (1080p)", "6ter"],
    ["Arte [Geo-blocked]", "arte"],
    ["TV5 Monde", "tv5monde"],
    ["BBC-One", "bbcone"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it("does not treat an upper-case word without a separator as a prefix", () => {
    expect(normalizeName("ABC News")).toBe("abcnews");
  });
});

describe("tvg-id helpers", () => {
  it("strips the iptv-org feed suffix", () => {
    expect(baseTvgId("TF1.fr@SD")).toBe("TF1.fr");
    expect(baseTvgId(" TF1.fr ")).toBe("TF1.fr");
  });
  it("splits name and country", () => {
    expect(tvgIdName("France2.fr@HD")).toBe("France2");
    expect(tvgIdCountry("France2.fr@HD")).toBe("fr");
    expect(tvgIdName("mux.test")).toBe("mux.test");
    expect(tvgIdCountry("bbb")).toBeUndefined();
  });
});

describe("matching", () => {
  const index = indexGuideChannels([
    { id: "1", name: "TF1" },
    { id: "2", name: "France 2" },
    { id: "3", name: "TF1 Séries Films" },
  ]);

  it("matches the display name first, the tvg-id name second, aliases last", () => {
    expect(channelMatchKeys(channel("FR| France 2 HD", "France2.fr@SD"), ["Deux"])).toEqual(["france2", "deux"]);
    expect(matchGuideChannel(channel("FR| France 2 HD"), index)?.id).toBe("2");
    expect(matchGuideChannel(channel("Chaîne inconnue", "TF1.fr"), index)?.id).toBe("1");
    expect(matchGuideChannel(channel("???"), index, ["TF1 Series Films"])?.id).toBe("3");
  });

  it("never guesses on a partial match", () => {
    expect(matchGuideChannel(channel("TF1 Series"), index)).toBeUndefined();
  });

  it("ranks the likely match first, then prefixes, then alphabetical", () => {
    const ranked = rankGuideChannels(channel("TF1"), [
      { id: "b", name: "Arte" },
      { id: "c", name: "TF1 Séries Films" },
      { id: "a", name: "TF1" },
      { id: "d", name: "6ter" },
    ]);
    expect(ranked.map((c) => c.id)).toEqual(["a", "c", "d", "b"]);
  });
});
