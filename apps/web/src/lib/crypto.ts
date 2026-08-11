import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/*
 * Both of these work without a secure context.
 *
 * `crypto.randomUUID` and `crypto.subtle` are only defined on HTTPS or on
 * localhost. A dev server reached by hostname over plain HTTP has neither, and
 * without a fallback the app cannot create an event or attach a file there --
 * it fails on the two things it exists to do.
 *
 * `crypto.getRandomValues` has no such restriction, so the ids stay properly
 * random either way. The hash falls back to an audited implementation rather
 * than one written here, because a wrong hash is a file stored under a name
 * that is not its content, which is the one thing the blob store promises.
 */

/** A short random id. Not a UUID, but random from the same source. */
export function randomId(bytes = 16): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();

  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);

  return bytesToHex(values);
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return bytesToHex(new Uint8Array(digest));
  }

  return bytesToHex(sha256(new Uint8Array(bytes)));
}
