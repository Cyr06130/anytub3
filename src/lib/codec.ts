// Compression for the per-device EPG cache.
//
// Why gzip (and not Zstandard): a zstd browser codec ships as WebAssembly, which
// needs `wasm-unsafe-eval` in the CSP `script-src`. We do NOT control the CSP
// inside the Polkadot host — the product's primary runtime — so a WASM codec
// could silently break EPG in-host. `CompressionStream` is a native browser API
// (Chromium/WebKit, all host webviews), needs no CSP change and no dependency,
// and still strips ~80% off XMLTV text.
//
// The encoded blob is `base64( [codec-tag byte] ++ payload )`. The tag lets a
// stronger codec (e.g. zstd) be slotted in later without invalidating blobs
// already cached on a device — `decompressText` dispatches on the tag and an
// unknown/old tag is treated as raw.

import { base64FromBytes, bytesFromBase64 } from "@/lib/bytes";

const CODEC_RAW = 0x52; // 'R' — stored uncompressed (CompressionStream absent)
const CODEC_GZIP = 0x47; // 'G' — gzip via CompressionStream

function hasCompressionStream(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

async function pipe(stream: TransformStream, input: Uint8Array): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // Deliberately un-awaited (awaiting would deadlock on backpressure), but
  // observed: on corrupt input both reject alongside the readable — the read
  // below carries the error, these must not fire unhandledrejection too.
  writer.write(input).catch(() => undefined);
  writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

const gzip = (b: Uint8Array) => pipe(new CompressionStream("gzip"), b);
const gunzip = (b: Uint8Array) => pipe(new DecompressionStream("gzip"), b);

function tagged(tag: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = tag;
  out.set(payload, 1);
  return out;
}

/** Compress text → base64 blob suitable for a string KV cache. */
export async function compressText(text: string): Promise<string> {
  const raw = new TextEncoder().encode(text);
  if (hasCompressionStream()) {
    return base64FromBytes(tagged(CODEC_GZIP, await gzip(raw)));
  }
  return base64FromBytes(tagged(CODEC_RAW, raw));
}

/** Inverse of {@link compressText}. */
export async function decompressText(blob: string): Promise<string> {
  const bytes = bytesFromBase64(blob);
  const tag = bytes[0];
  const payload = bytes.subarray(1);
  const raw = tag === CODEC_GZIP ? await gunzip(payload) : payload;
  return new TextDecoder().decode(raw);
}
