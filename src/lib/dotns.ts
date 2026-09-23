import { DOTNS_IDENTIFIER } from "@/lib/config";

/** Polkadot Web serves the product `<label>.<tld>` at `<label>.<tld>.li`. */
const WEB_GATEWAY_SUFFIX = ".li";

function isIpAddress(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/**
 * dotNS identifier of the product as the host sees it, from the page hostname.
 *
 * The host binds the product account to the domain it LOADED, so a hard-coded
 * name breaks as soon as the same bundle is served under another name
 * (`anytub3tv.test` on previewnet, a renamed deploy…): `getProductAccount`
 * answers `DomainNotValid`. Desktop/Mobile load the bundle at the dotNS name
 * itself; Web goes through the `.li` gateway. Local/dev hostnames (no dot,
 * localhost, IPs, the bare gateway) fall back to the configured default.
 */
export function dotNsIdentifierFromHostname(hostname: string, fallback: string = DOTNS_IDENTIFIER): string {
  const host = hostname.trim().toLowerCase();
  if (!host || host === "localhost" || !host.includes(".") || isIpAddress(host)) return fallback;
  if (host.endsWith(WEB_GATEWAY_SUFFIX)) {
    const name = host.slice(0, -WEB_GATEWAY_SUFFIX.length);
    // `paseo.li` is the gateway itself, not a product served under it.
    return name.includes(".") ? name : fallback;
  }
  return host;
}

/** Identifier for the current page; the configured default outside a browser. */
export function currentDotNsIdentifier(): string {
  return dotNsIdentifierFromHostname(globalThis.location?.hostname ?? "");
}
