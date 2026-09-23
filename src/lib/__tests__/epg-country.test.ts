import { describe, expect, it } from "vitest";
import { countryCode } from "@/lib/country";
import { inferCountry } from "@/lib/epg-country";
import type { Channel } from "@/types";

const ch = (patch: Partial<Channel>): Channel => ({ id: "c", name: "X", url: "https://x.test/s.m3u8", ...patch });

describe("countryCode", () => {
  it("normalizes to upper-case ISO and maps UK to GB", () => {
    expect(countryCode("fr")).toBe("FR");
    expect(countryCode(" uk ")).toBe("GB");
    expect(countryCode("France")).toBeUndefined();
    expect(countryCode(42)).toBeUndefined();
  });
});

describe("inferCountry", () => {
  it("prefers the tvg-id suffix", () => {
    expect(inferCountry(ch({ name: "DE| TF1", tvgId: "TF1.fr@SD", country: "IT" }), "US")).toBe("FR");
  });
  it("then tvg-country", () => {
    expect(inferCountry(ch({ name: "DE| TF1", tvgId: "tf1", country: "fr" }), "US")).toBe("FR");
  });
  it("then a provider prefix in the name", () => {
    expect(inferCountry(ch({ name: "UK: BBC One" }), "US")).toBe("GB");
    expect(inferCountry(ch({ name: "US - CNN" }), "FR")).toBe("US");
  });
  it("falls back to the caller's country, else nothing", () => {
    expect(inferCountry(ch({ name: "Mystery" }), "fr")).toBe("FR");
    expect(inferCountry(ch({ name: "Mystery" }))).toBeUndefined();
  });
});
