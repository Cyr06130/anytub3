import type { Channel, GuideChannel, Playlist, Programme } from "@/types";
import type { HostBridge } from "@/lib/bridge/types";
import { cachedFetchText, cachedProgrammes, fetchGuideText, readCachedJson, readCachedProgrammes, writeCachedJson, writeCachedProgrammes } from "@/lib/epg-cache";
import { inferCountry } from "@/lib/epg-country";
import { directoryCovers, loadGuideDirectory } from "@/lib/epg-guide-directory";
import { baseTvgId, indexGuideChannels, matchGuideChannel, rankGuideChannels } from "@/lib/epg-match";
import { userBinding } from "@/lib/epg-playlist";
import {
  EPG_MISS_TTL_MS,
  EPG_PRELOAD_CHANNELS_MAX,
  EPG_PROGRAMMES_TTL_MS,
  EPG_SOURCES,
  EPG_XTREAM_LISTING_LIMIT,
  fillUrlTemplate,
  guideDirectorySources,
  type DeclaredXmltvSource,
  type EpgSource,
  type GuideDirectorySource,
  type XtreamSource,
} from "@/lib/epg-sources";
import { extractChannelProgrammes, extractProgrammesByChannel, parseGuideChannels } from "@/lib/epg-xmltv";
import { parseXtreamShortEpg, xtreamAccount, xtreamShortEpgUrl, xtreamStreamId } from "@/lib/epg-xtream";
import { errorMessage } from "@/lib/errors";
import { djb2 } from "@/lib/hash";
import { isHttpUrl } from "@/lib/url";

// The guide resolver: walks EPG_SOURCES (lib/epg-sources.ts) in order when the
// user opens a channel's guide and returns the first source that has
// programmes for it. Everything is lazy and per channel; results and misses are
// cached per device so the player overlay can ask on every zap.

export type EpgErrorCode = "no-source" | "no-match" | "fetch-failed";

/** A user-presentable resolution failure (the panel renders `.message`). */
export class EpgError extends Error {
  constructor(
    readonly code: EpgErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EpgError";
  }
}

export type ResolvedGuide = {
  programmes: Programme[];
  /** Source id (lib/epg-sources.ts) or the XMLTV URL for a declared guide. */
  source: string;
  sourceLabel: string;
  /** Channel id inside the source. */
  channelId: string;
  /** Channel name inside the source, when the source has one. */
  channelName?: string;
};

export type ResolveStep = { source: string; label: string };

export type ResolveOptions = {
  /** Called as each source is consulted — drives the panel's status line. */
  onStep?: (step: ResolveStep) => void;
  /** The device's country (locale), the last clue for a channel's country. */
  deviceCountry?: string;
};

type Context = {
  bridge: HostBridge;
  playlist: Playlist;
  channel: Channel;
  opts: ResolveOptions;
  /** Sources that answered but don't list the channel (a picker can fix it). */
  unmatched: number;
  /** Network/parsing failures, for the final message. */
  failures: string[];
};

const XMLTV_NS = "xml";
/** Label of a guide reached through a URL the user pasted (no configured source). */
const DECLARED_LABEL = EPG_SOURCES.find((s) => s.kind === "declared-xmltv")?.label ?? "Playlist guide";

// ── Xtream Codes ─────────────────────────────────────────────────────────────

async function fromXtream(ctx: Context, source: XtreamSource): Promise<ResolvedGuide | undefined> {
  const account = xtreamAccount(ctx.playlist.sourceUrl);
  if (!account) return undefined;
  const streamId = xtreamStreamId(ctx.channel.url, account);
  if (!streamId) return undefined;
  ctx.opts.onStep?.({ source: source.id, label: source.label });
  const url = xtreamShortEpgUrl(account, streamId, EPG_XTREAM_LISTING_LIMIT);
  const programmes = await cachedProgrammes(ctx.bridge, url, streamId, async () =>
    parseXtreamShortEpg(JSON.parse(await ctx.bridge.httpGet(url)), streamId),
  );
  if (!programmes.length) {
    ctx.unmatched++;
    return undefined;
  }
  return { programmes, source: source.id, sourceLabel: source.label, channelId: streamId };
}

// ── declared XMLTV guides ────────────────────────────────────────────────────

/** Ids under which `channel` may appear in an XMLTV guide, most specific first. */
function xmltvIdCandidates(ctx: Context, url: string): string[] {
  const bound = userBinding(ctx.playlist, ctx.channel, url)?.channelId;
  const tvgId = ctx.channel.tvgId?.trim();
  const ids = [bound, tvgId, tvgId ? baseTvgId(tvgId) : undefined];
  return ids.filter((id, i): id is string => !!id && ids.indexOf(id) === i);
}

/** The playlist's other channels whose tvg-id lets them ride the same download. */
function preloadIds(ctx: Context): Set<string> {
  const ids = new Set<string>();
  for (const c of ctx.playlist.entries) {
    if (ids.size >= EPG_PRELOAD_CHANNELS_MAX) break;
    if (c.id !== ctx.channel.id && c.tvgId) ids.add(baseTvgId(c.tvgId));
  }
  return ids;
}

async function fromXmltvUrl(ctx: Context, url: string, label: string): Promise<ResolvedGuide | undefined> {
  const candidates = xmltvIdCandidates(ctx, url);
  for (const id of candidates) {
    const hit = readCachedProgrammes(ctx.bridge, url, id);
    if (hit) return { programmes: hit, source: url, sourceLabel: label, channelId: id };
  }

  ctx.opts.onStep?.({ source: url, label });
  const xml = await cachedFetchText(ctx.bridge, url, XMLTV_NS, EPG_PROGRAMMES_TTL_MS);

  // No usable id → match our name against the guide's own channel list.
  let matched: GuideChannel | undefined;
  if (!candidates.length) {
    matched = matchGuideChannel(ctx.channel, indexGuideChannels(parseGuideChannels(xml)));
    if (matched) candidates.push(matched.id);
  }

  // One pass extracts the requested channel AND the playlist's siblings, so the
  // next guide opened from this playlist never re-downloads the file.
  const wanted = new Set([...candidates, ...preloadIds(ctx)]);
  const byChannel = extractProgrammesByChannel(xml, wanted);
  for (const [id, programmes] of byChannel) {
    if (programmes.length) writeCachedProgrammes(ctx.bridge, url, id, programmes);
  }
  for (const id of candidates) {
    const programmes = byChannel.get(id);
    if (programmes?.length) {
      return { programmes, source: url, sourceLabel: label, channelId: id, channelName: matched?.name };
    }
  }
  ctx.unmatched++;
  return undefined;
}

async function fromDeclared(ctx: Context, source: DeclaredXmltvSource): Promise<ResolvedGuide | undefined> {
  for (const url of ctx.playlist.epg?.sources ?? []) {
    try {
      const guide = await fromXmltvUrl(ctx, url, source.label);
      if (guide) return guide;
    } catch (e) {
      ctx.failures.push(errorMessage(e, "Could not load the guide."));
    }
  }
  return undefined;
}

// ── public guide directories ─────────────────────────────────────────────────

function autoBindingKey(source: GuideDirectorySource, ctx: Context): string {
  return `epg:bind:${source.id}:${ctx.playlist.id}:${ctx.channel.id}`;
}

/** The country whose directory to search for `channel` in `source`, if covered. */
export function guideCountryFor(channel: Channel, source: GuideDirectorySource, deviceCountry?: string): string | undefined {
  const country = inferCountry(channel, deviceCountry);
  return directoryCovers(source, country) ? country : undefined;
}

/** Match by name against the country directory; the outcome (even a miss) is
 *  remembered per device so zapping never re-downloads the directory. */
async function autoMatch(ctx: Context, source: GuideDirectorySource, country: string): Promise<GuideChannel | undefined> {
  const key = autoBindingKey(source, ctx);
  const remembered = readCachedJson<GuideChannel | null>(ctx.bridge, key, source.directoryTtlMs);
  if (remembered !== undefined) return remembered ?? undefined;
  const directory = await loadGuideDirectory(ctx.bridge, source, country);
  const match = matchGuideChannel(ctx.channel, indexGuideChannels(directory));
  writeCachedJson(ctx.bridge, key, match ?? null);
  return match;
}

async function fromDirectory(ctx: Context, source: GuideDirectorySource): Promise<ResolvedGuide | undefined> {
  const bound = userBinding(ctx.playlist, ctx.channel, source.id);
  let target: GuideChannel | undefined = bound ? { id: bound.channelId, name: bound.name ?? ctx.channel.name } : undefined;
  if (!target) {
    const country = guideCountryFor(ctx.channel, source, ctx.opts.deviceCountry);
    if (!country) return undefined;
    ctx.opts.onStep?.({ source: source.id, label: source.label });
    target = await autoMatch(ctx, source, country);
    if (!target) {
      ctx.unmatched++;
      return undefined;
    }
  }
  const { id, name } = target;
  const url = fillUrlTemplate(source.channelUrl, { ID: id });
  const programmes = await cachedProgrammes(ctx.bridge, url, id, async () =>
    extractChannelProgrammes(await fetchGuideText(ctx.bridge, url), id),
  );
  if (!programmes.length) {
    ctx.unmatched++;
    return undefined;
  }
  return { programmes, source: source.id, sourceLabel: source.label, channelId: id, channelName: name };
}

// ── the cascade ──────────────────────────────────────────────────────────────

async function consult(ctx: Context, source: EpgSource): Promise<ResolvedGuide | undefined> {
  try {
    switch (source.kind) {
      case "xtream":
        return await fromXtream(ctx, source);
      case "declared-xmltv":
        return await fromDeclared(ctx, source);
      case "guide-directory":
        return await fromDirectory(ctx, source);
    }
  } catch (e) {
    ctx.failures.push(errorMessage(e, "Could not load the guide."));
    return undefined;
  }
}

/** A choice the user made in the picker wins over the cascade order. */
async function consultUserBinding(ctx: Context): Promise<ResolvedGuide | undefined> {
  const bound = ctx.playlist.epg?.bindings?.[ctx.channel.id];
  if (!bound) return undefined;
  const source = EPG_SOURCES.find((s) => s.id === bound.source);
  if (source?.kind === "guide-directory") return consult(ctx, source);
  if (isHttpUrl(bound.source)) {
    try {
      return await fromXmltvUrl(ctx, bound.source, DECLARED_LABEL);
    } catch (e) {
      ctx.failures.push(errorMessage(e, "Could not load the guide."));
    }
  }
  return undefined;
}

function finalError(ctx: Context): EpgError {
  if (ctx.unmatched) return new EpgError("no-match", "No guide found for this channel yet.");
  if (ctx.failures.length) return new EpgError("fetch-failed", ctx.failures[0]);
  return new EpgError("no-source", "No guide covers this channel yet.");
}

/** Misses are remembered per (playlist, channel, guide configuration): editing
 *  the sources or a binding changes the key, so a fix is retried at once. */
function missKey(playlist: Playlist, channel: Channel): string {
  const config = JSON.stringify([playlist.epg?.sources ?? [], playlist.epg?.bindings?.[channel.id] ?? null, playlist.sourceUrl ?? ""]);
  return `epg:miss:${playlist.id}:${channel.id}:${djb2(config).toString(36)}`;
}

type Miss = { code: EpgErrorCode; message: string };

/**
 * Resolve the programmes of one channel, walking the configured sources in
 * order. Throws an {@link EpgError} with a user-presentable message when none
 * covers the channel; `code` tells the UI which remedy to offer.
 */
export async function resolveChannelGuide(
  bridge: HostBridge,
  playlist: Playlist,
  channel: Channel,
  opts: ResolveOptions = {},
): Promise<ResolvedGuide> {
  const miss = readCachedJson<Miss>(bridge, missKey(playlist, channel), EPG_MISS_TTL_MS);
  if (miss) throw new EpgError(miss.code, miss.message);

  const ctx: Context = { bridge, playlist, channel, opts, unmatched: 0, failures: [] };
  const chosen = await consultUserBinding(ctx);
  if (chosen) return chosen;
  for (const source of EPG_SOURCES) {
    const guide = await consult(ctx, source);
    if (guide) return guide;
  }
  const error = finalError(ctx);
  // A transient network failure must not silence the guide for half an hour.
  if (error.code !== "fetch-failed") {
    writeCachedJson<Miss>(bridge, missKey(playlist, channel), { code: error.code, message: error.message });
  }
  throw error;
}

// ── manual choice (the picker) ───────────────────────────────────────────────

export type GuideChoices = {
  source: GuideDirectorySource;
  /** Country whose directory is listed; undefined until the user picks one. */
  country?: string;
  /** Directory channels, most likely match first. */
  channels: GuideChannel[];
};

/**
 * What the picker shows when the user wants to choose (or correct) the guide
 * channel: the first configured directory's channels for the channel's
 * country (or `country` when the user overrides it). Undefined when no
 * directory source is configured.
 */
export async function loadGuideChoices(
  bridge: HostBridge,
  channel: Channel,
  country?: string,
  deviceCountry?: string,
): Promise<GuideChoices | undefined> {
  const source = guideDirectorySources()[0];
  if (!source) return undefined;
  const target = country ?? guideCountryFor(channel, source, deviceCountry);
  if (!directoryCovers(source, target)) return { source, channels: [] };
  const channels = await loadGuideDirectory(bridge, source, target);
  return { source, country: target, channels: rankGuideChannels(channel, channels) };
}
