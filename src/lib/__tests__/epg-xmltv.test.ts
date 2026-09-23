// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractProgrammesByChannel, parseGuideChannels } from "@/lib/epg-xmltv";

const prog = (channel: string, title: string, h: number) =>
  `<programme start="202607241${h}0000 +0000" stop="202607241${h + 1}0000 +0000" channel="${channel}"><title>${title}</title></programme>`;

describe("extractProgrammesByChannel", () => {
  it("extracts several channels in one pass and returns empty lists for the rest", () => {
    const xml = `<tv>${prog("a", "A1", 0)}${prog("b", "B1", 0)}${prog("a", "A2", 1)}${prog("c", "C1", 0)}</tv>`;
    const out = extractProgrammesByChannel(xml, new Set(["a", "b", "zzz"]));
    expect(out.get("a")?.map((p) => p.title)).toEqual(["A1", "A2"]);
    expect(out.get("b")?.map((p) => p.title)).toEqual(["B1"]);
    expect(out.get("zzz")).toEqual([]);
    expect(out.has("c")).toBe(false);
  });
});

describe("parseGuideChannels", () => {
  it("reads id + first display-name, unescapes entities, de-dupes ids", () => {
    const xml =
      `<?xml version="1.0"?><tv>` +
      `<channel id="1"><display-name lang="fr">TF1</display-name><display-name>TF1 HD</display-name></channel>` +
      `<channel id="2"><display-name>Canal &amp; Co</display-name></channel>` +
      `<channel id="1"><display-name>Dupe</display-name></channel>` +
      `<channel id=""><display-name>No id</display-name></channel>` +
      `<channel id="3"></channel>`;
    expect(parseGuideChannels(xml)).toEqual([
      { id: "1", name: "TF1" },
      { id: "2", name: "Canal & Co" },
    ]);
  });

  it("ignores a truncated trailing block (a streamed header cut mid-channel)", () => {
    const xml = `<tv><channel id="1"><display-name>TF1</display-name></channel><channel id="2"><display-na`;
    expect(parseGuideChannels(xml)).toEqual([{ id: "1", name: "TF1" }]);
  });

  it("rejects an unreasonably long id", () => {
    const xml = `<tv><channel id="${"x".repeat(200)}"><display-name>Long</display-name></channel></tv>`;
    expect(parseGuideChannels(xml)).toEqual([]);
  });
});
