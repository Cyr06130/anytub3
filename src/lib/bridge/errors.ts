/**
 * Raised when the app runs inside a Polkadot host but cannot establish a usable
 * bridge to it: the transport never connected, the host refused this build's
 * protocol version, or the host SDK failed to load.
 *
 * Never degraded silently. A mock fallback in-host would "save" playlists to
 * localStorage under fake CIDs while the user believes Bulletin holds their
 * library — the UI must block on the reason and offer Retry instead.
 */
export class HostBridgeError extends Error {
  /** One actionable sentence for the user, when there is one. */
  readonly hint: string | undefined;
  /** Compact diagnostics (transport kind, origin, underlying error) shown in
   *  monospace so a report from a device we cannot debug carries them. */
  readonly details: string | undefined;

  constructor(message: string, options: { hint?: string; details?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HostBridgeError";
    this.hint = options.hint;
    this.details = options.details;
  }
}
