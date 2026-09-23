import { gcm } from "@noble/ciphers/aes.js";

// AES-256-GCM in the "packed" layout: nonce(12) ‖ ciphertext+tag(16).
// BYTE-COMPATIBLE with product-sdk-crypto's aesGcmEncryptPacked/DecryptPacked
// (cross-tested against the SDK in aes.test.ts) — these decrypt every blob
// already stored on Bulletin. Implemented over @noble/ciphers directly because
// the SDK barrel re-exports tweetnacl (CommonJS, untree-shakable), putting
// ~60 KB of unused NaCl on the first-paint path for two small functions.

const NONCE_LENGTH = 12;
const AES_KEY_LENGTH = 32;
const TAG_LENGTH = 16;

function validateKey(key: Uint8Array): void {
  if (key.length !== AES_KEY_LENGTH) {
    throw new Error(`AES-256-GCM requires a 32-byte key, got ${key.length}`);
  }
}

export function aesGcmEncryptPacked(data: Uint8Array, key: Uint8Array): Uint8Array {
  validateKey(key);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
  const ciphertext = gcm(key, nonce).encrypt(data);
  const packed = new Uint8Array(NONCE_LENGTH + ciphertext.length);
  packed.set(nonce, 0);
  packed.set(ciphertext, NONCE_LENGTH);
  return packed;
}

export function aesGcmDecryptPacked(packed: Uint8Array, key: Uint8Array): Uint8Array {
  validateKey(key);
  if (packed.length < NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("Packed data too short");
  }
  const nonce = packed.subarray(0, NONCE_LENGTH);
  const ciphertext = packed.subarray(NONCE_LENGTH);
  return gcm(key, nonce).decrypt(ciphertext);
}
