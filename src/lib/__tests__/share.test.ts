import { describe, expect, it } from "vitest";
import { decodeShareCode, encodeShareCode } from "@/lib/share";

const pointer = {
  playlistCid: "bafybeigdyrzt5examplecid",
  key: new Uint8Array([1, 2, 3, 250, 251, 252]),
  title: "Chaînes TNT",
};

describe("share code encode/decode", () => {
  it("round-trips a pointer through the copyable code", () => {
    const decoded = decodeShareCode(encodeShareCode(pointer));
    expect(decoded).toEqual({
      v: 1,
      playlistCid: pointer.playlistCid,
      key: Array.from(pointer.key),
      title: pointer.title,
    });
  });

  it("produces a code carrying the anytub3: prefix", () => {
    expect(encodeShareCode(pointer)).toMatch(/^anytub3:/);
  });

  it("accepts a code pasted without its prefix", () => {
    const bare = encodeShareCode(pointer).slice("anytub3:".length);
    expect(decodeShareCode(bare)?.playlistCid).toBe(pointer.playlistCid);
  });

  it("tolerates surrounding whitespace (copy/paste artifacts)", () => {
    const code = `  ${encodeShareCode(pointer)}\n`;
    expect(decodeShareCode(code)?.title).toBe(pointer.title);
  });

  it("returns null for an empty or prefix-only code", () => {
    expect(decodeShareCode("")).toBeNull();
    expect(decodeShareCode("anytub3:")).toBeNull();
  });

  it("returns null for non-base64 garbage", () => {
    expect(decodeShareCode("anytub3:%%%not-base64%%%")).toBeNull();
  });

  it("returns null for valid base64 that is not a pointer", () => {
    expect(decodeShareCode(btoa(JSON.stringify({ hello: "world" })))).toBeNull();
  });

  it("returns null for a pointer with an unknown version", () => {
    const foreign = btoa(JSON.stringify({ v: 2, playlistCid: "x", key: [1] }));
    expect(decodeShareCode(foreign)).toBeNull();
  });
});
