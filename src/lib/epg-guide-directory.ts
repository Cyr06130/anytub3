import type { GuideChannel } from "@/types";
import type { HostBridge } from "@/lib/bridge/types";
import { cachedJson } from "@/lib/epg-cache";
import { EPG_DIRECTORY_PREFIX_MAX_BYTES, fillUrlTemplate, type GuideDirectorySource } from "@/lib/epg-sources";
import { parseGuideChannels } from "@/lib/epg-xmltv";

// A public aggregator's channel directory for one country: the <channel>
// header of its country XMLTV file. The file itself is tens of MB, so we
// stream it and cancel at the first <programme> (~60 KB), then keep only the
// (id, name) pairs — a few KB, cached per device for the source's TTL.

const PROGRAMME_MARKER = "<programme";

function directoryKey(source: GuideDirectorySource, country: string): string {
  return `epg:dir:${source.id}:${country}`;
}

export function directoryCovers(source: GuideDirectorySource, country: string | undefined): country is string {
  return !!country && source.countries.includes(country);
}

/** The channels `source` lists for `country`. Throws on a network failure. */
export function loadGuideDirectory(
  bridge: HostBridge,
  source: GuideDirectorySource,
  country: string,
): Promise<GuideChannel[]> {
  return cachedJson(bridge, directoryKey(source, country), source.directoryTtlMs, async () => {
    const url = fillUrlTemplate(source.directoryUrl, { CC: country });
    const header = await bridge.httpGetPrefix(url, { until: PROGRAMME_MARKER, maxBytes: EPG_DIRECTORY_PREFIX_MAX_BYTES });
    return parseGuideChannels(header);
  });
}
