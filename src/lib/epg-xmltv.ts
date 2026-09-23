import type { GuideChannel, Programme } from "@/types";
import { isHttpUrl } from "@/lib/url";

// XMLTV parsing. Guides are third-party, untrusted and often huge, so blocks
// are located by string scanning and each one is parsed in isolation with the
// browser's DOMParser (no external-entity resolution → XXE-safe; a malformed
// block is skipped, never throws). Text reaches the UI through React only.

export const UNTITLED_PROGRAMME = "Untitled programme";
const MAX_PROGRAMMES = 500; // per channel — memory bound on a hostile/huge guide

// ── time ─────────────────────────────────────────────────────────────────────
// Format: `YYYYMMDDHHMMSS ±HHMM` (offset optional; seconds/minutes optional).
const XMLTV_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*([+-]\d{4})?/;

export function parseXmltvTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = XMLTV_TIME.exec(s.trim());
  if (!m) return null;
  const [, Y, Mo, D, h = "00", mi = "00", se = "00", tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "+00:00"; // default UTC
  const t = Date.parse(`${Y}-${Mo}-${D}T${h}:${mi}:${se}${offset}`);
  return Number.isNaN(t) ? null : t;
}

// ── block scanning ───────────────────────────────────────────────────────────

function openingTag(block: string): string {
  const gt = block.indexOf(">");
  return gt < 0 ? block : block.slice(0, gt);
}

function attrValue(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag);
  return m?.[1];
}

/** Every complete `<tag …>…</tag>` block of `xml`, in order. A (DTD-invalid)
 *  self-closing `<tag/>` is skipped so it can't swallow the next entry. */
function* elementBlocks(xml: string, tag: string): Generator<string> {
  const OPEN = `<${tag}`;
  const CLOSE = `</${tag}>`;
  let from = 0;
  for (;;) {
    const start = xml.indexOf(OPEN, from);
    if (start < 0) return;
    const tagEnd = xml.indexOf(">", start);
    if (tagEnd < 0) return;
    if (xml[tagEnd - 1] === "/") {
      from = tagEnd + 1;
      continue;
    }
    const close = xml.indexOf(CLOSE, start);
    if (close < 0) return;
    const end = close + CLOSE.length;
    from = end;
    yield xml.slice(start, end);
  }
}

function parseElement(block: string, tag: string): Element | null {
  const doc = new DOMParser().parseFromString(block, "text/xml");
  const el = doc.documentElement;
  if (!el || el.nodeName !== tag || doc.getElementsByTagName("parsererror").length) return null;
  return el;
}

function childText(el: Element, tag: string): string | undefined {
  return el.getElementsByTagName(tag)[0]?.textContent?.trim() || undefined;
}

// ── programmes ───────────────────────────────────────────────────────────────

function parseProgramme(block: string, channelId: string): Programme | null {
  const el = parseElement(block, "programme");
  if (!el) return null;
  const start = parseXmltvTime(el.getAttribute("start"));
  const stop = parseXmltvTime(el.getAttribute("stop"));
  if (start == null || stop == null || stop <= start) return null;
  const iconSrc = el.getElementsByTagName("icon")[0]?.getAttribute("src")?.trim();
  return {
    channelId,
    start,
    stop,
    title: childText(el, "title") || UNTITLED_PROGRAMME,
    desc: childText(el, "desc"),
    category: childText(el, "category"),
    icon: isHttpUrl(iconSrc) ? iconSrc : undefined, // http(s) only
  };
}

/**
 * One pass over the guide: the programmes (≤ MAX_PROGRAMMES each) of every
 * channel in `channelIds`. Blocks of other channels are never parsed, so a
 * multi-channel guide doesn't materialize a giant DOM.
 */
export function extractProgrammesByChannel(xml: string, channelIds: ReadonlySet<string>): Map<string, Programme[]> {
  const out = new Map<string, Programme[]>();
  for (const id of channelIds) out.set(id, []);
  for (const block of elementBlocks(xml, "programme")) {
    const id = attrValue(openingTag(block), "channel");
    const list = id === undefined ? undefined : out.get(id);
    if (!list || list.length >= MAX_PROGRAMMES) continue;
    const p = parseProgramme(block, id!);
    if (p) list.push(p);
  }
  return out;
}

/** Programmes of a single channel (see {@link extractProgrammesByChannel}). */
export function extractChannelProgrammes(xml: string, channelId: string): Programme[] {
  return extractProgrammesByChannel(xml, new Set([channelId])).get(channelId) ?? [];
}

// ── channel directory ────────────────────────────────────────────────────────

const MAX_ID_LENGTH = 128;

/**
 * The `<channel id>` + first `<display-name>` pairs of a guide (or of its
 * streamed header — a truncated trailing block is simply ignored).
 */
export function parseGuideChannels(xml: string): GuideChannel[] {
  const out: GuideChannel[] = [];
  const seen = new Set<string>();
  for (const block of elementBlocks(xml, "channel")) {
    const el = parseElement(block, "channel");
    if (!el) continue;
    const id = el.getAttribute("id")?.trim();
    const name = childText(el, "display-name");
    if (!id || id.length > MAX_ID_LENGTH || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}
