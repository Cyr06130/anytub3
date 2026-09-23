import type { Channel, ChannelEpg, Playlist, Programme } from "@/types";
import { getBridge } from "@/lib/bridge";
import { deviceCountry } from "@/lib/country";
import { resolveChannelGuide, loadGuideChoices, type GuideChoices, type ResolveStep } from "@/lib/epg-resolve";

export { EpgError, type EpgErrorCode } from "@/lib/epg-resolve";
export { extractChannelProgrammes } from "@/lib/epg-xmltv";

// EPG = the programmes for a channel, resolved on demand (lib/epg-resolve.ts).
//
// Design notes:
//  - Lazy: nothing is fetched until the user opens a channel's guide. Only that
//    channel's programmes are kept — bounding both network and RAM.
//  - Untrusted: guides come from third parties. XML is parsed with the
//    browser's DOMParser (no external-entity resolution → XXE-safe), icons are
//    http(s) only, and React escapes all text. Same posture as shared playlists.

const MAX_UPCOMING = 30; // programmes surfaced in the panel

// ── now / next ───────────────────────────────────────────────────────────────

/**
 * Current programme at `at` + the one right after, from a list sorted by start.
 * Single authority for the guide UIs too (they re-derive on a live clock).
 */
export function nowAndNext(sorted: Programme[], at: number): { now?: Programme; next?: Programme } {
  const now = sorted.find((p) => p.start <= at && at < p.stop);
  const next = now ? sorted[sorted.indexOf(now) + 1] : sorted.find((p) => p.start > at);
  return { now, next };
}

function computeNowNext(
  programmes: Programme[],
  at: number,
): { now?: Programme; next?: Programme; upcoming: Programme[] } {
  const sorted = [...programmes].sort((a, b) => a.start - b.start);
  const upcoming = sorted.filter((p) => p.stop > at).slice(0, MAX_UPCOMING);
  return { ...nowAndNext(sorted, at), upcoming };
}

/** Fraction [0,1] of `p` elapsed at `at` — drives the progress bar. */
export function progress(p: Programme, at: number = Date.now()): number {
  const span = p.stop - p.start;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (at - p.start) / span));
}

// ── public entry points ──────────────────────────────────────────────────────

/**
 * Load the guide for one channel — the single thing the EPG panel and the
 * player overlay call. Throws an {@link EpgError} with a user-presentable
 * message when no configured source covers the channel.
 */
export async function getChannelEpg(
  playlist: Playlist,
  channel: Channel,
  opts: { at?: number; onStep?: (step: ResolveStep) => void } = {},
): Promise<ChannelEpg> {
  const at = opts.at ?? Date.now();
  const bridge = await getBridge();
  const guide = await resolveChannelGuide(bridge, playlist, channel, {
    onStep: opts.onStep,
    deviceCountry: deviceCountry(),
  });
  return {
    channelId: guide.channelId,
    ...computeNowNext(guide.programmes, at),
    source: guide.source,
    sourceLabel: guide.sourceLabel,
    sourceChannelName: guide.channelName,
  };
}

/** The public directory's channels the user can pick from for `channel`. */
export async function getGuideChoices(channel: Channel, country?: string): Promise<GuideChoices | undefined> {
  return loadGuideChoices(await getBridge(), channel, country, deviceCountry());
}

export type { GuideChoices, ResolveStep };
