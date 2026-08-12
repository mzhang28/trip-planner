import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';
import type { Db } from './db';
import { fileLinkSecret } from './identity';

/**
 * A link lasts a day.
 *
 * Long enough that an agent given a list of files can still fetch one after
 * thinking about it, short enough that a link copied into a transcript stops
 * working before the transcript is somewhere it should not be.
 */
const LINK_TTL_MS = 24 * 60 * 60 * 1000;

function sign(secret: string, hash: string, expiresAt: number): string {
  return createHmac('sha256', secret).update(`${hash}.${expiresAt}`).digest('base64url');
}

/**
 * An address for a file that authorises itself.
 *
 * Whatever follows this holds no session and no bearer token — it is a model
 * being handed a URL — so the permission has to travel in the URL. It is signed
 * rather than looked up so that listing twenty files does not write twenty rows.
 *
 * Absolute, because the thing following it is not a browser sitting on the page
 * and has no origin to resolve against.
 */
export function fileLink(db: Db, hash: string, mime?: string): string {
  const expiresAt = Date.now() + LINK_TTL_MS;
  const query = new URLSearchParams({
    expires: String(expiresAt),
    sig: sign(fileLinkSecret(db), hash, expiresAt),
  });

  if (mime) query.set('mime', mime);

  return `${config.PUBLIC_URL}/files/${hash}?${query.toString()}`;
}

/** Whether this signature was made here, for this file, and is still in date. */
export function fileLinkIsValid(db: Db, hash: string, expires: string, sig: string): boolean {
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;

  const expected = Buffer.from(sign(fileLinkSecret(db), hash, expiresAt));
  const offered = Buffer.from(sig);

  // Compared in constant time. Byte-at-a-time comparison leaks where the first
  // difference is, which is enough to build a valid signature one byte at a go.
  return expected.length === offered.length && timingSafeEqual(expected, offered);
}

export { LINK_TTL_MS };
