import { describe, expect, it } from "vitest";
import { errorMessage } from "@/lib/errors";

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error throw by default", () => {
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toBe("42");
  });

  it("prefers the fallback copy for non-Error throws", () => {
    expect(errorMessage({ odd: true }, "Could not load the guide.")).toBe("Could not load the guide.");
  });

  it("ignores the fallback when a real Error carries a message", () => {
    expect(errorMessage(new Error("specific"), "generic")).toBe("specific");
  });
});
