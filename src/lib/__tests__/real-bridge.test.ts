import { afterEach, describe, expect, it, vi } from "vitest";
import { HostBridgeError } from "@/lib/bridge/errors";
import {
  negotiateProtocol,
  waitForHostConnection,
  type HandshakeHost,
  type HandshakePeer,
  type HostConnection,
} from "@/lib/bridge/real";

type Status = Parameters<Parameters<HostConnection["subscribeConnectionStatus"]>[0]>[0];

/** Host stub whose connection status starts at `statuses[0]` (emitted
 *  synchronously on subscribe, like the SDK) and then steps through the rest. */
function hostReporting(statuses: Status[], stepMs = 1) {
  const unsubscribe = vi.fn();
  const host: HostConnection = {
    subscribeConnectionStatus(cb) {
      cb(statuses[0]);
      let i = 1;
      const timer = setInterval(() => {
        if (i < statuses.length) cb(statuses[i++]);
        else clearInterval(timer);
      }, stepMs);
      return () => {
        clearInterval(timer);
        unsubscribe();
      };
    },
  };
  return { host, unsubscribe };
}

describe("waitForHostConnection (host transport gate)", () => {
  // Regression: `isInsideContainer()` is a sync heuristic and `getTruApi()` is
  // non-null as soon as a provider is *buildable* — neither proves the host is
  // listening. Gating on either raced the handshake and every save then failed
  // with "Bulletin storage unavailable (preimage manager missing)".

  it("resolves true immediately when the channel is already connected", async () => {
    const { host, unsubscribe } = hostReporting(["connected"]);
    expect(await waitForHostConnection(host, { timeoutMs: 50 })).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("waits through connecting and resolves true once connected", async () => {
    const { host, unsubscribe } = hostReporting(["connecting", "connecting", "connected"]);
    expect(await waitForHostConnection(host, { timeoutMs: 1_000 })).toBe(true);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("resolves false when the host never connects within the timeout", async () => {
    const { host, unsubscribe } = hostReporting(["connecting"]);
    expect(await waitForHostConnection(host, { timeoutMs: 20 })).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("resolves false when outside any host (disconnected for good)", async () => {
    const { host } = hostReporting(["disconnected"]);
    expect(await waitForHostConnection(host, { timeoutMs: 20 })).toBe(false);
  });
});

type HandshakeOutcome = { ok: true } | { err: unknown } | { rejects: unknown };

/** TruAPI stub whose `system.handshake()` settles as `outcome` says. The real
 *  call returns a neverthrow ResultAsync; only `.match` is exercised here. */
function peerWhoseHandshake(outcome: HandshakeOutcome): HandshakePeer {
  const match = (onOk: () => unknown, onErr: (error: unknown) => unknown) =>
    "rejects" in outcome
      ? Promise.reject(outcome.rejects)
      : Promise.resolve("ok" in outcome ? onOk() : onErr(outcome.err));
  return { system: { handshake: () => ({ match }) } } as unknown as HandshakePeer;
}

const host: HandshakeHost = { formatHostError: (error) => JSON.stringify(error) };

describe("negotiateProtocol (host codec handshake)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes silently when the host answers Ok", async () => {
    await expect(negotiateProtocol(host, peerWhoseHandshake({ ok: true }))).resolves.toBeUndefined();
  });

  it("blocks with a redeploy hint when the host refuses the codec version", async () => {
    const refused = { tag: "Domain", value: { tag: "V1", value: { tag: "UnsupportedProtocolVersion" } } };
    const failure = await negotiateProtocol(host, peerWhoseHandshake({ err: refused })).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HostBridgeError);
    expect((failure as HostBridgeError).message).toMatch(/refused this build's protocol version/);
    expect((failure as HostBridgeError).hint).toMatch(/redeployed/);
    expect((failure as HostBridgeError).details).toMatch(/^transport=/);
  });

  // Regression (Polkadot Mobile, 2026-09-23): the SDK's 10 s handshake deadline
  // REJECTS instead of returning Err, so it escaped the `.match` and surfaced as
  // the generic "bridge failed to initialize" with no clue where it hung.
  it("blocks with transport diagnostics when the host never answers (deadline rejection)", async () => {
    const silent = new Error("TrUAPI handshake timed out after 10000ms; the host did not answer on wire codec 3");
    const failure = await negotiateProtocol(host, peerWhoseHandshake({ rejects: silent })).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HostBridgeError);
    expect((failure as HostBridgeError).message).toMatch(/never answered the protocol handshake/);
    expect((failure as HostBridgeError).hint).toMatch(/Fully close the Polkadot app/);
    expect((failure as HostBridgeError).details).toContain("timed out after 10000ms");
    expect((failure as HostBridgeError).details).toContain("transport=");
    expect((failure as HostBridgeError).cause).toBe(silent);
  });

  it("only warns on any other domain error and lets the real calls decide", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(negotiateProtocol(host, peerWhoseHandshake({ err: { tag: "Unsupported" } }))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/handshake did not complete/), expect.stringContaining("Unsupported"));
  });
});
