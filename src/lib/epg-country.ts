import type { Channel } from "@/types";
import { countryCode } from "@/lib/country";
import { tvgIdCountry } from "@/lib/epg-match";

/** `FR| TF1`, `UK: BBC One`, `US - CNN` → the two-letter prefix. */
const NAME_PREFIX = /^([A-Z]{2})\s*(?:[|:]|\s-\s)/;

/**
 * Best-effort country of a channel, most reliable clue first: the tvg-id
 * suffix (`TF1.fr`), the m3u `tvg-country`, a provider prefix in the name,
 * else the caller's fallback (typically the device's locale).
 */
export function inferCountry(channel: Channel, fallback?: string): string | undefined {
  const fromId = channel.tvgId ? countryCode(tvgIdCountry(channel.tvgId)) : undefined;
  return (
    fromId ??
    countryCode(channel.country) ??
    countryCode(NAME_PREFIX.exec(channel.name)?.[1]) ??
    countryCode(fallback)
  );
}
