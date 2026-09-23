// CID ↔ Bulletin preimage-key codecs, byte-compatible with
// @parity/product-sdk-cloud-storage's `hashToCid`/`cidToPreimageKey` defaults
// (verified by cid.test.ts against the SDK itself).
//
// Why a local copy: the SDK package drags polkadot-api and ~2MB of chain
// metadata into the chunk graph, and a single failed chunk load in a host
// webview used to take the WHOLE Bulletin path down — for what is, on the
// sponsored preimage path, just this pair of pure string codecs.

const CID_VERSION = 1;
const CODEC_RAW = 0x55;
const CODEC_DAG_PB = 0x70;
const HASH_BLAKE2B_256 = 0xb220;
const HASH_SHA2_256 = 0x12;
const DIGEST_LENGTH = 32;

const SUPPORTED_CODECS = new Set([CODEC_RAW, CODEC_DAG_PB]);
const SUPPORTED_HASHES = new Set([HASH_BLAKE2B_256, HASH_SHA2_256]);

// RFC 4648 base32, lowercase, no padding — the CIDv1 `b` multibase.
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const BASE32_LOOKUP = new Map([...BASE32_ALPHABET].map((c, i) => [c, i]));

function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  let buffer = 0;
  let bits = 0;
  let i = 0;
  for (const c of s) {
    const value = BASE32_LOOKUP.get(c);
    if (value === undefined) throw new Error(`Invalid base32 character "${c}" in CID`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out[i++] = (buffer >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out;
}

function varintEncode(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

/** Decode a varint at `offset`; returns the value and the next offset. */
function varintDecode(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let value = 0;
  let shift = 0;
  for (let i = offset; i < bytes.length; i++) {
    value |= (bytes[i] & 0x7f) << shift;
    if ((bytes[i] & 0x80) === 0) return [value >>> 0, i + 1];
    shift += 7;
  }
  throw new Error("Truncated varint in CID");
}

/**
 * Wrap a 32-byte content hash (`0x`-prefixed hex — a Bulletin preimage key)
 * into a CIDv1 string: raw codec + blake2b-256 multihash, base32 multibase —
 * the SDK's defaults, so CIDs stay identical to previously stored ones.
 */
export function hashToCid(hexHash: `0x${string}`): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hexHash)) {
    throw new Error(`Expected a 0x-prefixed 32-byte hex hash, got: ${hexHash.slice(0, 20)}…`);
  }
  const digest = new Uint8Array(DIGEST_LENGTH);
  for (let i = 0; i < DIGEST_LENGTH; i++) {
    digest[i] = Number.parseInt(hexHash.slice(2 + i * 2, 4 + i * 2), 16);
  }
  const bytes = Uint8Array.from([
    CID_VERSION,
    CODEC_RAW,
    ...varintEncode(HASH_BLAKE2B_256),
    DIGEST_LENGTH,
    ...digest,
  ]);
  return `b${base32Encode(bytes)}`;
}

/** Extract the 32-byte content hash from a CIDv1 as a `0x` hex preimage key. */
export function cidToPreimageKey(cid: string): `0x${string}` {
  if (!cid.startsWith("b")) throw new Error(`Expected a base32 CIDv1 (multibase "b"), got: ${cid.slice(0, 12)}…`);
  const bytes = base32Decode(cid.slice(1));
  if (bytes[0] !== CID_VERSION) throw new Error(`Expected CIDv1, got version ${bytes[0]}`);
  const [codec, afterCodec] = varintDecode(bytes, 1);
  if (!SUPPORTED_CODECS.has(codec)) throw new Error(`Unsupported CID codec 0x${codec.toString(16)}`);
  const [hashCode, afterHash] = varintDecode(bytes, afterCodec);
  if (!SUPPORTED_HASHES.has(hashCode)) throw new Error(`Unsupported hash algorithm 0x${hashCode.toString(16)}`);
  const [length, digestStart] = varintDecode(bytes, afterHash);
  if (length !== DIGEST_LENGTH || bytes.length < digestStart + DIGEST_LENGTH) {
    throw new Error(`Expected a ${DIGEST_LENGTH}-byte digest in CID`);
  }
  let hex = "";
  for (let i = digestStart; i < digestStart + DIGEST_LENGTH; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return `0x${hex}`;
}
