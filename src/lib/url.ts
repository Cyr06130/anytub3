/**
 * The app's single http(s)-only trust predicate (XSS hardening, design R3).
 * Stream URLs, logos, EPG sources and fetched playlist URLs must all pass it —
 * one authoritative copy, so a hardening tweak can never miss a site.
 */
export function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}
