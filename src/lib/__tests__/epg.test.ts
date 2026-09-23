// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { extractChannelProgrammes, nowAndNext, progress } from "@/lib/epg";
import type { Programme } from "@/types";

const prog = (attrs: string, body = "<title>T</title>") => `<programme ${attrs}>${body}</programme>`;
const wrap = (...blocks: string[]) => `<?xml version="1.0"?><tv>${blocks.join("")}</tv>`;

describe("extractChannelProgrammes (XMLTV time parsing included)", () => {
  it("parses a full-precision timestamp with a ±HHMM offset", () => {
    const [p] = extractChannelProgrammes(
      wrap(prog('start="20260724120000 +0100" stop="20260724130000 +0100" channel="c1"')),
      "c1",
    );
    expect(p.start).toBe(Date.UTC(2026, 6, 24, 11, 0, 0));
    expect(p.stop).toBe(Date.UTC(2026, 6, 24, 12, 0, 0));
  });

  it("defaults missing seconds/minutes/offset (UTC)", () => {
    const [p] = extractChannelProgrammes(
      wrap(prog('start="202607241130" stop="2026072413" channel="c1"')),
      "c1",
    );
    expect(p.start).toBe(Date.UTC(2026, 6, 24, 11, 30, 0));
    expect(p.stop).toBe(Date.UTC(2026, 6, 24, 13, 0, 0));
  });

  it("drops programmes whose stop is not after start", () => {
    const out = extractChannelProgrammes(
      wrap(prog('start="20260724120000 +0000" stop="20260724120000 +0000" channel="c1"')),
      "c1",
    );
    expect(out).toHaveLength(0);
  });

  it("only extracts blocks for the requested channel", () => {
    const out = extractChannelProgrammes(
      wrap(
        prog('start="20260724120000 +0000" stop="20260724130000 +0000" channel="ours"', "<title>Ours</title>"),
        prog('start="20260724120000 +0000" stop="20260724130000 +0000" channel="theirs"', "<title>Theirs</title>"),
      ),
      "ours",
    );
    expect(out.map((p) => p.title)).toEqual(["Ours"]);
  });

  it("skips a malformed block without dropping the rest", () => {
    const out = extractChannelProgrammes(
      wrap(
        `<programme start="20260724120000 +0000" stop="20260724130000 +0000" channel="c1"><title>Bad</programme>`,
        prog('start="20260724130000 +0000" stop="20260724140000 +0000" channel="c1"', "<title>Good</title>"),
      ),
      "c1",
    );
    expect(out.map((p) => p.title)).toEqual(["Good"]);
  });

  it("strips non-http(s) icons and fills text fields", () => {
    const [p] = extractChannelProgrammes(
      wrap(
        prog(
          'start="20260724120000 +0000" stop="20260724130000 +0000" channel="c1"',
          '<title>Show</title><desc>D</desc><category>Cat</category><icon src="javascript:alert(1)"/>',
        ),
      ),
      "c1",
    );
    expect(p).toMatchObject({ title: "Show", desc: "D", category: "Cat", icon: undefined });
  });

  it("does not let a (DTD-invalid) self-closing <programme/> swallow the next entry", () => {
    const out = extractChannelProgrammes(
      wrap(
        '<programme start="20260724110000 +0000" stop="20260724120000 +0000" channel="c1"/>',
        prog('start="20260724120000 +0000" stop="20260724130000 +0000" channel="c1"', "<title>Kept</title>"),
      ),
      "c1",
    );
    expect(out.map((p) => p.title)).toEqual(["Kept"]);
  });

  it("caps extraction at 500 programmes", () => {
    const blocks = Array.from({ length: 502 }, (_, i) =>
      prog(`start="20260724${String(i % 24).padStart(2, "0")}0000 +0000" stop="20260725000000 +0000" channel="c1"`),
    );
    expect(extractChannelProgrammes(wrap(...blocks), "c1")).toHaveLength(500);
  });
});

describe("nowAndNext", () => {
  const p = (start: number, stop: number): Programme => ({ channelId: "c", start, stop, title: `${start}` });
  const sorted = [p(0, 10), p(10, 20), p(30, 40)];

  it("finds the airing programme and its successor", () => {
    expect(nowAndNext(sorted, 5)).toMatchObject({ now: { start: 0 }, next: { start: 10 } });
  });
  it("falls back to the next start during a gap", () => {
    expect(nowAndNext(sorted, 25)).toMatchObject({ now: undefined, next: { start: 30 } });
  });
  it("returns nothing after the last programme", () => {
    expect(nowAndNext(sorted, 50)).toEqual({ now: undefined, next: undefined });
  });
});

describe("progress", () => {
  const p = { channelId: "c", start: 1000, stop: 2000, title: "t" };
  it("clamps to [0,1] and maps the midpoint", () => {
    expect(progress(p, 500)).toBe(0);
    expect(progress(p, 1500)).toBe(0.5);
    expect(progress(p, 3000)).toBe(1);
  });
});
