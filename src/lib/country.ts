// ISO 3166-1 alpha-2 country codes as the app uses them (upper-case).

/** iptv-org ids and provider prefixes say "UK"; ISO (and guide hosts) say "GB". */
const ALIASES: Record<string, string> = { UK: "GB" };

/** Upper-case two-letter code from a loosely typed value, else undefined. */
export function countryCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(v)) return undefined;
  return ALIASES[v] ?? v;
}

/** The device's region from its locale (`fr-FR` → FR), when it has one. */
export function deviceCountry(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const region = new Intl.Locale(navigator.language).maximize().region;
  return countryCode(region);
}
