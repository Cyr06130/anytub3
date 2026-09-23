import { describe, expect, it } from "vitest";
import { describeStreamFailure } from "@/player/stream-errors";

const failure = (details: string, code?: number) =>
  ({ details, response: code === undefined ? undefined : { code, text: "" } }) as Parameters<typeof describeStreamFailure>[0];

describe("describeStreamFailure", () => {
  it("treats an opaque failure (CORS-hidden 403, blocked origin, offline) as a refusal", () => {
    expect(describeStreamFailure(failure("manifestLoadError", 0))).toMatch(/refused this stream/);
    expect(describeStreamFailure(failure("manifestLoadError"))).toMatch(/limited to a region/);
  });
  it("names a visible 403/451 as a refusal with the status", () => {
    expect(describeStreamFailure(failure("levelLoadError", 403))).toMatch(/refused.*HTTP 403/);
    expect(describeStreamFailure(failure("levelLoadError", 451))).toMatch(/HTTP 451/);
  });
  it("distinguishes a missing stream, a failing server and a timeout", () => {
    expect(describeStreamFailure(failure("manifestLoadError", 404))).toMatch(/no longer exists/);
    expect(describeStreamFailure(failure("fragLoadError", 502))).toMatch(/failing \(HTTP 502\)/);
    expect(describeStreamFailure(failure("manifestLoadTimeOut", 0))).toMatch(/did not answer in time/);
  });
  it("falls back to the raw status for anything else", () => {
    expect(describeStreamFailure(failure("fragLoadError", 418))).toBe("The stream server answered HTTP 418.");
  });
});
