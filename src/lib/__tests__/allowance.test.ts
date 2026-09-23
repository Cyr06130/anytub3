import { describe, expect, it, vi } from "vitest";
import { looksLikeAllowanceFailure, withAllowanceRetry } from "@/lib/allowance";

describe("looksLikeAllowanceFailure", () => {
  it("recognises the host's authorization / allowance wording", () => {
    expect(looksLikeAllowanceFailure(new Error("preimage submit failed: not authorized to upload"))).toBe(true);
    expect(looksLikeAllowanceFailure(new Error("Bulletin allowance expired"))).toBe(true);
    expect(looksLikeAllowanceFailure(new Error("Unauthorised"))).toBe(true);
    expect(looksLikeAllowanceFailure(new Error("insufficient quota"))).toBe(true);
    expect(looksLikeAllowanceFailure("permission denied")).toBe(true);
  });

  it("leaves unrelated failures alone", () => {
    expect(looksLikeAllowanceFailure(new Error("Bulletin read timed out"))).toBe(false);
    expect(looksLikeAllowanceFailure(new Error("network error"))).toBe(false);
  });
});

describe("withAllowanceRetry", () => {
  const allowanceError = () => new Error("preimage submit failed: not authorized to upload");

  it("returns the write result and never asks for an allowance on success", async () => {
    const request = vi.fn(async () => "Allocated" as const);
    const write = vi.fn(async () => "0xcid");
    await expect(withAllowanceRetry(write, request)).resolves.toBe("0xcid");
    expect(write).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("rethrows unrelated failures without requesting an allowance", async () => {
    const request = vi.fn(async () => "Allocated" as const);
    const write = vi.fn(async () => {
      throw new Error("Bulletin read timed out");
    });
    await expect(withAllowanceRetry(write, request)).rejects.toThrow("Bulletin read timed out");
    expect(write).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("requests the allowance once and retries after Allocated", async () => {
    const request = vi.fn(async () => "Allocated" as const);
    const write = vi.fn().mockRejectedValueOnce(allowanceError()).mockResolvedValueOnce("0xcid");
    await expect(withAllowanceRetry(write, request)).resolves.toBe("0xcid");
    expect(write).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("surfaces a refused allowance with the outcome attached, without retrying", async () => {
    const request = vi.fn(async () => "Rejected" as const);
    const write = vi.fn(async () => {
      throw allowanceError();
    });
    await expect(withAllowanceRetry(write, request)).rejects.toThrow(
      /not authorized to upload \(allowance request: Rejected\)/,
    );
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("treats a failed allowance call as refused", async () => {
    const request = vi.fn(async () => {
      throw new Error("host unreachable");
    });
    const write = vi.fn(async () => {
      throw allowanceError();
    });
    await expect(withAllowanceRetry(write, request)).rejects.toThrow(/allowance request: failed/);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("lets a failing retry surface its own error", async () => {
    const request = vi.fn(async () => "Allocated" as const);
    const write = vi
      .fn()
      .mockRejectedValueOnce(allowanceError())
      .mockRejectedValueOnce(new Error("still not authorized"));
    await expect(withAllowanceRetry(write, request)).rejects.toThrow("still not authorized");
    expect(write).toHaveBeenCalledTimes(2);
  });
});
