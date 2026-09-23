import { describe, expect, it } from "vitest";
import { EPG_SOURCES, fillUrlTemplate, guideDirectorySources } from "@/lib/epg-sources";

// The source list is hand-edited configuration: these checks catch a typo
// before it silently disables a source at runtime.
describe("EPG_SOURCES configuration", () => {
  it("has unique, non-empty ids and labels", () => {
    const ids = EPG_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of EPG_SOURCES) {
      expect(s.id).not.toBe("");
      expect(s.label).not.toBe("");
    }
  });

  it("gives every guide directory https templates with their placeholders and ISO countries", () => {
    for (const s of guideDirectorySources()) {
      expect(s.directoryUrl).toMatch(/^https:\/\/.*\{CC\}/);
      expect(s.channelUrl).toMatch(/^https:\/\/.*\{ID\}/);
      expect(s.countries.length).toBeGreaterThan(0);
      for (const cc of s.countries) expect(cc).toMatch(/^[A-Z]{2}$/);
      expect(s.directoryTtlMs).toBeGreaterThan(0);
    }
  });

  it("ships at least one directory (the picker depends on it)", () => {
    expect(guideDirectorySources().length).toBeGreaterThan(0);
  });
});

describe("fillUrlTemplate", () => {
  it("substitutes and URL-encodes values", () => {
    expect(fillUrlTemplate("https://h.test/epg_{CC}.xml?id={ID}", { CC: "FR", ID: "a b/c" })).toBe(
      "https://h.test/epg_FR.xml?id=a%20b%2Fc",
    );
  });
});
