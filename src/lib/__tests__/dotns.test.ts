import { describe, expect, it } from "vitest";
import { dotNsIdentifierFromHostname } from "@/lib/dotns";
import { DOTNS_IDENTIFIER } from "@/lib/config";

describe("dotNsIdentifierFromHostname", () => {
  it("strips the Web gateway suffix to recover the dotNS name", () => {
    expect(dotNsIdentifierFromHostname("anytub3tv.paseo.li")).toBe("anytub3tv.paseo");
    expect(dotNsIdentifierFromHostname("anytub3tv.test.li")).toBe("anytub3tv.test");
  });

  it("keeps a dotNS name loaded directly (Desktop/Mobile webview)", () => {
    expect(dotNsIdentifierFromHostname("anytub3tv.paseo")).toBe("anytub3tv.paseo");
    expect(dotNsIdentifierFromHostname("anytub3.dot")).toBe("anytub3.dot");
  });

  it("normalises case and whitespace", () => {
    expect(dotNsIdentifierFromHostname("  AnyTub3tv.Paseo.LI ")).toBe("anytub3tv.paseo");
  });

  it("falls back for local and dev hostnames", () => {
    expect(dotNsIdentifierFromHostname("localhost")).toBe(DOTNS_IDENTIFIER);
    expect(dotNsIdentifierFromHostname("127.0.0.1")).toBe(DOTNS_IDENTIFIER);
    expect(dotNsIdentifierFromHostname("[::1]")).toBe(DOTNS_IDENTIFIER);
    expect(dotNsIdentifierFromHostname("")).toBe(DOTNS_IDENTIFIER);
    expect(dotNsIdentifierFromHostname("devbox")).toBe(DOTNS_IDENTIFIER);
  });

  it("falls back for the bare gateway host", () => {
    expect(dotNsIdentifierFromHostname("paseo.li")).toBe(DOTNS_IDENTIFIER);
  });

  it("honours an explicit fallback", () => {
    expect(dotNsIdentifierFromHostname("localhost", "other.dot")).toBe("other.dot");
  });
});
