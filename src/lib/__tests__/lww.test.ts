import { describe, expect, it } from "vitest";
import { pickFreshest } from "@/lib/lww";

describe("pickFreshest (last-write-wins)", () => {
  it("returns the other value when one side is absent", () => {
    const only = { ts: 5 };
    expect(pickFreshest(only, null)).toBe(only);
    expect(pickFreshest(null, only)).toBe(only);
    expect(pickFreshest(null, null)).toBeNull();
  });

  it("picks the newer of two `ts` values", () => {
    const older = { ts: 1 };
    const newer = { ts: 2 };
    expect(pickFreshest(older, newer)).toBe(newer);
    expect(pickFreshest(newer, older)).toBe(newer);
  });

  it("compares across the two clock field spellings (ts vs timestamp)", () => {
    const head = { ts: 10 };
    const nowPlaying = { timestamp: 20 };
    expect(pickFreshest<{ ts?: number; timestamp?: number }>(head, nowPlaying)).toBe(nowPlaying);
  });

  it("keeps the first argument on a tie (authoritative source first)", () => {
    const a = { ts: 7 };
    const b = { ts: 7 };
    expect(pickFreshest(a, b)).toBe(a);
  });

  it("treats a value without any clock field as timestamp 0", () => {
    const unstamped = {};
    const stamped = { ts: 1 };
    expect(pickFreshest<{ ts?: number }>(unstamped, stamped)).toBe(stamped);
  });
});
