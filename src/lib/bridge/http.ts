import { isHttpUrl } from "@/lib/url";

// Shared http(s) fetch helpers for both bridges. The scheme check lives here
// (not only in callers) so a javascript:/file:/data: URL can never be fetched.

async function open(url: string): Promise<Response> {
  if (!isHttpUrl(url)) throw new Error("Only http(s) URLs are supported.");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function fetchText(url: string): Promise<string> {
  return (await open(url)).text();
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await open(url)).arrayBuffer());
}

export type PrefixOptions = {
  /** Stop reading at the first occurrence of this marker (excluded). */
  until: string;
  /** Stop reading after this many bytes even without the marker. */
  maxBytes: number;
};

/** `text` up to (excluding) the first `marker`, or all of it. */
export function cutAt(text: string, marker: string): string {
  const i = text.indexOf(marker);
  return i < 0 ? text : text.slice(0, i);
}

/**
 * Read the beginning of a (possibly huge) text resource and cancel the download
 * as soon as `until` shows up. The browser transparently inflates a
 * Content-Encoding: gzip body, so a 15 MB country guide costs ~60 KB when only
 * its <channel> header is wanted.
 */
export async function fetchTextPrefix(url: string, { until, maxBytes }: PrefixOptions): Promise<string> {
  const res = await open(url);
  const reader = res.body?.getReader();
  if (!reader) return cutAt(await res.text(), until);

  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return cutAt(text + decoder.decode(), until);
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    const markerAt = text.indexOf(until);
    if (markerAt >= 0 || received >= maxBytes) {
      void reader.cancel().catch(() => undefined);
      return markerAt >= 0 ? text.slice(0, markerAt) : text;
    }
  }
}
