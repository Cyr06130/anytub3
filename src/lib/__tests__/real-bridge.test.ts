import { describe, expect, it } from "vitest";
import { waitForTruApi } from "@/lib/bridge/real";

type TruApiStub = Awaited<ReturnType<Parameters<typeof waitForTruApi>[0]["getTruApi"]>>;
const client = {} as NonNullable<TruApiStub>;

/** Host-module stub whose getTruApi returns null for the first `nullCalls` calls. */
function hostComingUpAfter(nullCalls: number) {
  let calls = 0;
  return { getTruApi: async () => (calls++ < nullCalls ? null : client) };
}

describe("waitForTruApi (host handshake gate)", () => {
  // Regression: `isInsideContainer()` is a sync heuristic, but the SDK's
  // service getters return null until the TruAPI handshake completes. init()
  // used to resolve them immediately, racing the handshake — every save then
  // failed with "Bulletin storage unavailable (preimage manager missing)".

  it("resolves true immediately when the client is already up", async () => {
    expect(await waitForTruApi(hostComingUpAfter(0), { timeoutMs: 50, pollMs: 1 })).toBe(true);
  });

  it("keeps polling through the handshake and resolves true once connected", async () => {
    expect(await waitForTruApi(hostComingUpAfter(3), { timeoutMs: 1_000, pollMs: 1 })).toBe(true);
  });

  it("returns false when the host never comes up within the timeout", async () => {
    const neverUp = { getTruApi: async () => null };
    expect(await waitForTruApi(neverUp, { timeoutMs: 20, pollMs: 1 })).toBe(false);
  });

  it("still checks at least once with a zero timeout", async () => {
    expect(await waitForTruApi(hostComingUpAfter(0), { timeoutMs: 0, pollMs: 1 })).toBe(true);
  });
});
