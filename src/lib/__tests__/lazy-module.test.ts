import { describe, expect, it, vi } from "vitest";
import { createModuleLoader } from "@/lib/lazy-module";

const noSleep = async () => undefined;

describe("createModuleLoader", () => {
  it("loads once and memoizes the module", async () => {
    const load = vi.fn(async () => ({ name: "player" }));
    const loader = createModuleLoader(load, { sleep: noSleep });
    expect(loader.peek()).toBeNull();
    await expect(loader.load()).resolves.toEqual({ name: "player" });
    await expect(loader.load()).resolves.toEqual({ name: "player" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(loader.peek()).toEqual({ name: "player" });
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const load = vi.fn(async () => "mod");
    const loader = createModuleLoader(load, { sleep: noSleep });
    await Promise.all([loader.load(), loader.load(), loader.load()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures with a growing backoff", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("404"))
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce("mod");
    const loader = createModuleLoader(load, { attempts: 3, delayMs: 100, sleep });
    await expect(loader.load()).resolves.toBe("mod");
    expect(load).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });

  it("rejects after the last attempt and forgets the failure so a later load starts over", async () => {
    const load = vi.fn().mockRejectedValue(new Error("error loading dynamically imported module"));
    const loader = createModuleLoader(load, { attempts: 2, sleep: noSleep });
    await expect(loader.load()).rejects.toThrow("error loading dynamically imported module");
    expect(load).toHaveBeenCalledTimes(2);
    load.mockResolvedValueOnce("mod");
    await expect(loader.load()).resolves.toBe("mod"); // a fresh cycle, not the cached rejection
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("prefetch loads in the background and never rejects", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("cold")).mockResolvedValueOnce("mod");
    const loader = createModuleLoader(load, { attempts: 2, sleep: noSleep });
    loader.prefetch();
    await new Promise((r) => setTimeout(r, 0));
    await loader.load();
    expect(loader.peek()).toBe("mod");
  });
});
