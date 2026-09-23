import type { ErrorData } from "hls.js";

// User-facing wording for a stream that could not be loaded. The browser hides
// most of the truth from a web player: a geo-blocked 403 whose error page
// carries no CORS headers, a CDN that never allows web origins and a dead
// network all surface as "status 0". Say what the user can act on, not the
// mechanism.

export type NetworkFailure = Pick<ErrorData, "details" | "response">;

const REFUSED = "The broadcaster refused this stream. It may be limited to a region, or not open to web players.";

/** Message for a fatal hls.js NETWORK_ERROR after the retries are exhausted. */
export function describeStreamFailure({ details, response }: NetworkFailure): string {
  if (/TimeOut$/.test(details)) return "The stream did not answer in time.";
  const code = response?.code ?? 0;
  if (code === 0) return REFUSED;
  if (code === 403 || code === 451) return `${REFUSED} (HTTP ${code})`;
  if (code === 404 || code === 410) return "This stream no longer exists at that address.";
  if (code >= 500) return `The stream server is failing (HTTP ${code}). Try again later.`;
  return `The stream server answered HTTP ${code}.`;
}
