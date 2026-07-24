import type { Channel } from "@/types";
import { isHttpUrl } from "@/lib/url";
import { djb2 } from "@/lib/hash";

// ── m3u ingestion + sanitization ────────────────────────────────────────────
// Channel names and tvg-logo are XSS vectors (design R3, severity high).
// Rules:
//  - only http(s) URLs accepted for stream + logo (reject javascript:/data:/file:…)
//  - text fields are returned raw; React escapes them on render (NEVER innerHTML)
//  - malformed / non-http entries are skipped, not silently coerced

/** Stable, deterministic id for an entry — avoids random ids drifting across
 *  re-parses of the same playlist (so now-playing handoff stays valid). */
function entryId(tvgId: string | undefined, url: string, name: string): string {
  const basis = tvgId?.trim() || `${url}::${name}`;
  return `ch_${djb2(basis).toString(36)}`;
}

function attr(meta: string, key: string): string | undefined {
  // matches key="value" (the m3u/EXTINF convention)
  const m = new RegExp(`${key}="([^"]*)"`, "i").exec(meta);
  return m?.[1]?.trim() || undefined;
}

/**
 * Parse an m3u / m3u8 playlist into sanitized channel entries.
 * Tolerant of CRLF, blank lines, comments and missing #EXTM3U header.
 */
export function parseM3U(text: string): Channel[] {
  const out: Channel[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF")) continue;

    // The stream URL is the next non-comment, non-blank line — but never past
    // the next #EXTINF: an entry whose URL is missing must not steal the next
    // entry's stream. On success the outer cursor advances past the URL.
    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (candidate.startsWith("#EXTINF")) break; // next entry — this one has no URL
      if (!candidate || candidate.startsWith("#")) continue;
      url = candidate;
      i = j;
      break;
    }
    if (!isHttpUrl(url)) continue; // reject javascript:/data:/file:/empty

    const meta = line;
    // The display name follows the LAST comma outside quoted attributes; slicing
    // after the final quote keeps commas inside e.g. group-title="News, Sports"
    // out of it (falls back to the whole line when there are no quotes).
    const afterAttrs = meta.slice(meta.lastIndexOf('"') + 1);
    const name = (afterAttrs.split(",").slice(1).join(",").trim() || attr(meta, "tvg-name") || "Channel").trim();
    const rawLogo = attr(meta, "tvg-logo");
    const tvgId = attr(meta, "tvg-id");
    const id = entryId(tvgId, url, name);

    if (seen.has(id)) continue; // de-dupe stable ids within one playlist
    seen.add(id);

    out.push({
      id,
      name,
      url,
      logo: isHttpUrl(rawLogo) ? rawLogo : undefined, // http(s) logos only
      group: attr(meta, "group-title"),
      tvgId,
    });
  }
  return out;
}

/**
 * Re-validate UNTRUSTED channel entries — e.g. the `entries` of a playlist body
 * decrypted from Bulletin (a shared playlist comes from another, untrusted user
 * and never passes through {@link parseM3U}). Enforces the same rules as ingest:
 * only http(s) stream URLs (drops the rest), http(s) logos only (else stripped),
 * string coercion, de-dupe. This is the single sanitizer for imported content.
 */
export function sanitizeEntries(raw: unknown): Channel[] {
  if (!Array.isArray(raw)) return [];
  const out: Channel[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const url = typeof c.url === "string" ? c.url.trim() : "";
    if (!isHttpUrl(url)) continue; // reject javascript:/data:/file:/empty streams
    const name = (typeof c.name === "string" && c.name.trim()) || "Channel";
    const tvgId = typeof c.tvgId === "string" ? c.tvgId : undefined;
    const id = typeof c.id === "string" && c.id ? c.id : entryId(tvgId, url, name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name,
      url,
      logo: isHttpUrl(c.logo) ? c.logo : undefined,
      group: typeof c.group === "string" ? c.group : undefined,
      tvgId,
    });
  }
  return out;
}

/**
 * Read the EPG source URL from the `#EXTM3U` header, if present. IPTV providers
 * advertise their XMLTV guide there as `url-tvg`, `x-tvg-url` or `tvg-url` (the
 * value may be a comma-separated list — we take the first http(s) URL). This is
 * the primary, decentralized EPG source: it travels with the playlist, no
 * central dependency. Returns undefined when absent or non-http(s).
 */
export function parseM3UHeader(text: string): { epgUrl?: string } {
  // The header is (conventionally) the first line; scan the first few lines to
  // tolerate leading blanks/BOM and a misplaced #EXTM3U.
  const lines = text.split(/\r?\n/, 8);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("#EXTM3U")) continue;
    for (const key of ["url-tvg", "x-tvg-url", "tvg-url"]) {
      const value = attr(line, key);
      if (!value) continue;
      const first = value.split(",").map((s) => s.trim()).find(isHttpUrl);
      if (first) return { epgUrl: first };
    }
    break; // header found; no need to scan further
  }
  return {};
}

/** Derive a human title for a parsed playlist (from source URL or fallback). */
export function deriveTitle(source: string | undefined, channelCount: number): string {
  if (isHttpUrl(source)) {
    try {
      const u = new URL(source);
      const base = u.pathname.split("/").filter(Boolean).pop();
      if (base) return decodeURIComponent(base.replace(/\.(m3u8?|txt)$/i, ""));
      return u.hostname;
    } catch {
      /* fall through */
    }
  }
  return `Playlist (${channelCount} channels)`;
}
